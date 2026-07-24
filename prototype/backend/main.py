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
    THEME_NEUTRE,
    generate_narrative_exercise,
    patterns_narratifs_disponibles_pour_niveau,
    themes_disponibles,
)
from generation.substitution import (
    generer_exercice,
    generer_lot,
    patterns_disponibles_pour_niveau,
)
import tts
from tts import TTSConfigurationError, TTSServiceError
from tutor import TutorServiceError, build_tutor_reply

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
SESSION_MAX_AGE_DAYS = 7
SESSION_ID_PATTERN = re.compile(r"[0-9a-f]{32}")
ALLOWED_LEVELS = {"CE1", "CE2", "CE3", "CE4", "CE5", "CE6"}
RESOLUTION_LEVEL_TO_KEY = {1: "1_guide", 2: "2_semi_guide", 3: "3_autonome"}
REINFORCEMENT_BY_MASTERY = {1: 4, 2: 3, 3: 2}

# --- Revision ciblee ---------------------------------------------------
# Session batie sur une liste de patterns explicite (les faiblesses
# memorisees cote frontend) au lieu d'une lecon. Elle porte une identite de
# lecon propre pour que tout l'existant (titre, carnet, bilan) fonctionne
# sans cas particulier.
REVISION_LECON_ID = "revision_ciblee"
REVISION_LECON_NOM = "Revision ciblee"
# Au-dela, la revision deviendrait un marathon : on garde les faiblesses les
# plus anciennes, celles qui trainent depuis le plus longtemps.
REVISION_MAX_CONCEPTS = 6

# --- Detection de decouragement ----------------------------------------
# A ne pas confondre avec le tuteur proactif (frontend, proactive.js) : lui
# detecte un blocage sur UN exercice donne et remet ses compteurs a zero des
# qu'on change d'exercice. Ici on regarde la TENDANCE sur plusieurs
# exercices et plusieurs concepts, pour inserer un aparte de reconstruction
# de confiance. Les deux signaux sont independants et se completent.
DECOURAGEMENT_FENETRE = 5
DECOURAGEMENT_MIN_ECHECS = 4
DECOURAGEMENT_MAITRISES_BASSES = 2
# Nombre d'exercices normaux distincts a jouer avant qu'un nouvel aparte
# puisse se declencher : sans cela un eleve en difficulte enchainerait les
# pauses et perdrait le fil du parcours.
CONFIANCE_ESPACEMENT_MIN = 3
# L'exercice de confiance est toujours presente au niveau le plus accompagne.
CONFIANCE_PRESENTATION_NIVEAU = 1

# Repli quand l'eleve n'a encore rien maitrise a 3 : patterns proceduraux
# du plus simple au moins simple. Aucun probleme narratif (lecture longue,
# generation LLM) ni pattern a plusieurs etapes.
CONFIANCE_PATTERNS_SIMPLES = [
    "partie_tout_addition_non_narratif",
    "addition_pas_a_pas_sans_retenue",
    "partie_tout_soustraction_non_narratif",
    "double_via_2xn",
    "multiplication_par_10",
    "moitie_via_2xn",
]
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
    niveau_scolaire: Literal["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"]
    lecon_id: str | None = None
    theme: str | None = None


class RevisionStartRequest(BaseModel):
    niveau_scolaire: Literal["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"]
    patterns_cibles: list[str]
    theme: str | None = None


class EvaluationRequest(BaseModel):
    exercice_id: str
    session_id: str | None = None
    niveau: Literal["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"] | None = None
    reponse_eleve: str | None = None
    reponse_donnee: str | None = None


class TutorRequest(BaseModel):
    exercice_id: str
    niveau: Literal["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"]
    question: str
    session_id: str | None = None


class SpeechRequest(BaseModel):
    texte: str
    # Ton de la voix : le tuteur (le hibou) ou la lecture d'un enonce. Optionnel
    # (defaut = enonce). Toute autre valeur retombe sur le profil par defaut.
    source: str | None = None


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
    # L'exercice de confiance est persiste avec l'exercice normal : sinon un
    # redemarrage pendant l'aparte perdrait l'un ou l'autre.
    confiance = session.get("exercice_confiance")
    ids = [session.get("exercice_id_courant")]
    if confiance is not None:
        ids.append(confiance.get("exercice_id"))
    for exercice_id in ids:
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


