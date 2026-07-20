from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

import google.generativeai as genai
from google.ai.generativelanguage_v1beta.types import Candidate

LOGGER = logging.getLogger(__name__)
MODEL_NAME = "gemini-3.5-flash"
LOCAL_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
THINKING_LEVEL = "low"
BASE_MAX_OUTPUT_TOKENS = 500
RETRY_MAX_OUTPUT_TOKENS = 4000
VALID_ENDINGS = (".", "!", "?", "…")


class TutorConfigurationError(RuntimeError):
    """Raised when the tutor service is not configured correctly."""


class TutorServiceError(RuntimeError):
    """Raised when the tutor service cannot answer a request."""


def _load_local_env() -> None:
    if os.getenv("GEMINI_API_KEY") or not LOCAL_ENV_PATH.exists():
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


def ensure_tutor_configured() -> str:
    _load_local_env()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise TutorConfigurationError(
            "GEMINI_API_KEY est absente. Définissez-la dans l'environnement avant de démarrer le serveur."
        )
    return api_key


@lru_cache(maxsize=1)
def _build_model() -> genai.GenerativeModel:
    api_key = ensure_tutor_configured()
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(
        MODEL_NAME,
        system_instruction=(
            "Tu es un tuteur de mathématiques pour un élève de CE1 ou CE2 (6 à 8 ans). "
            "Utilise des phrases courtes, un vocabulaire simple, un ton bienveillant et encourageant. "
            "Reste strictement sur l'exercice de mathématiques en cours. "
            "Si la question est hors sujet, redirige poliment vers l'exercice. "
            "N'invente jamais une méthode différente de etapes_methode. "
            "Réponds en 2 ou 3 phrases maximum. "
            "Ne demande ni ne stocke aucune information personnelle. "
            "N'écris pas directement la réponse finale, sauf si le message de l'élève indique clairement plusieurs essais ou blocages répétés ; "
            "dans ce cas, donne la réponse en l'expliquant avec la méthode fournie."
        ),
    )


def _build_user_prompt(exercice: dict, question: str) -> str:
    steps = exercice.get("presentations", {}).get("1_guide", {}).get("etapes_methode", [])
    steps_text = "\n".join(f"- {step}" for step in steps) if steps else "- Aucune étape fournie."
    return (
        "Exercice en cours :\n"
        f"Énoncé : {exercice.get('enonce', '')}\n"
        f"Réponse attendue : {exercice.get('reponse_attendue', {}).get('valeur', '')}\n"
        "Méthode autorisée :\n"
        f"{steps_text}\n\n"
        "Message de l'élève :\n"
        f"{question}\n\n"
        "Aide l'élève en respectant exactement la méthode fournie."
    )


def _extract_text(response: object) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str):
        return text.strip()
    return ""


def _extract_finish_reason(response: object) -> Candidate.FinishReason | int | None:
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return None
    return getattr(candidates[0], "finish_reason", None)


def _is_max_tokens_finish_reason(finish_reason: Candidate.FinishReason | int | None) -> bool:
    if finish_reason is None:
        return False
    if finish_reason == Candidate.FinishReason.MAX_TOKENS:
        return True
    return int(finish_reason) == int(Candidate.FinishReason.MAX_TOKENS)


def _is_valid_tutor_text(text: str) -> bool:
    stripped = text.strip()
    return len(stripped) >= 10 and stripped.endswith(VALID_ENDINGS)


def _call_model(
    model: genai.GenerativeModel,
    prompt: str,
    max_output_tokens: int,
) -> tuple[str, Candidate.FinishReason | int | None]:
    generation_config = {
        "temperature": 0.3,
        "max_output_tokens": max_output_tokens,
    }
    # The installed google-generativeai SDK does not expose `thinking_level`
    # directly in GenerationConfig. We keep the intended value visible in logs
    # and compensate with a generous output budget plus retry-on-truncation.
    LOGGER.debug(
        "Appel Gemini: model=%s max_output_tokens=%s thinking_level=%s",
        MODEL_NAME,
        max_output_tokens,
        THINKING_LEVEL,
    )
    response = model.generate_content(prompt, generation_config=generation_config)
    return _extract_text(response), _extract_finish_reason(response)


def build_tutor_reply(exercice: dict, question: str) -> dict:
    """Call Gemini with a strict tutoring prompt anchored on exercise method steps."""
    model = _build_model()
    prompt = _build_user_prompt(exercice, question)

    try:
        text, finish_reason = _call_model(model, prompt, BASE_MAX_OUTPUT_TOKENS)

        if _is_max_tokens_finish_reason(finish_reason) or not _is_valid_tutor_text(text):
            LOGGER.warning(
                "Réponse Gemini incomplète ou trop courte. finish_reason=%s text=%r",
                finish_reason,
                text,
            )
            text, finish_reason = _call_model(model, prompt, RETRY_MAX_OUTPUT_TOKENS)
    except Exception as exc:  # pragma: no cover - covered by manual integration test
        LOGGER.exception("Erreur Gemini pendant /tuteur/aide")
        raise TutorServiceError("Le tuteur IA est temporairement indisponible.") from exc

    if _is_max_tokens_finish_reason(finish_reason):
        LOGGER.error("Gemini a coupé la réponse pour limite de tokens après retry.")
        raise TutorServiceError("Le tuteur IA est temporairement indisponible.")

    if not _is_valid_tutor_text(text):
        LOGGER.error("Gemini a renvoyé une réponse vide ou tronquée: %r", text)
        raise TutorServiceError("Le tuteur IA est temporairement indisponible.")

    return {
        "modele": MODEL_NAME,
        "reponse": text,
        "question_recue": question,
    }
