"""Programme de classe : ouvrir les concepts au rythme de la classe.

Une classe qui suit le programme (ProgrammeClasse.actif) ne donne a ses
eleves que les concepts que l'enseignant a ouverts (ConceptOuvert). Le
calendrier du ministere (data/programme.json : periode 4, semaine par
semaine) PROPOSE l'ordre et le concept suivant ; l'enseignant VALIDE d'un clic,
et peut aussi ouvrir plus loin ou refermer.

Une classe sans ligne ProgrammeClasse (classes creees avant cette fonction)
reste en acces libre : toutes les lecons de son niveau, comme avant.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from database import Classe, ConceptOuvert, ProgrammeClasse

PROGRAMME_PATH = Path(__file__).resolve().parent / "data" / "programme.json"
LESSONS_PATH = Path(__file__).resolve().parent / "data" / "lessons.json"


@lru_cache(maxsize=1)
def _programme() -> dict:
    return json.loads(PROGRAMME_PATH.read_text(encoding="utf-8"))["niveaux"]


@lru_cache(maxsize=1)
def _lecons() -> list[dict]:
    return json.loads(LESSONS_PATH.read_text(encoding="utf-8"))["lessons"]


def lecon_du_concept(pattern: str) -> dict | None:
    """La lecon qui porte ce concept (un concept n'est que dans une lecon par
    niveau : verifie par generation/test_programme_p4.py)."""
    for lecon in _lecons():
        if pattern in lecon["patterns"]:
            return lecon
    return None


def ordre_du_niveau(niveau: str) -> list[dict]:
    """[{pattern, semaine}] dans l'ordre du calendrier (semaine None = hors
    calendrier, en fin de liste)."""
    return [dict(item) for item in _programme().get(niveau, [])]


def suit_le_programme(db: Session, classe_id: int) -> bool:
    ligne = db.get(ProgrammeClasse, classe_id)
    return bool(ligne and ligne.actif)


def concepts_ouverts(db: Session, classe_id: int) -> dict[str, object]:
    """pattern_name -> date d'ouverture, pour une classe."""
    lignes = db.scalars(select(ConceptOuvert).where(ConceptOuvert.classe_id == classe_id)).all()
    return {ligne.pattern_name: ligne.date_ouverture for ligne in lignes}


def filtre_eleve(db: Session, classe: Classe | None) -> set[str] | None:
    """Concepts autorises pour un eleve de cette classe, ou None si la
    classe est en acces libre (pas de filtre)."""
    if classe is None or not suit_le_programme(db, classe.id):
        return None
    return set(concepts_ouverts(db, classe.id))


def prochain_concept(niveau: str, ouverts: set[str]) -> dict | None:
    """Le concept que le calendrier propose d'ouvrir : le premier, dans
    l'ordre du programme, qui n'est pas encore ouvert."""
    for item in ordre_du_niveau(niveau):
        if item["pattern"] not in ouverts:
            return item
    return None


def activer(db: Session, classe: Classe, actif: bool) -> None:
    """Active (ou coupe) le suivi du programme. A la premiere activation, le
    premier concept du calendrier est ouvert : la classe a de quoi jouer des
    le premier jour."""
    ligne = db.get(ProgrammeClasse, classe.id)
    premiere_fois = ligne is None
    if ligne is None:
        ligne = ProgrammeClasse(classe_id=classe.id, actif=actif)
        db.add(ligne)
    else:
        ligne.actif = actif
    db.flush()
    if actif and premiere_fois and not concepts_ouverts(db, classe.id):
        premier = prochain_concept(classe.niveau_scolaire, set())
        if premier is not None:
            ouvrir(db, classe, [premier["pattern"]])


def _valider(niveau: str, patterns: list[str]) -> list[str]:
    connus = {item["pattern"] for item in ordre_du_niveau(niveau)}
    inconnus = [p for p in patterns if p not in connus]
    if inconnus:
        raise ValueError(f"Concepts inconnus pour {niveau} : {', '.join(inconnus)}")
    return list(dict.fromkeys(patterns))


def ouvrir(db: Session, classe: Classe, patterns: list[str]) -> list[str]:
    patterns = _valider(classe.niveau_scolaire, patterns)
    deja = set(concepts_ouverts(db, classe.id))
    nouveaux = [p for p in patterns if p not in deja]
    for p in nouveaux:
        db.add(ConceptOuvert(classe_id=classe.id, pattern_name=p))
    db.flush()
    return nouveaux


def fermer(db: Session, classe: Classe, patterns: list[str]) -> None:
    patterns = _valider(classe.niveau_scolaire, patterns)
    db.execute(
        delete(ConceptOuvert).where(
            ConceptOuvert.classe_id == classe.id, ConceptOuvert.pattern_name.in_(patterns)
        )
    )
    db.flush()


def etat(db: Session, classe: Classe, libelle) -> dict:
    """Vue du programme pour l'enseignant : chaque concept dans l'ordre du
    calendrier, ouvert ou non, et le prochain propose."""
    ouverts = concepts_ouverts(db, classe.id)
    concepts = []
    for item in ordre_du_niveau(classe.niveau_scolaire):
        date = ouverts.get(item["pattern"])
        lecon = lecon_du_concept(item["pattern"])
        concepts.append(
            {
                "pattern": item["pattern"],
                "libelle": libelle(item["pattern"]),
                "semaine": item["semaine"],
                "lecon_id": lecon["lecon_id"] if lecon else None,
                "lecon_nom": lecon["nom"] if lecon else None,
                "ouvert": date is not None,
                "date_ouverture": date.isoformat() if date is not None else None,
            }
        )
    prochain = prochain_concept(classe.niveau_scolaire, set(ouverts))
    return {
        "classe_id": classe.id,
        "niveau_scolaire": classe.niveau_scolaire,
        "actif": suit_le_programme(db, classe.id),
        "nb_ouverts": sum(1 for c in concepts if c["ouvert"]),
        "concepts": concepts,
        "prochain": (
            {
                "pattern": prochain["pattern"],
                "libelle": libelle(prochain["pattern"]),
                "semaine": prochain["semaine"],
            }
            if prochain
            else None
        ),
    }
