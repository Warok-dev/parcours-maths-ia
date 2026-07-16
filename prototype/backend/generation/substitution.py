from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

CATALOG_PATH = Path(__file__).resolve().parents[3] / "pattern_catalog.json"
LEVEL_MAP = {"CE1": "N1", "CE2": "N2"}
ENONCE_TEMPLATES = {
    "multiplication_decomposee_chiffre_x_2chiffres": "Calcule : {a} x {bc} = ...",
    "addition_repetee_vers_multiplication": "Complète : {total} = {termes} ; {total} = ... x ...",
    "partie_tout_soustraction_non_narratif": "Complète : {tout} - {partie_connue} = ...",
    "partie_tout_addition_non_narratif": "Complète : {partie1} + {partie2} = ...",
    "moitie_via_2xn": "Calcule la moitié de {n}.",
    "addition_pas_a_pas_sans_retenue": "Calcule : {a} + {b} = ...",
    "multiplication_chiffre_x_multiple_de_10": "Calcule : {a} x {b0} = ...",
    "multiplication_par_10": "Complète : {a} x 10 = ...",
    "double_via_2xn": "Calcule le double de {n}.",
    "conversion_cm_mm_vers_mm": "Complète : {cm} cm {mm} mm = ... mm",
    "addition_2chiffres_sans_retenue": "Calcule : {ab} + {cd} = ...",
    "suite_multiples_de_10_a_completer": "Complète : {suite_affichee}",
    "identifier_multiple_de_10": "Complète : parmi {n1}, {n2}, {n3}, le multiple de 10 est ...",
    "facteur_manquant_table_de_2": "Complète : 2 x ... = {n}",
}


def _load_catalog() -> dict:
    with CATALOG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


