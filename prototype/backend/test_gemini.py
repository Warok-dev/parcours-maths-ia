"""Tests du module gemini (SDK google-genai) : la requete HTTP reellement
construite par le SDK est capturee via un transport httpx simule, sans aucun
appel reseau."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx

import gemini


class _Capture:
    def __init__(self, reponse_json: dict, statut: int = 200) -> None:
        self.requetes: list[httpx.Request] = []
        self.reponse_json = reponse_json
        self.statut = statut

    def __call__(self, _client, request, **_kwargs):
        self.requetes.append(request)
        return httpx.Response(self.statut, json=self.reponse_json, request=request)

    @property
    def corps(self) -> dict:
        return json.loads(self.requetes[-1].content)


def _reponse(texte: str, raison: str = "STOP") -> dict:
    return {
        "candidates": [
            {"content": {"role": "model", "parts": [{"text": texte}]}, "finishReason": raison}
        ]
    }


class GeminiTests(unittest.TestCase):
    def setUp(self) -> None:
        gemini.client.cache_clear()

    def tearDown(self) -> None:
        gemini.client.cache_clear()

    def _generer(self, capture: _Capture, **extra) -> gemini.ReponseGemini:
        # Une fonction (et non l'instance) pour etre liee comme une methode.
        def envoi(client, request, **kwargs):
            return capture(client, request, **kwargs)

        with patch.object(httpx.Client, "send", envoi):
            return gemini.generer(
                "Bonjour",
                api_key="cle",
                modele="gemini-test",
                system_instruction="Tu es un tuteur.",
                temperature=0.3,
                max_output_tokens=500,
                timeout_secondes=8,
                **extra,
            )

    def test_requete_construite(self) -> None:
        capture = _Capture(_reponse("Pars de 24. "))
        reponse = self._generer(capture)
        self.assertEqual(reponse, gemini.ReponseGemini(texte="Pars de 24.", tronquee=False))
        requete = capture.requetes[0]
        self.assertTrue(str(requete.url).endswith("/models/gemini-test:generateContent"))
        self.assertEqual(requete.headers["x-goog-api-key"], "cle")
        self.assertEqual(requete.extensions["timeout"]["read"], 8)
        corps = capture.corps
        self.assertEqual(corps["contents"][0]["parts"][0]["text"], "Bonjour")
        self.assertEqual(corps["systemInstruction"]["parts"][0]["text"], "Tu es un tuteur.")
        self.assertEqual(corps["generationConfig"]["maxOutputTokens"], 500)
        self.assertEqual(corps["generationConfig"]["temperature"], 0.3)

    def test_sortie_json_contrainte(self) -> None:
        schema = {"type": "object", "properties": {"objet": {"type": "string"}}}
        capture = _Capture(_reponse('{"objet": "billes"}'))
        reponse = self._generer(
            capture, response_mime_type="application/json", response_json_schema=schema
        )
        config = capture.corps["generationConfig"]
        self.assertEqual(config["responseMimeType"], "application/json")
        self.assertEqual(config["responseJsonSchema"], schema)
        self.assertEqual(json.loads(reponse.texte), {"objet": "billes"})

    def test_troncature_detectee(self) -> None:
        reponse = self._generer(_Capture(_reponse("Coupé au mil", "MAX_TOKENS")))
        self.assertTrue(reponse.tronquee)

    def test_reponse_sans_candidat(self) -> None:
        reponse = self._generer(_Capture({"candidates": []}))
        self.assertEqual(reponse, gemini.ReponseGemini(texte="", tronquee=False))

    def test_erreur_quota_remonte_sans_nouvelle_tentative(self) -> None:
        capture = _Capture({"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}, 429)
        with self.assertRaises(Exception):
            self._generer(capture)
        self.assertEqual(len(capture.requetes), 1)


if __name__ == "__main__":
    unittest.main()
