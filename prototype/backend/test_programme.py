"""Tests du programme de classe : le calendrier propose, l'enseignant ouvre
les concepts un par un, l'eleve ne joue que ce qui est ouvert -- sous
plusieurs aspects (calcul, probleme raconte, defi).

Base SQLite en memoire (surcharge de comptes.get_db), comme test_jeu_comptes.
"""

from __future__ import annotations

from outils_test import bonne_reponse

import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
import main
import programme
from database import Progression, create_db_engine, init_db
from generation import recits
from generation import substitution as s
from main import app

DATA = Path(__file__).resolve().parent / "data"


class ProgrammeDonneesTests(unittest.TestCase):
    """Le fichier programme.json est coherent avec les lecons du jeu."""

    def test_chaque_concept_du_programme_existe_dans_une_lecon_du_niveau(self) -> None:
        for niveau in main.ALLOWED_LEVELS:
            disponibles = main._all_patterns_for_level(niveau)
            ordre = programme.ordre_du_niveau(niveau)
            self.assertTrue(ordre, f"{niveau} : programme vide")
            patterns = [item["pattern"] for item in ordre]
            self.assertEqual(len(patterns), len(set(patterns)), f"{niveau} : doublon")
            for p in patterns:
                self.assertIn(p, disponibles, f"{niveau} : {p} pas jouable a ce niveau")
                self.assertIsNotNone(programme.lecon_du_concept(p), p)

    def test_semaines_croissantes_puis_hors_calendrier(self) -> None:
        for niveau in main.ALLOWED_LEVELS:
            semaines = [item["semaine"] for item in programme.ordre_du_niveau(niveau)]
            datees = [x for x in semaines if x is not None]
            self.assertEqual(datees, sorted(datees), niveau)
            if None in semaines:
                premier_null = semaines.index(None)
                self.assertTrue(all(x is None for x in semaines[premier_null:]), niveau)

    def test_premier_concept_de_chaque_niveau(self) -> None:
        brut = json.loads((DATA / "programme.json").read_text(encoding="utf-8"))
        self.assertEqual(set(brut["niveaux"]), set(main.ALLOWED_LEVELS))


class PlanAspectsTests(unittest.TestCase):
    def test_un_concept_devient_trois_etapes_variees(self) -> None:
        concepts, aspects = main._plan_aspects(["addition_repetee_somme"], "CE1")
        self.assertEqual(concepts, ["addition_repetee_somme"] * 3)
        self.assertEqual(aspects, ["calcul", "recit", "calcul"])

    def test_concept_sans_recit_reste_en_calcul(self) -> None:
        sans_recit = next(
            p for p in s.patterns_disponibles_pour_niveau("CE1") if not recits.recit_disponible(p)
        )
        concepts, aspects = main._plan_aspects([sans_recit], "CE1")
        self.assertEqual(concepts, [sans_recit] * 3)
        self.assertEqual(aspects, ["calcul"] * 3)

    def test_deux_concepts_gagnent_une_etape_racontee(self) -> None:
        concepts, aspects = main._plan_aspects(
            ["lecture_heure_analogique", "addition_repetee_somme"], "CE1"
        )
        self.assertEqual(len(concepts), 3)
        self.assertEqual(aspects[-1], "recit")
        self.assertEqual(concepts[-1], "addition_repetee_somme")

    def test_trois_concepts_inchanges(self) -> None:
        trio = ["a", "b", "c"]
        self.assertEqual(main._plan_aspects(trio, "CE1"), (trio, ["calcul"] * 3))