CATALOG = _load_catalog()
PATTERN_DEFS = {
    item["pattern_name"]: item for item in CATALOG["pure_substitution_patterns"]
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_files(pattern_def: dict) -> list[str]:
    return [example["file"] for example in pattern_def.get("examples", [])]


def _exercise_signature(exercice: dict) -> str:
    signature = {
        "pattern_name": exercice["pattern"]["pattern_name"],
        "variables": exercice["variables"],
    }
    return json.dumps(signature, sort_keys=True, ensure_ascii=False)


def _build_presentations(steps: list[str]) -> dict:
    return {
        "1_guide": {
            "aide_affichee": True,
            "etapes_methode": steps,
        },
        "2_semi_guide": {
            "aide_affichee": False,
            "correction_apres_coup": True,
        },
        "3_autonome": {
            "aide_affichee": False,
            "correction_apres_coup": False,
        },
    }


def _build_exercise(
    *,
    niveau: str,
    pattern_name: str,
    enonce: str,
    variables: dict,
    valeur: object,
    format_reponse: str = "nombre_entier",
    equivalences: list[object] | None = None,
    steps: list[str],
) -> dict:
    pattern_def = PATTERN_DEFS[pattern_name]
    return {
        "id": f"{niveau}-{pattern_name}-{random.randint(1, 999999):06d}",
        "niveau_scolaire": niveau,
        "matiere": "mathematiques",
        "pattern": {
            "pattern_name": pattern_name,
            "pattern_family": pattern_def["pattern_family"],
            "generation_method": "substitution",
        },
        "variables": variables,
        "contexte_narratif": None,
        "enonce": enonce,
        "reponse_attendue": {
            "valeur": valeur,
            "format": format_reponse,
            "tolerance": {
                "ignorer_espaces": True,
                "equivalences_acceptees": [] if equivalences is None else equivalences,
            },
        },
        "presentations": _build_presentations(steps),
        "jeu": {"etape_id": None, "chemin_id": None},
        "metadata": {
            "source_pattern_occurrence_count": pattern_def["occurrence_count"],
            "fichiers_source": _source_files(pattern_def),
            "genere_le": _now_iso(),
            "verifie_manuellement": False,
        },
    }


def _pick_level(pattern_name: str) -> str:
    levels = PATTERN_DEFS[pattern_name]["levels"]
    if "N1" in levels and "N2" not in levels:
        return "CE1"
    if "N2" in levels and "N1" not in levels:
        return "CE2"
    return random.choice(["CE1", "CE2"])


def _rand_non_carry_addition(max_total: int = 99, min_a: int = 1) -> tuple[int, int]:
    while True:
        a = random.randint(min_a, max_total - 1)
        b = random.randint(1, max_total - a)
        if (a % 10) + (b % 10) < 10:
            return a, b


def _rand_non_borrow_subtraction(max_tout: int = 10, min_tout: int = 2) -> tuple[int, int]:
    while True:
        tout = random.randint(min_tout, max_tout)
        partie = random.randint(1, tout - 1)
        if (tout % 10) >= (partie % 10):
            return tout, partie


def generer_multiplication_decomposee_chiffre_x_2chiffres(niveau: str = "CE2") -> dict:
    while True:
        a = random.randint(2, 7)
        dizaines = random.randint(2, 6)
        unites = random.randint(1, 9)
        bc = dizaines * 10 + unites
        total = a * bc
        if total <= 300:
            break
    b0 = dizaines * 10
    p1 = a * b0
    p2 = a * unites
    return _build_exercise(
        niveau=niveau,
        pattern_name="multiplication_decomposee_chiffre_x_2chiffres",
        enonce=ENONCE_TEMPLATES["multiplication_decomposee_chiffre_x_2chiffres"].format(a=a, bc=bc),
        variables={
            "a": a,
            "bc": bc,
            "b": dizaines,
            "c": unites,
            "b0": b0,
            "p1": p1,
            "p2": p2,
            "total": total,
        },
        valeur=total,
        steps=[
            f"Décompose {bc} en {b0} + {unites}.",
            f"Calcule {a} x {b0} = {p1}.",
            f"Calcule {a} x {unites} = {p2}.",
            f"Additionne {p1} + {p2} = {total}.",
        ],
    )


def generer_addition_repetee_vers_multiplication(niveau: str = "CE2") -> dict:
    k = random.choice([2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 30])
    if k <= 6:
        n = random.randint(2, 7)
    elif k in {8, 10, 12}:
        n = random.randint(2, 7)
    else:
        n = random.randint(2, 4)
    total = n * k
    termes = " + ".join([str(k)] * n)
    return _build_exercise(
        niveau=niveau,
        pattern_name="addition_repetee_vers_multiplication",
        enonce=ENONCE_TEMPLATES["addition_repetee_vers_multiplication"].format(total=total, termes=termes),
        variables={"k": k, "n": n, "total": total, "termes": [k] * n},
        valeur=f"{total} = {n} x {k}",
        format_reponse="expression",
        equivalences=[f"{n} x {k}", f"{total}={n}x{k}"],
        steps=[
            f"Repère que {k} est répété {n} fois.",
            f"Addition répétée : {termes} = {total}.",
            f"Donc {total} = {n} x {k}.",
        ],
    )


def generer_partie_tout_soustraction_non_narratif(niveau: str = "CE1") -> dict:
    tout, partie_connue = _rand_non_borrow_subtraction(10, 3)
    partie_manquante = tout - partie_connue
    return _build_exercise(
        niveau=niveau,
        pattern_name="partie_tout_soustraction_non_narratif",
        enonce=ENONCE_TEMPLATES["partie_tout_soustraction_non_narratif"].format(
            tout=tout,
            partie_connue=partie_connue,
        ),
        variables={
            "tout": tout,
            "partie_connue": partie_connue,
            "partie_manquante": partie_manquante,
        },
        valeur=partie_manquante,
        steps=[
            f"Le tout est {tout}.",
            f"La partie connue est {partie_connue}.",
            f"Calcule toujours dans le sens tout - partie : {tout} - {partie_connue} = {partie_manquante}.",
        ],
    )


def generer_partie_tout_addition_non_narratif(niveau: str = "CE1") -> dict:
    partie1, partie2 = _rand_non_carry_addition(10, 1)
    tout = partie1 + partie2
    return _build_exercise(
        niveau=niveau,
        pattern_name="partie_tout_addition_non_narratif",
        enonce=ENONCE_TEMPLATES["partie_tout_addition_non_narratif"].format(
            partie1=partie1,
            partie2=partie2,
        ),
        variables={"partie1": partie1, "partie2": partie2, "tout": tout},
        valeur=tout,
        steps=[
            f"Repère les deux parties : {partie1} et {partie2}.",
            "Additionne les parties.",
            f"{partie1} + {partie2} = {tout}.",
        ],
    )


def generer_moitie_via_2xn(niveau: str = "CE2") -> dict:
    moitie = random.randint(3, 20)
    n = moitie * 2
    return _build_exercise(
        niveau=niveau,
        pattern_name="moitie_via_2xn",
        enonce=ENONCE_TEMPLATES["moitie_via_2xn"].format(n=n),
        variables={"n": n, "moitie": moitie},
        valeur=moitie,
        steps=[
            f"Écris {n} = 2 x {moitie}.",
            f"La moitié de {n} est {moitie}.",
        ],
    )


def generer_addition_pas_a_pas_sans_retenue(niveau: str = "CE1") -> dict:
    if random.random() < 0.5:
        a = random.randint(2, 8)
        b = random.randint(1, 9 - a)
    else:
        dizaines = random.randint(2, 8)
        unite_a = random.randint(0, 7)
        a = dizaines * 10 + unite_a
        b = random.randint(1, 9 - unite_a)
    c = a + b
    return _build_exercise(
        niveau=niveau,
        pattern_name="addition_pas_a_pas_sans_retenue",
        enonce=ENONCE_TEMPLATES["addition_pas_a_pas_sans_retenue"].format(a=a, b=b),
        variables={"a": a, "b": b, "c": c},
        valeur=c,
        steps=[
            f"Pars de {a}.",
            f"Ajoute {b} sans dépasser 9 dans les unités.",
            f"{a} + {b} = {c}.",
        ],
    )


def generer_multiplication_chiffre_x_multiple_de_10(niveau: str = "CE2") -> dict:
    a = random.randint(2, 9)
    b = random.randint(2, 9)
    b0 = b * 10
    total = a * b0
    return _build_exercise(
        niveau=niveau,
        pattern_name="multiplication_chiffre_x_multiple_de_10",
        enonce=ENONCE_TEMPLATES["multiplication_chiffre_x_multiple_de_10"].format(a=a, b0=b0),
        variables={"a": a, "b": b, "b0": b0, "total": total},
        valeur=total,
        steps=[
            f"Calcule d'abord {a} x {b} = {a * b}.",
            "Ajoute ensuite un zéro à droite.",
            f"{a} x {b0} = {total}.",
        ],
    )


def generer_multiplication_par_10(niveau: str = "CE2") -> dict:
    a = random.randint(10, 89)
    total = a * 10
    return _build_exercise(
        niveau=niveau,
        pattern_name="multiplication_par_10",
        enonce=ENONCE_TEMPLATES["multiplication_par_10"].format(a=a),
        variables={"a": a, "total": total},
        valeur=total,
        steps=[
            f"Pars de {a}.",
            "Ajoute un zéro à droite.",
            f"{a} x 10 = {total}.",
        ],
    )


def generer_double_via_2xn(niveau: str = "CE2") -> dict:
    n = random.randint(4, 40)
    double = 2 * n
    return _build_exercise(
        niveau=niveau,
        pattern_name="double_via_2xn",
        enonce=ENONCE_TEMPLATES["double_via_2xn"].format(n=n),
        variables={"n": n, "double": double},
        valeur=double,
        steps=[
            f"Le double, c'est {n} + {n}.",
            f"On peut aussi écrire 2 x {n}.",
            f"Le double de {n} est {double}.",
        ],
    )


def generer_conversion_cm_mm_vers_mm(niveau: str = "CE2") -> dict:
    cm = random.randint(1, 12)
    mm = random.randint(0, 9)
    total_mm = cm * 10 + mm
    return _build_exercise(
        niveau=niveau,
        pattern_name="conversion_cm_mm_vers_mm",
        enonce=ENONCE_TEMPLATES["conversion_cm_mm_vers_mm"].format(cm=cm, mm=mm),
        variables={"cm": cm, "mm": mm, "total_mm": total_mm},
        valeur=total_mm,
        steps=[
            f"Convertis {cm} cm en {cm * 10} mm.",
            f"Ajoute les {mm} mm restants.",
            f"{cm} cm {mm} mm = {total_mm} mm.",
        ],
    )


def generer_addition_2chiffres_sans_retenue(niveau: str = "CE2") -> dict:
    while True:
        ab = random.randint(20, 89)
        cd = random.randint(10, 49)
        tens_total = (ab // 10) + (cd // 10)
        units_total = (ab % 10) + (cd % 10)
        if units_total < 10 and tens_total < 10:
            break
    sum_tens = (ab // 10 + cd // 10) * 10 + (ab % 10)
    sum_units = cd % 10
    total = ab + cd
    return _build_exercise(
        niveau=niveau,
        pattern_name="addition_2chiffres_sans_retenue",
        enonce=ENONCE_TEMPLATES["addition_2chiffres_sans_retenue"].format(ab=ab, cd=cd),
        variables={
            "ab": ab,
            "cd": cd,
            "sum_tens": sum_tens,
            "sum_units": sum_units,
            "total": total,
        },
        valeur=total,
        steps=[
            f"Ajoute d'abord les dizaines de {cd} à {ab} : {sum_tens}.",
            f"Ajoute ensuite les unités restantes : + {sum_units}.",
            f"{sum_tens} + {sum_units} = {total}.",
        ],
    )


def generer_suite_multiples_de_10_a_completer(niveau: str) -> dict:
    valid_options: list[tuple[int, int]] = []
    for length in [6, 7, 8]:
        for start in [0, 10, 20, 30, 40, 50]:
            end = start + (length - 1) * 10
            if end <= 100:
                valid_options.append((start, length))
    start, length = random.choice(valid_options)
    values = [start + i * 10 for i in range(length)]
    blank_count = 2 if length <= 7 else 3
    masked_indexes = sorted(random.sample(range(1, length - 1), k=blank_count))
    tokens: list[str] = []
    for idx, value in enumerate(values):
        if idx in masked_indexes:
            tokens.append("...")
        else:
            tokens.append(str(value))
    suite_affichee = ", ".join(tokens)
    end = values[-1]
    return _build_exercise(
        niveau=niveau,
        pattern_name="suite_multiples_de_10_a_completer",
        enonce=ENONCE_TEMPLATES["suite_multiples_de_10_a_completer"].format(suite_affichee=suite_affichee),
        variables={
            "start": start,
            "start_plus_10": start + 10,
            "start_plus_20": start + 20,
            "end": end,
            "suite_complete": values,
            "positions_manquantes": masked_indexes,
        },
        valeur=values,
        format_reponse="liste_ordonnee",
        equivalences=[", ".join(map(str, values))],
        steps=[
            "La suite augmente de 10 en 10.",
            f"En repartant de {start}, on obtient : {', '.join(map(str, values))}.",
        ],
    )


def generer_identifier_multiple_de_10(niveau: str = "CE2") -> dict:
    base = random.randint(1, 9)
    correct = base * 10
    d1 = int(f"{base}{random.randint(1, 9)}")
    d2 = int(f"{random.randint(1, 9)}{base}")
    while d2 == d1:
        d2 = int(f"{random.randint(1, 9)}{base}")
    options = [correct, d1, d2]
    random.shuffle(options)
    return _build_exercise(
        niveau=niveau,
        pattern_name="identifier_multiple_de_10",
        enonce=ENONCE_TEMPLATES["identifier_multiple_de_10"].format(
            n1=options[0],
            n2=options[1],
            n3=options[2],
        ),
        variables={"n1": options[0], "n2": options[1], "n3": options[2], "options": options},
        valeur=correct,
        format_reponse="choix_multiple",
        equivalences=[str(correct)],
        steps=[
            "Observe le chiffre des unités.",
            "Un multiple de 10 se termine par 0.",
            f"Ici, le bon choix est {correct}.",
        ],
    )


def generer_facteur_manquant_table_de_2(niveau: str = "CE2") -> dict:
    x = random.randint(3, 20)
    n = 2 * x
    return _build_exercise(
        niveau=niveau,
        pattern_name="facteur_manquant_table_de_2",
        enonce=ENONCE_TEMPLATES["facteur_manquant_table_de_2"].format(n=n),
        variables={"x": x, "n": n},
        valeur=x,
        steps=[
            f"Cherche le nombre qui double pour faire {n}.",
            f"Comme {n} = 2 x {x}, le facteur manquant est {x}.",
        ],
    )


GENERATOR_REGISTRY: dict[str, Callable[[str], dict]] = {
    "multiplication_decomposee_chiffre_x_2chiffres": generer_multiplication_decomposee_chiffre_x_2chiffres,
    "addition_repetee_vers_multiplication": generer_addition_repetee_vers_multiplication,
    "partie_tout_soustraction_non_narratif": generer_partie_tout_soustraction_non_narratif,
    "partie_tout_addition_non_narratif": generer_partie_tout_addition_non_narratif,
    "moitie_via_2xn": generer_moitie_via_2xn,
    "addition_pas_a_pas_sans_retenue": generer_addition_pas_a_pas_sans_retenue,
    "multiplication_chiffre_x_multiple_de_10": generer_multiplication_chiffre_x_multiple_de_10,
    "multiplication_par_10": generer_multiplication_par_10,
    "double_via_2xn": generer_double_via_2xn,
    "conversion_cm_mm_vers_mm": generer_conversion_cm_mm_vers_mm,
    "addition_2chiffres_sans_retenue": generer_addition_2chiffres_sans_retenue,
    "suite_multiples_de_10_a_completer": generer_suite_multiples_de_10_a_completer,
    "identifier_multiple_de_10": generer_identifier_multiple_de_10,
    "facteur_manquant_table_de_2": generer_facteur_manquant_table_de_2,
}


def patterns_disponibles_pour_niveau(niveau: str) -> list[str]:
    level_code = LEVEL_MAP[niveau]
    return [
        pattern_name
        for pattern_name, definition in PATTERN_DEFS.items()
        if level_code in definition["levels"]
    ]


def generer_exercice(pattern_name: str, niveau: str | None = None) -> dict:
    if pattern_name not in GENERATOR_REGISTRY:
        raise ValueError(f"Pattern inconnu: {pattern_name}")

    actual_niveau = niveau or _pick_level(pattern_name)
    if actual_niveau not in LEVEL_MAP:
        raise ValueError("Niveau invalide. Utiliser CE1 ou CE2.")

    if LEVEL_MAP[actual_niveau] not in PATTERN_DEFS[pattern_name]["levels"]:
        raise ValueError(f"Le pattern {pattern_name} n'est pas disponible pour {actual_niveau}.")

    return GENERATOR_REGISTRY[pattern_name](actual_niveau)


def _generer_exercice_unique(
    pattern_name: str,
    niveau: str,
    seen_signatures: set[str],
    max_attempts: int = 200,
) -> dict:
    for _ in range(max_attempts):
        candidat = generer_exercice(pattern_name, niveau)
        signature = _exercise_signature(candidat)
        if signature not in seen_signatures:
            seen_signatures.add(signature)
            return candidat
    raise RuntimeError(
        f"Espace de génération trop petit pour éviter les doublons du pattern {pattern_name}."
    )


def generer_lot(niveau: str, n: int) -> list[dict]:
    if n <= 0:
        return []

    patterns = patterns_disponibles_pour_niveau(niveau)
    weights = [PATTERN_DEFS[name]["occurrence_count"] for name in patterns]
    selected = random.choices(patterns, weights=weights, k=n)
    lot: list[dict] = []
    seen_signatures: set[str] = set()

    for pattern_name in selected:
        lot.append(_generer_exercice_unique(pattern_name, niveau, seen_signatures))

    return lot


def generate_substitution_exercise(niveau: str) -> dict:
    return generer_lot(niveau, 1)[0]
