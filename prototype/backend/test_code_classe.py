"""Regeneration du code de classe (POST /classe/{id}/code)."""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
from database import Classe, create_db_engine, init_db
from main import app


class RegenererCodeClasseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        self.fabrique = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)

        def override_get_db():
            db = self.fabrique()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        self.client = TestClient(app)
        self.h1 = self._prof("prof1")
        self.h2 = self._prof("prof2")
        self.classe = self.client.post(
            "/classe", json={"nom": "A", "niveau_scolaire": "CE2"}, headers=self.h1
        ).json()

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.engine.dispose()

    def _prof(self, ident: str) -> dict:
        self.client.post(
            "/enseignant/inscription",
            json={"nom": ident, "identifiant": ident, "mot_de_passe": "secret123"},
        )
        jeton = self.client.post(
            "/enseignant/connexion", json={"identifiant": ident, "mot_de_passe": "secret123"}
        ).json()["token"]
        return {"Authorization": f"Bearer {jeton}"}

    def test_nouveau_code_et_ancien_invalide(self) -> None:
        ancien = self.classe["code_classe"]
        reponse = self.client.post(f"/classe/{self.classe['id']}/code", headers=self.h1)
        self.assertEqual(reponse.status_code, 200)
        nouveau = reponse.json()["code_classe"]
        self.assertNotEqual(nouveau, ancien)
        self.assertRegex(nouveau, r"^CE2-[A-Z]+-[A-HJKMNP-Z2-9]{5}$")
        self.assertEqual(self.client.get(f"/classe/rejoindre/{ancien}").status_code, 404)
        self.assertEqual(self.client.get(f"/classe/rejoindre/{nouveau}").status_code, 200)

    def test_remplace_un_ancien_code_court(self) -> None:
        with self.fabrique() as db:
            db.get(Classe, self.classe["id"]).code_classe = "CE2-RENARD-42"
            db.commit()
        nouveau = self.client.post(f"/classe/{self.classe['id']}/code", headers=self.h1).json()
        self.assertEqual(len(nouveau["code_classe"].rsplit("-", 1)[-1]), 5)

    def test_eleve_deja_connecte_reste_connecte(self) -> None:
        eleve = self.client.post(
            f"/classe/{self.classe['id']}/eleve", json={"prenom": "Lea"}, headers=self.h1
        ).json()
        jeton = self.client.post(
            f"/eleve/{eleve['id']}/connexion",
            json={"code_classe": self.classe["code_classe"], "pin": eleve["pin"]},
        ).json()["token"]
        self.client.post(f"/classe/{self.classe['id']}/code", headers=self.h1)
        self.assertEqual(
            self.client.get(
                f"/eleve/{eleve['id']}/progression", headers={"Authorization": f"Bearer {jeton}"}
            ).status_code,
            200,
        )

    def test_reserve_au_proprietaire(self) -> None:
        self.assertEqual(
            self.client.post(f"/classe/{self.classe['id']}/code", headers=self.h2).status_code, 403
        )
        self.assertEqual(self.client.post(f"/classe/{self.classe['id']}/code").status_code, 401)


if __name__ == "__main__":
    unittest.main()
