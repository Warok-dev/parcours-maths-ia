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
from database import Progression, create_db_engine, init_db
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

    def test_liste_classes_compte_les_eleves(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        for prenom in ("Sofia", "Adam", "Lina"):
            self.client.post(
                f"/classe/{classe['id']}/eleve", json={"prenom": prenom}, headers=self._auth(token)
            )
        classes = self.client.get("/classe", headers=self._auth(token)).json()["classes"]
        self.assertEqual(classes[0]["nb_eleves"], 3)

    def test_lister_eleves_avec_date_ajout(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(token)
        )
        response = self.client.get(f"/classe/{classe['id']}/eleves", headers=self._auth(token))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["classe"]["id"], classe["id"])
        self.assertEqual(len(body["eleves"]), 1)
        self.assertEqual(body["eleves"][0]["prenom"], "Sofia")
        self.assertIn("date_creation", body["eleves"][0])

    def test_lister_eleves_exige_le_proprietaire(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        classeA = self._creer_classe(tokenA, "Classe de A", "CE1")

        response = self.client.get(f"/classe/{classeA['id']}/eleves", headers=self._auth(tokenB))
        self.assertEqual(response.status_code, 403)
        # Sans jeton du tout : authentification requise.
        self.assertEqual(self.client.get(f"/classe/{classeA['id']}/eleves").status_code, 401)

    # ---------- Tableau de bord enseignant ----------
    def _seed_progression(self, eleve_id, pattern_name, lecon_id, maitrise):
        """Insere une ligne de progression directement (sans jouer une session)."""
        with sessionmaker(bind=self.engine, class_=Session)() as db:
            db.add(
                Progression(
                    eleve_id=eleve_id,
                    pattern_name=pattern_name,
                    lecon_id=lecon_id,
                    maitrise=maitrise,
                )
            )
            db.commit()

    def _ajouter_eleve(self, token, classe_id, prenom):
        return self.client.post(
            f"/classe/{classe_id}/eleve", json={"prenom": prenom}, headers=self._auth(token)
        ).json()["id"]

    def _ajouter_eleve_avec_pin(self, token, classe_id, prenom):
        """Renvoie (eleve_id, pin) : le PIN n'est expose qu'a la creation."""
        corps = self.client.post(
            f"/classe/{classe_id}/eleve", json={"prenom": prenom}, headers=self._auth(token)
        ).json()
        return corps["id"], corps["pin"]

    def test_tableau_de_bord_agrege_par_eleve(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token, niveau="CE3")
        bon = self._ajouter_eleve(token, classe["id"], "Sofia")
        faible = self._ajouter_eleve(token, classe["id"], "Adam")
        # Sofia maitrise tout ; Adam bloque sur un concept.
        self._seed_progression(bon, "mult_a", "multiplication_division", 3)
        self._seed_progression(bon, "mult_b", "multiplication_division", 3)
        self._seed_progression(faible, "mult_a", "multiplication_division", 3)
        self._seed_progression(faible, "mult_b", "multiplication_division", 1)

        response = self.client.get(
            f"/classe/{classe['id']}/tableau_de_bord", headers=self._auth(token)
        )
        self.assertEqual(response.status_code, 200)
        eleves = {e["prenom"]: e for e in response.json()["eleves"]}
        self.assertEqual(eleves["Sofia"]["nb_acquis"], 2)
        self.assertEqual(eleves["Sofia"]["nb_a_retravailler"], 0)
        self.assertEqual(eleves["Adam"]["nb_acquis"], 1)
        self.assertEqual(eleves["Adam"]["nb_a_retravailler"], 1)
        self.assertEqual(eleves["Adam"]["nb_total"], 2)
        # Le detail des concepts est bien present pour la vue par eleve.
        self.assertEqual(len(eleves["Adam"]["concepts"]), 2)

    def test_tableau_de_bord_inclut_les_eleves_sans_progression(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        self._ajouter_eleve(token, classe["id"], "Nouveau")
        eleves = self.client.get(
            f"/classe/{classe['id']}/tableau_de_bord", headers=self._auth(token)
        ).json()["eleves"]
        self.assertEqual(eleves[0]["nb_total"], 0)
        self.assertEqual(eleves[0]["concepts"], [])

    def test_concepts_difficiles_classe(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token, niveau="CE3")
        e1 = self._ajouter_eleve(token, classe["id"], "Sofia")
        e2 = self._ajouter_eleve(token, classe["id"], "Adam")
        e3 = self._ajouter_eleve(token, classe["id"], "Lina")
        # "division" bloque 3 eleves (maitrise 1), "posee" en bloque 1.
        for e in (e1, e2, e3):
            self._seed_progression(e, "division_exacte", "multiplication_division", 1)
        self._seed_progression(e1, "mult_posee", "multiplication_division", 1)
        self._seed_progression(e2, "mult_posee", "multiplication_division", 3)  # acquis, non compte

        concepts = self.client.get(
            f"/classe/{classe['id']}/concepts_difficiles", headers=self._auth(token)
        ).json()["concepts"]
        self.assertEqual(concepts[0]["pattern_name"], "division_exacte")
        self.assertEqual(concepts[0]["nb_eleves_en_difficulte"], 3)
        self.assertEqual(concepts[1]["pattern_name"], "mult_posee")
        self.assertEqual(concepts[1]["nb_eleves_en_difficulte"], 1)

    def test_tableau_de_bord_cloisonne_par_enseignant(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        classeA = self._creer_classe(tokenA, "Classe de A", "CE1")

        for chemin in ("tableau_de_bord", "concepts_difficiles"):
            self.assertEqual(
                self.client.get(
                    f"/classe/{classeA['id']}/{chemin}", headers=self._auth(tokenB)
                ).status_code,
                403,
                f"un autre enseignant ne doit pas voir {chemin}",
            )
            self.assertEqual(
                self.client.get(f"/classe/{classeA['id']}/{chemin}").status_code,
                401,
                f"{chemin} exige une authentification",
            )

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
        eleve_id, pin = self._ajouter_eleve_avec_pin(token, classe["id"], "Sofia")

        response = self.client.post(
            f"/eleve/{eleve_id}/connexion",
            json={"code_classe": classe["code_classe"], "pin": pin},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["token"])
        self.assertEqual(body["eleve"]["id"], eleve_id)
        self.assertEqual(body["eleve"]["niveau_scolaire"], "CE1")

    def test_creation_eleve_renvoie_un_pin_a_4_chiffres(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        corps = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(token)
        ).json()
        self.assertRegex(corps["pin"], r"^\d{4}$")

    def test_pin_affiche_une_seule_fois_a_la_creation(self) -> None:
        # Le PIN n'apparait qu'a la creation : ni la liste enseignant ni la
        # liste publique "rejoindre" ne le reexposent (seul son hash est stocke).
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id, _pin = self._ajouter_eleve_avec_pin(token, classe["id"], "Sofia")

        liste = self.client.get(
            f"/classe/{classe['id']}/eleves", headers=self._auth(token)
        ).json()["eleves"]
        self.assertNotIn("pin", liste[0])
        self.assertNotIn("pin_hash", liste[0])

        rejoindre = self.client.get(f"/classe/rejoindre/{classe['code_classe']}").json()
        self.assertNotIn("pin", rejoindre["eleves"][0])
        self.assertNotIn("pin_hash", rejoindre["eleves"][0])
        self.assertEqual(eleve_id, rejoindre["eleves"][0]["id"])

    def test_connexion_eleve_mauvais_pin(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id, pin = self._ajouter_eleve_avec_pin(token, classe["id"], "Sofia")
        mauvais = "0000" if pin != "0000" else "1111"

        response = self.client.post(
            f"/eleve/{eleve_id}/connexion",
            json={"code_classe": classe["code_classe"], "pin": mauvais},
        )
        self.assertEqual(response.status_code, 403)

    def test_connexion_eleve_pin_manquant_refuse(self) -> None:
        # Sans PIN, la requete est invalide (422) : le champ est obligatoire.
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id, _pin = self._ajouter_eleve_avec_pin(token, classe["id"], "Sofia")
        response = self.client.post(
            f"/eleve/{eleve_id}/connexion", json={"code_classe": classe["code_classe"]}
        )
        self.assertEqual(response.status_code, 422)

    def test_rejoindre_classe_code_inconnu(self) -> None:
        response = self.client.get("/classe/rejoindre/CE1-INEXISTANT-00")
        self.assertEqual(response.status_code, 404)

    def test_connexion_eleve_mauvais_code(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id, pin = self._ajouter_eleve_avec_pin(token, classe["id"], "Sofia")

        # PIN correct mais mauvais code -> refuse (l'id doit appartenir au code).
        response = self.client.post(
            f"/eleve/{eleve_id}/connexion", json={"code_classe": "CE1-FAUX-99", "pin": pin}
        )
        self.assertEqual(response.status_code, 403)

    def test_connexion_eleve_id_d_une_autre_classe(self) -> None:
        # Anti-usurpation : un id d'eleve d'une autre classe, avec le code d'ici,
        # doit echouer (l'id doit appartenir a la classe du code fourni).
        self._inscrire()
        token = self._token()
        classe1 = self._creer_classe(token, "Classe 1", "CE1")
        classe2 = self._creer_classe(token, "Classe 2", "CE2")
        eleve_classe1, pin1 = self._ajouter_eleve_avec_pin(token, classe1["id"], "Sofia")

        # id + PIN de l'eleve de la classe 1, mais code de la classe 2 -> refuse.
        response = self.client.post(
            f"/eleve/{eleve_classe1}/connexion",
            json={"code_classe": classe2["code_classe"], "pin": pin1},
        )
        self.assertEqual(response.status_code, 403)

    # ---------- Reinitialisation du PIN eleve ----------
    def test_reinitialiser_pin_invalide_l_ancien_et_active_le_nouveau(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve_id, ancien_pin = self._ajouter_eleve_avec_pin(token, classe["id"], "Sofia")

        # Reinitialisation -> nouveau PIN a 4 chiffres, renvoye une seule fois.
        reinit = self.client.post(
            f"/classe/{classe['id']}/eleve/{eleve_id}/reinitialiser_pin",
            headers=self._auth(token),
        )
        self.assertEqual(reinit.status_code, 200)
        nouveau_pin = reinit.json()["pin"]
        self.assertRegex(nouveau_pin, r"^\d{4}$")
        self.assertNotEqual(nouveau_pin, ancien_pin)

        # L'ancien PIN ne fonctionne plus.
        rejet = self.client.post(
            f"/eleve/{eleve_id}/connexion",
            json={"code_classe": classe["code_classe"], "pin": ancien_pin},
        )
        self.assertEqual(rejet.status_code, 403)

        # Le nouveau PIN fonctionne.
        ok = self.client.post(
            f"/eleve/{eleve_id}/connexion",
            json={"code_classe": classe["code_classe"], "pin": nouveau_pin},
        )
        self.assertEqual(ok.status_code, 200)

    def test_reinitialiser_pin_reserve_au_proprietaire(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        classeA = self._creer_classe(tokenA, "Classe de A", "CE1")
        eleve_id, _pin = self._ajouter_eleve_avec_pin(tokenA, classeA["id"], "Sofia")

        # Un autre enseignant ne peut pas reinitialiser -> 403.
        autre = self.client.post(
            f"/classe/{classeA['id']}/eleve/{eleve_id}/reinitialiser_pin",
            headers=self._auth(tokenB),
        )
        self.assertEqual(autre.status_code, 403)
        # Sans jeton du tout -> authentification requise.
        anon = self.client.post(
            f"/classe/{classeA['id']}/eleve/{eleve_id}/reinitialiser_pin"
        )
        self.assertEqual(anon.status_code, 401)

    def test_reinitialiser_pin_eleve_d_une_autre_classe_introuvable(self) -> None:
        # L'eleve doit appartenir a la classe de l'URL, sinon 404.
        self._inscrire()
        token = self._token()
        classe1 = self._creer_classe(token, "Classe 1", "CE1")
        classe2 = self._creer_classe(token, "Classe 2", "CE2")
        eleve_id, _pin = self._ajouter_eleve_avec_pin(token, classe1["id"], "Sofia")

        response = self.client.post(
            f"/classe/{classe2['id']}/eleve/{eleve_id}/reinitialiser_pin",
            headers=self._auth(token),
        )
        self.assertEqual(response.status_code, 404)

    # ---------- Portail parent (lecture seule) ----------
    def _creer_eleve(self, token, classe_id, prenom):
        """Renvoie le corps de creation (id, pin, code_parent : exposes une seule fois)."""
        return self.client.post(
            f"/classe/{classe_id}/eleve", json={"prenom": prenom}, headers=self._auth(token)
        ).json()

    def test_acces_parent_donne_la_progression_du_bon_eleve(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token, niveau="CE3")
        eleve = self._creer_eleve(token, classe["id"], "Sofia")
        self._seed_progression(eleve["id"], "division_exacte", "multiplication_division", 2)

        # Le parent echange son code contre un token, puis lit la progression.
        acces = self.client.get(f"/parent/acces/{eleve['code_parent']}")
        self.assertEqual(acces.status_code, 200)
        ptoken = acces.json()["token"]
        self.assertEqual(acces.json()["eleve"]["id"], eleve["id"])
        self.assertEqual(acces.json()["eleve"]["niveau_scolaire"], "CE3")

        prog = self.client.get("/parent/progression", headers=self._auth(ptoken))
        self.assertEqual(prog.status_code, 200)
        corps = prog.json()
        self.assertEqual(corps["eleve"]["id"], eleve["id"])
        self.assertEqual(corps["eleve"]["prenom"], "Sofia")
        self.assertEqual([p["pattern_name"] for p in corps["progression"]], ["division_exacte"])
        self.assertEqual(corps["progression"][0]["maitrise"], 2)

    def test_acces_parent_code_invalide(self) -> None:
        response = self.client.get("/parent/acces/CODEFAUX9")
        self.assertEqual(response.status_code, 403)

    def test_parent_progression_sans_token(self) -> None:
        # /parent/progression sans token parent -> refuse.
        self.assertEqual(self.client.get("/parent/progression").status_code, 401)

    def test_parent_ne_voit_que_son_enfant(self) -> None:
        # Le token du parent de A ne donne QUE la progression de A, jamais celle de B.
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token, niveau="CE3")
        a = self._creer_eleve(token, classe["id"], "Sofia")
        b = self._creer_eleve(token, classe["id"], "Adam")
        self._seed_progression(a["id"], "concept_a", "multiplication_division", 3)
        self._seed_progression(b["id"], "concept_b", "multiplication_division", 1)

        ptoken_a = self.client.get(f"/parent/acces/{a['code_parent']}").json()["token"]
        corps = self.client.get("/parent/progression", headers=self._auth(ptoken_a)).json()
        self.assertEqual(corps["eleve"]["id"], a["id"])
        patterns = [p["pattern_name"] for p in corps["progression"]]
        self.assertEqual(patterns, ["concept_a"])  # jamais concept_b

    def test_regenerer_code_parent_invalide_l_ancien(self) -> None:
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve = self._creer_eleve(token, classe["id"], "Sofia")
        ancien = eleve["code_parent"]

        regen = self.client.post(
            f"/classe/{classe['id']}/eleve/{eleve['id']}/code_parent", headers=self._auth(token)
        )
        self.assertEqual(regen.status_code, 200)
        nouveau = regen.json()["code_parent"]
        self.assertNotEqual(nouveau, ancien)
        self.assertRegex(nouveau, r"^[A-Z0-9]{8}$")

        # L'ancien code ne donne plus acces, le nouveau si.
        self.assertEqual(self.client.get(f"/parent/acces/{ancien}").status_code, 403)
        self.assertEqual(self.client.get(f"/parent/acces/{nouveau}").status_code, 200)

    def test_regenerer_code_parent_reserve_au_proprietaire(self) -> None:
        self._inscrire("profA", "secretA")
        self._inscrire("profB", "secretB")
        tokenA = self._token("profA", "secretA")
        tokenB = self._token("profB", "secretB")
        classeA = self._creer_classe(tokenA, "Classe de A", "CE1")
        eleve = self._creer_eleve(tokenA, classeA["id"], "Sofia")

        autre = self.client.post(
            f"/classe/{classeA['id']}/eleve/{eleve['id']}/code_parent", headers=self._auth(tokenB)
        )
        self.assertEqual(autre.status_code, 403)
        anon = self.client.post(f"/classe/{classeA['id']}/eleve/{eleve['id']}/code_parent")
        self.assertEqual(anon.status_code, 401)

    def test_token_parent_ne_permet_aucune_ecriture(self) -> None:
        # Le token parent est en lecture seule : il ne doit ouvrir aucun endpoint
        # d'ecriture / de gestion, ni la progression brute par id d'eleve.
        self._inscrire()
        token = self._token()
        classe = self._creer_classe(token)
        eleve = self._creer_eleve(token, classe["id"], "Sofia")
        ptoken = self.client.get(f"/parent/acces/{eleve['code_parent']}").json()["token"]
        ph = self._auth(ptoken)

        # Gestion de classe (enseignant) -> 401 (token non enseignant).
        self.assertEqual(
            self.client.post(
                f"/classe/{classe['id']}/eleve", json={"prenom": "Intrus"}, headers=ph
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(
                f"/classe/{classe['id']}/eleve/{eleve['id']}/reinitialiser_pin", headers=ph
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(
                f"/classe/{classe['id']}/eleve/{eleve['id']}/code_parent", headers=ph
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.delete(
                f"/classe/{classe['id']}/eleve/{eleve['id']}", headers=ph
            ).status_code,
            401,
        )
        self.assertEqual(self.client.get("/classe", headers=ph).status_code, 401)
        # Progression brute par id d'eleve (token eleve/enseignant only) -> 403.
        self.assertEqual(
            self.client.get(f"/eleve/{eleve['id']}/progression", headers=ph).status_code, 403
        )


if __name__ == "__main__":
    unittest.main()
