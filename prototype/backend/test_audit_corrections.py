"""Tests des corrections issues de l'audit (M2 garde-robe en base, M4 validation
d'assignation, m6 propriete de session). Lancer : python -m unittest test_audit_corrections
"""
from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
from database import create_db_engine, init_db
from main import app, SESSION_STATE, EXERCICE_CACHE


class _Base(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        testing_session = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )

        def override_get_db():
            db = testing_session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        comptes._reset_tokens()
        SESSION_STATE.clear()
        EXERCICE_CACHE.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        comptes._reset_tokens()
        self.engine.dispose()

    # helpers
    def _auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _prof(self, identifiant="prof1"):
        self.client.post(
            "/enseignant/inscription",
            json={"nom": "Prof", "identifiant": identifiant, "mot_de_passe": "secret123"},
        )
        return self.client.post(
            "/enseignant/connexion",
            json={"identifiant": identifiant, "mot_de_passe": "secret123"},
        ).json()["token"]

    def _classe(self, token, niveau="CE1"):
        return self.client.post(
            "/classe", json={"nom": "Les Renards", "niveau_scolaire": niveau}, headers=self._auth(token)
        ).json()

    def _eleve(self, token, classe, prenom="Lina"):
        corps = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": prenom}, headers=self._auth(token)
        ).json()
        return corps["id"], corps["pin"]

    def _token_eleve(self, eleve_id, pin, code_classe):
        return self.client.post(
            f"/eleve/{eleve_id}/connexion",
            json={"code_classe": code_classe, "pin": pin},
        ).json()["token"]


# ============================================================
#  M2 : garde-robe (personnage) liee au compte
# ============================================================
class PersonnageTests(_Base):
    def _setup_eleve(self):
        prof = self._prof()
        classe = self._classe(prof)
        eleve_id, pin = self._eleve(prof, classe)
        token = self._token_eleve(eleve_id, pin, classe["code_classe"])
        return eleve_id, token, classe

    def test_defaut_quand_jamais_personnalise(self) -> None:
        eleve_id, token, _ = self._setup_eleve()
        r = self.client.get(f"/eleve/{eleve_id}/personnage", headers=self._auth(token))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"etoiles_totales": 0, "couleur": "bleu", "accessoire": "aucun"})

    def test_upsert_et_relecture(self) -> None:
        eleve_id, token, _ = self._setup_eleve()
        r = self.client.put(
            f"/eleve/{eleve_id}/personnage",
            json={"etoiles_totales": 120, "couleur": "orange", "accessoire": "chapeau"},
            headers=self._auth(token),
        )
        self.assertEqual(r.status_code, 200)
        relu = self.client.get(f"/eleve/{eleve_id}/personnage", headers=self._auth(token)).json()
        self.assertEqual(relu, {"etoiles_totales": 120, "couleur": "orange", "accessoire": "chapeau"})

    def test_total_ne_regresse_jamais(self) -> None:
        eleve_id, token, _ = self._setup_eleve()
        self.client.put(
            f"/eleve/{eleve_id}/personnage",
            json={"etoiles_totales": 200, "couleur": "jaune", "accessoire": "aucun"},
            headers=self._auth(token),
        )
        # Une sauvegarde plus ancienne (total plus bas) ne doit pas faire perdre d'etoiles.
        self.client.put(
            f"/eleve/{eleve_id}/personnage",
            json={"etoiles_totales": 50, "couleur": "vert", "accessoire": "aucun"},
            headers=self._auth(token),
        )
        relu = self.client.get(f"/eleve/{eleve_id}/personnage", headers=self._auth(token)).json()
        self.assertEqual(relu["etoiles_totales"], 200)
        self.assertEqual(relu["couleur"], "vert")  # la tenue, elle, suit la derniere ecriture

    def test_autre_eleve_ne_peut_ni_lire_ni_ecrire(self) -> None:
        prof = self._prof()
        classe = self._classe(prof)
        a_id, a_pin = self._eleve(prof, classe, "Lina")
        b_id, b_pin = self._eleve(prof, classe, "Noah")
        token_b = self._token_eleve(b_id, b_pin, classe["code_classe"])
        # B (authentifie) tente d'acceder au personnage de A -> 403.
        self.assertEqual(
            self.client.get(f"/eleve/{a_id}/personnage", headers=self._auth(token_b)).status_code,
            403,
        )
        self.assertEqual(
            self.client.put(
                f"/eleve/{a_id}/personnage",
                json={"etoiles_totales": 999, "couleur": "jaune", "accessoire": "cape"},
                headers=self._auth(token_b),
            ).status_code,
            403,
        )

    def test_sans_token_refuse(self) -> None:
        eleve_id, _, _ = self._setup_eleve()
        self.assertEqual(self.client.get(f"/eleve/{eleve_id}/personnage").status_code, 403)

    def test_supprimer_eleve_supprime_son_personnage(self) -> None:
        prof = self._prof()
        classe = self._classe(prof)
        eleve_id, pin = self._eleve(prof, classe)
        token = self._token_eleve(eleve_id, pin, classe["code_classe"])
        self.client.put(
            f"/eleve/{eleve_id}/personnage",
            json={"etoiles_totales": 10, "couleur": "bleu", "accessoire": "aucun"},
            headers=self._auth(token),
        )
        # Suppression de l'eleve : cascade -> plus de ligne personnage (pas d'orphelin).
        self.client.delete(f"/classe/{classe['id']}/eleve/{eleve_id}", headers=self._auth(prof))
        from database import Personnage
        from sqlalchemy import select

        with Session(self.engine) as db:
            reste = db.scalars(select(Personnage).where(Personnage.eleve_id == eleve_id)).first()
        self.assertIsNone(reste)


if __name__ == "__main__":
    unittest.main()