def _revision_concepts(niveau: str, patterns_cibles: list[str]) -> list[str]:
    """Pool d'une revision ciblee : uniquement les patterns demandes.

    L'ordre d'arrivee est conserve (les faiblesses les plus anciennes en
    premier) et les doublons sont ecartes. Les patterns ingenerables pour ce
    niveau sont ignores plutot que fatals : une faiblesse memorisee en CE1
    ne doit pas bloquer une revision demandee en CE2.
    """
    generables = _all_patterns_for_level(niveau)
    concepts: list[str] = []
    for pattern in patterns_cibles:
        if pattern in generables and pattern not in concepts:
            concepts.append(pattern)
    if not concepts:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun des patterns cibles n'est disponible pour le niveau {niveau}.",
        )
    return concepts[:REVISION_MAX_CONCEPTS]


def _cache_exercise(exercice: dict) -> dict:
    EXERCICE_CACHE[exercice["id"]] = exercice
    return exercice


def _generate_concept_exercise(niveau: str, concept: str, theme: str | None = None) -> dict:
    """Genere l'exercice d'un concept.

    Le theme ne concerne que les patterns narratifs : les exercices
    proceduraux n'ont pas d'habillage a colorer.
    """
    if concept in patterns_disponibles_pour_niveau(niveau):
        return _cache_exercise(generer_exercice(concept, niveau))
    if concept in patterns_narratifs_disponibles_pour_niveau(niveau):
        return _cache_exercise(generate_narrative_exercise(niveau, concept, theme))
    raise HTTPException(
        status_code=500,
        detail=f"Le concept '{concept}' n'est pas generable pour le niveau {niveau}.",
    )


def _ensure_session_fields(session: dict) -> dict:
    """Complete une session d'une version anterieure du schema.

    Les sessions vivent 7 jours sur disque : une session commencee avant
    l'ajout du suivi de decouragement doit continuer sans planter.
    """
    session.setdefault("tentatives_recentes", [])
    session.setdefault("maitrises_concepts_terminees", [])
    session.setdefault("patterns_maitrises", [])
    session.setdefault("exercice_confiance", None)
    session.setdefault("exercices_depuis_confiance", [])
    session.setdefault("confiance_deja_inseree", False)
    session.setdefault("confiance_maitrises_vues", 0)
    session.setdefault("revision", False)
    session.setdefault("theme", THEME_NEUTRE)
    return session


def _record_attempt(session: dict, correct: bool, exercice_id: str) -> None:
    """Memorise une tentative sur un exercice NORMAL (jamais un aparte)."""
    fenetre = session["tentatives_recentes"]
    fenetre.append(bool(correct))
    del fenetre[:-DECOURAGEMENT_FENETRE]

    # Espacement compte les exercices distincts, pas les tentatives : rester
    # bloque dix fois sur le meme exercice releve du tuteur proactif, pas
    # d'un nouvel aparte.
    vus = session["exercices_depuis_confiance"]
    if exercice_id not in vus and len(vus) < CONFIANCE_ESPACEMENT_MIN:
        vus.append(exercice_id)


def _signal_decouragement(session: dict) -> str | None:
    """Retourne le motif du decouragement detecte, ou None.

    Deux signaux independants : une serie d'echecs recents toutes activites
    confondues, ou deux concepts d'affilee acheves au plus bas niveau de
    maitrise.
    """
    if session["tentatives_recentes"].count(False) >= DECOURAGEMENT_MIN_ECHECS:
        return "echecs_repetes"

    maitrises = session["maitrises_concepts_terminees"]
    # Un concept doit avoir ete termine DEPUIS le dernier aparte, sinon deux
    # vieilles maitrises 1 rallumeraient le signal pour le reste de la partie.
    if (
        len(maitrises) >= DECOURAGEMENT_MAITRISES_BASSES
        and len(maitrises) > session["confiance_maitrises_vues"]
        and all(niveau == 1 for niveau in maitrises[-DECOURAGEMENT_MAITRISES_BASSES:])
    ):
        return "maitrises_basses"

    return None


