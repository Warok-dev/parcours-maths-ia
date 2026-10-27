"""/health garde Render eveille SANS toucher la base (sinon Neon ne dort
jamais et epuise son quota) ; /health/base verifie la base a la demande."""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

import comptes
import main
from main import app


class _BasePanne:
    def execute(self, *_args, **_kwargs):
        raise RuntimeError("Your account or project has exceeded the quota")

    def close(self) -> None:
        pass


class HealthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.appels_base = 0

        def base_en_panne():
            self.appels_base += 1
            yield _BasePanne()

        app.dependency_overrides[comptes.get_db] = base_en_panne
        app.dependency_overrides[main.get_db] = base_en_panne

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_health_ne_touche_pas_la_base(self) -> None:
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        self.assertEqual(self.client.head("/health").status_code, 200)
        self.assertEqual(self.appels_base, 0)

    def test_health_base_signale_une_base_injoignable(self) -> None:
        reponse = self.client.get("/health/base")
        self.assertEqual(reponse.status_code, 503)
        self.assertNotIn("quota", reponse.json()["detail"])  # pas de detail interne


if __name__ == "__main__":
    unittest.main()
