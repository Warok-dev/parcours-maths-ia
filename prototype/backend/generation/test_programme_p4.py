"""Tests des concepts de la periode 4 (programme_p4.py) et de la couverture
des lecons apres relecture du corpus."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from evaluation import compare_reponse
from generation import substitution
from generation.programme_p4 import GENERATEURS_P4, _decompositions, _heure_en_mots
from notifications import _LIBELLES_CONCEPTS

BACKEND = Path(__file__).resolve().parents[1]
LECONS = json.loads((BACKEND / "data" / "lessons.json").read_text(encoding="utf-8"))["lessons"]
NIVEAUX = ("CE1", "CE2", "CE3", "CE4", "CE5", "CE6")


def _niveaux(pattern: str) -> list[str]:
    return ["CE" + code[1] for code in substitution.PATTERN_DEFS[pattern]["levels"]]


def _beaucoup(pattern: str, niveau: str, n: int = 150) -> list[dict]:
    return [substitution.generer_exercice(pattern, niveau) for _ in range(n)]


def _nombre(texte: str) -> float:
    return float(str(texte).replace(" ", "").replace(",", "."))


class ContratCommunTests(unittest.TestCase):
    def test_chaque_concept_p4_est_au_catalogue_et_enregistre(self) -> None:
        for pattern in GENERATEURS_P4:
            self.assertIn(pattern, substitution.PATTERN_DEFS, pattern)
            self.assertIs(substitution.GENERATOR_REGISTRY[pattern], GENERATEURS_P4[pattern])
            exemples = substitution.PATTERN_DEFS[pattern]["examples"]
            self.assertTrue(exemples, f"{pattern} : au moins une seance source citee")
            for ex in exemples:
                self.assertRegex(ex["file"], r"^MATH_N[1-6]_P4_SEM[1-5]_S[1-5]\.pptx$")

    def test_reponse_attendue_acceptee_et_qcm_coherent(self) -> None:
        for pattern in GENERATEURS_P4:
            for niveau in _niveaux(pattern):
                for ex in _beaucoup(pattern, niveau, 120):
                    attendue = ex["reponse_attendue"]
                    with self.subTest(pattern=pattern, niveau=niveau, enonce=ex["enonce"]):
                        self.assertEqual(ex["pattern"]["pattern_name"], pattern)
                        self.assertEqual(ex["niveau_scolaire"], niveau)
                        self.assertTrue(compare_reponse(str(attendue["valeur"]), attendue)["correct"])
                        etapes = ex["presentations"]["1_guide"]["etapes_methode"]
                        self.assertGreaterEqual(len(etapes), 2)
                        if attendue["format"] == "choix_multiple":
                            options = ex["variables"]["options"]
                            self.assertIn(attendue["valeur"], options)
                            self.assertEqual(len(options), len(set(options)))
                            self.assertGreaterEqual(len(options), 2)
                        elif attendue["format"] == "nombre_entier":
                            self.assertIsInstance(attendue["valeur"], int)
                            self.assertGreaterEqual(attendue["valeur"], 0)

    def test_libelles_lisibles(self) -> None:
        carnet = (BACKEND.parent / "frontend" / "carnet.js").read_text(encoding="utf-8")
        for pattern in GENERATEURS_P4:
            self.assertIn(pattern, _LIBELLES_CONCEPTS, f"{pattern} : libelle du bilan parent")
            self.assertRegex(carnet, rf"\n\s+{pattern}: \"", f"{pattern} : libelle du carnet")


class CalculsJustesTests(unittest.TestCase):
    def test_monnaie_valeur(self) -> None:
        for ex in _beaucoup("monnaie_valeur", "CE1"):
            tas = ex["variables"]["monnaie"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], sum(tas))
            self.assertTrue(set(tas) <= {1, 2, 5, 10, 20})
            self.assertEqual(tas, sorted(tas, reverse=True), "de la plus grande valeur a la plus petite")
            self.assertLess(sum(tas), 100)

    def test_monnaie_echange(self) -> None:
        for ex in _beaucoup("monnaie_echange", "CE1"):
            billet = ex["variables"]["billet"]
            sommes = {o: sum(int(p.split()[0]) for p in o.split(" + ")) for o in ex["variables"]["options"]}
            bonnes = [o for o, total in sommes.items() if total == billet]
            self.assertEqual(bonnes, [ex["reponse_attendue"]["valeur"]], "une seule option vaut le billet")
        self.assertNotIn([20], _decompositions(20), "jamais le billet seul")
        self.assertTrue(all(2 <= len(t) <= 5 for t in _decompositions(50)))

    def test_partage_et_groupement(self) -> None:
        for niveau in ("CE1", "CE2"):
            for ex in _beaucoup("partage_equitable", niveau):
                v = ex["variables"]
                self.assertEqual(ex["reponse_attendue"]["valeur"] * v["parts"], v["total"])
            for ex in _beaucoup("groupement_egal", niveau):
                v = ex["variables"]
                self.assertEqual(ex["reponse_attendue"]["valeur"] * v["par_groupe"], v["total"])
        self.assertTrue(all(e["variables"]["total"] <= 20 for e in _beaucoup("partage_equitable", "CE1")))

    def test_additions_et_soustractions(self) -> None:
        for niveau, plafond in (("CE1", 100), ("CE2", 1000)):
            avec_retenue = 0
            for ex in _beaucoup("addition_posee", niveau, 200):
                a, b = ex["variables"]["a"], ex["variables"]["b"]
                self.assertEqual(ex["reponse_attendue"]["valeur"], a + b)
                self.assertLess(a + b, plafond)
                avec_retenue += (a % 10 + b % 10) >= 10
            self.assertGreater(avec_retenue, 40, "la retenue est bien travaillee")
        for ex in _beaucoup("soustraction_passage_dizaine", "CE1"):
            a, b = ex["variables"]["a"], ex["variables"]["b"]
            self.assertTrue(11 <= a <= 18 and b > a % 10, "on passe toujours la dizaine")
            self.assertEqual(ex["reponse_attendue"]["valeur"], a - b)
        for niveau in ("CE2", "CE3"):
            for ex in _beaucoup("soustraction_posee", niveau):
                a, b = ex["variables"]["a"], ex["variables"]["b"]
                self.assertEqual(ex["reponse_attendue"]["valeur"], a - b)
                self.assertGreater(a - b, 0)
            for ex in _beaucoup("ecart_entre_nombres", niveau):
                v = ex["variables"]
                self.assertEqual(ex["reponse_attendue"]["valeur"], v["a"] - v["b"])
        for ex in _beaucoup("addition_ligne_decomposee", "CE2"):
            a, b = ex["variables"]["a"], ex["variables"]["b"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], a + b)
        for ex in _beaucoup("addition_repetee_somme", "CE1"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], v["terme"] * v["fois"])
            self.assertEqual(ex["enonce"].count("+"), v["fois"] - 1)

    def test_suites_et_collections(self) -> None:
        for niveau in ("CE1", "CE2"):
            for ex in _beaucoup("completer_suite_pas", niveau):
                t, pas = ex["variables"]["termes"], ex["variables"]["pas"]
                self.assertTrue(all(t[i + 1] - t[i] == pas for i in range(len(t) - 1)))
                self.assertEqual(ex["reponse_attendue"]["valeur"], t[-1] + pas)
        for ex in _beaucoup("classer_compter", "CE1"):
            v = ex["variables"]
            self.assertEqual(len(v["objets"]), sum(v["comptes"]))
            self.assertEqual(len(set(v["comptes"])), 3)

    def test_heure_ecrite(self) -> None:
        self.assertEqual(_heure_en_mots(3, 30), "trois heures et demie")
        self.assertEqual(_heure_en_mots(9, 45), "dix heures moins le quart")
        self.assertEqual(_heure_en_mots(11, 45), "midi moins le quart")
        self.assertEqual(_heure_en_mots(1, 0), "une heure")
        self.assertEqual(_heure_en_mots(7, 20), "sept heures vingt")
        self.assertEqual(_heure_en_mots(4, 50), "cinq heures moins dix")
        for ex in _beaucoup("heure_ecrite", "CE1"):
            self.assertIn(ex["variables"]["minute"], (0, 30))
        for ex in _beaucoup("heure_ecrite", "CE3"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], f"{v['heure']}:{v['minute']:02d}")

    def test_mesures(self) -> None:
        for ex in _beaucoup("lecture_regle", "CE2"):
            v = ex["variables"]
            attendu = v["cm"] if v["mm"] == 0 else v["longueur_mm"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], attendu)
            self.assertLessEqual(v["longueur_mm"], 120, "le segment tient sur la regle de 12 cm")
        for ex in _beaucoup("masse_kg_g_mixte", "CE3"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], v["kg"] * 1000 + v["g"])
            self.assertLess(v["g"], 1000)

    def test_geometrie(self) -> None:
        for niveau in ("CE3", "CE5"):
            for ex in _beaucoup("rayon_diametre", niveau):
                v = ex["variables"]
                attendu = 2 * v["rayon"] if v["cible"] == "diametre" else v["rayon"]
                self.assertEqual(ex["reponse_attendue"]["valeur"], attendu)
        axes = set("AHMOTUVWXYBCDEK")
        for ex in _beaucoup("symetrie_lettre", "CE3"):
            bonne = ex["reponse_attendue"]["valeur"]
            cherche_axe = "AUCUN" not in ex["enonce"]
            self.assertEqual(bonne in axes, cherche_axe)
            self.assertTrue(all((o in axes) != cherche_axe for o in ex["variables"]["options"] if o != bonne))
        for ex in _beaucoup("angle_nature_mesure", "CE4"):
            m = ex["variables"]["mesure"]
            attendu = "aigu" if m < 90 else "droit" if m == 90 else "obtus"
            self.assertEqual(ex["reponse_attendue"]["valeur"], attendu)
        for ex in _beaucoup("rotation_fraction_tour", "CE4"):
            if ex["reponse_attendue"]["format"] == "nombre_entier":
                self.assertIn(ex["reponse_attendue"]["valeur"], (90, 180, 270, 360))
        for niveau in ("CE4", "CE5"):
            for ex in _beaucoup("cote_manquant_perimetre", niveau):
                v = ex["variables"]
                self.assertEqual(ex["reponse_attendue"]["valeur"] * v["n_cotes"], v["perimetre"])
        for ex in _beaucoup("tout_parts_egales", "CE3"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], v["parts"] * v["part"])

    def test_decimaux(self) -> None:
        for ex in _beaucoup("decimal_composer", "CE4"):
            self.assertEqual(ex["reponse_attendue"]["format"], "decimal")
            self.assertAlmostEqual(_nombre(ex["reponse_attendue"]["valeur"]), ex["variables"]["centiemes"] / 100)
            termes = re.findall(r"\d+(?:,\d+)?", ex["enonce"].split(":")[1].split("=")[0])
            if "+" in ex["enonce"]:
                self.assertAlmostEqual(sum(_nombre(t) for t in termes), ex["variables"]["centiemes"] / 100)
        for ex in _beaucoup("decimal_ranger", "CE4"):
            options = [_nombre(o) for o in ex["variables"]["options"]]
            cible = min(options) if "petit" in ex["enonce"] else max(options)
            self.assertAlmostEqual(_nombre(ex["reponse_attendue"]["valeur"]), cible)
        for ex in _beaucoup("arrondi_decimal", "CE4", 300):
            v = ex["variables"]
            valeur = _nombre(ex["reponse_attendue"]["valeur"])
            if v["forme"] == "dizaine":
                self.assertEqual(valeur % 10, 0)
                self.assertLess(abs(valeur - v["nombre"]), 5)
            elif v["forme"] == "unite":
                self.assertLess(abs(valeur - v["centiemes"] / 100), 0.5)
            else:
                self.assertLess(abs(valeur - v["centiemes"] / 100), 0.05 + 1e-9)

    def test_proportionnalite_et_pourcentages(self) -> None:
        for niveau in ("CE4", "CE5", "CE6"):
            for ex in _beaucoup("proportionnalite_prix", niveau):
                v = ex["variables"]
                self.assertEqual(ex["reponse_attendue"]["valeur"], v["m"] * v["prix"])
        for ex in _beaucoup("regle_de_trois", "CE6"):
            v = ex["variables"]
            self.assertEqual(v["a"] % v["x"], 0, "valeur unitaire entiere")
            self.assertEqual(ex["reponse_attendue"]["valeur"], v["a"] // v["x"] * v["y"])
        for ex in _beaucoup("proportionnalite_reconnaitre", "CE6"):
            x, y = ex["variables"]["x"], ex["variables"]["y"]
            prop = all(yi * x[0] == y[0] * xi for xi, yi in zip(x, y))
            self.assertEqual(ex["reponse_attendue"]["valeur"], "oui" if prop else "non")
            self.assertTrue(all(v > 0 for v in y))
        for niveau in ("CE5", "CE6"):
            for ex in _beaucoup("pourcentage_prix_final", niveau):
                v = ex["variables"]
                self.assertEqual(ex["reponse_attendue"]["valeur"] * 100, v["prix"] * (100 - v["remise"]))
            for ex in _beaucoup("camembert_angle", niveau):
                v = ex["variables"]
                attendu = v["pct"] * 360 // 100 if v["cible"] == "angle" else v["pct"]
                self.assertEqual(ex["reponse_attendue"]["valeur"], attendu)
        for ex in _beaucoup("agrandissement_pourcentage", "CE6"):
            self.assertAlmostEqual(_nombre(ex["reponse_attendue"]["valeur"]), ex["variables"]["pct"] / 100)
        for ex in _beaucoup("fraction_quantite_inverse", "CE4"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], v["d"] * v["part"])
        for ex in _beaucoup("fraction_addition_meme_denominateur", "CE6"):
            v = ex["variables"]
            n = v["a"] + v["b"] if "+" in ex["enonce"] else v["a"] - v["b"]
            self.assertEqual(ex["reponse_attendue"]["valeur"], f"{n}/{v['d']}")
            self.assertGreater(n, 0)

    def test_vitesse_et_echelle(self) -> None:
        for ex in _beaucoup("vitesse_horaires", "CE6"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"] * v["duree"], v["distance"])
            self.assertIn(f"arrive à {v['depart'] + v['duree']} h", ex["enonce"])
        for ex in _beaucoup("echelle_distance_plan", "CE6"):
            v = ex["variables"]
            self.assertEqual(ex["reponse_attendue"]["valeur"] * v["k"], v["reel"])


class CouvertureDesLeconsTests(unittest.TestCase):
    """Le defaut releve : des lecons a un seul concept. Chaque lecon proposee
    a un niveau doit en compter au moins deux."""

    def test_aucune_lecon_a_un_seul_concept(self) -> None:
        import main

        for niveau in NIVEAUX:
            for lecon in main._available_lessons_for_level(niveau):
                with self.subTest(niveau=niveau, lecon=lecon["lecon_id"]):
                    self.assertGreaterEqual(lecon["pattern_count"], 2)

    def test_chaque_concept_p4_est_joue_dans_une_lecon(self) -> None:
        dans_une_lecon = {p for lecon in LECONS for p in lecon["patterns"]}
        for pattern in GENERATEURS_P4:
            self.assertIn(pattern, dans_une_lecon, pattern)

    def test_identifiants_de_lecon_inchanges(self) -> None:
        """Progression, assignations et carnet sont indexes par lecon_id : les
        anciennes lecons doivent toutes exister encore."""
        anciennes = {
            "addition", "soustraction", "decomposition", "multiplication_par_10", "multiplication_decomposee",
            "moitie_double", "suites_mesures", "multiplication_division", "mesures_masse_duree", "lecture_heure",
            "proportionnalite", "geometrie_figures", "cercle", "triangles", "angles", "symetrie", "prismes",
            "solides", "agrandissement", "echelle", "nombres_decimaux", "durees", "pourcentage", "vitesse",
            "pictogramme", "diagramme_circulaire", "proportionnalite_graphique", "fraction_figure",
            "fraction_quantite", "fraction_decimal_pourcentage",
        }
        self.assertLessEqual(anciennes, {lecon["lecon_id"] for lecon in LECONS})

    def test_un_concept_n_apparait_qu_une_fois_par_niveau(self) -> None:
        """Sinon deux lecons d'un meme niveau se recouvrent."""
        import main

        for niveau in NIVEAUX:
            vus: dict[str, str] = {}
            for lecon in main._available_lessons_for_level(niveau):
                for pattern in lecon["patterns"]:
                    with self.subTest(niveau=niveau, pattern=pattern):
                        self.assertNotIn(pattern, vus, f"deja dans {vus.get(pattern)}")
                    vus[pattern] = lecon["lecon_id"]


if __name__ == "__main__":
    unittest.main()
