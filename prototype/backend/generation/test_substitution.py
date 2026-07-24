from __future__ import annotations

import json
import unittest

from generation import substitution


def _exercise_value(exercice: dict):
    return exercice["reponse_attendue"]["valeur"]


def _signature(exercice: dict) -> tuple[str, tuple[tuple[str, object], ...]]:
    variables = json.dumps(exercice["variables"], sort_keys=True, ensure_ascii=False)
    return exercice["pattern"]["pattern_name"], variables


class SubstitutionGenerationTests(unittest.TestCase):
    def _generate_many(self, pattern_name: str, niveau: str, count: int = 100) -> list[dict]:
        return [substitution.generer_exercice(pattern_name, niveau) for _ in range(count)]

    def test_multiplication_decomposee_chiffre_x_2chiffres(self) -> None:
        for ex in self._generate_many("multiplication_decomposee_chiffre_x_2chiffres", "CE2"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["a"] * v["bc"])
            self.assertEqual(v["bc"], v["b0"] + v["c"])
            self.assertEqual(v["b0"] % 10, 0)
            self.assertLessEqual(_exercise_value(ex), 300)

    def test_addition_repetee_vers_multiplication(self) -> None:
        for ex in self._generate_many("addition_repetee_vers_multiplication", "CE2"):
            v = ex["variables"]
            self.assertEqual(v["total"], v["n"] * v["k"])
            self.assertEqual(len(v["termes"]), v["n"])
            self.assertTrue(all(term == v["k"] for term in v["termes"]))
            self.assertIn(v["k"], {2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 30})
            self.assertGreaterEqual(v["n"], 2)
            self.assertLessEqual(v["n"], 7)

    def test_partie_tout_soustraction_non_narratif(self) -> None:
        for ex in self._generate_many("partie_tout_soustraction_non_narratif", "CE1"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["tout"] - v["partie_connue"])
            self.assertGreater(v["tout"], v["partie_connue"])
            # Part-whole dans les 10 : le tout ne depasse pas 10.
            self.assertLessEqual(v["tout"], 10)
            self.assertGreaterEqual(v["partie_connue"], 1)
            self.assertIn(f"{v['tout']} - {v['partie_connue']}", ex["enonce"])

    def test_partie_tout_addition_non_narratif(self) -> None:
        for ex in self._generate_many("partie_tout_addition_non_narratif", "CE1"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["partie1"] + v["partie2"])
            self.assertLessEqual(v["partie1"] + v["partie2"], 10)
            self.assertGreaterEqual(v["partie1"], 1)
            self.assertGreaterEqual(v["partie2"], 1)

    def test_complements_a_dix_sont_generables(self) -> None:
        # Garde anti-regression : les complements a 10 (tout = 10) sont le cas
        # emblematique du corpus N1 et doivent pouvoir etre generes, pour la
        # soustraction (10 - x) comme pour l'addition (x + y = 10). Une ancienne
        # contrainte "sans retenue" sur les unites les excluait totalement.
        souly = self._generate_many("partie_tout_soustraction_non_narratif", "CE1", count=400)
        self.assertTrue(
            any(ex["variables"]["tout"] == 10 for ex in souly),
            "aucune soustraction avec tout = 10 (complement a 10) generee",
        )
        addy = self._generate_many("partie_tout_addition_non_narratif", "CE1", count=400)
        self.assertTrue(
            any(ex["variables"]["tout"] == 10 for ex in addy),
            "aucune addition avec somme = 10 (complement a 10) generee",
        )

    def test_moitie_via_2xn(self) -> None:
        for ex in self._generate_many("moitie_via_2xn", "CE2"):
            v = ex["variables"]
            self.assertEqual(v["n"] % 2, 0)
            self.assertGreaterEqual(v["n"], 6)
            self.assertLessEqual(v["n"], 40)
            self.assertEqual(_exercise_value(ex), v["n"] // 2)

    def test_addition_pas_a_pas_sans_retenue(self) -> None:
        for ex in self._generate_many("addition_pas_a_pas_sans_retenue", "CE1"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["a"] + v["b"])
            self.assertLess((v["a"] % 10) + (v["b"] % 10), 10)

    def test_multiplication_chiffre_x_multiple_de_10(self) -> None:
        for ex in self._generate_many("multiplication_chiffre_x_multiple_de_10", "CE2"):
            v = ex["variables"]
            self.assertEqual(v["b0"], v["b"] * 10)
            self.assertEqual(_exercise_value(ex), v["a"] * v["b0"])

    def test_multiplication_par_10(self) -> None:
        for ex in self._generate_many("multiplication_par_10", "CE2"):
            v = ex["variables"]
            self.assertGreaterEqual(v["a"], 10)
            self.assertLessEqual(v["a"], 89)
            self.assertEqual(_exercise_value(ex), v["a"] * 10)

    def test_double_via_2xn(self) -> None:
        for ex in self._generate_many("double_via_2xn", "CE2"):
            v = ex["variables"]
            self.assertGreaterEqual(v["n"], 4)
            self.assertLessEqual(v["n"], 40)
            self.assertEqual(_exercise_value(ex), 2 * v["n"])

    def test_conversion_cm_mm_vers_mm(self) -> None:
        for ex in self._generate_many("conversion_cm_mm_vers_mm", "CE2"):
            v = ex["variables"]
            self.assertGreaterEqual(v["cm"], 1)
            self.assertLessEqual(v["cm"], 12)
            self.assertGreaterEqual(v["mm"], 0)
            self.assertLessEqual(v["mm"], 9)
            self.assertEqual(_exercise_value(ex), v["cm"] * 10 + v["mm"])

    def test_addition_2chiffres_sans_retenue(self) -> None:
        for ex in self._generate_many("addition_2chiffres_sans_retenue", "CE2"):
            v = ex["variables"]
            self.assertGreaterEqual(v["ab"], 20)
            self.assertLessEqual(v["ab"], 89)
            self.assertGreaterEqual(v["cd"], 10)
            self.assertLessEqual(v["cd"], 49)
            self.assertEqual(_exercise_value(ex), v["ab"] + v["cd"])
            self.assertLess((v["ab"] % 10) + (v["cd"] % 10), 10)
            self.assertLess((v["ab"] // 10) + (v["cd"] // 10), 10)
            self.assertLess(_exercise_value(ex), 100)

    def test_suite_multiples_de_10_a_completer(self) -> None:
        for ex in self._generate_many("suite_multiples_de_10_a_completer", "CE1"):
            suite = _exercise_value(ex)
            self.assertIn(len(suite), {6, 7, 8})
            self.assertLessEqual(max(suite), 100)
            for idx in range(1, len(suite)):
                self.assertEqual(suite[idx] - suite[idx - 1], 10)

    def test_identifier_multiple_de_10(self) -> None:
        for ex in self._generate_many("identifier_multiple_de_10", "CE2"):
            v = ex["variables"]
            correct = _exercise_value(ex)
            self.assertIn(correct, v["options"])
            self.assertEqual(correct % 10, 0)
            distractors = [item for item in v["options"] if item != correct]
            self.assertTrue(all(item % 10 != 0 for item in distractors))

    def test_facteur_manquant_table_de_2(self) -> None:
        for ex in self._generate_many("facteur_manquant_table_de_2", "CE2"):
            v = ex["variables"]
            self.assertGreaterEqual(v["x"], 3)
            self.assertLessEqual(v["x"], 20)
            self.assertEqual(v["n"] % 2, 0)
            self.assertEqual(_exercise_value(ex), v["n"] // 2)

    # ---------- Patterns CE3 (N3) ----------
    def test_ce3_patterns_disponibles(self) -> None:
        patterns = set(substitution.patterns_disponibles_pour_niveau("CE3"))
        self.assertEqual(
            patterns,
            {
                "division_exacte_partage",
                "multiplication_posee_2chiffres",
                "multiplication_groupes_egaux_modele",
                "conversion_kg_g",
                "addition_durees_min",
                "lecture_heure_analogique",
            },
        )

    # ---------- Lecture de l'heure (horloge, CE1 + CE3) ----------
    def test_lecture_heure_analogique_ce1(self) -> None:
        for ex in self._generate_many("lecture_heure_analogique", "CE1"):
            v = ex["variables"]
            # CE1 : heures pleines et demi-heures uniquement.
            self.assertIn(v["minute"], (0, 30))
            self.assertGreaterEqual(v["heure"], 1)
            self.assertLessEqual(v["heure"], 12)
            self.assertEqual(ex["reponse_attendue"]["format"], "heure")
            self.assertEqual(_exercise_value(ex), f"{v['heure']}:{v['minute']:02d}")

    def test_lecture_heure_analogique_ce3(self) -> None:
        for ex in self._generate_many("lecture_heure_analogique", "CE3"):
            v = ex["variables"]
            # CE3 : pas de 5 minutes.
            self.assertEqual(v["minute"] % 5, 0)
            self.assertLess(v["minute"], 60)
            self.assertGreaterEqual(v["heure"], 1)
            self.assertLessEqual(v["heure"], 12)
            # L'heure affichee (variables) correspond exactement a la reponse.
            self.assertEqual(_exercise_value(ex), f"{v['heure']}:{v['minute']:02d}")

    def test_lecture_heure_diversite(self) -> None:
        valeurs = {
            _exercise_value(ex)
            for ex in self._generate_many("lecture_heure_analogique", "CE3", count=200)
        }
        self.assertGreaterEqual(len(valeurs), 20)

    def test_lecture_heure_disponible_ce1_et_ce3_pas_ce2(self) -> None:
        self.assertIn("lecture_heure_analogique", substitution.patterns_disponibles_pour_niveau("CE1"))
        self.assertIn("lecture_heure_analogique", substitution.patterns_disponibles_pour_niveau("CE3"))
        self.assertNotIn("lecture_heure_analogique", substitution.patterns_disponibles_pour_niveau("CE2"))

    def test_division_exacte_partage(self) -> None:
        for ex in self._generate_many("division_exacte_partage", "CE3"):
            v = ex["variables"]
            self.assertEqual(v["tout"], v["diviseur"] * v["quotient"])
            self.assertEqual(_exercise_value(ex), v["quotient"])
            self.assertLessEqual(v["tout"], 100)
            self.assertGreaterEqual(v["diviseur"], 2)
            self.assertLessEqual(v["diviseur"], 9)
            self.assertIn(f"{v['tout']} ÷ {v['diviseur']}", ex["enonce"])

    def test_multiplication_posee_2chiffres(self) -> None:
        for ex in self._generate_many("multiplication_posee_2chiffres", "CE3"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["f1"] * v["f2"])
            self.assertEqual(v["f2"], v["dizaines"] + v["unites"])
            self.assertEqual(v["produit"], v["p_unites"] + v["p_dizaines"])

    def test_multiplication_groupes_egaux_modele(self) -> None:
        for ex in self._generate_many("multiplication_groupes_egaux_modele", "CE3"):
            v = ex["variables"]
            self.assertEqual(v["total"], v["n"] * v["k"])
            self.assertEqual(_exercise_value(ex), f"{v['total']} = {v['n']} x {v['k']}")
            self.assertEqual(ex["reponse_attendue"]["format"], "expression")
            # Commutativite acceptee.
            self.assertIn(f"{v['k']} x {v['n']}", ex["reponse_attendue"]["tolerance"]["equivalences_acceptees"])

    def test_conversion_kg_g(self) -> None:
        for ex in self._generate_many("conversion_kg_g", "CE3"):
            v = ex["variables"]
            self.assertEqual(v["grammes"], v["kg"] * 1000)
            self.assertEqual(_exercise_value(ex), v["grammes"])
            self.assertGreaterEqual(v["kg"], 1)
            self.assertLessEqual(v["kg"], 9)

    def test_addition_durees_min(self) -> None:
        for ex in self._generate_many("addition_durees_min", "CE3"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["a"] + v["b"])
            self.assertLessEqual(v["a"] + v["b"], 55)
            self.assertEqual(v["a"] % 5, 0)
            self.assertEqual(v["b"] % 5, 0)

    def test_ce3_diversite_et_pas_d_exclusion_de_valeur_ronde(self) -> None:
        # Garde specifique demandee : verifier que les patterns CE3 n'excluent
        # aucune valeur "ronde" a la maniere du bug des complements a 10 de
        # N1/N2. Aucun de ces generateurs n'a de contrainte "sans retenue" sur
        # les unites ; on le confirme empiriquement sur la diversite generee.
        divisions = self._generate_many("division_exacte_partage", "CE3", count=400)
        touts = {ex["variables"]["tout"] for ex in divisions}
        self.assertGreaterEqual(len(touts), 15)
        # Des touts multiples de 10 (valeurs rondes) sont bien produits.
        self.assertTrue(any(t % 10 == 0 for t in touts), "aucun 'tout' multiple de 10 genere")

        durees = self._generate_many("addition_durees_min", "CE3", count=400)
        totals = {ex["variables"]["total"] for ex in durees}
        # La borne haute 55 est atteignable (pas d'exclusion du maximum).
        self.assertIn(55, totals)
        # Une valeur ronde comme 30 min est atteignable.
        self.assertIn(30, totals)

    # ---------- Ligne graduee a completer (CE1) ----------
    def test_completer_ligne_graduee(self) -> None:
        pas_vus = set()
        for ex in self._generate_many("completer_ligne_graduee", "CE1"):
            v = ex["variables"]
            pas = v["pas"]
            self.assertIn(pas, (2, 5, 10))
            pas_vus.add(pas)
            valeurs = _exercise_value(ex)
            self.assertEqual(ex["reponse_attendue"]["format"], "liste_ordonnee")
            self.assertIn(len(valeurs), {6, 7, 8})
            self.assertLessEqual(max(valeurs), 90)
            # Suite arithmetique de raison 'pas'.
            for i in range(1, len(valeurs)):
                self.assertEqual(valeurs[i] - valeurs[i - 1], pas)
            # Les positions manquantes sont internes et valides.
            for pos in v["positions_manquantes"]:
                self.assertGreater(pos, 0)
                self.assertLess(pos, len(valeurs) - 1)
        # Diversite : les trois pas apparaissent sur un echantillon suffisant.
        self.assertEqual(pas_vus, {2, 5, 10})

    def test_completer_ligne_graduee_disponible_ce1_pas_ce2(self) -> None:
        self.assertIn("completer_ligne_graduee", substitution.patterns_disponibles_pour_niveau("CE1"))
        self.assertNotIn("completer_ligne_graduee", substitution.patterns_disponibles_pour_niveau("CE2"))

    # ---------- Tableau de proportionnalite (CE4/CE5/CE6) ----------
    def test_completer_tableau_proportionnalite(self) -> None:
        coefficients = set()
        for niveau in ("CE4", "CE5", "CE6"):
            for ex in self._generate_many("completer_tableau_proportionnalite", niveau):
                v = ex["variables"]
                k = v["coefficient"]
                coefficients.add(k)
                self.assertGreaterEqual(k, 2)
                self.assertLessEqual(k, 10)
                # Proportionnalite : chaque case du bas = k x case du haut.
                self.assertEqual(v["bas"], [k * x for x in v["haut"]])
                self.assertIn(len(v["haut"]), {3, 4})
                col = v["colonne_manquante"]
                self.assertEqual(col, len(v["haut"]) - 1)
                # La reponse est la valeur de la case masquee.
                if v["ligne_manquante"] == 2:
                    self.assertEqual(_exercise_value(ex), v["bas"][col])
                    self.assertEqual(v["bas_affichee"][col], "?")
                    self.assertNotEqual(v["haut_affichee"][col], "?")
                else:
                    self.assertEqual(_exercise_value(ex), v["haut"][col])
                    self.assertEqual(v["haut_affichee"][col], "?")
                    self.assertNotEqual(v["bas_affichee"][col], "?")
                # Reponse entiere.
                self.assertIsInstance(_exercise_value(ex), int)
        self.assertGreaterEqual(len(coefficients), 4)

    # ---------- Figure cotee simple (CE4/CE5) ----------
    def test_figure_cotee_simple(self) -> None:
        formes_vues = set()
        for niveau in ("CE4", "CE5"):
            for ex in self._generate_many("figure_cotee_simple", niveau):
                v = ex["variables"]
                forme, question = v["forme"], v["question"]
                formes_vues.add(forme)
                valeur = _exercise_value(ex)
                self.assertIsInstance(valeur, int)
                self.assertNotIn("cercle", forme)  # jamais de cercle/compas
                if forme == "rectangle":
                    self.assertNotEqual(v["largeur"], v["hauteur"])
                    attendu = 2 * (v["largeur"] + v["hauteur"]) if question == "perimetre" else v["largeur"] * v["hauteur"]
                elif forme == "carre":
                    attendu = 4 * v["cote"] if question == "perimetre" else v["cote"] * v["cote"]
                elif forme == "triangle":
                    self.assertEqual(len(v["cotes"]), 3)
                    attendu = sum(v["cotes"])
                else:
                    self.assertIn(v["n_cotes"], (5, 6))
                    attendu = v["n_cotes"] * v["cote"]
                self.assertEqual(valeur, attendu)
        # Diversite : plusieurs formes apparaissent (rectangle/carre + CE5).
        self.assertTrue({"rectangle", "carre"}.issubset(formes_vues))
        self.assertTrue(formes_vues & {"triangle", "polygone_regulier"})

    def test_figure_cotee_disponible_ce4_ce5_pas_ce6(self) -> None:
        for niveau in ("CE4", "CE5"):
            self.assertIn("figure_cotee_simple", substitution.patterns_disponibles_pour_niveau(niveau))
        self.assertNotIn("figure_cotee_simple", substitution.patterns_disponibles_pour_niveau("CE6"))

    # ---------- Echelle / plan (CE6) ----------
    def test_echelle_plan(self) -> None:
        echelles = set()
        for ex in self._generate_many("echelle_plan", "CE6"):
            v = ex["variables"]
            echelles.add(v["echelle"])
            # reel = distance sur le plan x echelle.
            self.assertEqual(v["reel_m"], v["plan_cm"] * v["echelle"])
            self.assertEqual(_exercise_value(ex), v["reel_m"])
            self.assertIsInstance(_exercise_value(ex), int)
            self.assertLessEqual(v["reel_m"], 999)
            self.assertGreaterEqual(v["plan_cm"], 2)
            # L'echelle et la mesure apparaissent dans l'enonce (pattern texte).
            self.assertIn(f"{v['echelle']} m", ex["enonce"])
            self.assertIn(f"{v['plan_cm']} cm", ex["enonce"])
        self.assertGreaterEqual(len(echelles), 4)

    def test_echelle_plan_disponible_ce6_seulement(self) -> None:
        self.assertIn("echelle_plan", substitution.patterns_disponibles_pour_niveau("CE6"))
        for niveau in ("CE4", "CE5"):
            self.assertNotIn("echelle_plan", substitution.patterns_disponibles_pour_niveau(niveau))

    # ---------- Nombres decimaux (CE4) ----------
    def test_comparaison_decimaux(self) -> None:
        relations = set()
        for ex in self._generate_many("comparaison_decimaux", "CE4"):
            v = ex["variables"]
            rel = _exercise_value(ex)
            relations.add(rel)
            self.assertIn(rel, ("<", ">", "="))
            attendu = "<" if v["a_cent"] < v["b_cent"] else (">" if v["a_cent"] > v["b_cent"] else "=")
            self.assertEqual(rel, attendu)
            self.assertEqual(ex["reponse_attendue"]["format"], "choix_multiple")
            self.assertEqual(v["options"], ["<", ">", "="])
        self.assertEqual(relations, {"<", ">", "="})

    def test_addition_soustraction_decimaux(self) -> None:
        def to_cents(s):
            s = s.replace(",", ".")
            return round(float(s) * 100)

        for ex in self._generate_many("addition_decimaux", "CE4"):
            v = ex["variables"]
            self.assertEqual(to_cents(v["total"]), to_cents(v["a"]) + to_cents(v["b"]))
            self.assertEqual(_exercise_value(ex), v["total"])
            self.assertEqual(ex["reponse_attendue"]["format"], "decimal")
        for ex in self._generate_many("soustraction_decimaux", "CE4"):
            v = ex["variables"]
            self.assertEqual(to_cents(v["difference"]), to_cents(v["a"]) - to_cents(v["b"]))
            self.assertGreater(to_cents(v["a"]), to_cents(v["b"]))

    # ---------- Durees (CE5) ----------
    def test_conversion_duree_min(self) -> None:
        for ex in self._generate_many("conversion_duree_min", "CE5"):
            v = ex["variables"]
            self.assertEqual(v["total_min"], v["heures"] * 60 + v["minutes"])
            self.assertEqual(_exercise_value(ex), v["total_min"])
            self.assertLess(v["minutes"], 60)

    def test_duree_entre_horaires(self) -> None:
        for ex in self._generate_many("duree_entre_horaires", "CE5"):
            v = ex["variables"]
            self.assertEqual(v["duree_min"], v["arrivee_min"] - v["depart_min"])
            self.assertGreater(v["arrivee_min"], v["depart_min"])
            self.assertEqual(_exercise_value(ex), v["duree_min"])

    # ---------- Pourcentage (CE5 + CE6) et vitesse (CE6) ----------
    def test_pourcentage_d_une_quantite(self) -> None:
        for niveau in ("CE5", "CE6"):
            for ex in self._generate_many("pourcentage_d_une_quantite", niveau):
                v = ex["variables"]
                self.assertEqual(v["resultat"], v["total"] * v["pourcentage"] // 100)
                self.assertEqual(v["total"] * v["pourcentage"] % 100, 0)  # resultat entier
                self.assertEqual(_exercise_value(ex), v["resultat"])
                self.assertIsInstance(_exercise_value(ex), int)

    def test_vitesse_distance_duree(self) -> None:
        cibles = set()
        for ex in self._generate_many("vitesse_distance_duree", "CE6"):
            v = ex["variables"]
            cibles.add(v["cible"])
            self.assertEqual(v["distance"], v["vitesse"] * v["duree"])
            attendu = {"distance": v["distance"], "vitesse": v["vitesse"], "duree": v["duree"]}[v["cible"]]
            self.assertEqual(_exercise_value(ex), attendu)
        self.assertEqual(cibles, {"distance", "vitesse", "duree"})

    def test_nouveaux_patterns_disponibilite_par_niveau(self) -> None:
        ce4 = set(substitution.patterns_disponibles_pour_niveau("CE4"))
        ce5 = set(substitution.patterns_disponibles_pour_niveau("CE5"))
        ce6 = set(substitution.patterns_disponibles_pour_niveau("CE6"))
        self.assertTrue({"comparaison_decimaux", "addition_decimaux", "soustraction_decimaux"}.issubset(ce4))
        self.assertTrue({"conversion_duree_min", "duree_entre_horaires"}.issubset(ce5))
        self.assertIn("pourcentage_d_une_quantite", ce5 & ce6)
        self.assertIn("vitesse_distance_duree", ce6)
        # Cloisonnement : les decimaux ne fuient pas hors CE4.
        self.assertNotIn("comparaison_decimaux", ce5 | ce6)
        self.assertNotIn("vitesse_distance_duree", ce4 | ce5)

    def test_tableau_proportionnalite_disponible_ce4_ce5_ce6_pas_ce3(self) -> None:
        for niveau in ("CE4", "CE5", "CE6"):
            self.assertIn(
                "completer_tableau_proportionnalite",
                substitution.patterns_disponibles_pour_niveau(niveau),
            )
        self.assertNotIn(
            "completer_tableau_proportionnalite",
            substitution.patterns_disponibles_pour_niveau("CE3"),
        )

    def test_generer_lot_respecte_le_niveau(self) -> None:
        lot = substitution.generer_lot("CE1", 25)
        self.assertEqual(len(lot), 25)
        self.assertTrue(all(ex["niveau_scolaire"] == "CE1" for ex in lot))

    def test_generer_lot_ce3(self) -> None:
        lot = substitution.generer_lot("CE3", 20)
        self.assertEqual(len(lot), 20)
        self.assertTrue(all(ex["niveau_scolaire"] == "CE3" for ex in lot))
        ce3_patterns = set(substitution.patterns_disponibles_pour_niveau("CE3"))
        self.assertTrue(all(ex["pattern"]["pattern_name"] in ce3_patterns for ex in lot))

    def test_generer_lot_sans_doublons_stricts_sur_50(self) -> None:
        seen_signatures: set[str] = set()
        lot = [
            substitution._generer_exercice_unique(
                "addition_repetee_vers_multiplication",
                "CE2",
                seen_signatures,
            )
            for _ in range(50)
        ]
        signatures = {_signature(ex) for ex in lot}
        self.assertEqual(len(signatures), len(lot))

    def test_generer_lot_dedoublonne(self) -> None:
        lot = substitution.generer_lot("CE2", 50)
        signatures = {_signature(ex) for ex in lot}
        self.assertEqual(len(signatures), len(lot))


if __name__ == "__main__":
    unittest.main()
