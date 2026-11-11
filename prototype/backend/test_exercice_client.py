"""La bonne reponse ne part jamais au navigateur.

- vue client : ni valeur, ni variables de resultat, ni methode d'un autre
  niveau d'aide ; indices de mecanique coherents avec la reponse ;
- API : aucune reponse d'une partie complete ne contient la solution, sauf la
  correction voulue du niveau semi-guide, envoyee APRES la tentative ;
- hors-ligne : empreintes salees, formes canoniques identiques a offline.js.
"""

from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path

from fastapi.testclient import TestClient

import exercice_client as ec
from generation import substitution
from main import EXERCICE_CACHE, SESSION_STATE, app
from outils_test import bonne_reponse, exercice_complet

CAS_CANONIQUES = json.loads(
    (Path(__file__).resolve().parents[1] / "frontend" / "donnees_test" / "formes_canoniques.json").read_text("utf-8")
)["cas"]


def _tous_les_exercices(repetitions: int = 15) -> list[dict]:
    exercices = []
    for nom in dir(substitution):
        if not nom.startswith("generer_") or nom in ("generer_exercice", "generer_lot"):
            continue
        fabrique = getattr(substitution, nom)
        try:
            for _ in range(repetitions):
                ex = fabrique()
                if isinstance(ex, dict) and "reponse_attendue" in ex:
                    exercices.append(ex)
        except TypeError:
            continue
    return exercices


class VueClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.exercices = _tous_les_exercices()

    def test_ni_valeur_ni_tolerance(self) -> None:
        for ex in self.exercices:
            vue = ec.pour_client(ex)
            self.assertEqual(set(vue["reponse_attendue"]), {"format"})

    def test_variables_de_resultat_retirees(self) -> None:
        for ex in self.exercices:
            vue = ec.pour_client(ex)
            self.assertTrue(set(vue["variables"]) <= ec.VARIABLES_CLIENT)
        # Exemples concrets de fuites d'avant.
        ex = substitution.generer_addition_pas_a_pas_sans_retenue("CE1")
        self.assertNotIn("c", ec.pour_client(ex)["variables"])
        ex = substitution.generer_partie_tout_addition_non_narratif("CE1")
        self.assertNotIn("tout", ec.pour_client(ex)["variables"])

    def test_seule_la_presentation_affichee_part(self) -> None:
        ex = substitution.generer_addition_pas_a_pas_sans_retenue("CE1")
        vue = ec.pour_client(ex, "3_autonome")
        self.assertEqual(list(vue["presentations"]), ["3_autonome"])
        self.assertNotIn(str(ex["reponse_attendue"]["valeur"]), json.dumps(vue["presentations"]))

    def test_l_original_n_est_pas_modifie(self) -> None:
        ex = substitution.generer_addition_pas_a_pas_sans_retenue("CE1")
        avant = json.dumps(ex, sort_keys=True)
        ec.pour_client(ex, "3_autonome", hors_ligne=True)
        self.assertEqual(json.dumps(ex, sort_keys=True), avant)

    def test_indices_coherents_avec_la_reponse(self) -> None:
        for ex in self.exercices:
            valeur = ex["reponse_attendue"]["valeur"]
            m = ec.indices_mecanique(ex, None)
            with self.subTest(pattern=ex["pattern"]["pattern_name"], valeur=valeur):
                if m.get("entier_positif"):
                    chiffres = list(str(valeur))
                    self.assertEqual(m["nb_chiffres"], len(chiffres))
                    self.assertEqual(m["nb_planches"], len(chiffres))
                    reste = Counter(m["planches"]) - Counter(chiffres)
                    self.assertFalse(Counter(chiffres) - Counter(m["planches"]), "tous les chiffres sont proposes")
                    self.assertFalse(set(reste) & set(chiffres), "aucun leurre ne double un chiffre de la reponse")
                    if "ligne_debut" in m:
                        self.assertTrue(m["ligne_debut"] <= valeur <= m["ligne_debut"] + 12)
                    if "panier_objets" in m:
                        self.assertGreater(m["panier_objets"], valeur)
                    if "balance" in m:
                        self.assertEqual(sum(m["balance"]["gauche"]), valeur)
                if ex["reponse_attendue"]["format"] == "liste_ordonnee":
                    trous = [i for i, x in enumerate(m["suite"]) if x is None]
                    self.assertEqual(Counter(m["suite_reserve"]), Counter(valeur[i] for i in trous))
                    if len(trous) >= 2:
                        self.assertNotEqual(m["suite_reserve"], sorted(m["suite_reserve"]))
                    self.assertEqual(Counter(m["ordre"]), Counter(valeur))
                    self.assertNotEqual(m["ordre"], list(valeur))
                if "roue" in m:
                    self.assertIn(str(valeur), m["roue"])
                    self.assertTrue(1 <= len(m["roue"]) <= ec.ROUE_MAX_SECTIONS)

    def test_balance_montre_les_operandes_pas_la_somme(self) -> None:
        ex = substitution.generer_addition_pas_a_pas_sans_retenue("CE1")
        ex["variables"].update(a=3, b=4, c=7)
        ex["reponse_attendue"]["valeur"] = 7
        m = ec.indices_mecanique(ex, "balance")
        self.assertEqual(m, {"choisie": "balance", "balance": {"gauche": [3, 4]}})

    def test_seuls_les_indices_de_la_mecanique_jouee_partent(self) -> None:
        # Croiser la fenetre de la ligne, les objets du panier et les planches
        # suffirait a retrouver la reponse : on n'envoie que ceux qui servent.
        vues = Counter()
        for ex in self.exercices:
            m = ec.pour_client(ex)["mecanique"]
            vues[m["choisie"]] += 1
            self.assertIn(m["choisie"], ec.mecaniques_possibles(ex))
            self.assertTrue(set(m) - {"choisie"} <= set(ec.INDICES_PAR_MECANIQUE[m["choisie"]]), m)
        self.assertGreaterEqual(len(vues), 6, f"variete des mecaniques conservee : {dict(vues)}")

    def test_nouvelles_mecaniques_sans_fuite(self) -> None:
        # Blocs : le nombre de colonnes depend du niveau, aucun indice envoye.
        ex = substitution.generer_addition_2chiffres_sans_retenue("CE2")
        self.assertEqual(ec.indices_mecanique(ex, "blocs"), {"choisie": "blocs"})
        # Calculette : les touches dependent du format seulement.
        ex = substitution.generer_addition_decimaux("CE4")
        self.assertEqual(ec.mecaniques_possibles(ex), ["calculette"])
        self.assertEqual(ec.indices_mecanique(ex, "calculette"), {"choisie": "calculette"})
        # Bulles et roue d'un QCM : exactement les choix proposes.
        ex = substitution.generer_identifier_multiple_de_10("CE2")
        options = sorted(map(str, ex["variables"]["options"]))
        self.assertEqual(sorted(ec.indices_mecanique(ex, "bulles")["bulles"]), options)
        self.assertEqual(sorted(ec.indices_mecanique(ex, "roue")["roue"]), options)

    def test_poids_et_bornes_de_la_balance(self) -> None:
        self.assertEqual(ec._poids_minimum(20, ec._poids_disponibles(20)), 1)
        self.assertEqual(ec._poids_minimum(8, ec._poids_disponibles(8)), 3)
        self.assertEqual(ec._poids_minimum(18, ec._poids_disponibles(18)), 4)

    def test_hash_identique_au_js(self) -> None:
        # Valeurs calculees avec hashString de mechanics.js.
        self.assertEqual(ec.hash_chaine("abc"), 96354)
        self.assertEqual(ec.hash_chaine(""), 0)

    def test_indices_deterministes_par_exercice(self) -> None:
        ex = substitution.generer_addition_2chiffres_sans_retenue("CE2")
        self.assertEqual(ec.indices_mecanique(ex), ec.indices_mecanique(ex))


class HorsLigneTests(unittest.TestCase):
    def test_formes_canoniques_partagees_avec_le_js(self) -> None:
        for cas in CAS_CANONIQUES:
            with self.subTest(reponse=cas["reponse"]):
                self.assertEqual(ec.forme_canonique(cas["reponse"], cas["tolerance"]), cas["forme"])

    def test_empreintes_salees_sans_la_reponse(self) -> None:
        ex = substitution.generer_multiplication_par_10("CE3")
        valeur = ex["reponse_attendue"]["valeur"]
        verif = ec.pour_client(ex, hors_ligne=True)["verification_hors_ligne"]
        self.assertNotIn(str(valeur), json.dumps(verif).replace(verif["sel"], ""))
        attendue = ec.empreinte(verif["sel"], ec.forme_canonique(str(valeur), {}))
        self.assertIn(attendue, verif["empreintes"])
        autre = ec.pour_client(ex, hors_ligne=True)["verification_hors_ligne"]
        self.assertNotEqual(verif["sel"], autre["sel"], "un sel neuf a chaque envoi")


class ApiSansReponseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def setUp(self) -> None:
        EXERCICE_CACHE.clear()
        SESSION_STATE.clear()

    def _verifier_sans_reponse(self, corps: dict, contexte: str) -> None:
        texte = json.dumps(corps, ensure_ascii=False)
        self.assertNotIn("attendu_normalise", texte, contexte)
        self.assertNotIn('"valeur"', json.dumps(corps.get("exercice") or {}), contexte)
        self.assertNotIn('"valeur"', json.dumps(corps.get("exercice_suivant") or {}), contexte)
        self.assertNotIn('"valeur"', json.dumps((corps.get("progression") or corps).get("exercice_courant") or {}), contexte)
        self.assertNotIn("tolerance", texte, contexte)

    def test_une_partie_complete_ne_revele_jamais_la_reponse(self) -> None:
        depart = self.client.post("/session/demarrer", json={"niveau_scolaire": "CE1", "lecon_id": "addition"}).json()
        self._verifier_sans_reponse(depart, "demarrage")
        session_id, exercice = depart["session_id"], depart["exercice"]
        corrections = 0
        for tour in range(40):
            # Une erreur de temps en temps (une erreur a chaque tour bloquerait
            # la montee en autonomie), sinon la bonne reponse.
            if tour % 4 == 3:
                faux = self.client.post("/evaluer", json={"session_id": session_id, "exercice_id": exercice["id"], "reponse_donnee": "999999"}).json()
                self._verifier_sans_reponse(faux, f"tour {tour} (faux)")
                if "correction" in faux:
                    corrections += 1
            etat = self.client.get(f"/session/{session_id}").json()
            self._verifier_sans_reponse(etat, f"tour {tour} (etat)")
            exercice = etat["exercice_courant"]
            juste = self.client.post("/evaluer", json={"session_id": session_id, "exercice_id": exercice["id"], "reponse_donnee": bonne_reponse(exercice, session_id)}).json()
            self._verifier_sans_reponse(juste, f"tour {tour} (juste)")
            corrections += "correction" in juste
            if juste.get("statut") == "lecon_terminee" or juste["progression"].get("terminee"):
                break
            exercice = juste.get("exercice_suivant") or juste["progression"]["exercice_courant"]
            # L'exercice affiche ne porte que SA presentation.
            self.assertEqual(list(exercice["presentations"]), [juste["progression"]["presentation_courante"]])
        self.assertGreater(corrections, 0, "le niveau semi-guide a bien recu sa correction apres coup")

    def test_correction_semi_guidee_apres_la_tentative(self) -> None:
        depart = self.client.post("/session/demarrer", json={"niveau_scolaire": "CE1", "lecon_id": "addition"}).json()
        session = SESSION_STATE[depart["session_id"]]
        session["niveau_resolution_courant"] = 2
        exercice = depart["exercice"]
        corps = self.client.post("/evaluer", json={"session_id": depart["session_id"], "exercice_id": exercice["id"], "reponse_donnee": "999999"}).json()
        complet = exercice_complet(exercice, depart["session_id"])
        self.assertEqual(corps["correction"]["reponse"], ec.reponse_affichable(complet))
        self.assertEqual(corps["correction"]["explication"], complet["presentations"]["1_guide"]["etapes_methode"][-1])

    def test_exercice_hors_session_pour_le_tampon(self) -> None:
        corps = self.client.get("/exercices/CE2").json()
        self.assertEqual(set(corps["reponse_attendue"]), {"format"})
        self.assertIn("verification_hors_ligne", corps)
        evaluation = self.client.post("/evaluer", json={"niveau": "CE2", "exercice_id": corps["id"], "reponse_donnee": "999999"}).json()
        self.assertNotIn("attendu_normalise", evaluation)


if __name__ == "__main__":
    unittest.main()
