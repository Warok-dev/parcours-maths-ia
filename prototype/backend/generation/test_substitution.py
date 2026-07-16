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
            self.assertGreaterEqual(v["tout"] % 10, v["partie_connue"] % 10)
            self.assertIn(f"{v['tout']} - {v['partie_connue']}", ex["enonce"])

    def test_partie_tout_addition_non_narratif(self) -> None:
        for ex in self._generate_many("partie_tout_addition_non_narratif", "CE1"):
            v = ex["variables"]
            self.assertEqual(_exercise_value(ex), v["partie1"] + v["partie2"])
            self.assertLess(v["partie1"] + v["partie2"], 11)

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

    def test_generer_lot_respecte_le_niveau(self) -> None:
        lot = substitution.generer_lot("CE1", 25)
        self.assertEqual(len(lot), 25)
        self.assertTrue(all(ex["niveau_scolaire"] == "CE1" for ex in lot))

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
