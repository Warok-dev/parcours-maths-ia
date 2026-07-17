from __future__ import annotations

import unittest
from unittest.mock import patch

from generation import narrative


LLM_PAYLOADS = {
    "probleme_reste_partie_tout": {
        "personnage": "Yasmine",
        "objet": "billes",
        "action": "donne a sa cousine",
        "question": "Combien lui en reste-t-il ?",
    },
    "probleme_comparaison_difference": {
        "personnage": "Salma",
        "objet": "points",
        "action": "Son camarade en a",
        "question": "De combien en a-t-elle de plus ?",
    },
    "probleme_groupes_egaux_total": {
        "personnage": "Samir",
        "objet": "cartes",
        "action": "prepare",
        "question": "Combien y a-t-il de cartes en tout ?",
    },
    "probleme_total_partie_tout": {
        "personnage": "Aya",
        "objet": "fleurs",
        "action": "voit",
        "question": "Combien y en a-t-il en tout ?",
    },
    "probleme_groupes_egaux_quotient": {
        "personnage": "Imane",
        "objet": "jetons",
        "action": "range",
        "question": "Combien de groupes faut-il ?",
    },
}


class NarrativeGenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        narrative.RECENT_CONTEXTS.clear()

    def _generate_with_mock(self, niveau: str, pattern_name: str) -> dict:
        with patch("generation.narrative._call_model_json", return_value=LLM_PAYLOADS[pattern_name]):
            return narrative.generate_narrative_exercise(niveau, pattern_name)

    def test_probleme_reste_partie_tout(self) -> None:
        ex = self._generate_with_mock("CE1", "probleme_reste_partie_tout")
        v = ex["variables"]
        self.assertEqual(ex["reponse_attendue"]["valeur"], v["total"] - v["partie_connue"])
        self.assertIn(str(v["total"]), ex["enonce"])
        self.assertIn(str(v["partie_connue"]), ex["enonce"])
        self.assertEqual(ex["pattern"]["generation_method"], "llm")

    def test_probleme_comparaison_difference(self) -> None:
        ex = self._generate_with_mock("CE2", "probleme_comparaison_difference")
        v = ex["variables"]
        self.assertEqual(ex["reponse_attendue"]["valeur"], v["grand"] - v["petit"])
        self.assertIn(str(v["grand"]), ex["enonce"])
        self.assertIn(str(v["petit"]), ex["enonce"])
        self.assertIn("Son camarade en a", ex["enonce"])

    def test_probleme_groupes_egaux_total(self) -> None:
        ex = self._generate_with_mock("CE2", "probleme_groupes_egaux_total")
        v = ex["variables"]
        self.assertEqual(ex["reponse_attendue"]["valeur"], v["group_count"] * v["group_size"])
        self.assertIn(str(v["group_count"]), ex["enonce"])
        self.assertIn(str(v["group_size"]), ex["enonce"])

    def test_probleme_total_partie_tout(self) -> None:
        ex = self._generate_with_mock("CE1", "probleme_total_partie_tout")
        v = ex["variables"]
        self.assertEqual(ex["reponse_attendue"]["valeur"], v["partie1"] + v["partie2"])
        self.assertIn(str(v["partie1"]), ex["enonce"])
        self.assertIn(str(v["partie2"]), ex["enonce"])

    def test_probleme_groupes_egaux_quotient(self) -> None:
        ex = self._generate_with_mock("CE2", "probleme_groupes_egaux_quotient")
        v = ex["variables"]
        self.assertEqual(ex["reponse_attendue"]["valeur"], v["total"] // v["group_size"])
        self.assertIn(str(v["total"]), ex["enonce"])
        self.assertIn(str(v["group_size"]), ex["enonce"])

    def test_parse_llm_json_rejects_numbers(self) -> None:
        with self.assertRaises(narrative.NarrativeGenerationError):
            narrative._parse_llm_json(
                '{"personnage":"Ali 2","objet":"billes","action":"donne","question":"Combien ?"}'
            )

    def test_generate_retries_once_then_succeeds(self) -> None:
        with patch(
            "generation.narrative._call_model_json",
            side_effect=[
                narrative.NarrativeGenerationError("json invalide"),
                LLM_PAYLOADS["probleme_reste_partie_tout"],
            ],
        ) as mocked:
            ex = narrative.generate_narrative_exercise("CE1", "probleme_reste_partie_tout")
        self.assertEqual(mocked.call_count, 2)
        self.assertTrue(ex["enonce"].strip())

    def test_generate_raises_after_two_invalid_outputs(self) -> None:
        with patch(
            "generation.narrative._call_model_json",
            side_effect=narrative.NarrativeGenerationError("json invalide"),
        ):
            with self.assertRaises(narrative.NarrativeGenerationError):
                narrative.generate_narrative_exercise("CE2", "probleme_comparaison_difference")

    def test_large_comparison_rejects_implausible_object_outside_allowed_pool(self) -> None:
        with patch.dict(
            narrative.PATTERN_BUILDERS["probleme_comparaison_difference"],
            {
                "sample": lambda: (
                    {"grand": 91, "petit": 41},
                    50,
                    ["Repere la plus grande quantite : 91."],
                )
            },
        ):
            with patch(
                "generation.narrative._call_model_json",
                return_value={
                    "personnage": "Salma",
                    "objet": "pommes",
                    "action": "Son camarade en a",
                    "question": "De combien en a-t-elle de plus ?",
                },
            ):
                with self.assertRaises(narrative.NarrativeGenerationError):
                    narrative.generate_narrative_exercise("CE2", "probleme_comparaison_difference")

    def test_diversity_threshold_on_20_comparison_exercises(self) -> None:
        payloads = [
            {
                "personnage": name,
                "objet": obj,
                "action": "Son camarade en a",
                "question": "De combien en a-t-il de plus ?",
            }
            for name, obj in [
                ("Yassine", "points"),
                ("Salma", "cartes"),
                ("Karim", "billes"),
                ("Amina", "autocollants"),
                ("Samir", "jetons"),
            ]
            for _ in range(4)
        ]
        with patch.dict(
            narrative.PATTERN_BUILDERS["probleme_comparaison_difference"],
            {
                "sample": lambda: (
                    {"grand": 91, "petit": 41},
                    50,
                    ["Repere la plus grande quantite : 91."],
                )
            },
        ):
            with patch("generation.narrative._call_model_json", side_effect=payloads):
                lot = narrative.generate_narrative_lot("CE2", "probleme_comparaison_difference", 20)
        narrative.assert_narrative_diversity(lot)

    def test_diversity_threshold_on_20_group_total_exercises(self) -> None:
        payloads = [
            {
                "personnage": name,
                "objet": obj,
                "action": "prepare",
                "question": "Combien y en a-t-il en tout ?",
            }
            for name, obj in [
                ("Aya", "cartes"),
                ("Imane", "jetons"),
                ("Rania", "perles"),
                ("Hamza", "bonbons"),
                ("Lina", "billes"),
            ]
            for _ in range(4)
        ]
        with patch.dict(
            narrative.PATTERN_BUILDERS["probleme_groupes_egaux_total"],
            {
                "sample": lambda: (
                    {"group_count": 5, "group_size": 8},
                    40,
                    ["Repere le nombre de groupes : 5."],
                )
            },
        ):
            with patch("generation.narrative._call_model_json", side_effect=payloads):
                lot = narrative.generate_narrative_lot("CE2", "probleme_groupes_egaux_total", 20)
        narrative.assert_narrative_diversity(lot)


if __name__ == "__main__":
    unittest.main()
