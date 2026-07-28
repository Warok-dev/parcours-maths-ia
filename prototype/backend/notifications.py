"""Resume hebdomadaire et alerte de blocage a destination du parent.

Ce module NE fait pas d'envoi reel : il GENERE le contenu des notifications a
partir des donnees deja suivies (table Progression), par regles simples (aucun
LLM), dans le meme esprit que le bilan de session cote eleve. Le contenu est
consultable dans le portail parent (endpoint GET /parent/notifications).

Point d'injection pour un vrai envoi plus tard : `envoyer_email` est un STUB
qui se contente de logger. Le jour ou l'on branche un vrai service (SendGrid,
SMTP, ...), il suffit de remplacer le corps de cette seule fonction ; tout le
reste (generation du contenu, composition du message) est deja en place et
reutilisable tel quel via `envoyer_resume_hebdomadaire`.

Regles de datation : la BD SQLite renvoie des datetimes naifs meme pour des
colonnes timezone=True. On les normalise en UTC avant toute comparaison, pour
ne jamais melanger naif et aware.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from database import Eleve, Progression

logger = logging.getLogger("notifications")

# --- Parametres (regles), regroupes pour etre lisibles/ajustables ---
FENETRE_RESUME_JOURS = 7  # "cette semaine" = 7 derniers jours
SEUIL_STAGNATION_JOURS = 5  # actif mais aucune nouvelle maitrise 3 depuis N jours
SEUIL_TENTATIVES_BLOCAGE = 3  # concept encore a 1 apres N tentatives -> bloque
MAITRISE_ACQUISE = 3
MAITRISE_A_RETRAVAILLER = 1


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _en_utc(dt: datetime) -> datetime:
    """Normalise un datetime en UTC (SQLite rend des datetimes naifs)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _libelle_concept(pattern_name: str) -> str:
    """Nom de concept lisible par un parent (underscores -> espaces). Aligne sur
    le repli deja utilise dans l'export Excel et le portail parent."""
    return str(pattern_name or "").replace("_", " ")


def _lignes_progression(db: Session, eleve_id: int) -> list[Progression]:
    return list(
        db.scalars(
            select(Progression)
            .where(Progression.eleve_id == eleve_id)
            .order_by(Progression.lecon_id, Progression.pattern_name)
        ).all()
    )


def _concept_dict(p: Progression) -> dict:
    return {
        "pattern_name": p.pattern_name,
        "libelle": _libelle_concept(p.pattern_name),
        "lecon_id": p.lecon_id,
        "maitrise": p.maitrise,
        "nb_tentatives": p.nb_tentatives,
    }


def generer_resume_hebdomadaire(
    db: Session,
    eleve_id: int,
    aujourdhui: datetime | None = None,
    fenetre_jours: int = FENETRE_RESUME_JOURS,
) -> dict:
    """Compile l'activite des `fenetre_jours` derniers jours pour un eleve.

    A partir de la seule table Progression : concepts travailles recemment,
    ceux desormais acquis (maitrise 3) cette semaine, et ceux encore en
    difficulte (maitrise 1). Renvoie les listes structurees ET un texte de
    bilan genere par regles (pas de LLM), en langage parent.
    """
    maintenant = _en_utc(aujourdhui) if aujourdhui else _maintenant()
    depuis = maintenant - timedelta(days=fenetre_jours)

    eleve = db.get(Eleve, eleve_id)
    prenom = eleve.prenom if eleve else ""

    recents = [
        p
        for p in _lignes_progression(db, eleve_id)
        if _en_utc(p.date_derniere_tentative) >= depuis
    ]
    travailles = [_concept_dict(p) for p in recents]
    nouvellement_maitrises = [
        _concept_dict(p) for p in recents if p.maitrise == MAITRISE_ACQUISE
    ]
    en_difficulte = [
        _concept_dict(p) for p in recents if p.maitrise == MAITRISE_A_RETRAVAILLER
    ]

    texte = _texte_resume(prenom, travailles, nouvellement_maitrises, en_difficulte, fenetre_jours)
    return {
        "eleve_id": eleve_id,
        "prenom": prenom,
        "periode": {"debut": depuis.isoformat(), "fin": maintenant.isoformat()},
        "concepts_travailles": travailles,
        "nouvellement_maitrises": nouvellement_maitrises,
        "en_difficulte": en_difficulte,
        "texte": texte,
    }


def _liste_libelles(concepts: list[dict]) -> str:
    return ", ".join(c["libelle"] for c in concepts)


def _texte_resume(
    prenom: str,
    travailles: list[dict],
    nouvellement_maitrises: list[dict],
    en_difficulte: list[dict],
    fenetre_jours: int,
) -> str:
    """Bilan hebdo en phrases simples, meme ton que le bilan eleve (par regles)."""
    nom = prenom or "Votre enfant"
    if not travailles:
        return (
            f"{nom} n'a pas travaille de notion ces {fenetre_jours} derniers jours. "
            f"N'hesitez pas a l'encourager a reprendre le parcours."
        )
    n = len(travailles)
    lignes = [
        f"Cette semaine, {nom} a travaille {n} notion{'s' if n > 1 else ''} : "
        f"{_liste_libelles(travailles)}."
    ]
    if nouvellement_maitrises:
        m = len(nouvellement_maitrises)
        lignes.append(
            f"Bravo : {m} notion{'s' if m > 1 else ''} desormais bien maitrisee"
            f"{'s' if m > 1 else ''} ({_liste_libelles(nouvellement_maitrises)})."
        )
    if en_difficulte:
        d = len(en_difficulte)
        lignes.append(
            f"{d} notion{'s' if d > 1 else ''} reste"
            f"{'nt' if d > 1 else ''} a retravailler : {_liste_libelles(en_difficulte)}."
        )
    if not nouvellement_maitrises and not en_difficulte:
        lignes.append("La progression est en bonne voie, continuez ainsi !")
    return " ".join(lignes)


