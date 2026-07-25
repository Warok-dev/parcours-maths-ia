"""Tests d'integration des endpoints comptes/gestion (comptes.py).

Chaque test tourne sur une base SQLite EN MEMOIRE (get_db surcharge) : rien
n'est ecrit dans backend/data/. Couvre l'auth enseignant, la gestion de
classe/eleves, le cloisonnement entre enseignants, et la connexion eleve.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
from database import create_db_engine, init_db
from main import app


class ComptesIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")  # en memoire (StaticPool)
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
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        comptes._reset_tokens()
        self.engine.dispose()

    # --- Helpers ---
    def _inscrire(self, identifiant="prof1", mot_de_passe="secret123", nom="Prof Un"):
        return self.client.post(
            "/enseignant/inscription",
            json={"nom": nom, "identifiant": identifiant, "mot_de_passe": mot_de_passe},
        )

    def _token(self, identifiant="prof1", mot_de_passe="secret123"):
        response = self.client.post(
            "/enseignant/connexion",
            json={"identifiant": identifiant, "mot_de_passe": mot_de_passe},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["token"]

    def _auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _creer_classe(self, token, nom="Les Renards", niveau="CE1"):
        response = self.client.post(
            "/classe", json={"nom": nom, "niveau_scolaire": niveau}, headers=self._auth(token)
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    # ---------- Inscription / connexion enseignant ----------
    def test_inscription_reussie(self) -> None:
        response = self._inscrire()
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["identifiant"], "prof1")
        self.assertIn("ecole_id", body)

    def test_mot_de_passe_jamais_stocke_en_clair(self) -> None:
        self._inscrire(mot_de_passe="motdepasse42")
        # Le hash bcrypt ne contient pas le mot de passe et est verifiable.
        empreinte = comptes.hash_mot_de_passe("motdepasse42")
        self.assertNotIn("motdepasse42", empreinte)
        self.assertTrue(comptes.verifier_mot_de_passe("motdepasse42", empreinte))
        self.assertFalse(comptes.verifier_mot_de_passe("mauvais", empreinte))

    def test_inscription_identifiant_deja_pris(self) -> None:
        self._inscrire()
        response = self._inscrire(nom="Autre")
        self.assertEqual(response.status_code, 409)

    def test_connexion_reussie_donne_un_token(self) -> None:
        self._inscrire()
        response = self.client.post(
            "/enseignant/connexion", json={"identifiant": "prof1", "mot_de_passe": "secret123"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["token"])

    def test_connexion_mauvais_mot_de_passe(self) -> None:
        self._inscrire()
        response = self.client.post(
            "/enseignant/connexion", json={"identifiant": "prof1", "mot_de_passe": "faux"}
        )
        self.assertEqual(response.status_code, 401)

    def test_connexion_identifiant_inconnu(self) -> None:
        response = self.client.post(
            "/enseignant/connexion", json={"identifiant": "fantome", "mot_de_passe": "secret123"}
        )
        self.assertEqual(response.status_code, 401)

    # ---------- Classes (protege) ----------
    def test_creer_classe_exige_un_token(self) -> None:
        response = self.client.post("/classe", json={"nom": "X", "niveau_scolaire": "CE1"})
        self.assertEqual(response.status_code, 401)

    def test_creer_et_lister_classes(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token, "Les Renards", "CE1")
        self.assertRegex(classe["code_classe"], r"^CE1-[A-Z]+-\d{2}$")

        response = self.client.get("/classe", headers=self._auth(token))
        self.assertEqual(response.status_code, 200)
        classes = response.json()["classes"]
        self.assertEqual(len(classes), 1)
        self.assertEqual(classes[0]["id"], classe["id"])

    def test_creer_classe_niveau_invalide(self) -> None:
        self._inscrire()
        token = self._token()
        response = self.client.post(
            "/classe", json={"nom": "X", "niveau_scolaire": "CE9"}, headers=self._auth(token)
        )
        self.assertEqual(response.status_code, 400)

    # ---------- Eleves ----------
    def test_ajouter_et_retirer_eleve(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        add = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(token)
        )
        self.assertEqual(add.status_code, 201)
        eleve_id = add.json()["id"]

        # L'eleve apparait dans la liste publique de la classe.
        rejoindre = self.client.get(f"/classe/rejoindre/{classe['code_classe']}")
        self.assertEqual([e["prenom"] for e in rejoindre.json()["eleves"]], ["Sofia"])

        # Retrait.
        suppr = self.client.delete(
            f"/classe/{classe['id']}/eleve/{eleve_id}", headers=self._auth(token)
        )
        self.assertEqual(suppr.status_code, 204)
        rejoindre2 = self.client.get(f"/classe/rejoindre/{classe['code_classe']}")
        self.assertEqual(rejoindre2.json()["eleves"], [])

    # ---------- Cloisonnement entre enseignants ----------
    def test_enseignant_ne_voit_pas_les_classes_d_un_autre(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        self._creer_classe(tokenA, "Classe de A", "CE1")

        listeB = self.client.get("/classe", headers=self._auth(tokenB))
        self.assertEqual(listeB.json()["classes"], [])

    def test_enseignant_ne_peut_pas_ajouter_eleve_a_la_classe_d_un_autre(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        classeA = self._creer_classe(tokenA, "Classe de A", "CE1")

        response = self.client.post(
            f"/classe/{classeA['id']}/eleve",
            json={"prenom": "Intrus"},
            headers=self._auth(tokenB),
        )
        self.assertEqual(response.status_code, 403)

    def test_enseignant_ne_peut_pas_retirer_eleve_d_une_autre_classe(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        classeA = self._creer_classe(tokenA, "Classe de A", "CE1")
        eleve_id = self.client.post(
            f"/classe/{classeA['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(tokenA)
        ).json()["id"]

        response = self.client.delete(
            f"/classe/{classeA['id']}/eleve/{eleve_id}", headers=self._auth(tokenB)
        )
        self.assertEqual(response.status_code, 403)

    # ---------- Connexion eleve ----------
    def test_connexion_eleve_reussie(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(token)
        ).json()["id"]

        response = self.client.post(
            f"/eleve/{eleve_id}/connexion", json={"code_classe": classe["code_classe"]}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["token"])
        self.assertEqual(body["eleve"]["id"], eleve_id)
        self.assertEqual(body["eleve"]["niveau_scolaire"], "CE1")

    def test_rejoindre_classe_code_inconnu(self) -> None:
        response = self.client.get("/classe/rejoindre/CE1-INEXISTANT-00")
        self.assertEqual(response.status_code, 404)

    def test_connexion_eleve_mauvais_code(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(token)
        ).json()["id"]

        response = self.client.post(
            f"/eleve/{eleve_id}/connexion", json={"code_classe": "CE1-FAUX-99"}
        )
        self.assertEqual(response.status_code, 403)

    def test_connexion_eleve_id_d_une_autre_classe(self) -> None:
        # Anti-usurpation : un id d'eleve d'une autre classe, avec le code d'ici,
        # doit echouer (l'id doit appartenir a la classe du code fourni).
        self._inscrire()
        token = self._token()
        classe1 = self._creer_classe(token, "Classe 1", "CE1")
        classe2 = self._creer_classe(token, "Classe 2", "CE2")
        eleve_classe1 = self.client.post(
            f"/classe/{classe1['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(token)
        ).json()["id"]

        # id de l'eleve de la classe 1, mais code de la classe 2 -> refuse.
        response = self.client.post(
            f"/eleve/{eleve_classe1}/connexion", json={"code_classe": classe2["code_classe"]}
        )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
