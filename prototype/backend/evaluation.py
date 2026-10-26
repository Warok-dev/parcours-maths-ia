from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

# Expression multiplicative normalisee : "[total=]a x b" (apres suppression
# des espaces et mise en minuscules par normalize_value).
_MULT_EXPR = re.compile(r"^(?:(\d+)=)?(\d+)x(\d+)$")

# Expression soustractive normalisee : "[resultat=]a-b[=resultat]". Le resultat
# peut etre ecrit avant, apres, ou omis ; les operandes gardent leur ordre.
_SUB_EXPR = re.compile(r"^(?:(\d+)=)?(\d+)-(\d+)(?:=(\d+))?$")


# Nombre ecrit par un enfant : signe optionnel, separateur decimal "," ou ".".
_NOMBRE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")
# Milliers separes par des espaces ("1 000", "12 500") quand les espaces ne
# sont pas deja ignores par la tolerance de l'exercice.
_NOMBRE_MILLIERS = re.compile(r"^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$")
# Heure : "3:05", "03:05", "3h05", "3 h 05", "3h" (heure pleine).
_HEURE = re.compile(r"^(\d{1,2})\s*[h:]\s*(\d{2})?$")
# Espaces typographiques qu'un clavier ou un copier-coller peut inserer.
_ESPACES_SPECIAUX = str.maketrans({"\u00a0": " ", "\u202f": " ", "\u2009": " "})


def _nombre(texte: str) -> Decimal | None:
    """Valeur numerique d'une reponse, ou None si ce n'est pas un nombre.

    Tolere ce qu'un eleve ecrit naturellement : virgule ou point decimal,
    zeros non significatifs ("08", "3,50"), espaces de milliers. Un nombre
    suivi d'autre chose (unite, operation...) n'est PAS un nombre ici : cette
    comparaison ne remplace pas les regles d'expression ci-dessous."""
    texte = texte.translate(_ESPACES_SPECIAUX).strip()
    if _NOMBRE_MILLIERS.match(texte):
        texte = texte.replace(" ", "")
    if not _NOMBRE.match(texte):
        return None
    try:
        return Decimal(texte.replace(",", "."))
    except InvalidOperation:
        return None


def _nombres_egaux(reponse_norm: str, candidats: list[str]) -> bool:
    valeur = _nombre(reponse_norm)
    if valeur is None:
        return False
    return any(_nombre(candidat) == valeur for candidat in candidats)


def _heure(texte: str) -> tuple[int, int] | None:
    match = _HEURE.match(texte.translate(_ESPACES_SPECIAUX).strip())
    if not match:
        return None
    heures = int(match.group(1))
    minutes = int(match.group(2)) if match.group(2) else 0
    if heures > 23 or minutes > 59:
        return None
    return heures, minutes


def _heures_egales(reponse_norm: str, candidats: list[str]) -> bool:
    valeur = _heure(reponse_norm)
    if valeur is None:
        return False
    return any(_heure(candidat) == valeur for candidat in candidats)


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
    # Comparaison par VALEUR (et non par texte) : "08" == "8", "3,5" == "3.5",
    # "1 000" == "1000". Uniquement quand la reponse est un nombre seul.
    candidats = [attendu_norm, *equivalences]
    if not is_correct:
        is_correct = _nombres_egaux(reponse_norm, candidats)
    if not is_correct and reponse_attendue.get("format") == "heure":
        is_correct = _heures_egales(reponse_norm, candidats)

    return {
        "correct": is_correct,
        "reponse_normalisee": reponse_norm,
        "attendu_normalise": attendu_norm,
        "message": "Bonne reponse." if is_correct else "Essaie encore.",
    }
