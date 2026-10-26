"""Tests de robustesse de l'API de jeu : identifiants d'exercice uniques,
caches memoire bornes (avec relecture disque des exercices evinces) et bornes
de taille sur les entrees libres."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from generation.substitution import generer_exercice, patterns_disponibles_pour_niveau
from main import CacheBorne, app


class IdentifiantsExerciceTests(unittest.TestCase):
    def test_pas_de_collision_sur_un_grand_nombre_d_exercices(self) -> None:
        pattern = patterns_disponibles_pour_niveau("CE1")[0]
        ids = {generer_exercice(pattern, "CE1")["id"] for _ in range(3000)}
        # Avec l'ancien suffixe a 6 chiffres, 3 000 tirages produisaient
        # presque surement au moins une collision.
        self.assertEqual(len(ids), 3000)
        self.assertTrue(all(i.startswith(f"CE1-{pattern}-") for i in ids))


class CacheBorneTests(unittest.TestCase):
    def test_evince_le_moins_recemment_utilise(self) -> None:
        cache = CacheBorne(2)
        cache["a"], cache["b"] = 1, 2
        self.assertEqual(cache.get("a"), 1)  # "a" redevient recent
        cache["c"] = 3
        self.assertNotIn("b", cache)
        self.assertEqual(list(cache), ["a", "c"])

    def test_se_comporte_comme_un_dict(self) -> None:
        cache = CacheBorne(10)
        cache.update({"x": 1})
        self.assertEqual(cache["x"], 1)
        self.assertIsNone(cache.get("absent"))
        cache.clear()
        self.assertEqual(len(cache), 0)


class SessionApresEvictionTests(unittest.TestCase):
    """Une session dont l'exercice a ete evince du cache memoire continue de
    fonctionner : l'exercice est relu depuis le fichier de session."""

    def setUp(self) -> None:
        self.dossier = Path(tempfile.mkdtemp())
        self.patch = patch.object(main, "SESSIONS_DIR", self.dossier)
        self.patch.start()
        main.EXERCICE_CACHE.clear()
        main.SESSION_STATE.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.patch.stop()
        shutil.rmtree(self.dossier, ignore_errors=True)
        main.EXERCICE_CACHE.clear()
        main.SESSION_STATE.clear()

    def test_evaluation_apres_eviction_de_l_exercice(self) -> None:
        demarrage = self.client.post("/session/demarrer", json={"niveau_scolaire": "CE1"}).json()
        exercice = demarrage["exercice"]
        main.EXERCICE_CACHE.clear()  # simule l'eviction LRU

        etat = self.client.get(f"/session/{demarrage['session_id']}").json()
        self.assertEqual(etat["exercice_courant"]["id"], exercice["id"])

        reponse = self.client.post(
            "/evaluer",
            json={
                "session_id": demarrage["session_id"],
                "exercice_id": exercice["id"],
                "reponse_eleve": exercice["reponse_attendue"]["valeur"],
            },
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertTrue(reponse.json()["correct"])

    def test_session_et_exercice_evinces_ensemble(self) -> None:
        demarrage = self.client.post("/session/demarrer", json={"niveau_scolaire": "CE1"}).json()
        main.EXERCICE_CACHE.clear()
        main.SESSION_STATE.clear()
        etat = self.client.get(f"/session/{demarrage['session_id']}")
        self.assertEqual(etat.status_code, 200)
        self.assertIn("exercice_courant", etat.json())

    def test_get_exercices_ne_fait_pas_grossir_le_cache_sans_fin(self) -> None:
        with patch.object(main.EXERCICE_CACHE, "taille_max", 50):
            for _ in range(120):
                self.client.get("/exercices/CE1")
            self.assertLessEqual(len(main.EXERCICE_CACHE), 50)


class BornesEntreesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_question_tuteur_trop_longue_refusee(self) -> None:
        reponse = self.client.post(
            "/tuteur/aide",
            json={
                "exercice_id": "x",
                "niveau": "CE1",
                "question": "a" * (main.QUESTION_TUTEUR_MAX + 1),
            },
        )
        self.assertEqual(reponse.status_code, 422)

    def test_question_tuteur_vide_refusee(self) -> None:
        reponse = self.client.post(
            "/tuteur/aide", json={"exercice_id": "x", "niveau": "CE1", "question": ""}
        )
        self.assertEqual(reponse.status_code, 422)

    def test_texte_tts_trop_long_refuse(self) -> None:
        reponse = self.client.post(
            "/synthese-vocale", json={"texte": "a" * (main.TEXTE_TTS_MAX + 1)}
        )
        self.assertEqual(reponse.status_code, 422)

    def test_trop_de_patterns_cibles_refuses(self) -> None:
        reponse = self.client.post(
            "/session/demarrer_revision",
            json={
                "niveau_scolaire": "CE1",
                "patterns_cibles": ["p"] * (main.PATTERNS_CIBLES_MAX + 1),
            },
        )
        self.assertEqual(reponse.status_code, 422)

    def test_reponse_eleve_trop_longue_refusee(self) -> None:
        reponse = self.client.post(
            "/evaluer",
            json={
                "exercice_id": "x",
                "niveau": "CE1",
                "reponse_eleve": "1" * (main.REPONSE_MAX + 1),
            },
        )
        self.assertEqual(reponse.status_code, 422)


if __name__ == "__main__":
    unittest.main()
