"""Acces a Gemini via le SDK officiel `google-genai`.

Point d'appel unique pour le tuteur, la generation narrative et les rapports
IA. Remplace l'ancien SDK `google-generativeai`, deprecie par Google.

Toujours avec un timeout explicite : sans lui, un Gemini qui traine (souvent
en limite de quota) bloquerait la chaine de fallback (Groq, Mistral) au lieu
de lui laisser la main rapidement. Aucune nouvelle tentative automatique du
SDK pour la meme raison : c'est la chaine de fournisseurs qui sert de repli.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from google import genai
from google.genai import types


@dataclass(frozen=True)
class ReponseGemini:
    texte: str
    # Vrai si Gemini s'est arrete faute de jetons de sortie (reponse coupee).
    tronquee: bool


@lru_cache(maxsize=4)
def client(api_key: str, timeout_secondes: float) -> genai.Client:
    """Client reutilise (connexions HTTP partagees), un par (cle, timeout)."""
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=int(timeout_secondes * 1000)),
    )


def _texte(reponse: object) -> str:
    try:
        texte = getattr(reponse, "text", None)
    except (ValueError, AttributeError):  # reponse bloquee ou sans contenu
        return ""
    return texte.strip() if isinstance(texte, str) else ""


def _tronquee(reponse: object) -> bool:
    candidats = getattr(reponse, "candidates", None) or []
    if not candidats:
        return False
    raison = getattr(candidats[0], "finish_reason", None)
    if raison is None:
        return False
    nom = getattr(raison, "name", None) or getattr(raison, "value", None) or str(raison)
    return str(nom).upper().endswith("MAX_TOKENS")


def generer(
    prompt: str,
    *,
    api_key: str,
    modele: str,
    system_instruction: str,
    temperature: float,
    max_output_tokens: int,
    timeout_secondes: float,
    response_mime_type: str | None = None,
    response_json_schema: dict | None = None,
) -> ReponseGemini:
    """Un appel generate_content. Les erreurs du SDK (quota, reseau, cle...)
    remontent telles quelles : l'appelant passe alors au fournisseur suivant."""
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type=response_mime_type,
        response_json_schema=response_json_schema,
    )
    reponse = client(api_key, timeout_secondes).models.generate_content(
        model=modele, contents=prompt, config=config
    )
    return ReponseGemini(texte=_texte(reponse), tronquee=_tronquee(reponse))
