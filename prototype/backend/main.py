from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from diagnostic import diagnostiquer_erreur
from evaluation import compare_reponse
from generation.narrative import (
    generate_narrative_exercise,
    patterns_narratifs_disponibles_pour_niveau,
)
from generation.substitution import (
    generer_exercice,
    generer_lot,
    patterns_disponibles_pour_niveau,
)
from tutor import TutorServiceError, build_tutor_reply

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
SESSION_MAX_AGE_DAYS = 7
SESSION_ID_PATTERN = re.compile(r"[0-9a-f]{32}")
ALLOWED_LEVELS = {"CE1", "CE2"}
RESOLUTION_LEVEL_TO_KEY = {1: "1_guide", 2: "2_semi_guide", 3: "3_autonome"}
REINFORCEMENT_BY_MASTERY = {1: 4, 2: 3, 3: 2}
# Caches memoire de travail ; la verite persistante des sessions est sur
# disque (un JSON par session dans data/sessions/), rechargee a la demande.
EXERCICE_CACHE: dict[str, dict] = {}
SESSION_STATE: dict[str, dict] = {}

# Rend visibles les logs INFO applicatifs (ex : quel fournisseur narratif a
# repondu) dans la console uvicorn pendant le developpement.
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Prototype Parcours Maths IA", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionStartRequest(BaseModel):
    niveau_scolaire: Literal["CE1", "CE2"]
    lecon_id: str | None = None


class EvaluationRequest(BaseModel):
    exercice_id: str
    session_id: str | None = None
    niveau: Literal["CE1", "CE2"] | None = None
    reponse_eleve: str | None = None
    reponse_donnee: str | None = None


class TutorRequest(BaseModel):
    exercice_id: str
    niveau: Literal["CE1", "CE2"]
    question: str
    session_id: str | None = None


def load_json(name: str) -> list[dict] | dict:
    path = DATA_DIR / name
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _session_file_path(session_id: str) -> Path | None:
    # Les ids sont des uuid4().hex : tout autre format est rejete, ce qui
    # empeche au passage toute traversee de chemin via l'URL.
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        return None
    return SESSIONS_DIR / f"{session_id}.json"


def _save_session(session: dict) -> None:
    """Persiste la session et son exercice courant (ecriture atomique)."""
    path = _session_file_path(session["session_id"])
    if path is None:
        return
    exercices = {}
    exercice_id = session.get("exercice_id_courant")
    if exercice_id and exercice_id in EXERCICE_CACHE:
        exercices[exercice_id] = EXERCICE_CACHE[exercice_id]
    payload = {"session": session, "exercices": exercices}
    try:
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temp_path, path)
    except OSError:
        # Persistance en echec : la partie continue sur l'etat memoire.
        pass


def _load_session_from_disk(session_id: str) -> dict | None:
    path = _session_file_path(session_id)
    if path is None or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        session = payload["session"]
        exercices = payload.get("exercices", {})
    except (OSError, ValueError, KeyError, TypeError):
        return None
    EXERCICE_CACHE.update(exercices)
    SESSION_STATE[session_id] = session
    return session


