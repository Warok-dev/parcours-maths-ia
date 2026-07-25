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

import secrets
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import database
from database import Classe, Ecole, Eleve, Enseignant, Progression, generer_code_classe

router = APIRouter(tags=["comptes"])

# Une seule ecole pour l'instant (multi-tenant prepare cote schema).
ECOLE_PAR_DEFAUT = "Ecole du Parcours"
NIVEAUX = set(database.NIVEAUX_SCOLAIRES)

# --- Tokens opaques cote serveur (en memoire) ---
_TOKENS_ENSEIGNANT: dict[str, int] = {}  # token -> enseignant_id
_TOKENS_ELEVE: dict[str, int] = {}  # token -> eleve_id


def _reset_tokens() -> None:
    """Utilitaire de test : vide les stores de tokens."""
    _TOKENS_ENSEIGNANT.clear()
    _TOKENS_ELEVE.clear()


# --- Mot de passe (bcrypt) ---
def hash_mot_de_passe(mot_de_passe: str) -> str:
    return bcrypt.hashpw(mot_de_passe.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verifier_mot_de_passe(mot_de_passe: str, empreinte: str) -> bool:
    try:
        return bcrypt.checkpw(mot_de_passe.encode("utf-8"), empreinte.encode("utf-8"))
    except (ValueError, TypeError):
        return False


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
    inchange en l'absence de token."""
    return eleve_id_depuis_token(creds.credentials if creds else None)


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


# --- Helpers ---
def _classe_dict(classe: Classe) -> dict:
    return {
        "id": classe.id,
        "nom": classe.nom,
        "niveau_scolaire": classe.niveau_scolaire,
        "code_classe": classe.code_classe,
    }


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
    return {"classes": [_classe_dict(c) for c in classes]}


@router.post("/classe/{classe_id}/eleve", status_code=201)
def ajouter_eleve(
    classe_id: int,
    payload: EleveCreation,
    enseignant: Annotated[Enseignant, Depends(enseignant_courant)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    classe = _classe_de_l_enseignant(db, classe_id, enseignant)
    eleve = Eleve(classe_id=classe.id, prenom=payload.prenom)
    db.add(eleve)
    db.commit()
    db.refresh(eleve)
    return {"id": eleve.id, "prenom": eleve.prenom, "classe_id": classe.id}


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
    # Anti-usurpation : l'id doit appartenir a la classe du code fourni. On
    # renvoie le meme 403 pour "id inconnu" et "mauvais code" (pas d'enumeration).
    if eleve is None or eleve.classe.code_classe != payload.code_classe:
        raise HTTPException(status_code=403, detail="Eleve ou code de classe invalide.")

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

    lignes = db.scalars(
        select(Progression)
        .where(Progression.eleve_id == eleve_id)
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
