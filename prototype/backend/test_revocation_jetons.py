"""Tests de l'expiration et de la revocation des jetons (comptes.py).

Chaque action qui retire un droit doit couper aussitot les sessions ouvertes :
archivage d'un eleve, nouveau PIN, nouveau code parent, suppression
definitive (eleve ou ecole), deconnexion explicite, expiration.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import comptes
from database import Jeton, create_db_engine, init_db
from main import app


class RevocationJetonsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )
        self.factory = factory

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
        with self.factory() as db:
            self.assertIsNone(comptes._TOKENS_ELEVE.resoudre(db, self.jeton_eleve))
        self.assertEqual(self._parent_ok(), 401)

    def test_suppression_ecole_coupe_tous_les_comptes(self) -> None:
        reponse = self.client.post(
            "/ecole/suppression",
            json={"confirmation": "Ecole Test"},
            headers=self._h(self.jeton_prof),
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(self._prof_ok(), 401)
        with self.factory() as db:
            self.assertIsNone(comptes._TOKENS_ELEVE.resoudre(db, self.jeton_eleve))
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
    def _expirer(self, jeton: str) -> None:
        with self.factory() as db:
            ligne = db.get(Jeton, comptes._MagasinJetons.empreinte(jeton))
            ligne.expire_a = int(datetime.now(timezone.utc).timestamp()) - 1
            db.commit()

    def test_jeton_expire_refuse_puis_purge(self) -> None:
        self._expirer(self.jeton_prof)
        self.assertEqual(self._prof_ok(), 401)
        with self.factory() as db:
            self.assertIsNone(db.get(Jeton, comptes._MagasinJetons.empreinte(self.jeton_prof)))

    def test_jeton_eleve_expire_retombe_en_mode_invite(self) -> None:
        self._expirer(self.jeton_eleve)
        with self.factory() as db:
            self.assertIsNone(comptes.eleve_id_depuis_token(db, self.jeton_eleve))

    # --- Persistance ---
    def test_seule_l_empreinte_est_stockee(self) -> None:
        with self.factory() as db:
            empreintes = set(db.scalars(select(Jeton.empreinte)).all())
        self.assertNotIn(self.jeton_prof, empreintes)
        self.assertIn(comptes._MagasinJetons.empreinte(self.jeton_prof), empreintes)

    def test_jeton_survit_a_un_nouveau_client(self) -> None:
        # Equivalent d'un redemarrage : plus rien en memoire, tout est en base.
        self.client = TestClient(app)
        self.assertEqual(self._prof_ok(), 200)

    def test_un_type_de_jeton_n_ouvre_pas_un_autre(self) -> None:
        # Un jeton parent presente comme jeton enseignant : refuse.
        self.assertEqual(
            self.client.get("/classe", headers=self._h(self.jeton_parent)).status_code, 401
        )


class MagasinJetonsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_emission_fixe_la_duree_de_vie(self) -> None:
        magasin = comptes._MagasinJetons("test", timedelta(hours=2))
        avant = int(datetime.now(timezone.utc).timestamp())
        jeton = magasin.emettre(self.db, 7)
        ligne = self.db.get(Jeton, magasin.empreinte(jeton))
        self.assertAlmostEqual(ligne.expire_a - avant, 2 * 3600, delta=5)
        self.assertEqual(magasin.resoudre(self.db, jeton), 7)

    def test_revoquer_pour_ne_touche_que_le_titulaire(self) -> None:
        magasin = comptes._MagasinJetons("test", timedelta(hours=1))
        a1, a2, b = (magasin.emettre(self.db, i) for i in (1, 1, 2))
        self.assertEqual(magasin.revoquer_pour(self.db, 1), 2)
        self.assertIsNone(magasin.resoudre(self.db, a1))
        self.assertIsNone(magasin.resoudre(self.db, a2))
        self.assertEqual(magasin.resoudre(self.db, b), 2)

    def test_emission_purge_les_jetons_expires(self) -> None:
        magasin = comptes._MagasinJetons("test", timedelta(hours=1))
        vieux = magasin.emettre(self.db, 1)
        ligne = self.db.get(Jeton, magasin.empreinte(vieux))
        ligne.expire_a = 0
        self.db.commit()
        magasin.emettre(self.db, 2)
        self.assertIsNone(self.db.get(Jeton, magasin.empreinte(vieux)))

    def test_durees_par_type_de_compte(self) -> None:
        self.assertEqual(comptes._TOKENS_ENSEIGNANT.duree, comptes.DUREE_TOKEN_ENSEIGNANT)
        self.assertEqual(comptes._TOKENS_ELEVE.duree, comptes.DUREE_TOKEN_ELEVE)
        self.assertEqual(comptes._TOKENS_PARENT.duree, comptes.DUREE_TOKEN_PARENT)


if __name__ == "__main__":
    unittest.main()
