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
    def setUp(self) -> None:
        # Le cache des reponses est partage : sans le vider, un test servirait
        # la reponse mise en cache par le precedent au lieu d'appeler le LLM.
        tutor.CACHE_REPONSES.vider()

    def test_appel_gemini_borne_par_un_timeout_explicite(self) -> None:
        """Sans timeout explicite, un Gemini qui traine bloque toute la chaine
        de fallback. On verifie la requete HTTP REELLEMENT construite par le
        SDK google-genai (transport httpx simule, aucun appel reseau)."""
        import httpx

        import gemini

        requetes: list[httpx.Request] = []

        def envoi_factice(_client, request, **_kwargs):
            requetes.append(request)
            return httpx.Response(
                429,
                json={"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}},
                request=request,
            )

        gemini.client.cache_clear()
        with patch.dict("os.environ", {"GEMINI_API_KEY": "cle-test"}), patch.object(
            httpx.Client, "send", envoi_factice
        ):
            with self.assertRaises(Exception):
                tutor._call_gemini("prompt")
        gemini.client.cache_clear()

        # Un seul appel (pas de nouvelle tentative du SDK : c'est la chaine
        # de fournisseurs qui sert de repli), borne par le timeout attendu.
        self.assertEqual(len(requetes), 1)
        delai = requetes[0].extensions["timeout"]
        self.assertEqual(delai["read"], tutor.PROVIDER_TIMEOUT_SECONDS)
        self.assertIn(tutor.MODEL_NAME, str(requetes[0].url))

    def test_meme_timeout_que_les_autres_fournisseurs(self) -> None:
        from generation import narrative

        self.assertEqual(
            tutor.PROVIDER_TIMEOUT_SECONDS,
            narrative.PROVIDER_TIMEOUT_SECONDS,
            "le tuteur et la generation narrative doivent borner Gemini pareil",
        )


class TutorFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        # Le cache des reponses est partage : sans le vider, un test servirait
        # la reponse mise en cache par le precedent au lieu d'appeler le LLM.
        tutor.CACHE_REPONSES.vider()

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
