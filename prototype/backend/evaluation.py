from __future__ import annotations

from typing import Any


def normalize_value(value: Any, tolerance: dict | None = None) -> str:
    text = "" if value is None else str(value)
    tolerance = tolerance or {}

    if tolerance.get("ignorer_espaces"):
        text = "".join(text.split())

    return text.strip().lower()


def compare_reponse(reponse_eleve: Any, reponse_attendue: dict) -> dict:
    """Compare a student answer with minimal normalization rules."""
    valeur_attendue = reponse_attendue.get("valeur")
    tolerance = reponse_attendue.get("tolerance", {})

    reponse_norm = normalize_value(reponse_eleve, tolerance)
    attendu_norm = normalize_value(valeur_attendue, tolerance)
    equivalences = {
        normalize_value(item, tolerance) for item in tolerance.get("equivalences_acceptees", [])
    }

    is_correct = reponse_norm == attendu_norm or reponse_norm in equivalences

    # TODO: Extend normalization for domain-specific rules such as subtraction-order variants.
    return {
        "correct": is_correct,
        "reponse_normalisee": reponse_norm,
        "attendu_normalise": attendu_norm,
        "message": "Bonne reponse." if is_correct else "Essaie encore.",
    }
