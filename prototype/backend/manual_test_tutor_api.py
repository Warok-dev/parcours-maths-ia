from __future__ import annotations

import os
import unittest

from fastapi.testclient import TestClient

from main import app


@unittest.skipUnless(
    os.getenv("RUN_GEMINI_MANUAL_TEST") == "1" or os.path.exists("..\\.env"),
    "Manual Gemini test only.",
)
class ManualTutorApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_real_gemini_tutor_call(self) -> None:
        exercice_response = self.client.get("/exercices/CE1")
        self.assertEqual(exercice_response.status_code, 200)
        exercice = exercice_response.json()

        tutor_response = self.client.post(
            "/tuteur/aide",
            json={
                "exercice_id": exercice["id"],
                "niveau": "CE1",
                "question": "Je ne comprends pas par quoi commencer.",
            },
        )

        self.assertEqual(tutor_response.status_code, 200)
        payload = tutor_response.json()
        self.assertTrue(payload["reponse"].strip())


if __name__ == "__main__":
    unittest.main()
