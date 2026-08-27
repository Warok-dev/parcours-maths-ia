from __future__ import annotations

import re
from typing import Any

# Expression multiplicative normalisee : "[total=]a x b" (apres suppression
# des espaces et mise en minuscules par normalize_value).
_MULT_EXPR = re.compile(r"^(?:(\d+)=)?(\d+)x(\d+)$")

# Expression soustractive normalisee : "[resultat=]a-b[=resultat]". Le resultat
# peut etre ecrit avant, apres, ou omis ; les operandes gardent leur ordre.
_SUB_EXPR = re.compile(r"^(?:(\d+)=)?(\d+)-(\d+)(?:=(\d+))?$")


def normalize_value(value: Any, tolerance: dict | None = None) -> str:
    text = "" if value is None else str(value)
    tolerance = tolerance or {}

    # Les signes de multiplication equivalents (×, *) valent "x".
    text = text.replace("×", "x").replace("*", "x")

    if tolerance.get("ignorer_espaces"):
        text = "".join(text.split())

    return text.strip().lower()


def _parse_multiplication(text: str) -> tuple[int | None, tuple[int, int]] | None:
    match = _MULT_EXPR.match(text)
    if not match:
        return None
    total = int(match.group(1)) if match.group(1) else None
    facteurs = sorted((int(match.group(2)), int(match.group(3))))
    return total, (facteurs[0], facteurs[1])


def _multiplications_equivalentes(reponse_norm: str, attendu_norm: str) -> bool:
    """La multiplication est commutative : "10 x 7" vaut "7 x 10".

    Les deux ecritures doivent porter les memes facteurs (ordre libre) ; un
    total ecrit d'un cote ou de l'autre doit correspondre au produit.
    """
    reponse = _parse_multiplication(reponse_norm)
    attendu = _parse_multiplication(attendu_norm)
    if reponse is None or attendu is None:
        return False
    if reponse[1] != attendu[1]:
        return False
    produit = attendu[1][0] * attendu[1][1]
    for total, _facteurs in (reponse, attendu):
        if total is not None and total != produit:
            return False
    return True


def _parse_soustraction(text: str) -> tuple[int | None, tuple[int, int]] | None:
    match = _SUB_EXPR.match(text)
    if not match:
        return None
    prefixe = match.group(1)
    suffixe = match.group(4)
    # Un resultat ecrit des deux cotes ("8=13-5=8") est ambigu : on refuse.
    if prefixe is not None and suffixe is not None:
        return None
    resultat = int(prefixe) if prefixe is not None else (
        int(suffixe) if suffixe is not None else None
    )
    a = int(match.group(2))
    b = int(match.group(3))
    return resultat, (a, b)


def _soustractions_equivalentes(reponse_norm: str, attendu_norm: str) -> bool:
    """La soustraction n'est PAS commutative : l'ordre des operandes est fige.

    On tolere uniquement la place du resultat ("13 - 5", "13 - 5 = 8" et
    "8 = 13 - 5" sont equivalents), pas une inversion des termes.
    """
    reponse = _parse_soustraction(reponse_norm)
    attendu = _parse_soustraction(attendu_norm)
    if reponse is None or attendu is None:
        return False
    if reponse[1] != attendu[1]:
        return False
    difference = attendu[1][0] - attendu[1][1]
    for resultat, _operandes in (reponse, attendu):
        if resultat is not None and resultat != difference:
            return False
    return True


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
    if not is_correct:
        is_correct = _multiplications_equivalentes(reponse_norm, attendu_norm) or any(
            _multiplications_equivalentes(reponse_norm, equivalence)
            for equivalence in equivalences
        )
    if not is_correct:
        is_correct = _soustractions_equivalentes(reponse_norm, attendu_norm) or any(
            _soustractions_equivalentes(reponse_norm, equivalence)
            for equivalence in equivalences
        )

    return {
        "correct": is_correct,
        "reponse_normalisee": reponse_norm,
        "attendu_normalise": attendu_norm,
        "message": "Bonne reponse." if is_correct else "Essaie encore.",
    }
