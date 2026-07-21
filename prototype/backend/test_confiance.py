"""Tests de la detection de decouragement et de l'exercice de confiance.

Le decouragement est un signal de TENDANCE (plusieurs exercices, plusieurs
concepts), a distinguer du tuteur proactif du frontend qui, lui, ne regarde
qu'un seul exercice a la fois.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

import main
from main import (
    CONFIANCE_ESPACEMENT_MIN,
    EXERCICE_CACHE,
    SESSION_STATE,
    app,
)

SESSION_LECON_ID = "addition"


def _answer_for(exercice: dict) -> str:
    value = exercice["reponse_attendue"]["valeur"]
    if isinstance(value, list):
        return ", ".join(map(str, value))
    return str(value)


class ConfianceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def setUp(self) -> None:
        EXERCICE_CACHE.clear()
        SESSION_STATE.clear()

    # ---------- utilitaires ----------

    def _start(self, niveau: str = "CE1", lecon: str = SESSION_LECON_ID) -> tuple[str, dict]:
        response = self.client.post(
            "/session/demarrer",
            json={"niveau_scolaire": niveau, "lecon_id": lecon},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        return payload["session_id"], payload["exercice"]

    def _evaluer(self, session_id: str, exercice: dict, reponse: str) -> dict:
        response = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": reponse,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _echouer(self, session_id: str, exercice: dict) -> dict:
        return self._evaluer(session_id, exercice, "__faux__")

    def _reussir(self, session_id: str, exercice: dict) -> dict:
        return self._evaluer(session_id, exercice, _answer_for(exercice))

    # ---------- declenchement par echecs repetes ----------

    def test_quatre_echecs_sur_cinq_declenchent_un_exercice_de_confiance(self) -> None:
        session_id, exercice = self._start()

        # 1 reussite puis 4 echecs : la fenetre glissante contient 4 echecs
        # sur 5 tentatives, toutes activites confondues.
        body = self._reussir(session_id, exercice)
        exercice = body.get("exercice_suivant", exercice)

        for rang in range(1, 5):
            body = self._echouer(session_id, exercice)
            self.assertEqual(body["statut"], "incorrect")
            if rang < 4:
                self.assertFalse(
                    body["progression"]["exercice_confiance_actif"],
                    f"aparte declenche trop tot (apres {rang} echecs)",
                )

        self.assertTrue(body["progression"]["exercice_confiance_actif"])
        self.assertIn("exercice_suivant", body)
        self.assertEqual(
            body["exercice_suivant"]["id"],
            SESSION_STATE[session_id]["exercice_confiance"]["exercice_id"],
        )
        self.assertEqual(SESSION_STATE[session_id]["exercice_confiance"]["motif"], "echecs_repetes")

    def test_exercice_de_confiance_presente_au_niveau_le_plus_guide(self) -> None:
        session_id, exercice = self._start()
        # Monte au niveau 2 de resolution avant de decrocher, pour verifier
        # que l'aparte redescend bien en 1_guide.
        body = self._reussir(session_id, exercice)
        exercice = body.get("exercice_suivant", exercice)
        self.assertEqual(body["progression"]["niveau_resolution_courant"], 2)

        for _ in range(4):
            body = self._echouer(session_id, exercice)

        progression = body["progression"]
        self.assertTrue(progression["exercice_confiance_actif"])
        self.assertEqual(progression["presentation_courante"], "1_guide")
        self.assertTrue(progression["presentation_courante_detail"]["aide_affichee"])

    # ---------- declenchement par deux maitrises 1 ----------

    def test_deux_concepts_consecutifs_en_maitrise_un_declenchent_l_aparte(self) -> None:
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]

        # Deux concepts deja termines au plus bas niveau de maitrise, sans
        # aucun echec recent : seul le second critere peut declencher.
        session["maitrises_concepts_terminees"] = [1, 1]
        session["tentatives_recentes"] = [True, True]

        exercice = EXERCICE_CACHE[session["exercice_id_courant"]]
        body = self._reussir(session_id, exercice)

        self.assertTrue(body["progression"]["exercice_confiance_actif"])
        self.assertEqual(session["exercice_confiance"]["motif"], "maitrises_basses")

    def test_deux_maitrises_dont_une_bonne_ne_declenchent_pas(self) -> None:
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]
        session["maitrises_concepts_terminees"] = [1, 2]
        session["tentatives_recentes"] = [True, True]

        exercice = EXERCICE_CACHE[session["exercice_id_courant"]]
        body = self._reussir(session_id, exercice)

        self.assertFalse(body["progression"]["exercice_confiance_actif"])

    # ---------- absence de declenchement ----------

    def test_trois_echecs_sur_cinq_ne_declenchent_pas(self) -> None:
        session_id, exercice = self._start()
        self._echouer(session_id, exercice)
        self._echouer(session_id, exercice)
        body = self._reussir(session_id, exercice)
        exercice = body.get("exercice_suivant", exercice)
        body = self._echouer(session_id, exercice)

        session = SESSION_STATE[session_id]
        self.assertEqual(session["tentatives_recentes"], [False, False, True, False])
        self.assertFalse(body["progression"]["exercice_confiance_actif"])
        self.assertIsNone(session["exercice_confiance"])

    def test_parcours_sans_difficulte_ne_declenche_jamais(self) -> None:
        session_id, exercice = self._start()
        for _ in range(5):
            body = self._reussir(session_id, exercice)
            self.assertFalse(body["progression"]["exercice_confiance_actif"])
            exercice = body.get("exercice_suivant", exercice)

    # ---------- selection du pattern ----------

    def test_pattern_deja_maitrise_a_trois_est_prefere(self) -> None:
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]
        # Un pattern du niveau, maitrise a 3, l'emporte sur le repli simple.
        session["patterns_maitrises"] = ["partie_tout_soustraction_non_narratif"]

        self.assertEqual(
            main._pattern_pour_confiance(session),
            "partie_tout_soustraction_non_narratif",
        )

    def test_pattern_maitrise_dans_un_autre_niveau_est_ignore(self) -> None:
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]
        # multiplication_par_10 est un pattern CE2 : injouable en CE1, donc
        # ecarte au profit du repli procedural du niveau.
        session["patterns_maitrises"] = ["multiplication_par_10"]

        self.assertEqual(
            main._pattern_pour_confiance(session),
            "partie_tout_addition_non_narratif",
        )

    def test_pattern_maitrise_identique_au_concept_courant_est_evite(self) -> None:
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]
        autre = "partie_tout_soustraction_non_narratif"
        self.assertNotEqual(session["concept_courant"], autre)
        session["patterns_maitrises"] = [session["concept_courant"], autre]

        self.assertEqual(main._pattern_pour_confiance(session), autre)

    def test_concept_en_echec_ecarte_meme_s_il_est_le_seul_maitrise(self) -> None:
        # Cas reel : l'eleve a maitrise ce concept a 3, puis a decroche en
        # renforcement dessus. Le lui reservir irait contre le but de l'aparte.
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]
        session["patterns_maitrises"] = [session["concept_courant"]]

        pattern = main._pattern_pour_confiance(session)
        self.assertNotEqual(pattern, session["concept_courant"])
        self.assertIn(pattern, main.CONFIANCE_PATTERNS_SIMPLES)

    def test_repli_choisit_le_plus_simple_et_non_le_dernier_de_la_liste(self) -> None:
        session_id, _ = self._start(niveau="CE2", lecon="multiplication_decomposee")
        session = SESSION_STATE[session_id]
        session["patterns_maitrises"] = []

        # Pour CE2, le premier repli disponible dans l'ordre de simplicite.
        attendu = next(
            pattern
            for pattern in main.CONFIANCE_PATTERNS_SIMPLES
            if pattern in main.patterns_disponibles_pour_niveau("CE2")
        )
        self.assertEqual(main._pattern_pour_confiance(session), attendu)
        self.assertEqual(attendu, "double_via_2xn")

    def test_repli_sur_le_pattern_procedural_le_plus_simple(self) -> None:
        session_id, _ = self._start()
        session = SESSION_STATE[session_id]
        self.assertEqual(session["patterns_maitrises"], [])

        pattern = main._pattern_pour_confiance(session)
        self.assertEqual(pattern, "partie_tout_addition_non_narratif")
        # Le repli reste procedural : jamais un probleme narratif.
        self.assertIn(pattern, main.patterns_disponibles_pour_niveau("CE1"))
        self.assertNotIn(pattern, main.patterns_narratifs_disponibles_pour_niveau("CE1"))

    def test_maitrise_trois_est_enregistree_pendant_la_session(self) -> None:
        session_id, exercice = self._start()
        # Trois reussites d'affilee : maitrise 3 detectee sur le concept.
        for _ in range(3):
            body = self._reussir(session_id, exercice)
            exercice = body.get("exercice_suivant", exercice)

        self.assertEqual(body["progression"]["maitrise_actuelle"], 3)
        self.assertIn(
            body["progression"]["concept_courant"],
            SESSION_STATE[session_id]["patterns_maitrises"],
        )

    # ---------- espacement ----------

    def _remplacer_exercice_normal(self, session: dict, modele: dict, suffixe: str) -> dict:
        """Force un exercice normal distinct (un echec ne change pas l'exercice)."""
        remplacant = dict(modele, id=f"exercice-normal-{suffixe}")
        EXERCICE_CACHE[remplacant["id"]] = remplacant
        session["exercice_id_courant"] = remplacant["id"]
        return remplacant

    def test_pas_deux_apartes_consecutifs_avant_trois_exercices_normaux(self) -> None:
        session_id, exercice = self._start()
        for _ in range(4):
            body = self._echouer(session_id, exercice)
        self.assertTrue(body["progression"]["exercice_confiance_actif"])

        # Reussite de l'aparte : retour a l'exercice normal, inchange.
        body = self._reussir(session_id, body["exercice_suivant"])
        self.assertEqual(body["statut"], "confiance_reussie")
        exercice = body["exercice_suivant"]
        session = SESSION_STATE[session_id]

        # Le signal reste chaud (la fenetre contient toujours 4 echecs), seul
        # l'espacement empeche un second aparte.
        for rang in range(CONFIANCE_ESPACEMENT_MIN - 1):
            self.assertIsNotNone(main._signal_decouragement(session))
            body = self._echouer(session_id, exercice)
            self.assertFalse(
                body["progression"]["exercice_confiance_actif"],
                f"aparte redeclenche apres seulement {rang + 1} exercice(s) normal(aux)",
            )
            exercice = self._remplacer_exercice_normal(session, exercice, str(rang))

        self.assertEqual(
            len(session["exercices_depuis_confiance"]),
            CONFIANCE_ESPACEMENT_MIN - 1,
        )
        # Troisieme exercice normal distinct : l'aparte redevient possible.
        body = self._echouer(session_id, exercice)
        self.assertTrue(body["progression"]["exercice_confiance_actif"])
        # L'insertion remet le compteur d'espacement a zero.
        self.assertEqual(session["exercices_depuis_confiance"], [])

    def test_echecs_repetes_sur_le_meme_exercice_ne_font_pas_avancer_l_espacement(self) -> None:
        session_id, exercice = self._start()
        for _ in range(4):
            body = self._echouer(session_id, exercice)
        body = self._reussir(session_id, body["exercice_suivant"])
        exercice = body["exercice_suivant"]

        # Six echecs de plus, tous sur le MEME exercice normal.
        for _ in range(6):
            body = self._echouer(session_id, exercice)
            self.assertFalse(body["progression"]["exercice_confiance_actif"])

        session = SESSION_STATE[session_id]
        # Un seul exercice distinct joue : rester bloque sur un exercice
        # unique releve du tuteur proactif, pas d'un second aparte.
        self.assertEqual(session["exercices_depuis_confiance"], [exercice["id"]])

    # ---------- l'aparte n'affecte pas la progression ----------

    def test_aparte_ne_touche_ni_la_maitrise_ni_la_progression(self) -> None:
        session_id, exercice = self._start()
        for _ in range(4):
            body = self._echouer(session_id, exercice)
        session = SESSION_STATE[session_id]
        etat_avant = {
            cle: session[cle]
            for cle in (
                "concept_index",
                "concept_courant",
                "phase",
                "niveau_resolution_courant",
                "maitrise_actuelle",
                "exercices_renforcement_restants",
                "erreurs_sur_chaine_actuelle",
                "exercice_id_courant",
            )
        }

        confiance = body["exercice_suivant"]
        # Un echec sur l'aparte ne change rien non plus.
        echec = self._echouer(session_id, confiance)
        self.assertEqual(echec["statut"], "incorrect")
        self.assertTrue(echec["progression"]["exercice_confiance_actif"])
        for cle, valeur in etat_avant.items():
            self.assertEqual(session[cle], valeur, f"l'aparte a modifie {cle}")

        # ... et la fenetre de decouragement ignore l'aparte.
        self.assertEqual(len(session["tentatives_recentes"]), 4)

        reussite = self._reussir(session_id, confiance)
        self.assertEqual(reussite["statut"], "confiance_reussie")
        self.assertFalse(reussite["progression"]["exercice_confiance_actif"])
        for cle, valeur in etat_avant.items():
            self.assertEqual(session[cle], valeur, f"la reprise a modifie {cle}")

        # Le parcours reprend exactement sur l'exercice laisse en attente.
        self.assertEqual(reussite["exercice_suivant"]["id"], etat_avant["exercice_id_courant"])
        self.assertEqual(
            reussite["progression"]["exercice_id_courant"],
            etat_avant["exercice_id_courant"],
        )

    def test_pendant_l_aparte_seul_l_exercice_de_confiance_est_jouable(self) -> None:
        session_id, exercice = self._start()
        for _ in range(4):
            body = self._echouer(session_id, exercice)
        self.assertTrue(body["progression"]["exercice_confiance_actif"])

        refus = self.client.post(
            "/evaluer",
            json={
                "session_id": session_id,
                "exercice_id": exercice["id"],
                "reponse_donnee": _answer_for(exercice),
            },
        )
        self.assertEqual(refus.status_code, 409)

    def test_aparte_survit_a_un_redemarrage_du_serveur(self) -> None:
        session_id, exercice = self._start()
        for _ in range(4):
            body = self._echouer(session_id, exercice)
        confiance_id = body["exercice_suivant"]["id"]

        # Simule un redemarrage : caches memoire vides, tout vient du disque.
        EXERCICE_CACHE.clear()
        SESSION_STATE.clear()

        progression = self.client.get(f"/session/{session_id}")
        self.assertEqual(progression.status_code, 200)
        payload = progression.json()
        self.assertTrue(payload["exercice_confiance_actif"])
        self.assertEqual(payload["exercice_id_courant"], confiance_id)
        self.assertIsNotNone(payload.get("exercice_courant"))


if __name__ == "__main__":
    unittest.main()
