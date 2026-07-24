from __future__ import annotations

import json
import random
from collections import defaultdict, deque
from datetime import datetime, timezone
from math import gcd
from pathlib import Path
from typing import Callable

CATALOG_PATH = Path(__file__).resolve().parents[3] / "pattern_catalog.json"
LEVEL_MAP = {"CE1": "N1", "CE2": "N2", "CE3": "N3", "CE4": "N4", "CE5": "N5", "CE6": "N6"}
CODE_TO_LEVEL = {code: niveau for niveau, code in LEVEL_MAP.items()}
ENONCE_TEMPLATES = {
    "division_exacte_partage": "Calcule : {tout} ÷ {diviseur} = ...",
    "multiplication_posee_2chiffres": "Calcule : {f1} x {f2} = ...",
    "multiplication_groupes_egaux_modele": "Un modèle montre {n} groupes de {k}. Écris la multiplication et son résultat : {total} = ... x ...",
    "conversion_kg_g": "Complète : {kg} kg = ... g",
    "addition_durees_min": "Calcule : {a} min + {b} min = ... min",
    "lecture_heure_analogique": "Quelle heure indique l'horloge ?",
    "completer_ligne_graduee": "Complète la ligne graduée : {suite_affichee}",
    "completer_tableau_proportionnalite": "Complète le tableau de proportionnalité : trouve le nombre qui manque.",
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
    # Un pattern peut viser un ou plusieurs niveaux (ex. les suites, N1+N2) :
    # on tire au hasard parmi les niveaux scolaires reconnus qu'il couvre.
    levels = PATTERN_DEFS[pattern_name]["levels"]
    candidates = [CODE_TO_LEVEL[code] for code in levels if code in CODE_TO_LEVEL]
    return random.choice(candidates) if candidates else "CE1"


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
        equivalences=[
            f"{n} x {k}",
            f"{total}={n}x{k}",
            # La multiplication est commutative : l'ordre inverse est accepte.
            f"{k} x {n}",
            f"{total} = {k} x {n}",
            f"{total}={k}x{n}",
        ],
        steps=[
            f"Repère que {k} est répété {n} fois.",
            f"Addition répétée : {termes} = {total}.",
            f"Donc {total} = {n} x {k}.",
        ],
    )


def generer_partie_tout_soustraction_non_narratif(niveau: str = "CE1") -> dict:
    # Part-whole dans les 10 : le corpus (N1) est domine par les complements a
    # 10 (10 - 4 = 6, 10 - 7 = 3, 10 - 8 = 2). Toutes ces soustractions tiennent
    # sur une colonne, donc aucune retenue n'entre en jeu : imposer une regle
    # "sans retenue" sur les unites excluait a tort le tout = 10, pourtant le
    # cas emblematique du niveau. On tire donc directement tout dans [3, 10].
    tout = random.randint(3, 10)
    partie_connue = random.randint(1, tout - 1)
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
    # Part-whole dans les 10, complements a 10 inclus (4 + 6 = 10, 3 + 7 = 10) :
    # le tout peut valoir 10, que l'ancienne contrainte "sans retenue" sur les
    # unites excluait mecaniquement alors que c'est l'objectif du niveau.
    partie1 = random.randint(1, 9)
    partie2 = random.randint(1, 10 - partie1)
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