def detecter_alerte_blocage(
    db: Session,
    eleve_id: int,
    aujourdhui: datetime | None = None,
    seuil_stagnation_jours: int = SEUIL_STAGNATION_JOURS,
    seuil_tentatives: int = SEUIL_TENTATIVES_BLOCAGE,
) -> dict:
    """Detecte si l'eleve semble bloque, selon deux criteres (l'un OU l'autre) :

    1. STAGNATION : l'eleve est actif (au moins un concept travaille dans les
       `seuil_stagnation_jours` derniers jours) mais aucune nouvelle maitrise 3
       sur cette periode. Un eleve simplement absent (aucune activite recente)
       ne declenche PAS d'alerte : ce n'est pas un blocage, juste une pause.

    2. CONCEPT BLOQUE : un concept reste en maitrise 1 apres au moins
       `seuil_tentatives` tentatives (il est retravaille sans debloquer).

    Renvoie {"active": bool, "alertes": [{"type", "message", ...}]}.
    """
    maintenant = _en_utc(aujourdhui) if aujourdhui else _maintenant()
    depuis = maintenant - timedelta(days=seuil_stagnation_jours)
    lignes = _lignes_progression(db, eleve_id)
    eleve = db.get(Eleve, eleve_id)
    nom = (eleve.prenom if eleve else "") or "Votre enfant"

    alertes: list[dict] = []

    recents = [p for p in lignes if _en_utc(p.date_derniere_tentative) >= depuis]
    if recents and not any(p.maitrise == MAITRISE_ACQUISE for p in recents):
        alertes.append(
            {
                "type": "stagnation",
                "message": (
                    f"{nom} s'entraine mais n'a consolide aucune nouvelle notion depuis "
                    f"{seuil_stagnation_jours} jours. Un petit coup de pouce pourrait aider."
                ),
            }
        )

    for p in lignes:
        if p.maitrise == MAITRISE_A_RETRAVAILLER and (p.nb_tentatives or 0) >= seuil_tentatives:
            alertes.append(
                {
                    "type": "concept_bloque",
                    "pattern_name": p.pattern_name,
                    "libelle": _libelle_concept(p.pattern_name),
                    "nb_tentatives": p.nb_tentatives,
                    "message": (
                        f"{nom} bute sur « {_libelle_concept(p.pattern_name)} » "
                        f"depuis {p.nb_tentatives} essais sans y arriver. "
                        f"Ce concept meriterait d'etre repris ensemble."
                    ),
                }
            )

    return {"active": bool(alertes), "alertes": alertes}


# ============================================================
#  POINT D'INJECTION POUR UN VRAI ENVOI (aujourd'hui : STUB)
# ============================================================
def envoyer_email(destinataire: str, sujet: str, corps: str) -> bool:
    """STUB d'envoi d'email. NE PART PAS reellement : il LOGGE le contenu.

    C'est le SEUL point a remplacer pour brancher un vrai envoi (SendGrid, SMTP,
    ...). La signature (destinataire, sujet, corps) est volontairement generique
    pour qu'un vrai backend s'y substitue sans toucher aux appelants. Renvoie
    True pour simuler un envoi accepte.
    """
    logger.info(
        "[STUB envoyer_email] -> %s | sujet=%r\n%s",
        destinataire,
        sujet,
        corps,
    )
    return True


def composer_message_parent(resume: dict, alerte: dict) -> tuple[str, str]:
    """Construit (sujet, corps) texte a partir du resume et des alertes.
    Separe de l'envoi pour rester testable et reutilisable."""
    prenom = resume.get("prenom") or "votre enfant"
    sujet = f"Le point de la semaine sur {prenom}"
    parties = [resume.get("texte", "")]
    if alerte.get("active"):
        parties.append("")
        parties.append("Point d'attention :")
        parties.extend(f"- {a['message']}" for a in alerte.get("alertes", []))
    return sujet, "\n".join(parties)


def envoyer_resume_hebdomadaire(
    db: Session, eleve: Eleve, destinataire: str | None = None
) -> dict:
    """Compose le resume + les alertes d'un eleve et le "transmet" au parent.

    Aujourd'hui, la transmission passe par le STUB `envoyer_email` (log). Le jour
    ou un email parent existera, il suffira de le passer en `destinataire` et de
    remplir `envoyer_email`. Renvoie ce qui a ete compose (pour test/aperçu).
    """
    resume = generer_resume_hebdomadaire(db, eleve.id)
    alerte = detecter_alerte_blocage(db, eleve.id)
    sujet, corps = composer_message_parent(resume, alerte)
    # Pas d'email parent stocke pour l'instant : adresse-marqueur explicite.
    envoyer_email(destinataire or f"parent-eleve-{eleve.id}@non-configure.local", sujet, corps)
    return {"resume": resume, "alerte": alerte, "sujet": sujet, "corps": corps}