class RecitsTests(unittest.TestCase):
    """Les problemes racontes sont justes et gardent le concept d'origine."""

    def test_recits_valides_a_chaque_niveau(self) -> None:
        for pattern in recits.RECITS:
            self.assertIn(pattern, s.PATTERN_DEFS, pattern)
            niveaux = [s.CODE_TO_LEVEL[c] for c in s.PATTERN_DEFS[pattern]["levels"] if c in s.CODE_TO_LEVEL]
            for niveau in niveaux:
                for theme in (None, "foot"):
                    for _ in range(15):
                        exo = recits.generer_recit(pattern, niveau, theme)
                        self.assertEqual(exo["pattern"]["pattern_name"], pattern)
                        self.assertEqual(exo["variables"]["aspect"], "recit")
                        self.assertTrue(exo["enonce"].endswith("?"), exo["enonce"])
                        valeur = exo["reponse_attendue"]["valeur"]
                        if isinstance(valeur, int):
                            self.assertGreaterEqual(valeur, 0, exo["enonce"])
                        # La reponse apparait dans la derniere etape de la methode.
                        derniere = exo["presentations"]["1_guide"]["etapes_methode"][-1]
                        self.assertIn(str(valeur), derniere.replace("\u202f", " "), exo["enonce"])

    def test_pas_de_multiplication_ecrite_en_ce1(self) -> None:
        for pattern in ("addition_repetee_somme", "division_exacte_partage"):
            if "N1" not in s.PATTERN_DEFS[pattern]["levels"]:
                continue
            for _ in range(30):
                exo = recits.generer_recit(pattern, "CE1", None)
                self.assertNotIn("×", json.dumps(exo["presentations"], ensure_ascii=False))
                self.assertNotIn("÷", json.dumps(exo["presentations"], ensure_ascii=False))

    def test_soustraction_passage_dizaine_passe_vraiment_la_dizaine(self) -> None:
        for _ in range(50):
            exo = recits.generer_recit("soustraction_passage_dizaine", "CE2", None)
            a, b = exo["variables"]["a"], exo["variables"]["b"]
            self.assertGreater(b, a % 10)
            self.assertEqual(exo["reponse_attendue"]["valeur"], a - b)

    def test_recit_inconnu_refuse(self) -> None:
        with self.assertRaises(ValueError):
            recits.generer_recit("pattern_qui_n_existe_pas", "CE1")


