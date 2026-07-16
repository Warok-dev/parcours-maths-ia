from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from evaluation import compare_reponse
from generation.narrative import generate_narrative_exercise
from generation.substitution import (
    generer_exercice,
    generer_lot,
    patterns_disponibles_pour_niveau,
)
from tutor import TutorServiceError, build_tutor_reply, ensure_tutor_configured

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ALLOWED_LEVELS = {"CE1", "CE2"}
# Volatile in-memory cache for dynamically generated exercises.
# This is enough for a local prototype, but the content is lost on server restart.
# A deployed version would need persistent storage (file or database).
EXERCICE_CACHE: dict[str, dict] = {}

app = FastAPI(title="Prototype Parcours Maths IA", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def validate_tutor_configuration() -> None:
    ensure_tutor_configured()


class EvaluationRequest(BaseModel):
    exercice_id: str
    niveau: Literal["CE1", "CE2"]
    reponse_eleve: str


class TutorRequest(BaseModel):
    exercice_id: str
    niveau: Literal["CE1", "CE2"]
    question: str


def load_json(name: str) -> list[dict] | dict:
    path = DATA_DIR / name
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


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
    raise HTTPException(status_code=404, detail="Exercice introuvable ou expiré.")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


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
        exercice = generer_exercice(pattern, niveau)
        EXERCICE_CACHE[exercice["id"]] = exercice
        return exercice

    exercice = generer_lot(niveau, 1)[0]
    EXERCICE_CACHE[exercice["id"]] = exercice
    return exercice


@app.post("/evaluer")
def evaluer(payload: EvaluationRequest) -> dict:
    exercice = get_exercice_by_id(payload.niveau, payload.exercice_id)
    result = compare_reponse(payload.reponse_eleve, exercice["reponse_attendue"])
    return {
        "exercice_id": payload.exercice_id,
        "niveau": payload.niveau,
        **result,
    }


@app.post("/tuteur/aide")
def tuteur_aide(payload: TutorRequest) -> dict:
    exercice = get_exercice_by_id(payload.niveau, payload.exercice_id)
    try:
        tutor_reply = build_tutor_reply(exercice, payload.question)
    except TutorServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "exercice_id": payload.exercice_id,
        "niveau": payload.niveau,
        **tutor_reply,
    }


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