def _pattern_pour_confiance(session: dict) -> str | None:
    """Choisit le pattern de l'exercice de confiance.

    On cherche une reussite quasi certaine, donc d'abord un pattern deja
    maitrise a 3 dans cette session. Le pattern sur lequel l'eleve bute est
    ecarte tant qu'il existe une autre option, y compris au profit du repli
    simple : lui reservir le concept qui vient de le mettre en echec irait
    contre le but meme de l'aparte.
    """
    niveau = session["niveau_scolaire"]
    proceduraux = patterns_disponibles_pour_niveau(niveau)
    generables = set(proceduraux) | set(patterns_narratifs_disponibles_pour_niveau(niveau))
    maitrises = [pattern for pattern in session["patterns_maitrises"] if pattern in generables]
    simples = [pattern for pattern in CONFIANCE_PATTERNS_SIMPLES if pattern in proceduraux]
    courant = session["concept_courant"]

    # Parmi les patterns maitrises on prend le plus recent (maitrise encore
    # fraiche) ; parmi les replis, le plus simple, qui est le premier de la
    # liste. Du plus souhaitable au dernier recours.
    preferences = (
        ("recent", [p for p in maitrises if p != courant and p in proceduraux]),
        ("recent", [p for p in maitrises if p != courant]),
        ("simple", [p for p in simples if p != courant]),
        ("recent", maitrises),
        ("simple", simples),
    )
    for choix, candidats in preferences:
        if candidats:
            return candidats[-1] if choix == "recent" else candidats[0]
    return None


def _inserer_exercice_confiance(session: dict, motif: str) -> dict | None:
    pattern = _pattern_pour_confiance(session)
    if pattern is None:
        return None
    try:
        exercice = _generate_concept_exercise(
            session["niveau_scolaire"], pattern, session.get("theme")
        )
    except Exception:
        # Un aparte de confort ne doit jamais casser la progression : si la
        # generation echoue, l'eleve poursuit simplement son parcours.
        logging.warning("Exercice de confiance indisponible (pattern %s).", pattern)
        return None

    session["exercice_confiance"] = {
        "exercice_id": exercice["id"],
        "pattern": pattern,
        "motif": motif,
    }
    session["confiance_deja_inseree"] = True
    session["exercices_depuis_confiance"] = []
    session["confiance_maitrises_vues"] = len(session["maitrises_concepts_terminees"])
    return exercice


def _maybe_inserer_confiance(session: dict) -> dict | None:
    """Insere un exercice de confiance si le decouragement se confirme."""
    if session["terminee"] or session["exercice_confiance"] is not None:
        return None
    if session["exercice_id_courant"] is None:
        return None
    if (
        session["confiance_deja_inseree"]
        and len(session["exercices_depuis_confiance"]) < CONFIANCE_ESPACEMENT_MIN
    ):
        return None

    motif = _signal_decouragement(session)
    if motif is None:
        return None
    return _inserer_exercice_confiance(session, motif)


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
        "theme": session["theme"],
        # Maitrise atteinte sur chaque concept ACHEVE, dans l'ordre de
        # concepts : le frontend s'en sert pour memoriser les faiblesses en
        # fin de lecon sans avoir a observer tous les snapshots intermediaires.
        "maitrises_concepts_terminees": list(session["maitrises_concepts_terminees"]),
        "revision": session["revision"],
        "terminee": session["terminee"],
    }
    if exercice is not None:
        payload["exercice_courant"] = exercice
        payload["presentation_courante_detail"] = exercice["presentations"][_resolution_key(current_level)]

    # Aparte de confiance : c'est lui que l'eleve joue maintenant, mais la
    # progression annoncee reste celle du parcours (concept, phase, maitrise
    # inchanges) pour qu'il reprenne exactement au meme point ensuite.
    confiance = session.get("exercice_confiance")
    exercice_confiance = (
        EXERCICE_CACHE.get(confiance["exercice_id"]) if confiance is not None else None
    )
    payload["exercice_confiance_actif"] = exercice_confiance is not None
    if exercice_confiance is not None:
        presentation = _resolution_key(CONFIANCE_PRESENTATION_NIVEAU)
        payload["exercice_id_courant"] = exercice_confiance["id"]
        payload["exercice_courant"] = exercice_confiance
        payload["niveau_resolution_courant"] = CONFIANCE_PRESENTATION_NIVEAU
        payload["presentation_courante"] = presentation
        payload["presentation_courante_detail"] = exercice_confiance["presentations"][presentation]
    return payload


def _valider_theme(theme: str | None) -> str:
    """Theme de l'habillage narratif, neutre par defaut.

    Un theme inconnu est refuse ici, a la frontiere de l'API, pour que la
    faute remonte tout de suite au front plutot que de se traduire en
    exercices silencieusement neutres.
    """
    if theme is None:
        return THEME_NEUTRE
    if theme not in themes_disponibles():
        raise HTTPException(status_code=400, detail=f"Theme inconnu : '{theme}'.")
    return theme


