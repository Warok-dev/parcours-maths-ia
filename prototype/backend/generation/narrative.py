from __future__ import annotations

import json
import random
import re
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


def _prompt_for_pattern(pattern_name: str, instruction: str) -> str:
    pattern_def = PATTERN_DEFS[pattern_name]
    return (
        f"Pattern cible: {pattern_name}\n"
        f"Template pedagogique: {pattern_def['template']}\n"
        "Exemples reels du corpus a imiter pour le registre et le niveau:\n"
        f"{_build_examples_block(pattern_name)}\n\n"
        "Ta mission:\n"
        f"{instruction}\n"
        "Regles absolues:\n"
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
    prompt = _prompt_for_pattern(selected_pattern, builder["instruction"]())
    contexte = _generate_narrative_context(prompt)
    enonce = builder["assemble"](variables, contexte)

    return _build_exercise(
        niveau=niveau,
        pattern_name=selected_pattern,
        variables=variables,
        contexte_narratif=contexte,
        enonce=enonce,
        valeur=valeur,
        steps=steps,
    )
