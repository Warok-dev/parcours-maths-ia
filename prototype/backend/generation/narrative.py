from __future__ import annotations

import json
import random
import re
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Callable

import google.generativeai as genai

from tutor import ensure_tutor_configured

CATALOG_PATH = Path(__file__).resolve().parents[3] / "pattern_catalog.json"
LEVEL_MAP = {"CE1": "N1", "CE2": "N2"}
MODEL_NAME = "gemini-3.5-flash"
MAX_OUTPUT_TOKENS = 4000
MAX_ATTEMPTS = 2
STRICT_KEYS = ("personnage", "objet", "action", "question")
NUMBER_RE = re.compile(r"\d")
CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
MAX_OBJECT_SHARE = 0.3
RECENT_CONTEXT_LIMIT = 4
PERSONNAGES = (
    "Yassine",
    "Yasmine",
    "Salma",
    "Karim",
    "Amina",
    "Aya",
    "Imane",
    "Samir",
    "Amine",
    "Nadia",
    "Sami",
    "Meryem",
    "Rania",
    "Zakaria",
    "Lina",
    "Hamza",
)
OBJECT_POOLS = {
    "small_count": (
        "billes",
        "crayons",
        "gommes",
        "cahiers",
        "pommes",
        "oranges",
        "dattes",
        "ballons",
        "jouets",
        "fleurs",
    ),
    "medium_count": (
        "billes",
        "autocollants",
        "cartes",
        "jetons",
        "points",
        "graines",
        "perles",
        "images",
        "tickets",
        "bonbons",
    ),
    "grouped_count": (
        "cartes",
        "autocollants",
        "jetons",
        "billes",
        "perles",
        "bonbons",
        "gobelets",
        "crayons",
        "gommes",
        "balles",
    ),
}
RECENT_CONTEXTS: dict[str, deque[dict[str, str]]] = defaultdict(
    lambda: deque(maxlen=RECENT_CONTEXT_LIMIT)
)


class NarrativeGenerationError(RuntimeError):
    """Raised when narrative generation cannot produce a reliable exercise."""


def _load_catalog() -> dict:
    with CATALOG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