def _build_session(
    niveau: str,
    lecon_id: str | None = None,
    concepts: list[str] | None = None,
    lecon_nom: str | None = None,
    revision: bool = False,
    theme: str | None = None,
) -> dict:
    """Cree une session.

    `concepts` force le pool de concepts (mode revision ciblee) ; sans lui, le
    pool vient de la lecon demandee, ou de tout le niveau. Le reste de la
    session est identique dans les deux cas : meme progression par niveaux de
    presentation, meme detection de maitrise, meme renforcement.
    """
    if concepts is None:
        if lecon_id is None:
            concepts = _concepts_for_level(niveau)
            lecon_nom = None
        else:
            lesson, concepts = _lesson_concepts_for_level(niveau, lecon_id)
            lecon_nom = lesson["nom"]

    theme = _valider_theme(theme)
    concept = concepts[0]
    exercice = _generate_concept_exercise(niveau, concept, theme)
    session_id = uuid4().hex
    session = {
        "session_id": session_id,
        "niveau_scolaire": niveau,
        "theme": theme,
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
        "revision": revision,
    }
    _ensure_session_fields(session)
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
    return _ensure_session_fields(session)


def _ensure_current_exercise(session: dict, exercice_id: str) -> dict:
    if session["terminee"]:
        raise HTTPException(status_code=400, detail="La carte est deja terminee.")
    # Pendant un aparte de confiance, l'exercice de confiance est le seul
    # jouable : l'exercice normal attend, inchange, la fin de la pause.
    confiance = session.get("exercice_confiance")
    attendu = confiance["exercice_id"] if confiance is not None else session["exercice_id_courant"]
    if exercice_id != attendu:
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
        return _generate_concept_exercise(session["niveau_scolaire"], concept, session.get("theme"))
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
    # Un concept detecte au meilleur niveau devient un candidat ideal pour un
    # futur exercice de confiance : l'eleve a prouve qu'il le reussit.
    if mastery == 3 and session["concept_courant"] not in session["patterns_maitrises"]:
        session["patterns_maitrises"].append(session["concept_courant"])
    return exercice


def _unlock_next_concept(session: dict) -> tuple[str, dict | None]:
    next_index = session["concept_index"] + 1
    maitrise_terminee = max(1, session["maitrise_actuelle"])
    if next_index >= len(session["concepts"]):
        session["maitrises_concepts_terminees"].append(maitrise_terminee)
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
    # La generation peut echouer : rien ne doit etre mute avant sa reussite.
    exercice = _generate_next_exercise(session, next_concept)
    session["maitrises_concepts_terminees"].append(maitrise_terminee)
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


def _apply_confidence_evaluation(session: dict, exercice: dict, reponse: str) -> dict:
    """Evalue l'aparte de confiance.

    Un aparte ne touche a RIEN de la progression : ni maitrise du concept en
    cours, ni chaine parfaite, ni fenetre de decouragement. Un echec laisse
    simplement l'exercice en place (reessai illimite, comme ailleurs).
    """
    result = compare_reponse(reponse, exercice["reponse_attendue"])
    response = {
        "session_id": session["session_id"],
        "exercice_id": exercice["id"],
        "niveau": session["niveau_scolaire"],
        **result,
    }

    if not result["correct"]:
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
    session["exercice_confiance"] = None
    response["statut"] = "confiance_reussie"
    response["progression"] = _progression_payload(session)
    exercice_normal = EXERCICE_CACHE.get(session["exercice_id_courant"])
    if exercice_normal is not None:
        response["exercice_suivant"] = exercice_normal
    return response


