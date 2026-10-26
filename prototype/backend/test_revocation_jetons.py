"""Tests de l'expiration et de la revocation des jetons (comptes.py).

Chaque action qui retire un droit doit couper aussitot les sessions ouvertes :
archivage d'un eleve, nouveau PIN, nouveau code parent, suppression
definitive (eleve ou ecole), deconnexion explicite, expiration.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
from database import create_db_engine, init_db
from main import app


class RevocationJetonsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )

        def override_get_db():
            db = factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        comptes._reset_tokens()
        self.client = TestClient(app)

        self.client.post(
            "/enseignant/inscription",
            json={
                "nom": "Prof",
                "identifiant": "prof1",
                "mot_de_passe": "secret123",
                "ecole": "Ecole Test",
            },
        )
        self.jeton_prof = self.client.post(
            "/enseignant/connexion", json={"identifiant": "prof1", "mot_de_passe": "secret123"}
        ).json()["token"]
        self.classe = self.client.post(
            "/classe", json={"nom": "A", "niveau_scolaire": "CE1"}, headers=self._h(self.jeton_prof)
        ).json()
        self.eleve = self.client.post(
            f"/classe/{self.classe['id']}/eleve", json={"prenom": "Lea"}, headers=self._h(self.jeton_prof)
        ).json()
        self.jeton_eleve = self.client.post(
            f"/eleve/{self.eleve['id']}/connexion",
            json={"code_classe": self.classe["code_classe"], "pin": self.eleve["pin"]},
        ).json()["token"]
        self.jeton_parent = self.client.get(
            f"/parent/acces/{self.eleve['code_parent']}"
        ).json()["token"]

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        comptes._reset_tokens()
        self.engine.dispose()

    # --- Helpers ---
    @staticmethod
    def _h(jeton: str) -> dict:
        return {"Authorization": f"Bearer {jeton}"}

    def _eleve_ok(self) -> int:
        return self.client.get(
            f"/eleve/{self.eleve['id']}/progression", headers=self._h(self.jeton_eleve)
        ).status_code

    def _parent_ok(self) -> int:
        return self.client.get("/parent/progression", headers=self._h(self.jeton_parent)).status_code

    def _prof_ok(self) -> int:
        return self.client.get("/classe", headers=self._h(self.jeton_prof)).status_code

    def _url_eleve(self, suffixe: str) -> str:
        return f"/classe/{self.classe['id']}/eleve/{self.eleve['id']}{suffixe}"

    # --- Etat initial ---
    def test_jetons_valides_au_depart(self) -> None:
        self.assertEqual(self._eleve_ok(), 200)
        self.assertEqual(self._parent_ok(), 200)
        self.assertEqual(self._prof_ok(), 200)

    # --- Revocations metier ---
    def test_archivage_coupe_eleve_et_parent(self) -> None:
        self.client.delete(self._url_eleve(""), headers=self._h(self.jeton_prof))
        self.assertEqual(self._eleve_ok(), 403)
        self.assertEqual(self._parent_ok(), 401)

    def test_nouveau_pin_coupe_l_eleve_mais_pas_le_parent(self) -> None:
        self.client.post(self._url_eleve("/reinitialiser_pin"), headers=self._h(self.jeton_prof))
        self.assertEqual(self._eleve_ok(), 403)
        self.assertEqual(self._parent_ok(), 200)

    def test_nouveau_code_parent_coupe_le_parent_mais_pas_l_eleve(self) -> None:
        self.client.post(self._url_eleve("/code_parent"), headers=self._h(self.jeton_prof))
        self.assertEqual(self._parent_ok(), 401)
        self.assertEqual(self._eleve_ok(), 200)

    def test_suppression_definitive_eleve_coupe_tout(self) -> None:
        self.client.post(
            self._url_eleve("/suppression"),
            json={"confirmation": comptes.CONFIRMATION_SUPPRESSION_ELEVE},
            headers=self._h(self.jeton_prof),
        )
        self.assertIsNone(comptes._TOKENS_ELEVE.resoudre(self.jeton_eleve))
        self.assertEqual(self._parent_ok(), 401)

    def test_suppression_ecole_coupe_tous_les_comptes(self) -> None:
        reponse = self.client.post(
            "/ecole/suppression",
            json={"confirmation": "Ecole Test"},
            headers=self._h(self.jeton_prof),
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(self._prof_ok(), 401)
        self.assertIsNone(comptes._TOKENS_ELEVE.resoudre(self.jeton_eleve))
        self.assertEqual(self._parent_ok(), 401)

    # --- Deconnexion explicite ---
    def test_deconnexion_revoque_chaque_type_de_jeton(self) -> None:
        for jeton in (self.jeton_eleve, self.jeton_parent, self.jeton_prof):
            self.assertEqual(
                self.client.post("/deconnexion", headers=self._h(jeton)).status_code, 204
            )
        self.assertEqual(self._eleve_ok(), 403)
        self.assertEqual(self._parent_ok(), 401)
        self.assertEqual(self._prof_ok(), 401)

    def test_deconnexion_ne_touche_que_le_jeton_presente(self) -> None:
        second = self.client.post(
            "/enseignant/connexion", json={"identifiant": "prof1", "mot_de_passe": "secret123"}
        ).json()["token"]
        self.client.post("/deconnexion", headers=self._h(self.jeton_prof))
        self.assertEqual(self._prof_ok(), 401)
        self.assertEqual(self.client.get("/classe", headers=self._h(second)).status_code, 200)

    def test_deconnexion_idempotente_sans_jeton_ou_jeton_inconnu(self) -> None:
        self.assertEqual(self.client.post("/deconnexion").status_code, 204)
        self.assertEqual(
            self.client.post("/deconnexion", headers=self._h("inconnu")).status_code, 204
        )

    # --- Expiration ---
    def test_jeton_expire_refuse_puis_purge(self) -> None:
        magasin = comptes._TOKENS_ENSEIGNANT
        titulaire, _exp = magasin._jetons[self.jeton_prof]
        magasin._jetons[self.jeton_prof] = (
            titulaire,
            datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        self.assertEqual(self._prof_ok(), 401)
        self.assertNotIn(self.jeton_prof, magasin._jetons)

    def test_jeton_eleve_expire_retombe_en_mode_invite(self) -> None:
        magasin = comptes._TOKENS_ELEVE
        titulaire, _exp = magasin._jetons[self.jeton_eleve]
        magasin._jetons[self.jeton_eleve] = (titulaire, datetime.now(timezone.utc))
        self.assertIsNone(comptes.eleve_id_depuis_token(self.jeton_eleve))


class MagasinJetonsTests(unittest.TestCase):
    def test_emission_fixe_la_duree_de_vie(self) -> None:
        magasin = comptes._MagasinJetons(timedelta(hours=2))
        avant = datetime.now(timezone.utc)
        jeton = magasin.emettre(7)
        _tid, expiration = magasin._jetons[jeton]
        self.assertAlmostEqual(
            (expiration - avant).total_seconds(), 2 * 3600, delta=5
        )
        self.assertEqual(magasin.resoudre(jeton), 7)

    def test_revoquer_pour_ne_touche_que_le_titulaire(self) -> None:
        magasin = comptes._MagasinJetons(timedelta(hours=1))
        a1, a2, b = magasin.emettre(1), magasin.emettre(1), magasin.emettre(2)
        self.assertEqual(magasin.revoquer_pour(1), 2)
        self.assertIsNone(magasin.resoudre(a1))
        self.assertIsNone(magasin.resoudre(a2))
        self.assertEqual(magasin.resoudre(b), 2)

    def test_emission_purge_les_jetons_expires(self) -> None:
        magasin = comptes._MagasinJetons(timedelta(hours=1))
        vieux = magasin.emettre(1)
        magasin._jetons[vieux] = (1, datetime.now(timezone.utc) - timedelta(hours=1))
        magasin.emettre(2)
        self.assertNotIn(vieux, magasin._jetons)

    def test_durees_par_type_de_compte(self) -> None:
        self.assertEqual(comptes._TOKENS_ENSEIGNANT.duree, comptes.DUREE_TOKEN_ENSEIGNANT)
        self.assertEqual(comptes._TOKENS_ELEVE.duree, comptes.DUREE_TOKEN_ELEVE)
        self.assertEqual(comptes._TOKENS_PARENT.duree, comptes.DUREE_TOKEN_PARENT)


if __name__ == "__main__":
    unittest.main()