CATALOG = _load_catalog()
PATTERN_DEFS = {
    item["pattern_name"]: item for item in CATALOG["llm_required_patterns"]
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_files(pattern_def: dict) -> list[str]:
    return [example["file"] for example in pattern_def.get("examples", [])]


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


def _pick_pattern_for_level(niveau: str) -> str:
    level_code = LEVEL_MAP[niveau]
    compatibles = [
        pattern_name
        for pattern_name, definition in PATTERN_DEFS.items()
        if level_code in definition["levels"]
    ]
    if not compatibles:
        raise NarrativeGenerationError(f"Aucun pattern narratif disponible pour {niveau}.")
    return random.choice(compatibles)


def _sentence(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return stripped
    if stripped[-1] not in ".!?":
        stripped += "."
    return stripped


def _build_examples_block(pattern_name: str) -> str:
    pattern_def = PATTERN_DEFS[pattern_name]
    lines = []
    for index, example in enumerate(pattern_def.get("examples", [])[:2], start=1):
        lines.append(f'Exemple {index} - question: "{example["question"]}"')
        lines.append(f'Exemple {index} - correction: "{example["correction"]}"')
    return "\n".join(lines)


def _strip_code_fences(text: str) -> str:
    return CODE_FENCE_RE.sub("", text.strip()).strip()


def _validate_llm_payload(payload: object) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise NarrativeGenerationError("La sortie LLM n'est pas un objet JSON.")

    if set(payload.keys()) != set(STRICT_KEYS):
        raise NarrativeGenerationError("La sortie LLM doit contenir exactement les 4 cles attendues.")

    cleaned: dict[str, str] = {}
    for key in STRICT_KEYS:
        value = payload.get(key)
        if not isinstance(value, str):
            raise NarrativeGenerationError(f"La valeur '{key}' doit etre une chaine.")
        stripped = value.strip()
        if not stripped:
            raise NarrativeGenerationError(f"La valeur '{key}' est vide.")
        if NUMBER_RE.search(stripped):
            raise NarrativeGenerationError(f"La valeur '{key}' contient un nombre.")
        cleaned[key] = stripped
    return cleaned


def _choose_object_pool(pattern_name: str, variables: dict) -> tuple[str, ...]:
    if pattern_name in {"probleme_reste_partie_tout", "probleme_total_partie_tout"}:
        return OBJECT_POOLS["small_count"]

    if pattern_name == "probleme_comparaison_difference":
        maximum = max(variables["grand"], variables["petit"])
        return OBJECT_POOLS["medium_count"] if maximum >= 25 else OBJECT_POOLS["small_count"]

    if pattern_name in {"probleme_groupes_egaux_total", "probleme_groupes_egaux_quotient"}:
        total = variables.get("total", variables.get("group_count", 0) * variables.get("group_size", 0))
        return OBJECT_POOLS["grouped_count"] if total >= 25 else OBJECT_POOLS["medium_count"]

    raise NarrativeGenerationError(f"Pool d'objets inconnu pour {pattern_name}.")


def _validate_allowed_values(
    contexte: dict[str, str],
    *,
    allowed_personnages: tuple[str, ...],
    allowed_objets: tuple[str, ...],
) -> dict[str, str]:
    if contexte["personnage"] not in allowed_personnages:
        raise NarrativeGenerationError("Le personnage choisi n'est pas dans la liste autorisee.")
    if contexte["objet"] not in allowed_objets:
        raise NarrativeGenerationError("L'objet choisi n'est pas dans la liste autorisee.")
    return contexte


def _recent_constraints(pattern_name: str) -> tuple[list[str], list[str]]:
    recent = list(RECENT_CONTEXTS[pattern_name])
    return (
        [item["personnage"] for item in recent],
        [item["objet"] for item in recent],
    )


def _remember_context(pattern_name: str, contexte: dict[str, str]) -> None:
    RECENT_CONTEXTS[pattern_name].append(
        {"personnage": contexte["personnage"], "objet": contexte["objet"]}
    )


def _object_share_by_pattern(exercises: list[dict]) -> dict[str, dict[str, float]]:
    by_pattern: dict[str, list[str]] = defaultdict(list)
    for exercice in exercises:
        pattern_name = exercice["pattern"]["pattern_name"]
        objet = exercice.get("contexte_narratif", {}).get("objet")
        if objet:
            by_pattern[pattern_name].append(objet)

    shares: dict[str, dict[str, float]] = {}
    for pattern_name, objets in by_pattern.items():
        total = len(objets)
        counts = Counter(objets)
        shares[pattern_name] = {objet: count / total for objet, count in counts.items()}
    return shares


def assert_narrative_diversity(exercises: list[dict], max_object_share: float = MAX_OBJECT_SHARE) -> None:
    shares = _object_share_by_pattern(exercises)
    for pattern_name, pattern_shares in shares.items():
        if not pattern_shares:
            continue
        objet, share = max(pattern_shares.items(), key=lambda item: item[1])
        if share > max_object_share:
            raise NarrativeGenerationError(
                f"Non-diversite detectee pour {pattern_name}: '{objet}' apparait dans {share:.0%} des exercices."
            )


def _parse_llm_json(text: str) -> dict[str, str]:
    try:
        payload = json.loads(_strip_code_fences(text))
    except json.JSONDecodeError as exc:
        raise NarrativeGenerationError("Le LLM n'a pas renvoye un JSON valide.") from exc
    return _validate_llm_payload(payload)


@lru_cache(maxsize=1)
def _build_model() -> genai.GenerativeModel:
    api_key = ensure_tutor_configured()
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(
        MODEL_NAME,
        system_instruction=(
            "Tu rediges uniquement l'habillage narratif d'un probleme de mathematiques CE1/CE2. "
            "Tu ne fais jamais le calcul, tu ne choisis jamais les nombres, tu n'ecris jamais de chiffres. "
            "Tu reponds uniquement en JSON strict sans markdown, avec exactement les cles "
            '"personnage", "objet", "action", "question". '
            "Ecris en francais simple, naturel, adapte a un enfant marocain."
        ),
    )


def _call_model_json(prompt: str) -> dict[str, str]:
    model = _build_model()
    response = model.generate_content(
        prompt,
        generation_config={
            "temperature": 0.2,
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "object",
                "required": list(STRICT_KEYS),
                "properties": {
                    "personnage": {"type": "string"},
                    "objet": {"type": "string"},
                    "action": {"type": "string"},
                    "question": {"type": "string"},
                },
            },
        },
    )
    text = getattr(response, "text", "") or ""
    return _parse_llm_json(text)


def _generate_narrative_context(prompt: str) -> dict[str, str]:
    last_error: Exception | None = None
    for _ in range(MAX_ATTEMPTS):
        try:
            return _call_model_json(prompt)
        except NarrativeGenerationError as exc:
            last_error = exc
    raise NarrativeGenerationError("Impossible d'obtenir un habillage narratif fiable.") from last_error


def _build_exercise(
    *,
    niveau: str,
    pattern_name: str,
    variables: dict,
    contexte_narratif: dict[str, str],
    enonce: str,
    valeur: object,
    steps: list[str],
) -> dict:
    pattern_def = PATTERN_DEFS[pattern_name]
    equivalences = [str(valeur)] if not isinstance(valeur, list) else [", ".join(map(str, valeur))]
    return {
        "id": f"{niveau}-{pattern_name}-{random.randint(1, 999999):06d}",
        "niveau_scolaire": niveau,
        "matiere": "mathematiques",
        "pattern": {
            "pattern_name": pattern_name,
            "pattern_family": pattern_def["pattern_family"],
            "generation_method": "llm",
        },
        "variables": variables,
        "contexte_narratif": contexte_narratif,
        "enonce": enonce,
        "reponse_attendue": {
            "valeur": valeur,
            "format": "nombre_entier",
            "tolerance": {
                "ignorer_espaces": True,
                "equivalences_acceptees": equivalences,
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


def _prompt_for_pattern(
    pattern_name: str,
    instruction: str,
    *,
    variables: dict,
    allowed_personnages: tuple[str, ...],
    allowed_objets: tuple[str, ...],
    recent_personnages: list[str],
    recent_objets: list[str],
) -> str:
    pattern_def = PATTERN_DEFS[pattern_name]
    recent_block = ""
    if recent_personnages or recent_objets:
        recent_block = (
            "Variantes recentes a eviter si possible:\n"
            f"- Personnages recents: {', '.join(recent_personnages) if recent_personnages else 'aucun'}\n"
            f"- Objets recents: {', '.join(recent_objets) if recent_objets else 'aucun'}\n"
        )
    return (
        f"Pattern cible: {pattern_name}\n"
        f"Template pedagogique: {pattern_def['template']}\n"
        f"Valeurs numeriques deja fixees par Python: {json.dumps(variables, ensure_ascii=False)}\n"
        "Exemples reels du corpus a imiter pour le registre et le niveau:\n"
        f"{_build_examples_block(pattern_name)}\n\n"
        "Banque de personnages autorises:\n"
        f"{', '.join(allowed_personnages)}\n"
        "Banque d'objets autorises pour cet ordre de grandeur:\n"
        f"{', '.join(allowed_objets)}\n"
        f"{recent_block}\n"
        "Ta mission:\n"
        f"{instruction}\n"
        "Regles absolues:\n"
        "- Choisis obligatoirement un personnage dans la banque autorisee.\n"
        "- Choisis obligatoirement un objet dans la banque autorisee.\n"
        "- Varie systematiquement le personnage et l'objet; evite de reprendre ceux utilises juste avant.\n"
        "- Tiens compte de l'ordre de grandeur des nombres deja fixes par Python pour choisir un objet plausible.\n"
        "- Pour les grandes quantites, privilegie des objets ou mesures que l'on compte facilement par dizaines comme billes, cartes, jetons, points, autocollants ou graines.\n"
        "- N'ecris aucun chiffre ni aucun nombre dans les valeurs JSON.\n"
        "- Ne fais aucun calcul.\n"
        "- N'ajoute aucune cle supplementaire.\n"
        "- Le champ 'objet' doit etre un nom commun pluriel adapte au contexte.\n"
        "- Le champ 'question' doit etre une vraie question finale en francais simple.\n"
        "- Reponds uniquement avec un objet JSON, sans commentaire.\n"
        "Format de sortie impose:\n"
        '{"personnage":"...","objet":"...","action":"...","question":"..."}'
    )


def _sampler_reste_partie_tout() -> tuple[dict, int, list[str]]:
    total = random.randint(4, 10)
    partie_connue = random.randint(1, total - 1)
    reste = total - partie_connue
    variables = {"total": total, "partie_connue": partie_connue}
    steps = [
        f"Repere le total de depart : {total}.",
        f"Repere ce qui part : {partie_connue}.",
        f"Calcule {total} - {partie_connue} = {reste}.",
    ]
    return variables, reste, steps


def _sampler_comparaison_difference() -> tuple[dict, int, list[str]]:
    grand = random.randint(20, 99)
    petit = random.randint(10, grand - 1)
    difference = grand - petit
    variables = {"grand": grand, "petit": petit}
    steps = [
        f"Repere la plus grande quantite : {grand}.",
        f"Repere la plus petite quantite : {petit}.",
        f"Calcule l'ecart : {grand} - {petit} = {difference}.",
    ]
    return variables, difference, steps


def _sampler_groupes_egaux_total() -> tuple[dict, int, list[str]]:
    group_count = random.randint(2, 6)
    group_size = random.choice([2, 3, 4, 5, 6, 7, 8, 10, 12, 20])
    total = group_count * group_size
    variables = {"group_count": group_count, "group_size": group_size}
    steps = [
        f"Repere le nombre de groupes : {group_count}.",
        f"Repere le nombre d'elements dans chaque groupe : {group_size}.",
        f"Calcule {group_count} x {group_size} = {total}.",
    ]
    return variables, total, steps


def _sampler_total_partie_tout() -> tuple[dict, int, list[str]]:
    partie1 = random.randint(1, 6)
    partie2 = random.randint(1, 10 - partie1)
    total = partie1 + partie2
    variables = {"partie1": partie1, "partie2": partie2}
    steps = [
        f"Repere la premiere partie : {partie1}.",
        f"Repere la deuxieme partie : {partie2}.",
        f"Calcule {partie1} + {partie2} = {total}.",
    ]
    return variables, total, steps


def _sampler_groupes_egaux_quotient() -> tuple[dict, int, list[str]]:
    group_size = random.choice([2, 3, 4, 5, 6, 8, 10])
    quotient = random.randint(2, 6)
    total = group_size * quotient
    variables = {"total": total, "group_size": group_size}
    steps = [
        f"Repere le total : {total}.",
        f"Repere la taille d'un groupe : {group_size}.",
        f"Calcule combien de groupes de {group_size} tiennent dans {total} : {quotient}.",
    ]
    return variables, quotient, steps


def _assemble_reste_partie_tout(variables: dict, contexte: dict[str, str]) -> str:
    return " ".join(
        [
            f"{contexte['personnage']} a {variables['total']} {contexte['objet']}.",
            _sentence(
                f"{contexte['personnage']} {contexte['action']} {variables['partie_connue']} {contexte['objet']}"
            ),
            _sentence(contexte["question"]),
        ]
    )


def _assemble_comparaison_difference(variables: dict, contexte: dict[str, str]) -> str:
    return " ".join(
        [
            f"{contexte['personnage']} a {variables['grand']} {contexte['objet']}.",
            _sentence(f"{contexte['action']} {variables['petit']}"),
            _sentence(contexte["question"]),
        ]
    )


def _assemble_groupes_egaux_total(variables: dict, contexte: dict[str, str]) -> str:
    return " ".join(
        [
            _sentence(
                f"{contexte['personnage']} {contexte['action']} {variables['group_count']} groupes de {variables['group_size']} {contexte['objet']}"
            ),
            _sentence(contexte["question"]),
        ]
    )


def _assemble_total_partie_tout(variables: dict, contexte: dict[str, str]) -> str:
    return " ".join(
        [
            _sentence(
                f"{contexte['personnage']} {contexte['action']} {variables['partie1']} {contexte['objet']} et {variables['partie2']} autres {contexte['objet']}"
            ),
            _sentence(contexte["question"]),
        ]
    )


def _assemble_groupes_egaux_quotient(variables: dict, contexte: dict[str, str]) -> str:
    return " ".join(
        [
            _sentence(
                f"{contexte['personnage']} {contexte['action']} {variables['total']} {contexte['objet']} par groupes de {variables['group_size']}"
            ),
            _sentence(contexte["question"]),
        ]
    )


def _instruction_reste_partie_tout() -> str:
    return (
        "Genere une situation de retrait d'une partie d'un tout pour un eleve de CE1. "
        "Le champ 'action' doit etre un groupe verbal qui s'insere dans la phrase "
        '"{personnage} {action} {nombre} {objet}".'
    )


def _instruction_comparaison_difference() -> str:
    return (
        "Genere une situation de comparaison entre deux quantites pour un eleve de CE2. "
        "Le champ 'action' doit etre une phrase courte qui s'insere dans "
        '"{action} {nombre}" pour decrire la deuxieme quantite sans recalcul.'
    )


def _instruction_groupes_egaux_total() -> str:
    return (
        "Genere une situation de groupes egaux ou l'on cherche le total. "
        "Le champ 'action' doit s'inserer dans "
        '"{personnage} {action} {nombre_de_groupes} groupes de {taille} {objet}".'
    )


def _instruction_total_partie_tout() -> str:
    return (
        "Genere une situation d'addition de deux parties pour trouver le tout, pour un eleve de CE1. "
        "Le champ 'action' doit s'inserer dans "
        '"{personnage} {action} {partie1} {objet} et {partie2} autres {objet}".'
    )


def _instruction_groupes_egaux_quotient() -> str:
    return (
        "Genere une situation de repartition en groupes egaux ou l'on cherche le nombre de groupes. "
        "Le champ 'action' doit s'inserer dans "
        '"{personnage} {action} {total} {objet} par groupes de {taille}".'
    )


PatternBuilder = dict[str, Callable[..., object]]

PATTERN_BUILDERS: dict[str, PatternBuilder] = {
    "probleme_reste_partie_tout": {
        "sample": _sampler_reste_partie_tout,
        "assemble": _assemble_reste_partie_tout,
        "instruction": _instruction_reste_partie_tout,
    },
    "probleme_comparaison_difference": {
        "sample": _sampler_comparaison_difference,
        "assemble": _assemble_comparaison_difference,
        "instruction": _instruction_comparaison_difference,
    },
    "probleme_groupes_egaux_total": {
        "sample": _sampler_groupes_egaux_total,
        "assemble": _assemble_groupes_egaux_total,
        "instruction": _instruction_groupes_egaux_total,
    },
    "probleme_total_partie_tout": {
        "sample": _sampler_total_partie_tout,
        "assemble": _assemble_total_partie_tout,
        "instruction": _instruction_total_partie_tout,
    },
    "probleme_groupes_egaux_quotient": {
        "sample": _sampler_groupes_egaux_quotient,
        "assemble": _assemble_groupes_egaux_quotient,
        "instruction": _instruction_groupes_egaux_quotient,
    },
}


def generate_narrative_exercise(niveau: str, pattern_name: str | None = None) -> dict:
    if niveau not in LEVEL_MAP:
        raise ValueError("Niveau invalide. Utiliser CE1 ou CE2.")

    selected_pattern = pattern_name or _pick_pattern_for_level(niveau)
    if selected_pattern not in PATTERN_DEFS:
        raise ValueError(f"Pattern narratif inconnu: {selected_pattern}")

    if LEVEL_MAP[niveau] not in PATTERN_DEFS[selected_pattern]["levels"]:
        raise ValueError(f"Le pattern {selected_pattern} n'est pas disponible pour {niveau}.")

    builder = PATTERN_BUILDERS[selected_pattern]
    variables, valeur, steps = builder["sample"]()
    allowed_personnages = PERSONNAGES
    allowed_objets = _choose_object_pool(selected_pattern, variables)
    recent_personnages, recent_objets = _recent_constraints(selected_pattern)
    prompt = _prompt_for_pattern(
        selected_pattern,
        builder["instruction"](),
        variables=variables,
        allowed_personnages=allowed_personnages,
        allowed_objets=allowed_objets,
        recent_personnages=recent_personnages,
        recent_objets=recent_objets,
    )
    contexte = _generate_narrative_context(prompt)
    contexte = _validate_allowed_values(
        contexte,
        allowed_personnages=allowed_personnages,
        allowed_objets=allowed_objets,
    )
    enonce = builder["assemble"](variables, contexte)
    _remember_context(selected_pattern, contexte)

    return _build_exercise(
        niveau=niveau,
        pattern_name=selected_pattern,
        variables=variables,
        contexte_narratif=contexte,
        enonce=enonce,
        valeur=valeur,
        steps=steps,
    )


def generate_narrative_lot(niveau: str, pattern_name: str, count: int) -> list[dict]:
    if count <= 0:
        return []

    last_error: Exception | None = None
    for _ in range(5):
        lot = [generate_narrative_exercise(niveau, pattern_name) for _ in range(count)]
        try:
            assert_narrative_diversity(lot)
            return lot
        except NarrativeGenerationError as exc:
            last_error = exc
    raise NarrativeGenerationError(
        f"Impossible d'obtenir un lot narratif suffisamment diversifie pour {pattern_name}."
    ) from last_error