def _cleanup_old_sessions() -> None:
    """Au demarrage : supprime les fichiers de session de plus de 7 jours."""
    if not SESSIONS_DIR.is_dir():
        return
    cutoff = time.time() - SESSION_MAX_AGE_DAYS * 86400
    for path in SESSIONS_DIR.glob("*.json"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


_cleanup_old_sessions()


def load_exercices(niveau: str) -> list[dict]:
    file_name = f"exercices_{niveau.lower()}.json"
    exercices = load_json(file_name)
    if not isinstance(exercices, list):
        raise ValueError(f"{file_name} must contain a JSON list.")
    return exercices


def get_exercice_by_id(niveau: str, exercice_id: str) -> dict:
    exercice = EXERCICE_CACHE.get(exercice_id)
    if exercice is not None:
        return exercice

    for exercice in load_exercices(niveau):
        if exercice.get("id") == exercice_id:
            return exercice
    raise HTTPException(status_code=404, detail="Exercice introuvable ou expire.")


def _resolution_key(level: int) -> str:
    return RESOLUTION_LEVEL_TO_KEY[level]


def _concepts_for_level(niveau: str) -> list[str]:
    concepts = patterns_disponibles_pour_niveau(niveau)
    if not concepts:
        raise HTTPException(status_code=500, detail="Aucun concept disponible pour ce niveau.")
    return concepts


def _load_lessons() -> list[dict]:
    lessons = load_json("lessons.json")
    if not isinstance(lessons, dict) or not isinstance(lessons.get("lessons"), list):
        raise HTTPException(status_code=500, detail="Structure de lecons invalide.")
    return lessons["lessons"]


def _all_patterns_for_level(niveau: str) -> set[str]:
    return set(patterns_disponibles_pour_niveau(niveau)) | set(
        patterns_narratifs_disponibles_pour_niveau(niveau)
    )


def _available_lessons_for_level(niveau: str) -> list[dict]:
    available_patterns = _all_patterns_for_level(niveau)
    lessons: list[dict] = []
    for lesson in _load_lessons():
        patterns = [pattern for pattern in lesson["patterns"] if pattern in available_patterns]
        if not patterns:
            continue
        lessons.append(
            {
                "lecon_id": lesson["lecon_id"],
                "nom": lesson["nom"],
                "pattern_count": len(patterns),
                "patterns": patterns,
            }
        )
    return lessons


def _lesson_concepts_for_level(niveau: str, lecon_id: str) -> tuple[dict, list[str]]:
    for lesson in _available_lessons_for_level(niveau):
        if lesson["lecon_id"] == lecon_id:
            return lesson, lesson["patterns"]
    raise HTTPException(status_code=404, detail="Lecon introuvable pour ce niveau.")


def _cache_exercise(exercice: dict) -> dict:
    EXERCICE_CACHE[exercice["id"]] = exercice
    return exercice


def _generate_concept_exercise(niveau: str, concept: str) -> dict:
    if concept in patterns_disponibles_pour_niveau(niveau):
        return _cache_exercise(generer_exercice(concept, niveau))
    if concept in patterns_narratifs_disponibles_pour_niveau(niveau):
        return _cache_exercise(generate_narrative_exercise(niveau, concept))
    raise HTTPException(
        status_code=500,
        detail=f"Le concept '{concept}' n'est pas generable pour le niveau {niveau}.",
    )


def _progression_payload(session: dict) -> dict:
    exercice = EXERCICE_CACHE.get(session["exercice_id_courant"])
    current_level = session["niveau_resolution_courant"]
    payload = {
        "session_id": session["session_id"],
        "niveau_scolaire": session["niveau_scolaire"],
        "lecon_id": session["lecon_id"],
        "lecon_nom": session["lecon_nom"],
        "concept_courant": session["concept_courant"],
        "phase": session["phase"],
        "niveau_resolution_courant": current_level,
        "presentation_courante": _resolution_key(current_level),
        "exercice_id_courant": session["exercice_id_courant"],
        "erreurs_sur_chaine_actuelle": session["erreurs_sur_chaine_actuelle"],
        "maitrise_actuelle": session["maitrise_actuelle"],
        "exercices_renforcement_restants": session["exercices_renforcement_restants"],
        "etapes_debloquees": session["etapes_debloquees"],
        "concepts": session["concepts"],
        "concept_index": session["concept_index"],
        "terminee": session["terminee"],
    }
    if exercice is not None:
        payload["exercice_courant"] = exercice
        payload["presentation_courante_detail"] = exercice["presentations"][_resolution_key(current_level)]
    return payload


def _build_session(niveau: str, lecon_id: str | None = None) -> dict:
    if lecon_id is None:
        concepts = _concepts_for_level(niveau)
        lecon_nom = None
    else:
        lesson, concepts = _lesson_concepts_for_level(niveau, lecon_id)
        lecon_nom = lesson["nom"]

    concept = concepts[0]
    exercice = _generate_concept_exercise(niveau, concept)
    session_id = uuid4().hex
    session = {
        "session_id": session_id,
        "niveau_scolaire": niveau,
        "lecon_id": lecon_id,
        "lecon_nom": lecon_nom,
        "concepts": concepts,
        "concept_index": 0,
        "concept_courant": concept,
        "phase": "detection_maitrise",
        "niveau_resolution_courant": 1,
        "exercice_id_courant": exercice["id"],
        "erreurs_sur_chaine_actuelle": False,
        "exercices_renforcement_restants": 0,
        "etapes_debloquees": [concept],
        "maitrise_actuelle": 0,
        "terminee": False,
        "dernier_diagnostic": None,
    }
    SESSION_STATE[session_id] = session
    _save_session(session)
    return session


def _get_session(session_id: str) -> dict:
    session = SESSION_STATE.get(session_id)
    if session is None:
        # Pas en memoire (ex : serveur redemarre) : tente le fichier persiste.
        session = _load_session_from_disk(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session introuvable.")
    return session


def _ensure_current_exercise(session: dict, exercice_id: str) -> dict:
    if session["terminee"]:
        raise HTTPException(status_code=400, detail="La carte est deja terminee.")
    if exercice_id != session["exercice_id_courant"]:
        raise HTTPException(status_code=409, detail="Exercice courant invalide pour cette session.")
    return get_exercice_by_id(session["niveau_scolaire"], exercice_id)


def _advance_to_next_level(session: dict) -> None:
    session["niveau_resolution_courant"] += 1


def _mark_chain_broken(session: dict) -> None:
    session["erreurs_sur_chaine_actuelle"] = True


def _generate_next_exercise(session: dict, concept: str) -> dict:
    # La session ne doit etre mutee qu'apres une generation reussie : toute
    # erreur ici doit laisser l'etat intact et signaler un indisponible au front.
    try:
        return _generate_concept_exercise(session["niveau_scolaire"], concept)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Generation de l'exercice suivant indisponible, reessaie.",
        ) from exc


def _start_reinforcement(session: dict, mastery: int) -> dict:
    exercice = _generate_next_exercise(session, session["concept_courant"])
    session["phase"] = "renforcement"
    session["maitrise_actuelle"] = mastery
    # En renforcement, chaque exercice se joue UNE fois, au niveau de
    # presentation correspondant a la maitrise detectee (1 = guide,
    # 2 = semi-guide, 3 = autonome) : l'echelle 1->2->3 est reservee a la
    # detection, sinon chaque exercice serait rejoue trois fois.
    session["niveau_resolution_courant"] = mastery
    session["erreurs_sur_chaine_actuelle"] = False
    session["exercices_renforcement_restants"] = REINFORCEMENT_BY_MASTERY[mastery]
    session["exercice_id_courant"] = exercice["id"]
    return exercice


def _unlock_next_concept(session: dict) -> tuple[str, dict | None]:
    next_index = session["concept_index"] + 1
    if next_index >= len(session["concepts"]):
        session["terminee"] = True
        session["concept_index"] = next_index
        session["concept_courant"] = None
        session["phase"] = "terminee"
        session["niveau_resolution_courant"] = 1
        session["exercice_id_courant"] = None
        session["exercices_renforcement_restants"] = 0
        session["erreurs_sur_chaine_actuelle"] = False
        return "carte_terminee", None

    next_concept = session["concepts"][next_index]
    exercice = _generate_next_exercise(session, next_concept)
    session["concept_index"] = next_index
    session["concept_courant"] = next_concept
    session["phase"] = "detection_maitrise"
    session["niveau_resolution_courant"] = 1
    session["erreurs_sur_chaine_actuelle"] = False
    session["exercices_renforcement_restants"] = 0
    session["maitrise_actuelle"] = 0
    session["terminee"] = False
    session["etapes_debloquees"].append(next_concept)
    session["exercice_id_courant"] = exercice["id"]
    return "correct_concept_debloque", exercice


def _handle_detection_success(session: dict) -> tuple[str, dict | None]:
    current_level = session["niveau_resolution_courant"]
    if session["erreurs_sur_chaine_actuelle"]:
        locked_mastery = max(1, session["maitrise_actuelle"])
        exercice = _start_reinforcement(session, locked_mastery)
        return "correct_nouveau_renforcement", exercice

    if current_level < 3:
        session["maitrise_actuelle"] = current_level
        _advance_to_next_level(session)
        return "correct_niveau_suivant", EXERCICE_CACHE[session["exercice_id_courant"]]

    exercice = _start_reinforcement(session, 3)
    return "correct_nouveau_renforcement", exercice


def _handle_reinforcement_success(session: dict) -> tuple[str, dict | None]:
    if session["exercices_renforcement_restants"] > 1:
        exercice = _generate_next_exercise(session, session["concept_courant"])
        session["exercices_renforcement_restants"] -= 1
        session["niveau_resolution_courant"] = session["maitrise_actuelle"]
        session["erreurs_sur_chaine_actuelle"] = False
        session["exercice_id_courant"] = exercice["id"]
        return "correct_nouveau_renforcement", exercice

    return _unlock_next_concept(session)


def _apply_session_evaluation(session: dict, exercice: dict, reponse: str) -> dict:
    result = compare_reponse(reponse, exercice["reponse_attendue"])
    response = {
        "session_id": session["session_id"],
        "exercice_id": exercice["id"],
        "niveau": session["niveau_scolaire"],
        **result,
    }

    if not result["correct"]:
        _mark_chain_broken(session)
        # Diagnostic par regles de l'erreur probable, memorise pour que le
        # tuteur puisse cibler son aide (ecrase a chaque nouvelle tentative).
        session["dernier_diagnostic"] = diagnostiquer_erreur(
            exercice["pattern"]["pattern_name"],
            exercice.get("variables") or {},
            exercice["reponse_attendue"]["valeur"],
            reponse,
        )
        response["statut"] = "incorrect"
        response["diagnostic"] = session["dernier_diagnostic"]
        response["progression"] = _progression_payload(session)
        return response

    session["dernier_diagnostic"] = None

    if session["phase"] == "detection_maitrise":
        statut, next_exercise = _handle_detection_success(session)
    elif session["phase"] == "renforcement":
        statut, next_exercise = _handle_reinforcement_success(session)
    else:
        raise HTTPException(status_code=400, detail="Session terminee.")

    response["statut"] = statut
    response["progression"] = _progression_payload(session)
    if next_exercise is not None:
        response["exercice_suivant"] = next_exercise
    return response


def _extract_answer(payload: EvaluationRequest) -> str:
    answer = payload.reponse_donnee if payload.reponse_donnee is not None else payload.reponse_eleve
    if answer is None:
        raise HTTPException(status_code=400, detail="La reponse est obligatoire.")
    return answer


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/session/demarrer")
def demarrer_session(payload: SessionStartRequest) -> dict:
    session = _build_session(payload.niveau_scolaire, payload.lecon_id)
    return {
        "session_id": session["session_id"],
        "exercice": EXERCICE_CACHE[session["exercice_id_courant"]],
        "progression": _progression_payload(session),
    }


@app.get("/session/{session_id}")
def get_session(session_id: str) -> dict:
    session = _get_session(session_id)
    return _progression_payload(session)


@app.get("/lecons/{niveau_scolaire}")
def get_lecons(niveau_scolaire: str) -> dict:
    if niveau_scolaire not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Niveau invalide. Utiliser CE1 ou CE2.")

    return {
        "niveau_scolaire": niveau_scolaire,
        "lecons": _available_lessons_for_level(niveau_scolaire),
    }


@app.get("/exercices/{niveau}")
def get_exercice(niveau: str, pattern: str | None = None) -> dict:
    if niveau not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Niveau invalide. Utiliser CE1 ou CE2.")

    if pattern is not None:
        patterns_disponibles = patterns_disponibles_pour_niveau(niveau)
        if pattern not in patterns_disponibles:
            raise HTTPException(
                status_code=404,
                detail=f"Pattern '{pattern}' introuvable pour le niveau {niveau}.",
            )
        return _cache_exercise(generer_exercice(pattern, niveau))

    return _cache_exercise(generer_lot(niveau, 1)[0])


@app.post("/evaluer")
def evaluer(payload: EvaluationRequest) -> dict:
    reponse = _extract_answer(payload)

    if payload.session_id is not None:
        session = _get_session(payload.session_id)
        exercice = _ensure_current_exercise(session, payload.exercice_id)
        response = _apply_session_evaluation(session, exercice, reponse)
        _save_session(session)
        return response

    if payload.niveau is None:
        raise HTTPException(status_code=400, detail="Le niveau est obligatoire hors session.")

    exercice = get_exercice_by_id(payload.niveau, payload.exercice_id)
    result = compare_reponse(reponse, exercice["reponse_attendue"])
    return {
        "exercice_id": payload.exercice_id,
        "niveau": payload.niveau,
        **result,
    }


@app.post("/tuteur/aide")
def tuteur_aide(payload: TutorRequest) -> dict:
    progression = None
    diagnostic = None
    if payload.session_id is not None:
        session = _get_session(payload.session_id)
        exercice = _ensure_current_exercise(session, payload.exercice_id)
        if session["niveau_resolution_courant"] >= 2:
            _mark_chain_broken(session)
            _save_session(session)
        progression = _progression_payload(session)
        diagnostic = session.get("dernier_diagnostic")
    else:
        exercice = get_exercice_by_id(payload.niveau, payload.exercice_id)

    try:
        tutor_reply = build_tutor_reply(exercice, payload.question, diagnostic=diagnostic)
    except TutorServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    response = {
        "exercice_id": payload.exercice_id,
        "niveau": payload.niveau,
        **tutor_reply,
    }
    if payload.session_id is not None:
        response["session_id"] = payload.session_id
        response["progression"] = progression
    return response


@app.get("/carte/{niveau}")
def get_carte(niveau: str) -> dict:
    if niveau not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Niveau invalide. Utiliser CE1 ou CE2.")

    cartes = load_json("cartes.json")
    if not isinstance(cartes, dict):
        raise HTTPException(status_code=500, detail="Structure de carte invalide.")

    if niveau not in cartes:
        raise HTTPException(status_code=404, detail="Carte introuvable pour ce niveau.")

    return cartes[niveau]


@app.get("/generation/demo/{niveau}")
def generation_demo(niveau: str) -> dict:
    if niveau not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Niveau invalide. Utiliser CE1 ou CE2.")

    return {
        "substitution": generer_lot(niveau, 1)[0],
        "narratif": generate_narrative_exercise(niveau),
    }
