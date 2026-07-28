"""Endpoints d'authentification et de gestion (enseignants, classes, eleves).

Isole du flux de jeu : ce module expose un APIRouter que main.py inclut, mais
ne touche a AUCUN endpoint existant (session/evaluation). Le mot de passe
enseignant est hashe avec bcrypt (jamais stocke en clair). Les tokens de
session sont opaques et stockes cote serveur (en memoire, comme SESSION_STATE) :
le plus simple a integrer proprement avec FastAPI.

Regles de securite :
- un enseignant n'agit que sur SES classes (verifie a chaque endpoint protege) ;
- un eleve ne peut se connecter que si son id appartient bien au code_classe
  fourni (l'id n'est jamais accepte tel quel).
"""

from __future__ import annotations

import hashlib
import io
import json
import secrets
from datetime import date, datetime, timezone
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import database
import export_excel
import notifications
from database import (
    Assignation,
    Classe,
    Ecole,
    Eleve,
    Enseignant,
    Progression,
    generer_code_classe,
)

# Content-Type officiel des classeurs .xlsx (Office Open XML).
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(tags=["comptes"])

# Une seule ecole pour l'instant (multi-tenant prepare cote schema).
ECOLE_PAR_DEFAUT = "Ecole du Parcours"
NIVEAUX = set(database.NIVEAUX_SCOLAIRES)

# --- Tokens opaques cote serveur (en memoire) ---
_TOKENS_ENSEIGNANT: dict[str, int] = {}  # token -> enseignant_id
_TOKENS_ELEVE: dict[str, int] = {}  # token -> eleve_id
_TOKENS_PARENT: dict[str, int] = {}  # token -> eleve_id (lecture seule, 1 eleve)


def _reset_tokens() -> None:
    """Utilitaire de test : vide les stores de tokens."""
    _TOKENS_ENSEIGNANT.clear()
    _TOKENS_ELEVE.clear()
    _TOKENS_PARENT.clear()


