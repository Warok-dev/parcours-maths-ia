from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from main import app


class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_get_exercices_ce1_returns_valid_exercise(self) -> None:
        response = self.client.get("/exercices/CE1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        required_keys = {
            "id",
            "niveau_scolaire",
            "matiere",
            "pattern",
            "variables",
            "contexte_narratif",
            "enonce",
            "reponse_attendue",
            "presentations",
            "jeu",
            "metadata",
        }
        self.assertTrue(required_keys.issubset(payload.keys()))
        self.assertEqual(payload["niveau_scolaire"], "CE1")
        self.assertEqual(payload["pattern"]["generation_method"], "substitution")

    def test_get_exercices_invalid_level_returns_400(self) -> None:
        response = self.client.get("/exercices/CE3")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Niveau invalide", response.json()["detail"])

    def test_get_exercices_forced_pattern_returns_requested_pattern(self) -> None:
        response = self.client.get("/exercices/CE2", params={"pattern": "multiplication_par_10"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["niveau_scolaire"], "CE2")
        self.assertEqual(payload["pattern"]["pattern_name"], "multiplication_par_10")

    def test_evaluer_generated_exercice_from_cache(self) -> None:
        generation_response = self.client.get("/exercices/CE1")
        self.assertEqual(generation_response.status_code, 200)
        exercice = generation_response.json()

        evaluation_response = self.client.post(
            "/evaluer",
            json={
                "exercice_id": exercice["id"],
                "niveau": "CE1",
                "reponse_eleve": str(exercice["reponse_attendue"]["valeur"]),
            },
        )

        self.assertEqual(evaluation_response.status_code, 200)
        payload = evaluation_response.json()
        self.assertEqual(payload["exercice_id"], exercice["id"])
        self.assertTrue(payload["correct"])


if __name__ == "__main__":
    unittest.main()
