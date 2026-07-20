"""Diagnostic d'erreur par regles (aucun appel IA).

Analyse une reponse fausse a partir des vraies variables de l'exercice pour
detecter une signature d'erreur connue. Retourne None si aucune signature ne
correspond : on ne force jamais un faux diagnostic.
"""

from __future__ import annotations

INVERSION_OPERANDES = "INVERSION_OPERANDES"
ERREUR_DISTRACTION = "ERREUR_DISTRACTION"
ZERO_OUBLIE = "ZERO_OUBLIE"
OPERATION_INVERSEE = "OPERATION_INVERSEE"
TABLE_MULTIPLICATION_PROCHE = "TABLE_MULTIPLICATION_PROCHE"

# Patterns dont la reponse attendue est a - b : (nom variable a, nom variable b).
SUBTRACTION_OPERANDS = {
    "partie_tout_soustraction_non_narratif": ("tout", "partie_connue"),
    "probleme_reste_partie_tout": ("total", "partie_connue"),
    "probleme_comparaison_difference": ("grand", "petit"),
}

# Patterns dont la reponse attendue est a + b.
ADDITION_OPERANDS = {
    "partie_tout_addition_non_narratif": ("partie1", "partie2"),
    "probleme_total_partie_tout": ("partie1", "partie2"),
}

# Multiplications par 10 ou par un multiple de 10 : oubli du zero final.
ZERO_FINAL_PATTERNS = {
    "multiplication_par_10",
    "multiplication_chiffre_x_multiple_de_10",
}

# Multiplications decomposees : (facteur 1, facteur 2) pour les tables voisines.
TABLE_FACTOR_OPERANDS = {
    "multiplication_decomposee_chiffre_x_2chiffres": ("a", "bc"),
}

DISTRACTION_MAX_ECART = 2


def _to_int(value: object) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _operandes(variables: dict, names: tuple[str, str]) -> tuple[int, int] | None:
    a = _to_int(variables.get(names[0]))
    b = _to_int(variables.get(names[1]))
    if a is None or b is None:
        return None
    return a, b


def diagnostiquer_erreur(
    pattern_name: str,
    variables: dict | None,
    reponse_attendue: object,
    reponse_donnee: object,
) -> str | None:
    """Retourne le type d'erreur probable, ou None si aucune signature connue.

    Les signatures specifiques (inversion, zero oublie, table voisine...) sont
    testees avant la signature generique de distraction (+/- 1 ou 2).
    """
    attendu = _to_int(reponse_attendue)
    donnee = _to_int(reponse_donnee)
    if attendu is None or donnee is None or donnee == attendu:
        return None
    variables = variables or {}

    operandes = _operandes(variables, SUBTRACTION_OPERANDS.get(pattern_name, ("", "")))
    if operandes is not None:
        a, b = operandes
        if donnee == b - a:
            return INVERSION_OPERANDES
        if donnee == a + b:
            return OPERATION_INVERSEE

    operandes = _operandes(variables, ADDITION_OPERANDS.get(pattern_name, ("", "")))
    if operandes is not None:
        a, b = operandes
        if donnee == abs(a - b):
            return OPERATION_INVERSEE

    if pattern_name in ZERO_FINAL_PATTERNS and attendu % 10 == 0 and donnee == attendu // 10:
        return ZERO_OUBLIE

    operandes = _operandes(variables, TABLE_FACTOR_OPERANDS.get(pattern_name, ("", "")))
    if operandes is not None:
        a, b = operandes
        tables_voisines = {(a + 1) * b, (a - 1) * b, a * (b + 1), a * (b - 1)}
        if donnee in tables_voisines:
            return TABLE_MULTIPLICATION_PROCHE

    if abs(donnee - attendu) <= DISTRACTION_MAX_ECART:
        return ERREUR_DISTRACTION

    return None
