"""Tests de la chaine de fallback du tuteur (Gemini -> Groq -> Mistral)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from google.api_core import exceptions as gexc

import tutor

EXERCICE = {
    "enonce": "Calcule : 24 + 6 = ?",
    "reponse_attendue": {"valeur": 30},
    "presentations": {
        "1_guide": {"etapes_methode": ["Pars de 24.", "Ajoute 6.", "24 + 6 = 30."]}
    },
}


class TutorTimeoutTests(unittest.TestCase):
    def test_appel_gemini_borne_par_un_timeout_explicite(self) -> None:
        """Sans timeout explicite, le SDK applique son defaut de 600 s et un
        Gemini qui traine bloque toute la chaine de fallback."""
        captures: list[dict] = []

        class ModeleFactice:
            def generate_content(self, prompt, **kwargs):
                captures.append(kwargs)
                raise gexc.ResourceExhausted("429 quota epuise")

        with patch.object(tutor, "_build_model", return_value=ModeleFactice()):
            with self.assertRaises(gexc.ResourceExhausted):
                tutor._call_gemini("prompt")

        self.assertEqual(len(captures), 1)
        self.assertEqual(
            captures[0].get("request_options"),
            {"timeout": tutor.PROVIDER_TIMEOUT_SECONDS},
        )

    def test_meme_timeout_que_les_autres_fournisseurs(self) -> None:
        from generation import narrative

        self.assertEqual(
            tutor.PROVIDER_TIMEOUT_SECONDS,
            narrative.PROVIDER_TIMEOUT_SECONDS,
            "le tuteur et la generation narrative doivent borner Gemini pareil",
        )


class TutorFallbackTests(unittest.TestCase):
    def test_quota_gemini_bascule_sur_groq(self) -> None:
        with patch.object(tutor, "_call_gemini", side_effect=gexc.ResourceExhausted("429 quota")):
            with patch.object(tutor, "_call_groq", return_value="Pars de 24, puis ajoute 6."):
                reponse = tutor.build_tutor_reply(EXERCICE, "Aide-moi.")

        self.assertEqual(reponse["modele"], tutor.GROQ_MODEL_NAME)
        self.assertIn("Pars de 24", reponse["reponse"])

    def test_timeout_gemini_bascule_sur_groq(self) -> None:
        with patch.object(tutor, "_call_gemini", side_effect=gexc.DeadlineExceeded("504 timeout")):
            with patch.object(tutor, "_call_groq", return_value="Compte de 24 jusqu'a 30."):
                reponse = tutor.build_tutor_reply(EXERCICE, "Aide-moi.")

        self.assertEqual(reponse["modele"], tutor.GROQ_MODEL_NAME)

    def test_gemini_et_groq_en_echec_basculent_sur_mistral(self) -> None:
        with patch.object(tutor, "_call_gemini", side_effect=gexc.ResourceExhausted("429")):
            with patch.object(tutor, "_call_groq", side_effect=RuntimeError("groq indisponible")):
                with patch.object(tutor, "_call_mistral", return_value="Ajoute 6 a 24."):
                    reponse = tutor.build_tutor_reply(EXERCICE, "Aide-moi.")

        self.assertEqual(reponse["modele"], tutor.MISTRAL_MODEL_NAME)

    def test_reponse_vide_d_un_fournisseur_passe_au_suivant(self) -> None:
        with patch.object(tutor, "_call_gemini", return_value=""):
            with patch.object(tutor, "_call_groq", return_value="Pars de 24, puis ajoute 6."):
                reponse = tutor.build_tutor_reply(EXERCICE, "Aide-moi.")

        self.assertEqual(reponse["modele"], tutor.GROQ_MODEL_NAME)

    def test_tous_les_fournisseurs_en_echec_leve_une_erreur_de_service(self) -> None:
        with patch.object(tutor, "_call_gemini", side_effect=RuntimeError("gemini")):
            with patch.object(tutor, "_call_groq", side_effect=RuntimeError("groq")):
                with patch.object(tutor, "_call_mistral", side_effect=RuntimeError("mistral")):
                    with self.assertRaises(tutor.TutorServiceError):
                        tutor.build_tutor_reply(EXERCICE, "Aide-moi.")

    def test_gemini_prioritaire_quand_il_repond(self) -> None:
        with patch.object(tutor, "_call_gemini", return_value="Pars de 24, puis ajoute 6."):
            with patch.object(tutor, "_call_groq", side_effect=AssertionError("ne doit pas etre appele")):
                reponse = tutor.build_tutor_reply(EXERCICE, "Aide-moi.")

        self.assertEqual(reponse["modele"], tutor.MODEL_NAME)


if __name__ == "__main__":
    unittest.main()
