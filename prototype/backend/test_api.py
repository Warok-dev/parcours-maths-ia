from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from generation.narrative import NarrativeGenerationError
from main import EXERCICE_CACHE, SESSION_STATE, app

SESSION_LECON_ID = "addition"


def _answer_for(exercice: dict) -> str:
    value = exercice["reponse_attendue"]["valeur"]
    if isinstance(value, list):
        return ", ".join(map(str, value))
    return str(value)


class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def setUp(self) -> None:
        EXERCICE_CACHE.clear()
        SESSION_STATE.clear()

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

    def test_get_lecons_ce1_returns_non_empty_list_with_expected_format(self) -> None:
        response = self.client.get("/lecons/CE1")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["niveau_scolaire"], "CE1")
        self.assertTrue(payload["lecons"])

        first_lesson = payload["lecons"][0]
        self.assertTrue({"lecon_id", "nom", "pattern_count", "patterns"}.issubset(first_lesson.keys()))
        self.assertIsInstance(first_lesson["patterns"], list)
        self.assertGreater(first_lesson["pattern_count"], 0)

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
                "reponse_eleve": _answer_for(exercice),
            },
        )

        self.assertEqual(evaluation_response.status_code, 200)
        payload = evaluation_response.json()
        self.assertEqual(payload["exercice_id"], exercice["id"])
        self.assertTrue(payload["correct"])

    def test_session_perfect_mastery_unlocks_next_concept_after_two_reinforcements(self) -> None:
        start = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": "CE1", "lecon_id": SESSION_LECON_ID},
        )
        self.assertEqual(start.status_code, 200)
        payload = start.json()
        session_id = payload["session_id"]
        concept_initial = payload["progression"]["concept_courant"]
        exercice = payload["exercice"]

        statuses: list[str] = []
        for _ in range(5):
            response = self.client.post(
                "/evaluer",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            statuses.append(body["statut"])
            if "exercice_suivant" in body:
                exercice = body["exercice_suivant"]

        # Detection en 3 niveaux, puis chaque exercice de renforcement se joue
        # UNE seule fois (regle 2/3/4) au niveau de la maitrise detectee.
        self.assertEqual(
            statuses,
            [
                "correct_niveau_suivant",
                "correct_niveau_suivant",
                "correct_nouveau_renforcement",
                "correct_nouveau_renforcement",
                "correct_concept_debloque",
            ],
        )

        session_state = self.client.get(f"/session/{session_id}")
        self.assertEqual(session_state.status_code, 200)
        progression = session_state.json()
        self.assertEqual(progression["maitrise_actuelle"], 0)
        self.assertEqual(progression["phase"], "detection_maitrise")
        self.assertNotEqual(progression["concept_courant"], concept_initial)
        self.assertEqual(progression["exercices_renforcement_restants"], 0)

    def test_generation_failure_on_concept_unlock_keeps_session_state(self) -> None:
        start = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": "CE1", "lecon_id": SESSION_LECON_ID},
        )
        self.assertEqual(start.status_code, 200)
        payload = start.json()
        session_id = payload["session_id"]
        exercice = payload["exercice"]

        # Place la session juste avant le deblocage du concept narratif :
        # dernier exercice de renforcement du concept precedent, niveau 3.
        session = SESSION_STATE[session_id]
        narrative_index = session["concepts"].index("probleme_total_partie_tout")
        session["concept_index"] = narrative_index - 1
        session["concept_courant"] = session["concepts"][narrative_index - 1]
        session["phase"] = "renforcement"
        session["maitrise_actuelle"] = 3
        session["niveau_resolution_courant"] = 3
        session["exercices_renforcement_restants"] = 1
        before = copy.deepcopy(session)

        with patch(
            "main.generate_narrative_exercise",
            side_effect=NarrativeGenerationError("Quota Gemini epuise."),
        ):
            response = self.client.post(
                "/evaluer",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("indisponible", response.json()["detail"])
        self.assertEqual(SESSION_STATE[session_id], before)

    def test_session_failure_once_at_level_two_leads_to_mastery_one_and_four_reinforcements(self) -> None:
        start = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": "CE1", "lecon_id": SESSION_LECON_ID},
        )
        self.assertEqual(start.status_code, 200)
        payload = start.json()
        session_id = payload["session_id"]
        exercice = payload["exercice"]

        level_one = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": _answer_for(exercice),
            },
        )
        self.assertEqual(level_one.status_code, 200)
        self.assertEqual(level_one.json()["statut"], "correct_niveau_suivant")

        wrong_level_two = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": "__faux__",
            },
        )
        self.assertEqual(wrong_level_two.status_code, 200)
        self.assertEqual(wrong_level_two.json()["statut"], "incorrect")
        self.assertEqual(wrong_level_two.json()["progression"]["niveau_resolution_courant"], 2)

        retry_level_two = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": _answer_for(exercice),
            },
        )
        self.assertEqual(retry_level_two.status_code, 200)
        payload = retry_level_two.json()
        self.assertEqual(payload["statut"], "correct_nouveau_renforcement")
        self.assertEqual(payload["progression"]["maitrise_actuelle"], 1)
        self.assertEqual(payload["progression"]["phase"], "renforcement")
        self.assertEqual(payload["progression"]["exercices_renforcement_restants"], 4)

    def test_session_incorrect_answer_does_not_change_level_or_phase(self) -> None:
        start = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": "CE1", "lecon_id": SESSION_LECON_ID},
        )
        self.assertEqual(start.status_code, 200)
        payload = start.json()
        session_id = payload["session_id"]
        exercice = payload["exercice"]

        before = payload["progression"]
        wrong = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": "__incorrect__",
            },
        )

        self.assertEqual(wrong.status_code, 200)
        wrong_payload = wrong.json()
        self.assertEqual(wrong_payload["statut"], "incorrect")
        self.assertEqual(
            wrong_payload["progression"]["niveau_resolution_courant"],
            before["niveau_resolution_courant"],
        )
        self.assertEqual(wrong_payload["progression"]["phase"], before["phase"])
        self.assertEqual(wrong_payload["progression"]["concept_courant"], before["concept_courant"])

    def test_tutor_at_level_two_breaks_perfect_chain_even_if_answers_stay_correct(self) -> None:
        with patch(
            "main.build_tutor_reply",
            return_value={
                "modele": "gemini-3.5-flash",
                "reponse": "Regarde d'abord le total puis la partie.",
                "question_recue": "Aide-moi.",
            },
        ):
            start = self.client.post(
                "/session/demarrer",
                json={"niveau_scolaire": "CE1", "lecon_id": SESSION_LECON_ID},
            )
            self.assertEqual(start.status_code, 200)
            payload = start.json()
            session_id = payload["session_id"]
            exercice = payload["exercice"]

            level_one = self.client.post(
                "/evaluer",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            )
            self.assertEqual(level_one.status_code, 200)
            self.assertEqual(level_one.json()["statut"], "correct_niveau_suivant")

            tutor = self.client.post(
                "/tuteur/aide",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "niveau": "CE1",
                    "question": "Aide-moi.",
                },
            )
            self.assertEqual(tutor.status_code, 200)
            self.assertTrue(tutor.json()["progression"]["erreurs_sur_chaine_actuelle"])
            self.assertEqual(tutor.json()["progression"]["niveau_resolution_courant"], 2)

            level_two = self.client.post(
                "/evaluer",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            )
            self.assertEqual(level_two.status_code, 200)
            payload = level_two.json()
            self.assertEqual(payload["statut"], "correct_nouveau_renforcement")
            self.assertEqual(payload["progression"]["maitrise_actuelle"], 1)
            self.assertEqual(payload["progression"]["phase"], "renforcement")
            self.assertEqual(payload["progression"]["exercices_renforcement_restants"], 4)

    def test_tutor_at_level_one_does_not_break_perfect_chain(self) -> None:
        with patch(
            "main.build_tutor_reply",
            return_value={
                "modele": "gemini-3.5-flash",
                "reponse": "Commence par lire l'enonce.",
                "question_recue": "Aide-moi.",
            },
        ):
            start = self.client.post(
                "/session/demarrer",
                json={"niveau_scolaire": "CE1", "lecon_id": SESSION_LECON_ID},
            )
            self.assertEqual(start.status_code, 200)
            payload = start.json()
            session_id = payload["session_id"]
            exercice = payload["exercice"]

            tutor = self.client.post(
                "/tuteur/aide",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "niveau": "CE1",
                    "question": "Aide-moi.",
                },
            )
            self.assertEqual(tutor.status_code, 200)
            self.assertFalse(tutor.json()["progression"]["erreurs_sur_chaine_actuelle"])
            self.assertEqual(tutor.json()["progression"]["niveau_resolution_courant"], 1)

            statuses: list[str] = []
            for _ in range(3):
                response = self.client.post(
                    "/evaluer",
                    json={
                        "session_id": session_id,
                        "exercice_id": exercice["id"],
                        "reponse_donnee": _answer_for(exercice),
                    },
                )
                self.assertEqual(response.status_code, 200)
                body = response.json()
                statuses.append(body["statut"])
                if "exercice_suivant" in body:
                    exercice = body["exercice_suivant"]

            self.assertEqual(
                statuses,
                [
                    "correct_niveau_suivant",
                    "correct_niveau_suivant",
                    "correct_nouveau_renforcement",
                ],
            )
            self.assertEqual(body["progression"]["maitrise_actuelle"], 3)
            self.assertEqual(body["progression"]["exercices_renforcement_restants"], 2)


if __name__ == "__main__":
    unittest.main()
