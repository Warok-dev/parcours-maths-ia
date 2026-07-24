"""Tests de l'endpoint de synthese vocale (POST /synthese-vocale) et du module
tts, avec l'appel Google TTS MOCKE : aucun vrai appel reseau ni consommation
de quota dans la suite automatique.

Verifie : succes (audio renvoye), cache (2e appel identique ne rappelle pas
l'API), et 503 propre en cas d'echec du fournisseur.
"""

from __future__ import annotations

import base64
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import tts
from main import app

AUDIO_BYTES = b"ID3-faux-mp3-bytes"


class _FakeAudioResponse:
    def __init__(self, audio: bytes) -> None:
        self.audio_content = audio


class _CountingClient:
    """Faux client Google TTS : compte les appels et renvoie un audio fixe."""

    def __init__(self, audio: bytes = AUDIO_BYTES) -> None:
        self.audio = audio
        self.calls = 0

    def synthesize_speech(self, *, input, voice, audio_config):  # noqa: A002
        self.calls += 1
        return _FakeAudioResponse(self.audio)


class SyntheseVocaleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def setUp(self) -> None:
        # Cache memoire partage entre tests : on repart propre a chaque test.
        tts._AUDIO_CACHE.clear()

    def test_succes_renvoie_de_l_audio(self) -> None:
        fake = _CountingClient()
        with patch.object(tts, "_build_client", return_value=fake):
            response = self.client.post(
                "/synthese-vocale", json={"texte": "Bravo, tu progresses !", "source": "tuteur"}
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["format"], "mp3")
        self.assertEqual(payload["voix"], tts.VOICE_NAME)
        self.assertFalse(payload["depuis_cache"])
        # L'audio renvoye est bien le MP3 (mocke) encode en base64.
        self.assertEqual(base64.b64decode(payload["audio_base64"]), AUDIO_BYTES)
        self.assertEqual(fake.calls, 1)

    def test_cache_evite_un_second_appel_identique(self) -> None:
        fake = _CountingClient()
        with patch.object(tts, "_build_client", return_value=fake):
            first = self.client.post("/synthese-vocale", json={"texte": "Calcule 24 + 6."})
            second = self.client.post("/synthese-vocale", json={"texte": "Calcule 24 + 6."})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        # Meme texte : l'API n'a ete appelee qu'une seule fois.
        self.assertEqual(fake.calls, 1)
        self.assertFalse(first.json()["depuis_cache"])
        self.assertTrue(second.json()["depuis_cache"])
        # Le second sert exactement le meme audio.
        self.assertEqual(first.json()["audio_base64"], second.json()["audio_base64"])

    def test_texte_different_rappelle_l_api(self) -> None:
        fake = _CountingClient()
        with patch.object(tts, "_build_client", return_value=fake):
            self.client.post("/synthese-vocale", json={"texte": "Premier texte."})
            self.client.post("/synthese-vocale", json={"texte": "Deuxieme texte."})
        self.assertEqual(fake.calls, 2)

    def test_meme_texte_source_differente_rappelle_l_api(self) -> None:
        # Le profil (ton) fait partie de la cle de cache : tuteur vs enonce ne
        # doivent pas se partager le meme audio.
        fake = _CountingClient()
        with patch.object(tts, "_build_client", return_value=fake):
            self.client.post("/synthese-vocale", json={"texte": "Meme phrase.", "source": "tuteur"})
            self.client.post("/synthese-vocale", json={"texte": "Meme phrase.", "source": "enonce"})
        self.assertEqual(fake.calls, 2)

    def test_echec_fournisseur_renvoie_503(self) -> None:
        # Le SDK leve une erreur quelconque (quota, cle, reseau) au moment de
        # synthetiser : l'endpoint doit repondre 503, pas planter.
        boom = _CountingClient()

        def _explose(*, input, voice, audio_config):  # noqa: A002
            raise RuntimeError("429 quota epuise")

        boom.synthesize_speech = _explose  # type: ignore[assignment]
        with patch.object(tts, "_build_client", return_value=boom):
            response = self.client.post("/synthese-vocale", json={"texte": "Aide-moi."})

        self.assertEqual(response.status_code, 503)
        self.assertIn("indisponible", response.json()["detail"].lower())

    def test_credentials_absents_renvoie_503(self) -> None:
        # Erreur de configuration (fichier de credentials manquant) : elle
        # remonte aussi en 503 propre cote endpoint.
        with patch.object(
            tts, "_build_client", side_effect=tts.TTSConfigurationError("credentials manquants")
        ):
            response = self.client.post("/synthese-vocale", json={"texte": "Bonjour."})
        self.assertEqual(response.status_code, 503)

    def test_texte_vide_renvoie_400(self) -> None:
        response = self.client.post("/synthese-vocale", json={"texte": "   "})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