def _apply_session_evaluation(session: dict, exercice: dict, reponse: str) -> dict:
    confiance = session.get("exercice_confiance")
    if confiance is not None and exercice["id"] == confiance["exercice_id"]:
        return _apply_confidence_evaluation(session, exercice, reponse)

    result = compare_reponse(reponse, exercice["reponse_attendue"])
    response = {
        "session_id": session["session_id"],
        "exercice_id": exercice["id"],
        "niveau": session["niveau_scolaire"],
        **result,
    }

    if not result["correct"]:
        _record_attempt(session, False, exercice["id"])
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
        _finaliser_avec_confiance(session, response)
        return response

    session["dernier_diagnostic"] = None

    # Ces handlers peuvent lever un 503 (generation de l'exercice suivant
    # indisponible) en laissant la session intacte : la tentative n'est donc
    # enregistree qu'apres, sinon un reessai la compterait deux fois.
    if session["phase"] == "detection_maitrise":
        statut, next_exercise = _handle_detection_success(session)
    elif session["phase"] == "renforcement":
        statut, next_exercise = _handle_reinforcement_success(session)
    else:
        raise HTTPException(status_code=400, detail="Session terminee.")

    _record_attempt(session, True, exercice["id"])
    response["statut"] = statut
    if next_exercise is not None:
        response["exercice_suivant"] = next_exercise
    _finaliser_avec_confiance(session, response)
    return response


def _finaliser_avec_confiance(session: dict, response: dict) -> None:
    """Publie la progression, en glissant un aparte de confiance si besoin.

    L'insertion se fait juste avant de servir l'exercice suivant : c'est donc
    l'exercice de confiance que l'eleve joue maintenant, l'exercice normal
    restant en attente tel quel.
    """
    exercice_confiance = _maybe_inserer_confiance(session)
    if exercice_confiance is not None:
        response["exercice_suivant"] = exercice_confiance
    response["progression"] = _progression_payload(session)


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
    session = _build_session(payload.niveau_scolaire, payload.lecon_id, theme=payload.theme)
    return {
        "session_id": session["session_id"],
        "exercice": EXERCICE_CACHE[session["exercice_id_courant"]],
        "progression": _progression_payload(session),
    }


@app.post("/session/demarrer_revision")
def demarrer_session_revision(payload: RevisionStartRequest) -> dict:
    """Session de revision ciblee sur les faiblesses de l'eleve.

    Le pool de concepts vient des patterns transmis par le frontend, pas des
    lecons : l'eleve repasse exactement ses points faibles, une seule fois
    chacun, avec la meme mecanique de progression que d'habitude.
    """
    concepts = _revision_concepts(payload.niveau_scolaire, payload.patterns_cibles)
    session = _build_session(
        payload.niveau_scolaire,
        lecon_id=REVISION_LECON_ID,
        concepts=concepts,
        lecon_nom=REVISION_LECON_NOM,
        revision=True,
        theme=payload.theme,
    )
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
        # Pendant un aparte de confiance, l'aide du tuteur ne coute rien : la
        # chaine parfaite appartient au concept du parcours, pas a la pause.
        if session["exercice_confiance"] is None and session["niveau_resolution_courant"] >= 2:
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


@app.post("/synthese-vocale")
def synthese_vocale(payload: SpeechRequest) -> dict:
    """Synthese vocale neurale (Google TTS) d'un texte : reponse du tuteur ou
    enonce d'exercice. Renvoie l'audio MP3 en base64.

    En cas de panne du fournisseur (quota, cle invalide, reseau), renvoie un
    503 propre : le frontend retombe alors sur la synthese native du navigateur.
    """
    texte = payload.texte.strip()
    if not texte:
        raise HTTPException(status_code=400, detail="Le texte a lire est obligatoire.")

    profile = payload.source or tts.DEFAULT_PROFILE
    # Observe le cache AVANT l'appel : permet de confirmer cote client qu'un
    # second appel identique n'a pas resollicite l'API.
    depuis_cache = tts.is_cached(texte, profile)
    try:
        audio_base64 = tts.synthesize(texte, profile)
    except (TTSServiceError, TTSConfigurationError) as exc:
        # Panne du fournisseur OU credentials absents : dans les deux cas la
        # synthese neurale est indisponible -> 503, et le frontend retombe sur
        # la voix native du navigateur.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "audio_base64": audio_base64,
        "format": "mp3",
        "voix": tts.VOICE_NAME,
        "depuis_cache": depuis_cache,
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


@app.get("/themes")
def get_themes() -> dict:
    """Univers narratifs proposes a l'eleve (le frontend en porte l'habillage)."""
    return {"themes": themes_disponibles(), "defaut": THEME_NEUTRE}


@app.get("/generation/demo/{niveau}")
def generation_demo(niveau: str, theme: str | None = None) -> dict:
    if niveau not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Niveau invalide. Utiliser CE1 ou CE2.")

    return {
        "substitution": generer_lot(niveau, 1)[0],
        "narratif": generate_narrative_exercise(niveau, theme=_valider_theme(theme)),
    }