class ProgrammeClasseTests(unittest.TestCase):
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

    def _auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _classe(self, niveau="CE1", prof="prof1"):
        self.client.post(
            "/enseignant/inscription",
            json={"nom": "P", "identifiant": prof, "mot_de_passe": "secret123"},
        )
        ptoken = self.client.post(
            "/enseignant/connexion", json={"identifiant": prof, "mot_de_passe": "secret123"}
        ).json()["token"]
        classe = self.client.post(
            "/classe", json={"nom": "C", "niveau_scolaire": niveau}, headers=self._auth(ptoken)
        ).json()
        eleve = self.client.post(
            f"/classe/{classe['id']}/eleve", json={"prenom": "Sofia"}, headers=self._auth(ptoken)
        ).json()
        etoken = self.client.post(
            f"/eleve/{eleve['id']}/connexion",
            json={"code_classe": classe["code_classe"], "pin": eleve["pin"]},
        ).json()["token"]
        return ptoken, classe["id"], eleve["id"], etoken

    def _jouer(self, start: dict) -> dict:
        sid, exercice = start["session_id"], start["exercice"]
        for _ in range(80):
            body = self.client.post(
                "/evaluer",
                json={"session_id": sid, "exercice_id": exercice["id"],
                      "reponse_donnee": bonne_reponse(exercice, sid)},
            ).json()
            if body.get("progression", {}).get("terminee"):
                return body["progression"]
            if "exercice_suivant" in body:
                exercice = body["exercice_suivant"]
        raise AssertionError("session non terminee")

    # --- Enseignant ---
    def test_nouvelle_classe_suit_le_programme_avec_le_premier_concept(self) -> None:
        ptoken, cid, _, _ = self._classe("CE1")
        etat = self.client.get(f"/classe/{cid}/programme", headers=self._auth(ptoken)).json()
        premier = programme.ordre_du_niveau("CE1")[0]["pattern"]
        self.assertTrue(etat["actif"])
        self.assertEqual(etat["nb_ouverts"], 1)
        self.assertTrue(etat["concepts"][0]["ouvert"])
        self.assertEqual(etat["concepts"][0]["pattern"], premier)
        self.assertEqual(etat["prochain"]["pattern"], programme.ordre_du_niveau("CE1")[1]["pattern"])
        self.assertTrue(all(c["libelle"] for c in etat["concepts"]))

    def test_ouvrir_suivant_puis_fermer(self) -> None:
        ptoken, cid, _, _ = self._classe("CE1")
        suivant = programme.ordre_du_niveau("CE1")[1]["pattern"]
        etat = self.client.post(
            f"/classe/{cid}/programme/ouvrir", json={"patterns": [suivant]}, headers=self._auth(ptoken)
        ).json()
        self.assertEqual(etat["nb_ouverts"], 2)
        etat = self.client.post(
            f"/classe/{cid}/programme/fermer", json={"patterns": [suivant]}, headers=self._auth(ptoken)
        ).json()
        self.assertEqual(etat["nb_ouverts"], 1)

    def test_concept_d_un_autre_niveau_refuse(self) -> None:
        ptoken, cid, _, _ = self._classe("CE1")
        r = self.client.post(
            f"/classe/{cid}/programme/ouvrir", json={"patterns": ["regle_de_trois"]},
            headers=self._auth(ptoken),
        )
        self.assertEqual(r.status_code, 400)

    def test_autre_enseignant_ne_voit_pas_le_programme(self) -> None:
        _, cid, _, _ = self._classe("CE1", prof="prof1")
        autre, _, _, _ = self._classe("CE2", prof="prof2")
        r = self.client.get(f"/classe/{cid}/programme", headers=self._auth(autre))
        self.assertIn(r.status_code, (403, 404))

    # --- Eleve ---
    def test_eleve_ne_voit_que_les_concepts_ouverts(self) -> None:
        _, _, _, etoken = self._classe("CE1")
        premier = programme.ordre_du_niveau("CE1")[0]["pattern"]
        corps = self.client.get("/lecons/CE1", headers=self._auth(etoken)).json()
        tous = {p for l in corps["lecons"] for p in l["patterns"]}
        self.assertEqual(tous, {premier})
        self.assertEqual([c["pattern"] for c in corps["programme"]["concepts"]], [premier])
        self.assertTrue(corps["programme"]["concepts"][0]["nouveau"])
        self.assertEqual(corps["programme"]["concepts"][0]["maitrise"], 0)

    def test_invite_garde_toutes_les_lecons(self) -> None:
        corps = self.client.get("/lecons/CE1").json()
        self.assertIsNone(corps["programme"])
        self.assertGreater(len(corps["lecons"]), 3)

    def test_lecon_fermee_refusee_et_lecon_ouverte_en_trois_etapes(self) -> None:
        ptoken, cid, _, etoken = self._classe("CE1")
        premier = programme.ordre_du_niveau("CE1")[0]["pattern"]
        lecon_ouverte = programme.lecon_du_concept(premier)["lecon_id"]
        lecon_fermee = next(
            l["lecon_id"] for l in main._available_lessons_for_level("CE1")
            if premier not in l["patterns"]
        )
        r = self.client.post(
            "/session/demarrer", json={"niveau_scolaire": "CE1", "lecon_id": lecon_fermee},
            headers=self._auth(etoken),
        )
        self.assertEqual(r.status_code, 403)
        start = self.client.post(
            "/session/demarrer", json={"niveau_scolaire": "CE1", "lecon_id": lecon_ouverte},
            headers=self._auth(etoken),
        ).json()
        self.assertEqual(start["progression"]["concepts"], [premier] * 3)

    def test_lecon_assignee_reste_jouable(self) -> None:
        ptoken, cid, eid, etoken = self._classe("CE1")
        premier = programme.ordre_du_niveau("CE1")[0]["pattern"]
        lecon_fermee = next(
            l for l in main._available_lessons_for_level("CE1") if premier not in l["patterns"]
        )
        r = self.client.post(
            f"/classe/{cid}/assigner",
            json={"eleve_ids": [eid], "lecon_id": lecon_fermee["lecon_id"]},
            headers=self._auth(ptoken),
        )
        self.assertEqual(r.status_code, 201, r.text)
        start = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": "CE1", "lecon_id": lecon_fermee["lecon_id"]},
            headers=self._auth(etoken),
        ).json()
        self.assertEqual(start["progression"]["concepts"], lecon_fermee["patterns"])

    def test_entrainement_sur_un_concept_trois_aspects(self) -> None:
        ptoken, cid, eid, etoken = self._classe("CE1")
        cible = "addition_repetee_somme"
        self.client.post(
            f"/classe/{cid}/programme/ouvrir", json={"patterns": [cible]}, headers=self._auth(ptoken)
        )
        start = self.client.post(
            "/session/demarrer_concept",
            json={"niveau_scolaire": "CE1", "pattern": cible, "theme": "foot"},
            headers=self._auth(etoken),
        ).json()
        prog = start["progression"]
        self.assertEqual(prog["concepts"], [cible] * 3)
        self.assertEqual(prog["aspects"], ["calcul", "recit", "calcul"])
        self.assertEqual(prog["aspect_courant"], "calcul")
        fin = self._jouer(start)
        self.assertTrue(fin["terminee"])
        db = self.SessionFactory()
        try:
            ligne = db.query(Progression).filter_by(eleve_id=eid, pattern_name=cible).one()
            self.assertEqual(ligne.maitrise, 3)
            self.assertEqual(ligne.nb_tentatives, 3)
        finally:
            db.close()
        corps = self.client.get("/lecons/CE1", headers=self._auth(etoken)).json()
        concept = next(c for c in corps["programme"]["concepts"] if c["pattern"] == cible)
        self.assertEqual(concept["maitrise"], 3)
        self.assertTrue(concept["nouveau"])

    def test_etape_racontee_sert_un_probleme(self) -> None:
        main.SESSION_STATE.clear()
        start = self.client.post(
            "/session/demarrer_concept",
            json={"niveau_scolaire": "CE1", "pattern": "addition_repetee_somme"},
        ).json()
        session = main._get_session(start["session_id"])
        session["concept_index"] = 1
        exo = main._generate_next_exercise(session, "addition_repetee_somme")
        self.assertEqual(exo["variables"]["aspect"], "recit")
        self.assertEqual(exo["pattern"]["pattern_name"], "addition_repetee_somme")

    def test_entrainement_sur_concept_ferme_refuse(self) -> None:
        _, _, _, etoken = self._classe("CE1")
        r = self.client.post(
            "/session/demarrer_concept",
            json={"niveau_scolaire": "CE1", "pattern": "addition_repetee_somme"},
            headers=self._auth(etoken),
        )
        self.assertEqual(r.status_code, 403)

    def test_classe_en_acces_libre(self) -> None:
        ptoken, cid, _, etoken = self._classe("CE1")
        self.client.post(f"/classe/{cid}/programme", json={"actif": False}, headers=self._auth(ptoken))
        corps = self.client.get("/lecons/CE1", headers=self._auth(etoken)).json()
        self.assertIsNone(corps["programme"])
        r = self.client.post(
            "/session/demarrer_concept",
            json={"niveau_scolaire": "CE1", "pattern": "addition_repetee_somme"},
            headers=self._auth(etoken),
        )
        self.assertEqual(r.status_code, 200)

    def test_niveau_de_la_classe_impose(self) -> None:
        _, _, _, etoken = self._classe("CE1")
        corps = self.client.get("/lecons/CE5", headers=self._auth(etoken)).json()
        self.assertEqual(corps["niveau_scolaire"], "CE1")


if __name__ == "__main__":
    unittest.main()