# ============================================================
#  PATTERNS CE3 (N3)
#  Verifie (cf. correctif N1/N2) : aucun de ces patterns n'emploie de
#  contrainte "sans retenue" bornee a un nombre rond -> le bug des
#  complements a 10 ne peut pas s'y reproduire (division toujours exacte,
#  multiplication avec retenues assumees, conversion et duree sans modulo
#  d'exclusion).
# ============================================================
def generer_division_exacte_partage(niveau: str = "CE3") -> dict:
    diviseur = random.randint(2, 9)
    # Quotient borne pour garder le tout <= 100 (plage du corpus N3).
    quotient = random.randint(2, max(2, min(12, 100 // diviseur)))
    tout = diviseur * quotient
    return _build_exercise(
        niveau=niveau,
        pattern_name="division_exacte_partage",
        enonce=ENONCE_TEMPLATES["division_exacte_partage"].format(tout=tout, diviseur=diviseur),
        variables={"tout": tout, "diviseur": diviseur, "quotient": quotient},
        valeur=quotient,
        steps=[
            f"On partage {tout} en parts égales de {diviseur}.",
            f"Cherche combien de fois {diviseur} tient dans {tout}.",
            f"{tout} ÷ {diviseur} = {quotient}.",
        ],
    )


def generer_multiplication_posee_2chiffres(niveau: str = "CE3") -> dict:
    f1 = random.randint(21, 149)  # 2 a 3 chiffres
    f2 = random.randint(12, 32)  # 2 chiffres
    produit = f1 * f2
    dizaines = (f2 // 10) * 10
    unites = f2 % 10
    p_unites = f1 * unites
    p_dizaines = f1 * dizaines
    return _build_exercise(
        niveau=niveau,
        pattern_name="multiplication_posee_2chiffres",
        enonce=ENONCE_TEMPLATES["multiplication_posee_2chiffres"].format(f1=f1, f2=f2),
        variables={
            "f1": f1,
            "f2": f2,
            "dizaines": dizaines,
            "unites": unites,
            "p_unites": p_unites,
            "p_dizaines": p_dizaines,
            "produit": produit,
        },
        valeur=produit,
        steps=[
            f"Décompose {f2} en {dizaines} + {unites}.",
            f"Calcule {f1} x {unites} = {p_unites}.",
            f"Calcule {f1} x {dizaines} = {p_dizaines}.",
            f"Additionne {p_unites} + {p_dizaines} = {produit}.",
        ],
    )


def generer_multiplication_groupes_egaux_modele(niveau: str = "CE3") -> dict:
    n = random.randint(3, 8)
    k = random.choice([12, 15, 20, 24, 25, 30, 32])
    total = n * k
    return _build_exercise(
        niveau=niveau,
        pattern_name="multiplication_groupes_egaux_modele",
        enonce=ENONCE_TEMPLATES["multiplication_groupes_egaux_modele"].format(n=n, k=k, total=total),
        variables={"n": n, "k": k, "total": total},
        valeur=f"{total} = {n} x {k}",
        format_reponse="expression",
        equivalences=[
            f"{n} x {k}",
            f"{k} x {n}",
            f"{total}={n}x{k}",
            # Groupes egaux : la multiplication est commutative.
            f"{total} = {k} x {n}",
            f"{total}={k}x{n}",
        ],
        steps=[
            f"Le modèle montre {n} groupes de {k}.",
            f"Groupes égaux : {n} x {k}.",
            f"{n} x {k} = {total}.",
        ],
    )


def generer_conversion_kg_g(niveau: str = "CE3") -> dict:
    kg = random.randint(1, 9)
    grammes = kg * 1000
    return _build_exercise(
        niveau=niveau,
        pattern_name="conversion_kg_g",
        enonce=ENONCE_TEMPLATES["conversion_kg_g"].format(kg=kg),
        variables={"kg": kg, "grammes": grammes},
        valeur=grammes,
        steps=[
            "Rappelle-toi : 1 kg = 1000 g.",
            f"Donc {kg} kg = {kg} x 1000.",
            f"{kg} kg = {grammes} g.",
        ],
    )


def generer_addition_durees_min(niveau: str = "CE3") -> dict:
    # Sommes de durees qui restent sous l'heure ; a et b multiples de 5.
    a = random.choice([5, 10, 15, 20, 25, 30, 35, 40])
    b = random.choice([5, 10, 15, 20, 25])
    while a + b > 55:
        a = random.choice([5, 10, 15, 20, 25, 30, 35, 40])
        b = random.choice([5, 10, 15, 20, 25])
    total = a + b
    return _build_exercise(
        niveau=niveau,
        pattern_name="addition_durees_min",
        enonce=ENONCE_TEMPLATES["addition_durees_min"].format(a=a, b=b),
        variables={"a": a, "b": b, "total": total},
        valeur=total,
        steps=[
            f"Ajoute les minutes : {a} + {b}.",
            f"{a} min + {b} min = {total} min.",
        ],
    )


# ============================================================
#  LECTURE DE L'HEURE (horloge analogique) — visuel generable
#  Pattern CE1 (heures pleines et demi-heures) et CE3 (pas de 5 min).
#  La reponse est l'heure au format digital H:MM ; le frontend rend
#  l'horloge en SVG (ASSETS.clock) et propose deux molettes heure/minute.
# ============================================================
def _texte_heure(heure: int, minute: int) -> str:
    unite = "heure" if heure == 1 else "heures"
    if minute == 0:
        return f"{heure} {unite}"
    if minute == 30:
        return f"{heure} {unite} et demie"
    return f"{heure} {unite} {minute}"


def generer_lecture_heure_analogique(niveau: str = "CE1") -> dict:
    heure = random.randint(1, 12)
    # CE1 : heures pleines et demi-heures ; CE3 (et +) : pas de 5 minutes.
    if niveau == "CE1":
        minute = random.choice([0, 30])
    else:
        minute = random.choice([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    valeur = f"{heure}:{minute:02d}"
    return _build_exercise(
        niveau=niveau,
        pattern_name="lecture_heure_analogique",
        enonce=ENONCE_TEMPLATES["lecture_heure_analogique"],
        variables={"heure": heure, "minute": minute},
        valeur=valeur,
        format_reponse="heure",
        equivalences=[f"{heure}h{minute:02d}", f"{heure} h {minute:02d}"],
        steps=[
            "Regarde la petite aiguille : elle indique l'heure.",
            "Regarde la grande aiguille : elle indique les minutes.",
            f"Il est {_texte_heure(heure, minute)}, donc {valeur}.",
        ],
    )


# ============================================================
#  LIGNE GRADUEE A COMPLETER (visuel generable) — CE1
#  Reutilise TELLE QUELLE la mecanique "ligne" des suites a trous
#  (format liste_ordonnee + positions_manquantes) : aucun rendu neuf.
#  Distinct de suite_multiples_de_10 : le pas varie (2, 5 ou 10), comme
#  dans le corpus N1 ("نضيف 5/2/10 كل مرة").
# ============================================================
def generer_completer_ligne_graduee(niveau: str = "CE1") -> dict:
    pas = random.choice([2, 5, 10])
    length = random.choice([6, 7, 8])
    span = (length - 1) * pas
    # Depart multiple du pas, la ligne restant sous 90 (nombres CE1).
    max_start_mult = max(0, (90 - span) // pas)
    start = random.randint(0, max_start_mult) * pas
    values = [start + i * pas for i in range(length)]
    blank_count = 2 if length <= 7 else 3
    masked = sorted(random.sample(range(1, length - 1), blank_count))
    tokens = ["..." if i in masked else str(v) for i, v in enumerate(values)]
    suite_affichee = ", ".join(tokens)
    return _build_exercise(
        niveau=niveau,
        pattern_name="completer_ligne_graduee",
        enonce=ENONCE_TEMPLATES["completer_ligne_graduee"].format(suite_affichee=suite_affichee),
        variables={
            "start": start,
            "pas": pas,
            "suite_complete": values,
            "positions_manquantes": masked,
        },
        valeur=values,
        format_reponse="liste_ordonnee",
        equivalences=[", ".join(map(str, values))],
        steps=[
            f"La ligne graduée avance de {pas} en {pas}.",
            f"En repartant de {start}, on obtient : {', '.join(map(str, values))}.",
        ],
    )


# ============================================================
#  TABLEAU DE PROPORTIONNALITE A COMPLETER (visuel generable) — CE4/CE5/CE6
#  Deux lignes (grandeur du haut / grandeur du bas) liees par un coefficient
#  constant k (ligne bas = k x ligne haut). Une seule case est masquee : la
#  reponse est UN entier, ce qui reutilise les mecaniques existantes
#  (cadenas / ligne). Le tableau lui-meme est rendu comme visuel dans l'enonce.
# ============================================================
PROP_CONTEXTS = [
    ("Stylos", "Prix (dh)"),
    ("Cahiers", "Prix (dh)"),
    ("Tours", "Distance (km)"),
    ("Sachets", "Bonbons"),
    ("Boîtes", "Œufs"),
    ("Paquets", "Gâteaux"),
]


def generer_completer_tableau_proportionnalite(niveau: str = "CE6") -> dict:
    label1, label2 = random.choice(PROP_CONTEXTS)
    coefficient = random.randint(2, 10)
    n_colonnes = random.choice([3, 4])
    # Valeurs distinctes et croissantes en ligne du haut ; produits <= ~120.
    haut = sorted(random.sample(range(1, 13), n_colonnes))
    bas = [coefficient * x for x in haut]
    # La case masquee est dans la DERNIERE colonne (les precedentes restent
    # completes pour que l'eleve puisse retrouver le coefficient).
    colonne = n_colonnes - 1
    ligne_manquante = random.choice([1, 2])
    valeur = bas[colonne] if ligne_manquante == 2 else haut[colonne]
    haut_affichee = [str(x) for x in haut]
    bas_affichee = [str(y) for y in bas]
    if ligne_manquante == 2:
        bas_affichee[colonne] = "?"
    else:
        haut_affichee[colonne] = "?"
    if ligne_manquante == 2:
        etape = f"Applique-le à la case vide : {haut[colonne]} × {coefficient} = {valeur}."
    else:
        etape = f"Remonte en divisant : {bas[colonne]} ÷ {coefficient} = {valeur}."
    return _build_exercise(
        niveau=niveau,
        pattern_name="completer_tableau_proportionnalite",
        enonce=ENONCE_TEMPLATES["completer_tableau_proportionnalite"],
        variables={
            "label1": label1,
            "label2": label2,
            "coefficient": coefficient,
            "haut": haut,
            "bas": bas,
            "haut_affichee": haut_affichee,
            "bas_affichee": bas_affichee,
            "colonne_manquante": colonne,
            "ligne_manquante": ligne_manquante,
        },
        valeur=valeur,
        steps=[
            f"Trouve le coefficient : chaque nombre du bas = nombre du haut × {coefficient}.",
            etape,
        ],
    )


# ============================================================
#  FIGURE COTEE SIMPLE (visuel generable) — CE4/CE5
#  Formes basiques uniquement (rectangle, carre, triangle, polygone
#  regulier) COTEES : les dimensions sont donnees en parametres et
#  affichees sur la figure SVG. Question de perimetre ou d'aire ;
#  reponse = UN entier (mecanique standard). PAS de cercle/compas.
# ============================================================
_POLY_NOMS = {5: "pentagone", 6: "hexagone"}


def generer_figure_cotee_simple(niveau: str = "CE4") -> dict:
    unite = "cm"
    # Pool adapte au niveau : CE4 rectangle/carre ; CE5 triangle/polygone/aire.
    if niveau == "CE5":
        forme, question = random.choice(
            [
                ("triangle", "perimetre"),
                ("polygone_regulier", "perimetre"),
                ("rectangle", "aire"),
                ("carre", "aire"),
            ]
        )
    else:
        forme, question = random.choice(
            [
                ("rectangle", "perimetre"),
                ("rectangle", "aire"),
                ("carre", "perimetre"),
                ("carre", "aire"),
            ]
        )

    variables: dict = {"forme": forme, "question": question, "unite": unite}

    if forme == "rectangle":
        largeur = random.randint(3, 12)
        hauteur = random.randint(2, 12)
        if hauteur == largeur:  # rester visuellement un rectangle, pas un carre
            hauteur = hauteur - 1 if hauteur > 2 else hauteur + 1
        variables.update({"largeur": largeur, "hauteur": hauteur})
        if question == "perimetre":
            valeur = 2 * (largeur + hauteur)
            enonce = "Calcule le périmètre de ce rectangle."
            steps = [
                "Le périmètre = 2 × (longueur + largeur).",
                f"2 × ({largeur} + {hauteur}) = {valeur} {unite}.",
            ]
        else:
            valeur = largeur * hauteur
            enonce = "Calcule l'aire de ce rectangle."
            steps = ["L'aire = longueur × largeur.", f"{largeur} × {hauteur} = {valeur} {unite}²."]
    elif forme == "carre":
        cote = random.randint(3, 12)
        variables["cote"] = cote
        if question == "perimetre":
            valeur = 4 * cote
            enonce = "Calcule le périmètre de ce carré."
            steps = ["Le périmètre d'un carré = 4 × côté.", f"4 × {cote} = {valeur} {unite}."]
        else:
            valeur = cote * cote
            enonce = "Calcule l'aire de ce carré."
            steps = ["L'aire d'un carré = côté × côté.", f"{cote} × {cote} = {valeur} {unite}²."]
    elif forme == "triangle":
        cotes = [random.randint(3, 12) for _ in range(3)]
        variables["cotes"] = cotes
        valeur = sum(cotes)
        enonce = "Calcule le périmètre de ce triangle."
        steps = [
            "Le périmètre = somme des trois côtés.",
            f"{cotes[0]} + {cotes[1]} + {cotes[2]} = {valeur} {unite}.",
        ]
    else:  # polygone_regulier
        n_cotes = random.choice([5, 6])
        cote = random.randint(3, 14)
        variables.update({"n_cotes": n_cotes, "cote": cote})
        valeur = n_cotes * cote
        nom = _POLY_NOMS[n_cotes]
        enonce = f"Calcule le périmètre de ce {nom} régulier."
        steps = [
            f"Un {nom} régulier a {n_cotes} côtés égaux : périmètre = {n_cotes} × côté.",
            f"{n_cotes} × {cote} = {valeur} {unite}.",
        ]

    return _build_exercise(
        niveau=niveau,
        pattern_name="figure_cotee_simple",
        enonce=enonce,
        variables=variables,
        valeur=valeur,
        steps=steps,
    )


# ============================================================
#  ECHELLE / PLAN (calcul d'echelle pur) — CE6
#  Le corpus (N6) presente l'echelle comme une regle de trois : 1 cm sur le
#  plan represente k m en realite ; une longueur de d cm sur le plan vaut
#  d x k m en vrai. La carte n'est qu'un contexte : AUCUN visuel requis, c'est
#  un pattern TEXTE. (1 cm : 10000 cm du corpus = 1 cm : 100 m.)
# ============================================================
# (article indefini pour l'introduction, forme contractee avec "de" pour la
#  question : "du chemin", "de la route", "de l'avenue"...).
_ECHELLE_OBJETS = [
    ("une route", "de la route"),
    ("un chemin", "du chemin"),
    ("une rivière", "de la rivière"),
    ("une avenue", "de l'avenue"),
    ("une piste", "de la piste"),
]


def generer_echelle_plan(niveau: str = "CE6") -> dict:
    echelle = random.choice([2, 5, 10, 20, 25, 50, 100])  # 1 cm -> echelle m
    d_max = min(12, 999 // echelle)
    plan_cm = random.randint(2, max(2, d_max))
    reel_m = plan_cm * echelle
    objet_indef, objet_de = random.choice(_ECHELLE_OBJETS)
    enonce = (
        f"Sur un plan, 1 cm représente {echelle} m en réalité. "
        f"Sur ce plan, {objet_indef} mesure {plan_cm} cm. "
        f"Quelle est la longueur réelle {objet_de} en mètres ?"
    )
    return _build_exercise(
        niveau=niveau,
        pattern_name="echelle_plan",
        enonce=enonce,
        variables={"echelle": echelle, "plan_cm": plan_cm, "reel_m": reel_m, "objet": objet_de},
        valeur=reel_m,
        steps=[
            f"1 cm sur le plan = {echelle} m en réalité.",
            f"Pour {plan_cm} cm : {plan_cm} × {echelle} = {reel_m} m.",
        ],
    )


# ============================================================
#  NOMBRES DECIMAUX (coeur de CE4 / N4) — patterns TEXTE
#  Comparaison (< > =), addition et soustraction posees. Les valeurs sont
#  manipulees en CENTIEMES (entiers) pour eviter toute erreur de virgule
#  flottante ; l'affichage repasse en decimal francais (virgule).
# ============================================================
def _fmt_dec(cents: int) -> str:
    """Formate un nombre de centiemes en decimal francais (virgule)."""
    entier, frac = divmod(abs(cents), 100)
    if frac == 0:
        return str(entier)
    if frac % 10 == 0:
        return f"{entier},{frac // 10}"
    return f"{entier},{frac:02d}"


def generer_comparaison_decimaux(niveau: str = "CE4") -> dict:
    a = random.randint(100, 9999)  # centiemes -> 1,00 a 99,99
    tirage = random.random()
    if tirage < 0.15:
        b = a  # cas d'egalite
    elif tirage < 0.6:
        # Meme partie entiere, decimales differentes (piege classique).
        entier = a // 100
        b = entier * 100 + random.randint(0, 99)
        if b == a:
            b = a + 1 if a % 100 < 99 else a - 1
    else:
        b = random.randint(100, 9999)
    sa, sb = _fmt_dec(a), _fmt_dec(b)
    relation = "<" if a < b else (">" if a > b else "=")
    return _build_exercise(
        niveau=niveau,
        pattern_name="comparaison_decimaux",
        enonce=f"Compare ces deux nombres : {sa} ... {sb}",
        variables={"a": sa, "b": sb, "a_cent": a, "b_cent": b, "options": ["<", ">", "="]},
        valeur=relation,
        format_reponse="choix_multiple",
        equivalences=[relation],
        steps=[
            "Compare d'abord la partie entière (avant la virgule).",
            "Si elle est égale, compare les décimales, chiffre par chiffre.",
            f"{sa} {relation} {sb}.",
        ],
    )


def generer_addition_decimaux(niveau: str = "CE4") -> dict:
    a = random.randint(100, 8000)
    b = random.randint(100, 5000)
    total = a + b
    sa, sb, st = _fmt_dec(a), _fmt_dec(b), _fmt_dec(total)
    return _build_exercise(
        niveau=niveau,
        pattern_name="addition_decimaux",
        enonce=f"Calcule : {sa} + {sb} = ...",
        variables={"a": sa, "b": sb, "total": st},
        valeur=st,
        format_reponse="decimal",
        equivalences=[st.replace(",", ".")],
        steps=[
            "Aligne les virgules l'une sous l'autre.",
            f"{sa} + {sb} = {st}.",
        ],
    )


def generer_soustraction_decimaux(niveau: str = "CE4") -> dict:
    a = random.randint(2000, 9900)
    b = random.randint(100, a - 100)
    diff = a - b
    sa, sb, sd = _fmt_dec(a), _fmt_dec(b), _fmt_dec(diff)
    return _build_exercise(
        niveau=niveau,
        pattern_name="soustraction_decimaux",
        enonce=f"Calcule : {sa} - {sb} = ...",
        variables={"a": sa, "b": sb, "difference": sd},
        valeur=sd,
        format_reponse="decimal",
        equivalences=[sd.replace(",", ".")],
        steps=[
            "Aligne les virgules ; complète par des zéros si besoin.",
            f"{sa} - {sb} = {sd}.",
        ],
    )


# ============================================================
#  DUREES (CE5 / N5) — patterns TEXTE
#  Conversion h:min -> min et duree entre deux horaires (en minutes).
# ============================================================
def _fmt_horaire(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}"


def generer_conversion_duree_min(niveau: str = "CE5") -> dict:
    heures = random.randint(1, 12)
    minutes = random.randint(0, 59)
    total = heures * 60 + minutes
    return _build_exercise(
        niveau=niveau,
        pattern_name="conversion_duree_min",
        enonce=f"Convertis cette durée en minutes : {heures} h {minutes} min = ... min",
        variables={"heures": heures, "minutes": minutes, "total_min": total},
        valeur=total,
        steps=[
            f"1 h = 60 min, donc {heures} h = {heures * 60} min.",
            f"{heures * 60} + {minutes} = {total} min.",
        ],
    )


def generer_duree_entre_horaires(niveau: str = "CE5") -> dict:
    depart = random.randint(0, 21 * 60)
    duree = random.randint(20, 179)
    arrivee = depart + duree
    return _build_exercise(
        niveau=niveau,
        pattern_name="duree_entre_horaires",
        enonce=(
            f"Un trajet part à {_fmt_horaire(depart)} et arrive à {_fmt_horaire(arrivee)}. "
            "Combien de temps dure-t-il, en minutes ?"
        ),
        variables={"depart_min": depart, "arrivee_min": arrivee, "duree_min": duree},
        valeur=duree,
        steps=[
            f"De {_fmt_horaire(depart)} à {_fmt_horaire(arrivee)}.",
            f"La durée est {duree} minutes.",
        ],
    )


# ============================================================
#  POURCENTAGE (CE5 + CE6) et VITESSE MOYENNE (CE6) — patterns TEXTE
# ============================================================
_POURCENTAGE_CONTEXTES = [
    ("élèves", "sont des filles", "filles"),
    ("billes", "sont rouges", "billes rouges"),
    ("livres", "sont des BD", "BD"),
    ("bonbons", "sont au citron", "bonbons au citron"),
]


def generer_pourcentage_d_une_quantite(niveau: str = "CE6") -> dict:
    p = random.choice([5, 10, 20, 25, 40, 50, 60, 75])
    pas = 100 // gcd(p, 100)  # garantit un resultat entier
    total = pas * random.randint(2, 12)
    resultat = total * p // 100
    ensemble, predicat, categorie = random.choice(_POURCENTAGE_CONTEXTES)
    return _build_exercise(
        niveau=niveau,
        pattern_name="pourcentage_d_une_quantite",
        enonce=(
            f"Il y a {total} {ensemble}. {p} % {predicat}. "
            f"Combien de {categorie} y a-t-il ?"
        ),
        variables={"pourcentage": p, "total": total, "resultat": resultat},
        valeur=resultat,
        steps=[
            f"{p} % veut dire {p} sur 100.",
            f"{total} × {p} ÷ 100 = {resultat}.",
        ],
    )


def generer_vitesse_distance_duree(niveau: str = "CE6") -> dict:
    vitesse = random.choice([10, 20, 30, 40, 50, 60, 80, 100])
    duree = random.randint(2, 6)
    distance = vitesse * duree
    cible = random.choice(["distance", "vitesse", "duree"])
    if cible == "distance":
        enonce = (
            f"Une voiture roule à {vitesse} km/h pendant {duree} h. "
            "Quelle distance parcourt-elle, en km ?"
        )
        valeur = distance
        etape = f"{vitesse} × {duree} = {distance} km."
    elif cible == "vitesse":
        enonce = (
            f"Une voiture parcourt {distance} km en {duree} h. "
            "Quelle est sa vitesse moyenne, en km/h ?"
        )
        valeur = vitesse
        etape = f"{distance} ÷ {duree} = {vitesse} km/h."
    else:
        enonce = (
            f"Une voiture roule à {vitesse} km/h et parcourt {distance} km. "
            "Combien de temps met-elle, en heures ?"
        )
        valeur = duree
        etape = f"{distance} ÷ {vitesse} = {duree} h."
    return _build_exercise(
        niveau=niveau,
        pattern_name="vitesse_distance_duree",
        enonce=enonce,
        variables={"vitesse": vitesse, "duree": duree, "distance": distance, "cible": cible},
        valeur=valeur,
        steps=["Relation : distance = vitesse × durée.", etape],
    )


GENERATOR_REGISTRY: dict[str, Callable[[str], dict]] = {
    "lecture_heure_analogique": generer_lecture_heure_analogique,
    "completer_ligne_graduee": generer_completer_ligne_graduee,
    "completer_tableau_proportionnalite": generer_completer_tableau_proportionnalite,
    "figure_cotee_simple": generer_figure_cotee_simple,
    "echelle_plan": generer_echelle_plan,
    "comparaison_decimaux": generer_comparaison_decimaux,
    "addition_decimaux": generer_addition_decimaux,
    "soustraction_decimaux": generer_soustraction_decimaux,
    "conversion_duree_min": generer_conversion_duree_min,
    "duree_entre_horaires": generer_duree_entre_horaires,
    "pourcentage_d_une_quantite": generer_pourcentage_d_une_quantite,
    "vitesse_distance_duree": generer_vitesse_distance_duree,
    "division_exacte_partage": generer_division_exacte_partage,
    "multiplication_posee_2chiffres": generer_multiplication_posee_2chiffres,
    "multiplication_groupes_egaux_modele": generer_multiplication_groupes_egaux_modele,
    "conversion_kg_g": generer_conversion_kg_g,
    "addition_durees_min": generer_addition_durees_min,
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


# Les plages de certains patterns CE1 sont volontairement etroites (sommes
# sans retenue <= 10) : deux tirages proches dans le temps peuvent etre
# identiques. On memorise les dernieres variantes par pattern et on retente
# pour eviter les quasi-doublons consecutifs pendant le renforcement.
RECENT_VARIANTS_LIMIT = 4
RECENT_VARIANT_ATTEMPTS = 12
_RECENT_VARIANTS: dict[str, deque[str]] = defaultdict(
    lambda: deque(maxlen=RECENT_VARIANTS_LIMIT)
)


def generer_exercice(pattern_name: str, niveau: str | None = None) -> dict:
    if pattern_name not in GENERATOR_REGISTRY:
        raise ValueError(f"Pattern inconnu: {pattern_name}")

    actual_niveau = niveau or _pick_level(pattern_name)
    if actual_niveau not in LEVEL_MAP:
        raise ValueError("Niveau invalide. Utiliser CE1 ou CE2.")

    if LEVEL_MAP[actual_niveau] not in PATTERN_DEFS[pattern_name]["levels"]:
        raise ValueError(f"Le pattern {pattern_name} n'est pas disponible pour {actual_niveau}.")

    recent = _RECENT_VARIANTS[pattern_name]
    exercice = GENERATOR_REGISTRY[pattern_name](actual_niveau)
    for _ in range(RECENT_VARIANT_ATTEMPTS):
        if _exercise_signature(exercice) not in recent:
            break
        exercice = GENERATOR_REGISTRY[pattern_name](actual_niveau)
    recent.append(_exercise_signature(exercice))
    return exercice


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
