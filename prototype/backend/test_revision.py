"""Tests de la session de revision ciblee (POST /session/demarrer_revision).

Verifient les deux promesses du mode : le pool est limite aux patterns
demandes, et la progression dessus est celle d'une session normale.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from main import EXERCICE_CACHE, REVISION_MAX_CONCEPTS, SESSION_STATE, app

# Patterns proceduraux CE1 issus de deux lecons differentes (soustraction et
# addition) : une revision doit pouvoir les melanger, ce qu'une lecon ne
# permet pas. Aucun pattern narratif ici : leur generation appelle un LLM.
PATTERNS_CIBLES = [
    "partie_tout_soustraction_non_narratif",
    "addition_pas_a_pas_sans_retenue",
]


def _answer_for(exercice: dict) -> str:
    value = exercice["reponse_attendue"]["valeur"]
    if isinstance(value, list):
        return ", ".join(map(str, value))
    return str(value)


class RevisionSessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def setUp(self) -> None:
        EXERCICE_CACHE.clear()
        SESSION_STATE.clear()

    def _demarrer(self, patterns: list[str], niveau: str = "CE1"):
        return self.client.post(
            "/session/demarrer_revision",
            json={"niveau_scolaire": niveau, "patterns_cibles": patterns},
        )

    def test_pool_limite_aux_patterns_cibles(self) -> None:
        response = self._demarrer(PATTERNS_CIBLES)
        self.assertEqual(response.status_code, 200)
        progression = response.json()["progression"]

        self.assertEqual(progression["concepts"], PATTERNS_CIBLES)
        self.assertEqual(progression["concept_courant"], PATTERNS_CIBLES[0])
        self.assertTrue(progression["revision"])
        # Le premier exercice servi porte bien le pattern cible.
        self.assertEqual(
            response.json()["exercice"]["pattern"]["pattern_name"],
            PATTERNS_CIBLES[0],
        )

    def test_pool_ignore_les_patterns_ingenerables_et_les_doublons(self) -> None:
        response = self._demarrer(
            [
                PATTERNS_CIBLES[0],
                "pattern_qui_nexiste_pas",
                PATTERNS_CIBLES[0],
                PATTERNS_CIBLES[1],
            ]
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["progression"]["concepts"], PATTERNS_CIBLES)

    def test_pool_vide_apres_filtrage_retourne_404(self) -> None:
        response = self._demarrer(["pattern_qui_nexiste_pas"])
        self.assertEqual(response.status_code, 404)

        response = self._demarrer([])
        self.assertEqual(response.status_code, 404)

    def test_pool_plafonne_pour_ne_pas_devenir_un_marathon(self) -> None:
        # Le CE2 offre assez de patterns proceduraux pour depasser le plafond.
        patterns = [
            "double_via_2xn",
            "multiplication_par_10",
            "moitie_via_2xn",
            "identifier_multiple_de_10",
            "facteur_manquant_table_de_2",
            "addition_2chiffres_sans_retenue",
            "multiplication_chiffre_x_multiple_de_10",
            "conversion_cm_mm_vers_mm",
        ]
        response = self._demarrer(patterns, niveau="CE2")
        self.assertEqual(response.status_code, 200)
        concepts = response.json()["progression"]["concepts"]
        self.assertEqual(len(concepts), REVISION_MAX_CONCEPTS)
        self.assertEqual(concepts, patterns[:REVISION_MAX_CONCEPTS])

    def test_progression_identique_a_une_session_normale(self) -> None:
        """Detection 1->3 puis 2 renforcements, exactement comme une lecon."""
        start = self._demarrer(PATTERNS_CIBLES)
        payload = start.json()
        session_id = payload["session_id"]
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
        # Concept suivant : le second pattern cible, et rien d'autre.
        progression = self.client.get(f"/session/{session_id}").json()
        self.assertEqual(progression["concept_courant"], PATTERNS_CIBLES[1])
        self.assertEqual(progression["phase"], "detection_maitrise")

    def test_revision_dun_seul_concept_se_termine_sur_lui(self) -> None:
        start = self._demarrer([PATTERNS_CIBLES[0]])
        payload = start.json()
        session_id = payload["session_id"]
        exercice = payload["exercice"]
        self.assertEqual(payload["progression"]["concepts"], [PATTERNS_CIBLES[0]])

        statut = None
        for _ in range(5):
            body = self.client.post(
                "/evaluer",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            ).json()
            statut = body["statut"]
            if "exercice_suivant" in body:
                exercice = body["exercice_suivant"]

        self.assertEqual(statut, "carte_terminee")
        progression = self.client.get(f"/session/{session_id}").json()
        self.assertTrue(progression["terminee"])
        # Maitrise 3 (sans faute) publiee pour le concept revise : c'est elle
        # qui fera sortir le concept des faiblesses cote frontend.
        self.assertEqual(progression["maitrises_concepts_terminees"], [3])

    def test_maitrise_publiee_par_concept_apres_une_faute(self) -> None:
        """Une faute au niveau 1 verrouille la maitrise 1 sur le concept."""
        start = self._demarrer([PATTERNS_CIBLES[0]])
        payload = start.json()
        session_id = payload["session_id"]
        exercice = payload["exercice"]

        faux = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": "999999",
            },
        )
        self.assertEqual(faux.json()["statut"], "incorrect")

        # 1 bonne reponse (detection) + 4 renforcements de maitrise 1.
        for _ in range(6):
            body = self.client.post(
                "/evaluer",
                json={
                    "session_id": session_id,
                    "exercice_id": exercice["id"],
                    "reponse_donnee": _answer_for(exercice),
                },
            ).json()
            if "exercice_suivant" in body:
                exercice = body["exercice_suivant"]

        progression = self.client.get(f"/session/{session_id}").json()
        self.assertTrue(progression["terminee"])
        self.assertEqual(progression["maitrises_concepts_terminees"], [1])


if __name__ == "__main__":
    unittest.main()
