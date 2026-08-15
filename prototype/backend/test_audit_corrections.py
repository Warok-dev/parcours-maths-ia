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
        # Suppression DEFINITIVE de l'eleve : cascade -> plus de ligne personnage
        # (pas d'orphelin). Le simple retrait (DELETE) n'archive que l'eleve ; c'est
        # l'effacement definitif qui supprime reellement les donnees liees.
        self.client.post(
            f"/classe/{classe['id']}/eleve/{eleve_id}/suppression",
            json={"confirmation": "SUPPRIMER"},
            headers=self._auth(prof),
        )
        from database import Personnage
        from sqlalchemy import select

        with Session(self.engine) as db:
            reste = db.scalars(select(Personnage).where(Personnage.eleve_id == eleve_id)).first()
        self.assertIsNone(reste)


# ============================================================
#  M4 : une assignation doit cibler du generable pour le niveau
# ============================================================
class AssignationValidationTests(_Base):
    def _prof_classe_eleve(self, niveau="CE1"):
        prof = self._prof()
        classe = self._classe(prof, niveau=niveau)
        eleve_id, _ = self._eleve(prof, classe)
        return prof, classe, eleve_id

    def test_assignation_lecon_valide_acceptee(self) -> None:
        prof, classe, eleve_id = self._prof_classe_eleve("CE1")
        lecons = self.client.get(f"/lecons/{classe['niveau_scolaire']}").json()["lecons"]
        self.assertTrue(lecons)
        lecon_id = lecons[0]["lecon_id"]
        r = self.client.post(
            f"/classe/{classe['id']}/assigner",
            json={"eleve_ids": [eleve_id], "lecon_id": lecon_id},
            headers=self._auth(prof),
        )
        self.assertEqual(r.status_code, 201)

    def test_assignation_lecon_inexistante_refusee(self) -> None:
        prof, classe, eleve_id = self._prof_classe_eleve("CE1")
        r = self.client.post(
            f"/classe/{classe['id']}/assigner",
            json={"eleve_ids": [eleve_id], "lecon_id": "lecon_qui_nexiste_pas"},
            headers=self._auth(prof),
        )
        self.assertEqual(r.status_code, 400)

    def test_assignation_revision_pattern_valide_acceptee(self) -> None:
        prof, classe, eleve_id = self._prof_classe_eleve("CE1")
        r = self.client.post(
            f"/classe/{classe['id']}/assigner",
            json={
                "eleve_ids": [eleve_id],
                "patterns": ["partie_tout_addition_non_narratif"],
            },
            headers=self._auth(prof),
        )
        self.assertEqual(r.status_code, 201)

    def test_assignation_revision_pattern_non_generable_refusee(self) -> None:
        # "vitesse_distance_duree" est un pattern CE6, ingenerable en CE1 :
        # l'assignation ne pourrait jamais se terminer -> rejet a la creation.
        prof, classe, eleve_id = self._prof_classe_eleve("CE1")
        r = self.client.post(
            f"/classe/{classe['id']}/assigner",
            json={"eleve_ids": [eleve_id], "patterns": ["vitesse_distance_duree"]},
            headers=self._auth(prof),
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("vitesse_distance_duree", r.json()["detail"])


# ============================================================
#  m6 : propriete de session (un token ne pilote pas la session d'autrui)
# ============================================================
class ProprieteSessionTests(_Base):
    def _deux_eleves(self):
        prof = self._prof()
        classe = self._classe(prof, niveau="CE1")
        a_id, a_pin = self._eleve(prof, classe, "Lina")
        b_id, b_pin = self._eleve(prof, classe, "Noah")
        token_a = self._token_eleve(a_id, a_pin, classe["code_classe"])
        token_b = self._token_eleve(b_id, b_pin, classe["code_classe"])
        return token_a, token_b

    def _session_de(self, token):
        r = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": "CE1"},
            headers=self._auth(token),
        )
        self.assertEqual(r.status_code, 200)
        return r.json()

    def test_proprietaire_lit_sa_session(self) -> None:
        token_a, _ = self._deux_eleves()
        payload = self._session_de(token_a)
        r = self.client.get(f"/session/{payload['session_id']}", headers=self._auth(token_a))
        self.assertEqual(r.status_code, 200)

    def test_autre_eleve_ne_lit_pas_la_session(self) -> None:
        token_a, token_b = self._deux_eleves()
        payload = self._session_de(token_a)
        r = self.client.get(f"/session/{payload['session_id']}", headers=self._auth(token_b))
        self.assertEqual(r.status_code, 403)

    def test_autre_eleve_ne_peut_pas_evaluer_la_session(self) -> None:
        token_a, token_b = self._deux_eleves()
        payload = self._session_de(token_a)
        r = self.client.post(
            "/evaluer",
            json={
                "session_id": payload["session_id"],
                "exercice_id": payload["exercice"]["id"],
                "reponse_donnee": "123",
            },
            headers=self._auth(token_b),
        )
        self.assertEqual(r.status_code, 403)

    def test_autre_eleve_ne_peut_pas_demander_le_tuteur(self) -> None:
        token_a, token_b = self._deux_eleves()
        payload = self._session_de(token_a)
        r = self.client.post(
            "/tuteur/aide",
            json={
                "session_id": payload["session_id"],
                "exercice_id": payload["exercice"]["id"],
                "niveau": "CE1",
                "question": "aide",
            },
            headers=self._auth(token_b),
        )
        self.assertEqual(r.status_code, 403)

    def test_sans_token_le_comportement_invite_reste(self) -> None:
        # Retro-compatibilite : sans token, la lecture par session_id reste
        # possible (mode essai libre inchange).
        token_a, _ = self._deux_eleves()
        payload = self._session_de(token_a)
        r = self.client.get(f"/session/{payload['session_id']}")
        self.assertEqual(r.status_code, 200)

    def test_proprietaire_peut_evaluer(self) -> None:
        token_a, _ = self._deux_eleves()
        payload = self._session_de(token_a)
        r = self.client.post(
            "/evaluer",
            json={
                "session_id": payload["session_id"],
                "exercice_id": payload["exercice"]["id"],
                "reponse_donnee": "999999",
            },
            headers=self._auth(token_a),
        )
        # Pas de 403 : le proprietaire evalue (juste ou faux, peu importe ici).
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
