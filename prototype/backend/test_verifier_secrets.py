"""Tests du controle de secrets lance par la CI (scripts/verifier_secrets.py).

Les fausses cles sont ASSEMBLEES a l'execution : ecrites en clair, elles
feraient echouer le controle sur ce fichier lui-meme.
"""

from __future__ import annotations

import base64
import gzip
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
import verifier_secrets as vs  # noqa: E402


def _regles(texte: str) -> set[str]:
    return {regle for regle, _ in vs.chercher(texte)}


class DetectionTests(unittest.TestCase):
    def test_cles_au_format_connu(self) -> None:
        cas = {
            "cle Google / Gemini": "AIza" + "Sy" + "B" * 33,
            "cle Groq": "gsk_" + "a1B2" * 8,
            "cle OpenAI": "sk-" + "proj-" + "x9Y8" * 8,
            "jeton GitHub": "ghp_" + "Q" * 36,
            "cle AWS": "AKIA" + "ABCDEFGHIJKLMNOP",
            "cle privee": "-----BEGIN " + "RSA PRIVATE KEY-----",
        }
        for regle, secret in cas.items():
            with self.subTest(regle=regle):
                self.assertIn(regle, _regles(f'const cle = "{secret}";'))

    def test_secret_jamais_affiche_en_clair(self) -> None:
        secret = "AIza" + "Sy" + "C" * 33
        extraits = [extrait for _, extrait in vs.chercher(secret)]
        self.assertTrue(extraits)
        self.assertNotIn(secret, " ".join(extraits))

    def test_chaine_de_connexion_reelle(self) -> None:
        url = "postgresql://neondb_owner:" + "npg_Zt8Kq" + "@ep-real-host-1.eu-central-1.aws.neon.tech/neondb"
        self.assertIn("chaine de connexion avec mot de passe", _regles(url))

    def test_cle_mistral_par_son_nom(self) -> None:
        self.assertIn("affectation d'une cle", _regles("MISTRAL_API_KEY=" + "k3Y" * 11))

    def test_exemples_de_documentation_ignores(self) -> None:
        for texte in [
            "DATABASE_URL: postgresql://postgres:postgres@localhost:5432/parcours",
            "postgresql://mon_user:mon_mot_de_passe@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb",
            "Format `postgresql://user:mdp@hôte/base?sslmode=require`",
            "GEMINI_API_KEY=your_gemini_api_key_here",
            'api_key = os.getenv("GEMINI_API_KEY")',
            "DATABASE_URL = _normaliser_url(os.environ.get('DATABASE_URL'))",
        ]:
            with self.subTest(texte=texte):
                self.assertEqual(vs.chercher(texte), [])

    def test_ressources_compressees_d_une_page_bundlee(self) -> None:
        script = ('fetch(u, {headers: {"x-goog-api-key": "' + "AIza" + "Sy" + "D" * 33 + '"}})').encode()
        manifeste = {
            "abc": {"mime": "text/javascript", "compressed": True,
                    "data": base64.b64encode(gzip.compress(script)).decode()},
            "img": {"mime": "image/png", "compressed": False, "data": base64.b64encode(b"\x89PNG").decode()},
        }
        page = f'<script type="__bundler/manifest">{json.dumps(manifeste)}</script>'
        # La cle est invisible dans le HTML brut (compressee)...
        self.assertEqual(vs.chercher(page), [])
        # ...mais retrouvee une fois la ressource decodee.
        ressources = vs._ressources_bundle(page)
        self.assertEqual([cle for cle, _ in ressources], ["abc"])
        self.assertIn("cle Google / Gemini", _regles(ressources[0][1]))


class FichiersInterditsTests(unittest.TestCase):
    def _interdit(self, chemin: str) -> bool:
        if chemin in vs.FICHIERS_AUTORISES:
            return False
        return any(motif.search(chemin) for motif, _ in vs.FICHIERS_INTERDITS)

    def test_fichiers_sensibles(self) -> None:
        for chemin in [
            ".env",
            "prototype/.env",
            "prototype/backend/.env.production",
            "prototype/backend/google-tts-credentials.json",
            "cle.pem",
            "prototype/backend/data/parcours.db",
            "prototype/frontend/map.js.map",
        ]:
            with self.subTest(chemin=chemin):
                self.assertTrue(self._interdit(chemin))

    def test_fichiers_legitimes(self) -> None:
        for chemin in ["prototype/.env.example", "prototype/frontend/map.js", "README.md"]:
            with self.subTest(chemin=chemin):
                self.assertFalse(self._interdit(chemin))


class DepotTests(unittest.TestCase):
    def test_le_depot_est_propre(self) -> None:
        self.assertEqual(vs.verifier_arbre(), [])


if __name__ == "__main__":
    unittest.main()