# --- Mot de passe (bcrypt) ---
def hash_mot_de_passe(mot_de_passe: str) -> str:
    return bcrypt.hashpw(mot_de_passe.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verifier_mot_de_passe(mot_de_passe: str, empreinte: str) -> bool:
    try:
        return bcrypt.checkpw(mot_de_passe.encode("utf-8"), empreinte.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- PIN eleve (4 chiffres, hache comme un mot de passe) ---
def generer_pin() -> str:
    """PIN aleatoire a 4 chiffres, ex. '0473' (les zeros de tete sont gardes)."""
    return f"{secrets.randbelow(10000):04d}"


def verifier_pin(pin: str, empreinte: str | None) -> bool:
    """Verifie un PIN contre son empreinte bcrypt. Un eleve sans PIN (empreinte
    nulle, cree avant l'ajout du PIN) ne peut jamais se connecter."""
    if not empreinte:
        return False
    return verifier_mot_de_passe(pin, empreinte)


# --- Code d'acces parent (8 caracteres, haute entropie) ---
# Alphabet sans caracteres ambigus (0/O, 1/I/L) pour la lecture/dictee au parent.
_ALPHABET_CODE_PARENT = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generer_code_parent() -> str:
    """Code d'acces parent aleatoire, ex. 'K7P2M9QT'. 8 caracteres sur un
    alphabet de 31 -> ~31^8 combinaisons : assez pour resister au devinage sur
    un endpoint public, la ou le PIN a 4 chiffres ne suffirait pas."""
    return "".join(secrets.choice(_ALPHABET_CODE_PARENT) for _ in range(8))


def hash_code_parent(code: str) -> str:
    """Empreinte SHA-256 (hex) du code parent. Deterministe -> indexable, donc
    on retrouve l'eleve a partir du seul code sans iterer sur toute la base
    (impossible avec bcrypt sale). Le code reste haché, jamais stocke en clair.
    L'entropie elevee du code (8 caracteres) rend ce hash rapide sans danger."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


# --- Dependance session BD (surchargeable en test via dependency_overrides) ---
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- Dependance : enseignant connecte (via token Bearer) ---
_bearer = HTTPBearer(auto_error=False)


def enseignant_courant(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> Enseignant:
    token = creds.credentials if creds else None
    enseignant_id = _TOKENS_ENSEIGNANT.get(token) if token else None
    if enseignant_id is None:
        raise HTTPException(status_code=401, detail="Authentification enseignant requise.")
    enseignant = db.get(Enseignant, enseignant_id)
    if enseignant is None:
        # Token pointant vers un enseignant supprime : session invalide.
        _TOKENS_ENSEIGNANT.pop(token, None)
        raise HTTPException(status_code=401, detail="Session enseignant invalide.")
    return enseignant


def eleve_id_depuis_token(token: str | None) -> int | None:
    """Resout un token eleve en eleve_id (ou None si absent/inconnu)."""
    return _TOKENS_ELEVE.get(token) if token else None


def eleve_id_optionnel(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> int | None:
    """Dependance OPTIONNELLE : renvoie l'eleve_id si un token eleve valide est
    fourni, sinon None (mode invite). Ne leve jamais : le flux invite reste
    inchange en l'absence de token.

    NB : un token PARENT n'est PAS un token eleve -> il renvoie None ici, donc il
    ne peut jamais lier une session de jeu a un eleve (aucune ecriture possible)."""
    return eleve_id_depuis_token(creds.credentials if creds else None)


def parent_eleve_courant(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> Eleve:
    """Dependance : eleve suivi par le parent connecte (via son token parent).

    Le token parent est en lecture seule et strictement limite a UN eleve : il
    n'ouvre aucun autre endpoint (ni gestion de classe, ni autres eleves)."""
    token = creds.credentials if creds else None
    eleve_id = _TOKENS_PARENT.get(token) if token else None
    if eleve_id is None:
        raise HTTPException(status_code=401, detail="Acces parent requis.")
    eleve = db.get(Eleve, eleve_id)
    if eleve is None:
        # Eleve supprime entre-temps : le token ne vaut plus rien.
        _TOKENS_PARENT.pop(token, None)
        raise HTTPException(status_code=401, detail="Acces parent invalide.")
    return eleve


# --- Schemas ---
class EnseignantInscription(BaseModel):
    nom: str = Field(min_length=1, max_length=120)
    identifiant: str = Field(min_length=3, max_length=80)
    mot_de_passe: str = Field(min_length=6, max_length=128)
    ecole: str | None = Field(default=None, max_length=120)


class EnseignantConnexion(BaseModel):
    identifiant: str
    mot_de_passe: str


class ClasseCreation(BaseModel):
    nom: str = Field(min_length=1, max_length=120)
    niveau_scolaire: str


class EleveCreation(BaseModel):
    prenom: str = Field(min_length=1, max_length=80)


class EleveConnexion(BaseModel):
    code_classe: str
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")


class AssignationCreation(BaseModel):
    eleve_ids: list[int] = Field(min_length=1)
    lecon_id: str | None = None
    patterns: list[str] | None = None


# --- Helpers ---
def _classe_dict(classe: Classe, nb_eleves: int | None = None) -> dict:
    infos = {
        "id": classe.id,
        "nom": classe.nom,
        "niveau_scolaire": classe.niveau_scolaire,
        "code_classe": classe.code_classe,
    }
    if nb_eleves is not None:
        infos["nb_eleves"] = nb_eleves
    return infos


def _ecole_courante(db: Session, nom: str | None) -> Ecole:
    """Renvoie l'unique ecole, la creant au besoin (une seule pour l'instant)."""
    ecole = db.scalars(select(Ecole).limit(1)).first()
    if ecole is None:
        ecole = Ecole(nom=nom or ECOLE_PAR_DEFAUT)
        db.add(ecole)
        db.flush()
    return ecole


def _classe_de_l_enseignant(db: Session, classe_id: int, enseignant: Enseignant) -> Classe:
    """Recupere une classe en garantissant qu'elle appartient a l'enseignant."""
    classe = db.get(Classe, classe_id)
    if classe is None:
        raise HTTPException(status_code=404, detail="Classe introuvable.")
    if classe.enseignant_id != enseignant.id:
        raise HTTPException(status_code=403, detail="Cette classe ne vous appartient pas.")
    return classe


def _progression_payload(db: Session, eleve: Eleve) -> dict:
    """Progression complete d'un eleve, format commun a la vue eleve, enseignant
    et parent (une seule source de verite pour la structure renvoyee)."""
    lignes = db.scalars(
        select(Progression)
        .where(Progression.eleve_id == eleve.id)
        .order_by(Progression.lecon_id, Progression.pattern_name)
    ).all()
    return {
        "eleve": {
            "id": eleve.id,
            "prenom": eleve.prenom,
            "niveau_scolaire": eleve.classe.niveau_scolaire,
        },
        "progression": [
            {
                "pattern_name": p.pattern_name,
                "lecon_id": p.lecon_id,
                "maitrise": p.maitrise,
                "date_derniere_tentative": p.date_derniere_tentative.isoformat(),
            }
            for p in lignes
        ],
    }


# ============================================================
#  ENSEIGNANT : inscription / connexion
# ============================================================
@router.post("/enseignant/inscription", status_code=201)
def inscription_enseignant(
    payload: EnseignantInscription, db: Annotated[Session, Depends(get_db)]
) -> dict:
    deja = db.scalars(
        select(Enseignant).where(Enseignant.identifiant == payload.identifiant)
    ).first()
    if deja is not None:
        raise HTTPException(status_code=409, detail="Cet identifiant est deja pris.")

    ecole = _ecole_courante(db, payload.ecole)
    enseignant = Enseignant(
        ecole=ecole,
        nom=payload.nom,
        identifiant=payload.identifiant,
        mot_de_passe_hash=hash_mot_de_passe(payload.mot_de_passe),
    )
    db.add(enseignant)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cet identifiant est deja pris.")
    db.refresh(enseignant)
    return {
        "id": enseignant.id,
        "nom": enseignant.nom,
        "identifiant": enseignant.identifiant,
        "ecole_id": ecole.id,
    }


@router.post("/enseignant/connexion")
def connexion_enseignant(
    payload: EnseignantConnexion, db: Annotated[Session, Depends(get_db)]
) -> dict:
    enseignant = db.scalars(
        select(Enseignant).where(Enseignant.identifiant == payload.identifiant)
    ).first()
    if enseignant is None or not verifier_mot_de_passe(
        payload.mot_de_passe, enseignant.mot_de_passe_hash
    ):
        # Message identique dans les deux cas : ne pas reveler quel identifiant existe.
        raise HTTPException(status_code=401, detail="Identifiant ou mot de passe incorrect.")

    token = secrets.token_urlsafe(32)
    _TOKENS_ENSEIGNANT[token] = enseignant.id
    return {"token": token, "enseignant": {"id": enseignant.id, "nom": enseignant.nom}}


# ============================================================
#  CLASSES (protege : enseignant connecte)
# ============================================================
@router.post("/classe", status_code=201)
def creer_classe(
    payload: ClasseCreation,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    if payload.niveau_scolaire not in NIVEAUX:
        raise HTTPException(status_code=400, detail="Niveau scolaire invalide (CE1 a CE6).")

    # Code de classe unique : on retente en cas de collision (rare).
    for _ in range(25):
        classe = Classe(
            enseignant_id=enseignant.id,
            nom=payload.nom,
            niveau_scolaire=payload.niveau_scolaire,
            code_classe=generer_code_classe(payload.niveau_scolaire),
        )
        db.add(classe)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        db.refresh(classe)
        return _classe_dict(classe)
    raise HTTPException(status_code=500, detail="Impossible de generer un code de classe unique.")


@router.get("/classe")
def lister_classes(
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    classes = db.scalars(
        select(Classe).where(Classe.enseignant_id == enseignant.id).order_by(Classe.date_creation)
    ).all()
    # nb_eleves permet au tableau de bord d'afficher l'effectif sans un appel
    # par classe (le code_classe reste la donnee a partager, mise en avant).
    return {
        "classes": [
            _classe_dict(
                c,
                nb_eleves=db.scalar(
                    select(func.count()).select_from(Eleve).where(Eleve.classe_id == c.id)
                ),
            )
            for c in classes
        ]
    }


@router.get("/classe/{classe_id}/eleves")
def lister_eleves(
    classe_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Eleves d'une classe pour la vue detaillee du tableau de bord (prenom et
    date d'ajout). Protege : la classe doit appartenir a l'enseignant connecte.
    Distinct de /classe/rejoindre (public, cote eleve, sans dates)."""
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleves = db.scalars(
        select(Eleve).where(Eleve.classe_id == classe.id).order_by(Eleve.date_creation, Eleve.prenom)
    ).all()
    return {
        "classe": _classe_dict(classe),
        "eleves": [
            {"id": e.id, "prenom": e.prenom, "date_creation": e.date_creation.isoformat()}
            for e in eleves
        ],
    }


@router.post("/classe/{classe_id}/eleve", status_code=201)
def ajouter_eleve(
    classe_id: int,
    payload: EleveCreation,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    # PIN et code parent generes ici et renvoyes en clair UNE SEULE FOIS : seuls
    # leurs hash sont stockes. L'enseignant note le PIN pour l'eleve, et le code
    # parent pour le parent (suivi en lecture seule).
    pin = generer_pin()
    code_parent = generer_code_parent()
    eleve = Eleve(
        classe_id=classe.id,
        prenom=payload.prenom,
        pin_hash=hash_mot_de_passe(pin),
        code_parent_hash=hash_code_parent(code_parent),
    )
    db.add(eleve)
    db.commit()
    db.refresh(eleve)
    return {
        "id": eleve.id,
        "prenom": eleve.prenom,
        "classe_id": classe.id,
        "pin": pin,
        "code_parent": code_parent,
    }


@router.post("/classe/{classe_id}/eleve/{eleve_id}/reinitialiser_pin")
def reinitialiser_pin_eleve(
    classe_id: int,
    eleve_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Regenere le PIN d'un eleve (protege : proprietaire de la classe).

    On ne peut PAS reveler l'ancien PIN (seul son hash est stocke) : on le
    remplace par un nouveau, renvoye en clair UNE SEULE FOIS, exactement comme
    a la creation. L'ancien PIN cesse aussitot de fonctionner.
    """
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleve = db.get(Eleve, eleve_id)
    if eleve is None or eleve.classe_id != classe.id:
        raise HTTPException(status_code=404, detail="Eleve introuvable dans cette classe.")
    pin = generer_pin()
    eleve.pin_hash = hash_mot_de_passe(pin)
    db.commit()
    return {"id": eleve.id, "prenom": eleve.prenom, "classe_id": classe.id, "pin": pin}


@router.post("/classe/{classe_id}/eleve/{eleve_id}/code_parent")
def regenerer_code_parent(
    classe_id: int,
    eleve_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """(Re)genere le code d'acces parent d'un eleve (protege : proprietaire).

    Le code n'etant jamais stocke en clair, on ne peut pas le "reafficher" : on
    en genere un nouveau, renvoye en clair UNE SEULE FOIS. L'ancien code cesse
    aussitot de donner acces au suivi.
    """
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleve = db.get(Eleve, eleve_id)
    if eleve is None or eleve.classe_id != classe.id:
        raise HTTPException(status_code=404, detail="Eleve introuvable dans cette classe.")
    code_parent = generer_code_parent()
    eleve.code_parent_hash = hash_code_parent(code_parent)
    db.commit()
    return {
        "id": eleve.id,
        "prenom": eleve.prenom,
        "classe_id": classe.id,
        "code_parent": code_parent,
    }


@router.delete("/classe/{classe_id}/eleve/{eleve_id}", status_code=204, response_class=Response)
def retirer_eleve(
    classe_id: int,
    eleve_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleve = db.get(Eleve, eleve_id)
    if eleve is None or eleve.classe_id != classe.id:
        raise HTTPException(status_code=404, detail="Eleve introuvable dans cette classe.")
    db.delete(eleve)
    db.commit()
    return Response(status_code=204)


# ============================================================
#  TABLEAU DE BORD ENSEIGNANT (vue d'ensemble d'une classe)
# ============================================================
@router.get("/classe/{classe_id}/tableau_de_bord")
def tableau_de_bord(
    classe_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Vue d'ensemble de la classe : pour chaque eleve, les concepts traverses
    et un decompte par niveau de maitrise (memes seuils que le bilan eleve :
    3 = acquis, 2 = en bonne voie, 1 = a retravailler). Permet a l'enseignant
    de reperer d'un coup d'oeil qui maitrise quoi, sans ouvrir chaque eleve."""
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleves = db.scalars(
        select(Eleve).where(Eleve.classe_id == classe.id).order_by(Eleve.prenom)
    ).all()
    lignes = db.scalars(
        select(Progression)
        .join(Eleve, Progression.eleve_id == Eleve.id)
        .where(Eleve.classe_id == classe.id)
        .order_by(Progression.lecon_id, Progression.pattern_name)
    ).all()

    par_eleve: dict[int, list[Progression]] = {}
    for p in lignes:
        par_eleve.setdefault(p.eleve_id, []).append(p)

    def _resume(eleve: Eleve) -> dict:
        concepts = par_eleve.get(eleve.id, [])
        return {
            "id": eleve.id,
            "prenom": eleve.prenom,
            "concepts": [
                {
                    "pattern_name": p.pattern_name,
                    "lecon_id": p.lecon_id,
                    "maitrise": p.maitrise,
                    "date_derniere_tentative": p.date_derniere_tentative.isoformat(),
                }
                for p in concepts
            ],
            "nb_acquis": sum(1 for p in concepts if p.maitrise == 3),
            "nb_en_cours": sum(1 for p in concepts if p.maitrise == 2),
            "nb_a_retravailler": sum(1 for p in concepts if p.maitrise == 1),
            "nb_total": len(concepts),
        }

    return {"classe": _classe_dict(classe), "eleves": [_resume(e) for e in eleves]}


@router.get("/classe/{classe_id}/concepts_difficiles")
def concepts_difficiles(
    classe_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Concepts qui bloquent le plus a l'echelle de la classe : pour chaque
    concept, le nombre d'eleves encore en maitrise 1. Trie du plus problematique
    au moins, pour savoir quoi retravailler collectivement."""
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    rows = db.execute(
        select(
            Progression.pattern_name,
            func.min(Progression.lecon_id).label("lecon_id"),
            func.count().label("nb"),
        )
        .join(Eleve, Progression.eleve_id == Eleve.id)
        .where(Eleve.classe_id == classe.id, Progression.maitrise == 1)
        .group_by(Progression.pattern_name)
        .order_by(func.count().desc(), Progression.pattern_name)
    ).all()
    return {
        "concepts": [
            {
                "pattern_name": r.pattern_name,
                "lecon_id": r.lecon_id,
                "nb_eleves_en_difficulte": r.nb,
            }
            for r in rows
        ]
    }


def _concepts_par_eleve(db: Session, classe: Classe) -> list[dict]:
    """Pour chaque eleve de la classe, la liste de ses concepts traverses.
    Meme donnee que le tableau de bord, reutilisee pour l'export Excel."""
    eleves = db.scalars(
        select(Eleve).where(Eleve.classe_id == classe.id).order_by(Eleve.prenom)
    ).all()
    lignes = db.scalars(
        select(Progression)
        .join(Eleve, Progression.eleve_id == Eleve.id)
        .where(Eleve.classe_id == classe.id)
        .order_by(Progression.lecon_id, Progression.pattern_name)
    ).all()
    par_eleve: dict[int, list[Progression]] = {}
    for p in lignes:
        par_eleve.setdefault(p.eleve_id, []).append(p)
    return [
        {
            "id": e.id,
            "prenom": e.prenom,
            "concepts": [
                {
                    "pattern_name": p.pattern_name,
                    "lecon_id": p.lecon_id,
                    "maitrise": p.maitrise,
                    "date_derniere_tentative": p.date_derniere_tentative.isoformat(),
                }
                for p in par_eleve.get(e.id, [])
            ],
        }
        for e in eleves
    ]


@router.get("/classe/{classe_id}/export_excel")
def export_excel_classe(
    classe_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    """Exporte la progression de la classe en Excel (protege : proprietaire).

    Le classeur (feuilles "Vue d'ensemble" et "Detail") est genere a la volee en
    memoire et renvoye directement : aucun fichier n'est stocke sur le serveur."""
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleves = _concepts_par_eleve(db, classe)
    classeur = export_excel.construire_classeur(
        {
            "nom": classe.nom,
            "niveau_scolaire": classe.niveau_scolaire,
            "code_classe": classe.code_classe,
        },
        eleves,
    )
    flux = io.BytesIO()
    classeur.save(flux)
    flux.seek(0)
    nom_fichier = f"classe_{classe.code_classe}_export_{date.today().isoformat()}.xlsx"
    return StreamingResponse(
        flux,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{nom_fichier}"'},
    )


# ============================================================
#  ASSIGNATIONS : l'enseignant assigne un travail a ses eleves
# ============================================================
def _assignation_dict(a: Assignation, prenom: str | None = None) -> dict:
    infos = {
        "id": a.id,
        "eleve_id": a.eleve_id,
        "type": "revision" if a.patterns else "lecon",
        "lecon_id": a.lecon_id,
        "patterns": json.loads(a.patterns) if a.patterns else None,
        "terminee": a.terminee,
        "date_assignation": a.date_assignation.isoformat(),
        "date_completion": a.date_completion.isoformat() if a.date_completion else None,
    }
    if prenom is not None:
        infos["prenom"] = prenom
    return infos


def marquer_assignations_terminees(
    db: Session,
    eleve_id: int,
    lecon_id: str | None,
    concepts: list[str],
    est_revision: bool,
) -> None:
    """Marque comme terminees les assignations en attente de l'eleve que la
    session qui vient de s'achever satisfait. Appelee par main.py a la fin d'une
    session liee. NE COMMIT PAS : l'appelant gere la transaction.

    - session de lecon -> satisfait les assignations de meme lecon_id ;
    - session de revision -> satisfait les assignations dont tous les patterns
      cibles ont ete couverts par la session."""
    en_attente = db.scalars(
        select(Assignation).where(
            Assignation.eleve_id == eleve_id, Assignation.terminee.is_(False)
        )
    ).all()
    concepts_vus = set(concepts or [])
    maintenant = datetime.now(timezone.utc)
    for a in en_attente:
        if est_revision and a.patterns:
            cibles = set(json.loads(a.patterns))
            satisfait = bool(cibles) and cibles.issubset(concepts_vus)
        elif not est_revision and a.lecon_id is not None:
            satisfait = a.lecon_id == lecon_id
        else:
            satisfait = False
        if satisfait:
            a.terminee = True
            a.date_completion = maintenant


@router.post("/classe/{classe_id}/assigner", status_code=201)
def assigner_travail(
    classe_id: int,
    payload: AssignationCreation,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Assigne une lecon OU une revision ciblee (patterns) a un ou plusieurs
    eleves de la classe. Protege : proprietaire, et les eleves vises doivent
    tous appartenir a la classe (cloisonnement)."""
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    a_lecon = bool(payload.lecon_id)
    a_patterns = bool(payload.patterns)
    if a_lecon == a_patterns:
        raise HTTPException(
            status_code=400,
            detail="Fournir soit une lecon, soit une liste de concepts (exactement l'un des deux).",
        )
    # Deduplication en gardant l'ordre ; tous les eleves doivent etre de la classe.
    eleve_ids = list(dict.fromkeys(payload.eleve_ids))
    presents = db.scalars(
        select(Eleve.id).where(Eleve.id.in_(eleve_ids), Eleve.classe_id == classe.id)
    ).all()
    if set(presents) != set(eleve_ids):
        raise HTTPException(
            status_code=400, detail="Un ou plusieurs eleves n'appartiennent pas a cette classe."
        )

    patterns_json = json.dumps(payload.patterns) if a_patterns else None
    creees = []
    for eid in eleve_ids:
        assignation = Assignation(
            eleve_id=eid,
            assignee_par=enseignant.id,
            lecon_id=payload.lecon_id,
            patterns=patterns_json,
        )
        db.add(assignation)
        creees.append(assignation)
    db.commit()
    for a in creees:
        db.refresh(a)
    return {"assignations": [_assignation_dict(a) for a in creees]}


@router.get("/classe/{classe_id}/assignations")
def lister_assignations_classe(
    classe_id: int,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Statut de toutes les assignations de la classe (qui a termine, qui pas
    encore). Protege : proprietaire de la classe."""
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    rows = db.scalars(
        select(Assignation)
        .join(Eleve, Assignation.eleve_id == Eleve.id)
        .where(Eleve.classe_id == classe.id)
        .order_by(Assignation.date_assignation.desc(), Assignation.id.desc())
    ).all()
    prenoms = {
        e.id: e.prenom
        for e in db.scalars(select(Eleve).where(Eleve.classe_id == classe.id)).all()
    }
    return {
        "assignations": [_assignation_dict(a, prenom=prenoms.get(a.eleve_id, "")) for a in rows]
    }


# ============================================================
#  ELEVE : entree publique par code de classe, puis connexion
# ============================================================
@router.get("/classe/rejoindre/{code_classe}")
def rejoindre_classe(code_classe: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    classe = db.scalars(select(Classe).where(Classe.code_classe == code_classe)).first()
    if classe is None:
        raise HTTPException(status_code=404, detail="Aucune classe ne correspond a ce code.")
    eleves = db.scalars(
        select(Eleve).where(Eleve.classe_id == classe.id).order_by(Eleve.prenom)
    ).all()
    return {
        "classe": {
            "id": classe.id,
            "nom": classe.nom,
            "niveau_scolaire": classe.niveau_scolaire,
            "code_classe": classe.code_classe,
        },
        "eleves": [{"id": e.id, "prenom": e.prenom} for e in eleves],
    }


@router.post("/eleve/{eleve_id}/connexion")
def connexion_eleve(
    eleve_id: int, payload: EleveConnexion, db: Annotated[Session, Depends(get_db)]
) -> dict:
    eleve = db.get(Eleve, eleve_id)
    # Anti-usurpation : l'id doit appartenir a la classe du code fourni ET le PIN
    # doit correspondre. Meme 403 pour "id inconnu", "mauvais code" et "mauvais
    # PIN" (pas d'enumeration : on ne revele pas laquelle des conditions echoue).
    if (
        eleve is None
        or eleve.classe.code_classe != payload.code_classe
        or not verifier_pin(payload.pin, eleve.pin_hash)
    ):
        raise HTTPException(status_code=403, detail="Eleve, code de classe ou code secret invalide.")

    token = secrets.token_urlsafe(32)
    _TOKENS_ELEVE[token] = eleve.id
    return {
        "token": token,
        "eleve": {
            "id": eleve.id,
            "prenom": eleve.prenom,
            "classe_id": eleve.classe_id,
            "niveau_scolaire": eleve.classe.niveau_scolaire,
        },
    }


@router.get("/eleve/{eleve_id}/progression")
def progression_eleve(
    eleve_id: int,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Progression complete d'un eleve (equivalent BD du carnet d'aventurier).

    Accessible par l'eleve lui-meme (son token) OU par l'enseignant de sa
    classe (son token). Toute autre demande est refusee (403).
    """
    eleve = db.get(Eleve, eleve_id)
    if eleve is None:
        raise HTTPException(status_code=404, detail="Eleve introuvable.")

    token = creds.credentials if creds else None
    autorise = False
    if token and _TOKENS_ELEVE.get(token) == eleve_id:
        autorise = True  # l'eleve consulte sa propre progression
    elif token and token in _TOKENS_ENSEIGNANT:
        # l'enseignant ne voit que les eleves de SES classes
        autorise = eleve.classe.enseignant_id == _TOKENS_ENSEIGNANT[token]
    if not autorise:
        raise HTTPException(status_code=403, detail="Acces non autorise a cette progression.")

    return _progression_payload(db, eleve)


@router.get("/eleve/{eleve_id}/assignations")
def assignations_eleve(
    eleve_id: int,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Assignations EN ATTENTE d'un eleve (terminee=false).

    Accessible par l'eleve lui-meme (son token) OU par l'enseignant de sa classe.
    Un eleve ne voit donc que ses propres assignations."""
    eleve = db.get(Eleve, eleve_id)
    if eleve is None:
        raise HTTPException(status_code=404, detail="Eleve introuvable.")

    token = creds.credentials if creds else None
    autorise = False
    if token and _TOKENS_ELEVE.get(token) == eleve_id:
        autorise = True
    elif token and token in _TOKENS_ENSEIGNANT:
        autorise = eleve.classe.enseignant_id == _TOKENS_ENSEIGNANT[token]
    if not autorise:
        raise HTTPException(status_code=403, detail="Acces non autorise a ces assignations.")

    rows = db.scalars(
        select(Assignation)
        .where(Assignation.eleve_id == eleve_id, Assignation.terminee.is_(False))
        .order_by(Assignation.date_assignation.desc(), Assignation.id.desc())
    ).all()
    return {
        "eleve": {
            "id": eleve.id,
            "prenom": eleve.prenom,
            "niveau_scolaire": eleve.classe.niveau_scolaire,
        },
        "assignations": [_assignation_dict(a) for a in rows],
    }


# ============================================================
#  PARENT : acces en lecture seule au suivi d'UN eleve
# ============================================================
@router.get("/parent/acces/{code_parent}")
def acces_parent(code_parent: str, db: Annotated[Session, Depends(get_db)]) -> dict:
    """Entree publique du portail parent : echange le code d'acces contre un
    token parent limite a cet eleve (lecture seule). Recherche directe par le
    hash du code (indexe). Meme 403 si le code est inconnu (pas d'enumeration)."""
    empreinte = hash_code_parent(code_parent)
    eleve = db.scalars(select(Eleve).where(Eleve.code_parent_hash == empreinte)).first()
    if eleve is None:
        raise HTTPException(status_code=403, detail="Code d'acces parent invalide.")

    token = secrets.token_urlsafe(32)
    _TOKENS_PARENT[token] = eleve.id
    return {
        "token": token,
        "eleve": {
            "id": eleve.id,
            "prenom": eleve.prenom,
            "niveau_scolaire": eleve.classe.niveau_scolaire,
        },
    }


@router.get("/parent/progression")
def progression_parent(
    eleve: Annotated[Eleve, Depends(parent_eleve_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Progression de l'enfant suivi par le parent connecte (lecture seule).

    Meme structure que GET /eleve/{id}/progression, mais l'eleve est deduit du
    token parent (jamais fourni dans l'URL) : le parent ne peut voir que SON
    enfant. Aucun droit d'ecriture n'est attache a ce token."""
    return _progression_payload(db, eleve)


@router.get("/parent/notifications")
def notifications_parent(
    eleve: Annotated[Eleve, Depends(parent_eleve_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Resume hebdomadaire et alertes de blocage pour l'enfant suivi (lecture
    seule). Protege par le meme token parent que /parent/progression : l'eleve
    est deduit du token, jamais de l'URL. Le contenu est genere par regles a
    partir de la progression deja suivie (aucun email n'est encore envoye : le
    parent le consulte ici)."""
    return {
        "eleve": {
            "id": eleve.id,
            "prenom": eleve.prenom,
            "niveau_scolaire": eleve.classe.niveau_scolaire,
        },
        "resume": notifications.generer_resume_hebdomadaire(db, eleve.id),
        "alerte": notifications.detecter_alerte_blocage(db, eleve.id),
    }
