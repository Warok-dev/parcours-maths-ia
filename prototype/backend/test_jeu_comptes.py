"""Tests d'integration : le flux de jeu branche sur les comptes eleves.

Verifie qu'une session LIEE a un eleve alimente la table Progression au bon
moment, que la meilleure maitrise est conservee au rejeu, et que l'acces a la
progression est bien cloisonne (eleve = la sienne ; enseignant = sa classe).
Le mode INVITE (sans token) ne doit rien ecrire en base.

Base SQLite en memoire via surcharge de comptes.get_db (utilise aussi par
main.py, qui importe le meme get_db) : rien n'est ecrit dans backend/data/.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
import main
from database import Progression, create_db_engine, init_db
from main import app


def _answer_for(exercice: dict) -> str:
    valeur = exercice["reponse_attendue"]["valeur"]
    if isinstance(valeur, list):
        return ", ".join(map(str, valeur))
    return str(valeur)


class JeuComptesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        self.SessionFactory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )

        def override_get_db():
            db = self.SessionFactory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        comptes._reset_tokens()
        main.SESSION_STATE.clear()
        main.EXERCICE_CACHE.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        comptes._reset_tokens()
        main.SESSION_STATE.clear()
        main.EXERCICE_CACHE.clear()
        self.engine.dispose()

    # --- Helpers ---
    def _auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _prof_classe_eleve(self, prof="prof1", mdp="secret123", niveau="CE3", prenom="Sofia"):
        self.client.post(
            "/enseignant/inscription", json={"nom": "P", "identifiant": prof, "mot_de_passe": mdp}
        )
        ptoken = self.client.post(
            "/enseignant/connexion", json={"identifiant": prof, "mot_de_passe": mdp}
        ).json()["token"]
        classe = self.client.post(
            "/classe", json={"nom": "C", "niveau_scolaire": niveau}, headers=self._auth(ptoken)
        ).json()
        eleve = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": prenom}, headers=self._auth(ptoken)
        ).json()
        etoken = self.client.post(
            f"/eleve/{eleve['id']}/connexion",
            json={"code_classe": classe["code_classe"], "pin": eleve["pin"]},
        ).json()["token"]
        return {"ptoken": ptoken, "classe": classe, "eleve_id": eleve["id"], "etoken": etoken}

    def _jouer_lecon(self, niveau, lecon, token=None):
        """Joue une lecon jusqu'a la fin en repondant juste. token=None -> invite."""
        headers = self._auth(token) if token else {}
        start = self.client.post(
            "/session/demarrer", json={"niveau_scolaire": niveau, "lecon_id": lecon}, headers=headers
        ).json()
        sid, exercice = start["session_id"], start["exercice"]
        for _ in range(80):
            body = self.client.post(
                "/evaluer",
                json={
                    "session_id": sid,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            ).json()
            if body.get("progression", {}).get("terminee"):
                return sid
            if "exercice_suivant" in body:
                exercice = body["exercice_suivant"]
        raise AssertionError("La lecon n'a pas ete terminee dans la limite d'essais.")

    def _jouer_revision(self, niveau, patterns, token=None):
        """Joue une revision ciblee jusqu'a la fin en repondant juste."""
        headers = self._auth(token) if token else {}
        start = self.client.post(
            "/session/demarrer_revision",
            json={"niveau_scolaire": niveau, "patterns_cibles": patterns},
            headers=headers,
        ).json()
        sid, exercice = start["session_id"], start["exercice"]
        for _ in range(80):
            body = self.client.post(
                "/evaluer",
                json={
                    "session_id": sid,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            ).json()
            if body.get("progression", {}).get("terminee"):
                return sid
            if "exercice_suivant" in body:
                exercice = body["exercice_suivant"]
        raise AssertionError("La revision n'a pas ete terminee dans la limite d'essais.")

    # ---------- Une session liee ecrit la progression ----------
    def test_session_liee_ecrit_la_progression(self) -> None:
        ctx = self._prof_classe_eleve(niveau="CE3")
        # CE3 "multiplication_division" = 3 concepts, tous par substitution.
        self._jouer_lecon("CE3", "multiplication_division", token=ctx["etoken"])

        response = self.client.get(
            f"/eleve/{ctx['eleve_id']}/progression", headers=self._auth(ctx["etoken"])
        )
        self.assertEqual(response.status_code, 200)
        progression = response.json()["progression"]
        patterns = {p["pattern_name"] for p in progression}
        self.assertEqual(
            patterns,
            {
                "multiplication_groupes_egaux_modele",
                "multiplication_posee_2chiffres",
                "division_exacte_partage",
            },
        )
        for p in progression:
            self.assertIn(p["maitrise"], (1, 2, 3))
            self.assertEqual(p["lecon_id"], "multiplication_division")

    def test_session_invitee_n_ecrit_rien_en_base(self) -> None:
        ctx = self._prof_classe_eleve(niveau="CE3")
        # Meme lecon jouee SANS token -> mode invite -> aucune progression BD.
        self._jouer_lecon("CE3", "multiplication_division", token=None)

        response = self.client.get(
            f"/eleve/{ctx['eleve_id']}/progression", headers=self._auth(ctx["etoken"])
        )
        self.assertEqual(response.json()["progression"], [])

    def test_token_parent_ne_lie_pas_la_session_de_jeu(self) -> None:
        # Un token parent (lecture seule) presente au jeu ne doit rien ecrire :
        # eleve_id_optionnel le rejette -> session anonyme -> progression vide.
        ctx = self._prof_classe_eleve(niveau="CE3")
        code_parent = self.client.post(
            f"/classe/{ctx['classe']['id']}/eleve/{ctx['eleve_id']}/code_parent",
            headers=self._auth(ctx["ptoken"]),
        ).json()["code_parent"]
        ptoken = self.client.get(f"/parent/acces/{code_parent}").json()["token"]

        self._jouer_lecon("CE3", "multiplication_division", token=ptoken)

        response = self.client.get(
            f"/eleve/{ctx['eleve_id']}/progression", headers=self._auth(ctx["etoken"])
        )
        self.assertEqual(response.json()["progression"], [])

    # ---------- Completion automatique des assignations ----------
    def test_assignation_lecon_terminee_a_la_fin_de_la_session(self) -> None:
        ctx = self._prof_classe_eleve(niveau="CE3")
        self.client.post(
            f"/classe/{ctx['classe']['id']}/assigner",
            json={"eleve_ids": [ctx["eleve_id"]], "lecon_id": "multiplication_division"},
            headers=self._auth(ctx["ptoken"]),
        )
        # En attente avant de jouer.
        avant = self.client.get(
            f"/eleve/{ctx['eleve_id']}/assignations", headers=self._auth(ctx["etoken"])
        ).json()["assignations"]
        self.assertEqual(len(avant), 1)

        # L'eleve joue la lecon assignee (session liee a son compte).
        self._jouer_lecon("CE3", "multiplication_division", token=ctx["etoken"])

        # Plus rien en attente cote eleve, et statut "terminee" cote enseignant.
        apres = self.client.get(
            f"/eleve/{ctx['eleve_id']}/assignations", headers=self._auth(ctx["etoken"])
        ).json()["assignations"]
        self.assertEqual(apres, [])
        statut = self.client.get(
            f"/classe/{ctx['classe']['id']}/assignations", headers=self._auth(ctx["ptoken"])
        ).json()["assignations"]
        self.assertTrue(statut[0]["terminee"])
        self.assertIsNotNone(statut[0]["date_completion"])

    def test_assignation_revision_terminee_a_la_fin_de_la_session(self) -> None:
        ctx = self._prof_classe_eleve(niveau="CE3")
        cible = "division_exacte_partage"
        self.client.post(
            f"/classe/{ctx['classe']['id']}/assigner",
            json={"eleve_ids": [ctx["eleve_id"]], "patterns": [cible]},
            headers=self._auth(ctx["ptoken"]),
        )
        self._jouer_revision("CE3", [cible], token=ctx["etoken"])
        apres = self.client.get(
            f"/eleve/{ctx['eleve_id']}/assignations", headers=self._auth(ctx["etoken"])
        ).json()["assignations"]
        self.assertEqual(apres, [])

    def test_assignation_pas_terminee_par_une_autre_lecon(self) -> None:
        # Jouer une AUTRE lecon ne doit pas marquer l'assignation comme terminee.
        ctx = self._prof_classe_eleve(niveau="CE3")
        self.client.post(
            f"/classe/{ctx['classe']['id']}/assigner",
            json={"eleve_ids": [ctx["eleve_id"]], "lecon_id": "multiplication_division"},
            headers=self._auth(ctx["ptoken"]),
        )
        self._jouer_lecon("CE3", "mesures_masse_duree", token=ctx["etoken"])
        encore = self.client.get(
            f"/eleve/{ctx['eleve_id']}/assignations", headers=self._auth(ctx["etoken"])
        ).json()["assignations"]
        self.assertEqual(len(encore), 1)  # toujours en attente

    # ---------- Meilleure maitrise conservee au rejeu ----------
    def test_meilleure_maitrise_conservee(self) -> None:
        ctx = self._prof_classe_eleve()
        eleve_id = ctx["eleve_id"]
        with self.SessionFactory() as db:
            main._upsert_progression(db, eleve_id, "division_exacte_partage", "multiplication_division", 1)
            db.commit()
            # Rejeu meilleur -> la maitrise monte.
            main._upsert_progression(db, eleve_id, "division_exacte_partage", "multiplication_division", 3)
            db.commit()
            ligne = db.query(Progression).filter_by(eleve_id=eleve_id).first()
            self.assertEqual(ligne.maitrise, 3)
            # Rejeu moins bon -> la maitrise NE redescend PAS.
            main._upsert_progression(db, eleve_id, "division_exacte_partage", "multiplication_division", 2)
            db.commit()
            db.refresh(ligne)
            self.assertEqual(ligne.maitrise, 3)
            # Toujours une seule ligne (mise a jour, pas dupliquee).
            total = db.query(Progression).filter_by(eleve_id=eleve_id).count()
            self.assertEqual(total, 1)

    # ---------- La lecon fait partie de l'identite d'une progression ----------
    def test_meme_pattern_deux_lecons_deux_lignes(self) -> None:
        ctx = self._prof_classe_eleve()
        eleve_id = ctx["eleve_id"]
        with self.SessionFactory() as db:
            # Meme concept, deux lecons differentes -> deux lignes distinctes.
            main._upsert_progression(db, eleve_id, "addition_2chiffres", "lecon_A", 1)
            main._upsert_progression(db, eleve_id, "addition_2chiffres", "lecon_B", 3)
            db.commit()
            lignes = db.query(Progression).filter_by(
                eleve_id=eleve_id, pattern_name="addition_2chiffres"
            ).all()
            self.assertEqual(len(lignes), 2)
            self.assertEqual({l.lecon_id: l.maitrise for l in lignes}, {"lecon_A": 1, "lecon_B": 3})

    def test_revision_sans_lecon_reutilise_sa_ligne(self) -> None:
        ctx = self._prof_classe_eleve()
        eleve_id = ctx["eleve_id"]
        with self.SessionFactory() as db:
            # Session de revision : lecon_id absent (None). Deux passages ne
            # doivent pas empiler deux lignes NULL.
            main._upsert_progression(db, eleve_id, "addition_2chiffres", None, 1)
            db.commit()
            main._upsert_progression(db, eleve_id, "addition_2chiffres", None, 2)
            db.commit()
            lignes = db.query(Progression).filter_by(
                eleve_id=eleve_id, pattern_name="addition_2chiffres"
            ).all()
            self.assertEqual(len(lignes), 1)
            self.assertIsNone(lignes[0].lecon_id)
            self.assertEqual(lignes[0].maitrise, 2)

    # ---------- Cloisonnement de l'acces a la progression ----------
    def test_eleve_ne_voit_que_sa_propre_progression(self) -> None:
        a = self._prof_classe_eleve(prof="profA", niveau="CE3", prenom="Sofia")
        # Deuxieme eleve dans la meme classe.
        eleveB = self.client.post(
            f"/classe/{a['classe']['id']}/eleve", json={"prenom": "Adam"}, headers=self._auth(a["ptoken"])
        ).json()
        tokenB = self.client.post(
            f"/eleve/{eleveB['id']}/connexion",
            json={"code_classe": a["classe"]["code_classe"], "pin": eleveB["pin"]},
        ).json()["token"]

        # L'eleve B tente d'acceder a la progression de l'eleve A -> 403.
        response = self.client.get(
            f"/eleve/{a['eleve_id']}/progression", headers=self._auth(tokenB)
        )
        self.assertEqual(response.status_code, 403)
        # Mais accede bien a la sienne.
        self.assertEqual(
            self.client.get(f"/eleve/{eleveB['id']}/progression", headers=self._auth(tokenB)).status_code,
            200,
        )

    def test_enseignant_voit_sa_classe_pas_une_autre(self) -> None:
        a = self._prof_classe_eleve(prof="profA", niveau="CE3", prenom="Sofia")
        b = self._prof_classe_eleve(prof="profB", niveau="CE3", prenom="Yanis")

        # Le prof A voit la progression de SON eleve.
        self.assertEqual(
            self.client.get(f"/eleve/{a['eleve_id']}/progression", headers=self._auth(a["ptoken"])).status_code,
            200,
        )
        # Mais PAS celle de l'eleve du prof B.
        self.assertEqual(
            self.client.get(f"/eleve/{b['eleve_id']}/progression", headers=self._auth(a["ptoken"])).status_code,
            403,
        )

    def test_progression_sans_token_refusee(self) -> None:
        ctx = self._prof_classe_eleve()
        response = self.client.get(f"/eleve/{ctx['eleve_id']}/progression")
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
