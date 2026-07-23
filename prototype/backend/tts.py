"""Synthese vocale via Google Cloud Text-to-Speech (voix neurale francaise).

Remplace la voix native robotique du navigateur par une voix Neural2 fr-FR,
pour le tuteur et la narration des enonces. Le frontend appelle l'endpoint
POST /synthese-vocale (voir main.py) et joue l'audio ; en cas d'echec ici, il
retombe sur la synthese native (pas de silence pour l'eleve).

Points d'attention :
- Authentification : le SDK Google lit GOOGLE_APPLICATION_CREDENTIALS. On la
  charge depuis le .env local (comme tutor.py) et on garantit un chemin
  absolu valide AVANT de construire le client.
- Cache memoire : meme texte deja synthetise => on ressert le base64 sans
  rappeler l'API (economie du quota gratuit).
- Erreurs : toute panne du fournisseur remonte en TTSServiceError, que
  l'endpoint traduit en 503 propre plutot qu'un crash.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
from functools import lru_cache
from pathlib import Path

LOGGER = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
LOCAL_ENV_PATH = BASE_DIR.parent / ".env"
DEFAULT_CREDENTIALS_PATH = BASE_DIR / "google-tts-credentials.json"

LANGUAGE_CODE = "fr-FR"
# Voix neurale francaise chaleureuse (feminine), adaptee a un contexte
# enfantin CE1/CE2 : plus naturelle et posee que la voix native du navigateur.
# Neural2-F/G sont les voix Neural2 fr-FR disponibles sur le projet ; F (voix
# feminine posee) convient bien a un tuteur pour jeunes eleves.
VOICE_NAME = "fr-FR-Neural2-F"

# Deux tons legers selon l'appelant. Le tuteur parle un rien plus vif et aigu
# (le hibou complice) ; l'enonce est lu plus lentement et neutre, pour la
# comprehension. Les deux restent sur la MEME voix neurale.
VOICE_PROFILES = {
    "tuteur": {"speaking_rate": 0.98, "pitch": 1.5},
    "enonce": {"speaking_rate": 0.90, "pitch": 0.0},
}
DEFAULT_PROFILE = "enonce"

# Borne de securite : au-dela, on tronque (un enonce ou une reponse de tuteur
# tient largement dedans ; evite d'envoyer un texte aberrant a l'API).
MAX_TEXT_LENGTH = 800

# Cache : sha256(voix|profil|texte) -> audio MP3 en base64.
_AUDIO_CACHE: dict[str, str] = {}


class TTSConfigurationError(RuntimeError):
    """La synthese vocale n'est pas configuree correctement (credentials)."""


class TTSServiceError(RuntimeError):
    """La synthese vocale ne peut pas honorer la demande (panne fournisseur)."""


def _load_local_env() -> None:
    # Charge les cles manquantes du .env sans jamais ecraser l'environnement
    # (meme logique que tutor._load_local_env).
    if not LOCAL_ENV_PATH.exists():
        return
    for line in LOCAL_ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _resolve_credentials_path() -> Path:
    raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if raw:
        path = Path(raw)
        if not path.is_absolute():
            # Chemin relatif (ex : ./google-tts-credentials.json) : resolu
            # depuis le dossier backend, ou vivent .env et le fichier, et non
            # depuis le CWD imprevisible du process uvicorn.
            path = (BASE_DIR / path).resolve()
        return path
    return DEFAULT_CREDENTIALS_PATH


def ensure_tts_configured() -> Path:
    _load_local_env()
    path = _resolve_credentials_path()
    if not path.is_file():
        raise TTSConfigurationError(
            f"Fichier de credentials Google TTS introuvable : {path}. "
            "Definis GOOGLE_APPLICATION_CREDENTIALS dans .env."
        )
    # Le SDK Google lit cette variable a la construction du client : on la fige
    # sur un chemin absolu et verifie.
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(path)
    return path


@lru_cache(maxsize=1)
def _build_client():
    from google.cloud import texttospeech

    ensure_tts_configured()
    return texttospeech.TextToSpeechClient()


def _cache_key(text: str, profile: str) -> str:
    return hashlib.sha256(f"{VOICE_NAME}|{profile}|{text}".encode("utf-8")).hexdigest()


def _normalize(text: str, profile: str) -> tuple[str, str]:
    text = (text or "").strip()
    if not text:
        raise TTSServiceError("Texte vide a synthetiser.")
    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]
    if profile not in VOICE_PROFILES:
        profile = DEFAULT_PROFILE
    return text, profile


def is_cached(text: str, profile: str = DEFAULT_PROFILE) -> bool:
    """Vrai si ce texte/profil a deja ete synthetise (utile pour observer le
    cache cote endpoint sans rappeler l'API)."""
    try:
        text, profile = _normalize(text, profile)
    except TTSServiceError:
        return False
    return _cache_key(text, profile) in _AUDIO_CACHE


def _call_google_tts(text: str, profile: str) -> str:
    from google.cloud import texttospeech

    try:
        client = _build_client()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(
            language_code=LANGUAGE_CODE,
            name=VOICE_NAME,
        )
        params = VOICE_PROFILES[profile]
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=params["speaking_rate"],
            pitch=params["pitch"],
        )
        response = client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )
    except TTSConfigurationError:
        raise
    except Exception as exc:  # quota, cle invalide, reseau, gRPC...
        LOGGER.warning("TTS: echec Google TTS : %s", exc)
        raise TTSServiceError("La synthese vocale Google est indisponible.") from exc

    return base64.b64encode(response.audio_content).decode("ascii")


def synthesize(text: str, profile: str = DEFAULT_PROFILE) -> str:
    """Retourne l'audio MP3 en base64 pour `text`.

    Sert le cache memoire si ce texte a deja ete synthetise, sinon appelle
    l'API Google TTS et memorise le resultat.
    """
    text, profile = _normalize(text, profile)
    key = _cache_key(text, profile)

    cached = _AUDIO_CACHE.get(key)
    if cached is not None:
        LOGGER.info("TTS: cache hit (%s).", key[:8])
        return cached

    audio_b64 = _call_google_tts(text, profile)
    _AUDIO_CACHE[key] = audio_b64
    LOGGER.info("TTS: audio genere et mis en cache (%s).", key[:8])
    return audio_b64
