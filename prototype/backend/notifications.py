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

Un cran au-dessus du texte par regles, `generer_rapport_ia` produit une VRAIE
appreciation redigee par un LLM (comme le ferait un enseignant), en reutilisant
EXACTEMENT la chaine de fallback eprouvee du tuteur/narratif (Gemini -> Groq ->
Mistral, meme timeout, meme gestion d'erreur). Le LLM n'invente rien : il ne
recoit que des donnees deja calculees et verifiees, et sa sortie est validee
(aucun nombre non fourni) ; en cas d'echec, on retombe sur le texte par regles.

Regles de datation : la BD SQLite renvoie des datetimes naifs meme pour des
colonnes timezone=True. On les normalise en UTC avant toute comparaison, pour
ne jamais melanger naif et aware.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import google.generativeai as genai
from sqlalchemy import select
from sqlalchemy.orm import Session

import tutor
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


# Libelles lisibles des 36 concepts (CE1 -> CE6), pour le rapport IA, les
# alertes et le portail parent. MIROIR de CONCEPT_LABELS dans carnet.js
# (frontend) : garder les deux synchronises quand on ajoute/renomme un pattern.
# Sans cette table, le rapport affichait le nom technique brut du pattern
# ("comparaison decimaux", "pourcentage d une quantite"...).
_LIBELLES_CONCEPTS = {
    "addition_pas_a_pas_sans_retenue": "Addition pas à pas",
    "partie_tout_addition_non_narratif": "Partie et tout : addition",
    "addition_2chiffres_sans_retenue": "Addition à 2 chiffres",
    "probleme_total_partie_tout": "Problème : trouver le total",
    "partie_tout_soustraction_non_narratif": "Partie et tout : soustraction",
    "probleme_reste_partie_tout": "Problème : trouver le reste",
    "probleme_comparaison_difference": "Problème : comparer",
    "multiplication_par_10": "Multiplication par 10",
    "multiplication_chiffre_x_multiple_de_10": "Chiffre x multiple de 10",
    "identifier_multiple_de_10": "Reconnaître les multiples de 10",
    "multiplication_decomposee_chiffre_x_2chiffres": "Multiplication décomposée",
    "addition_repetee_vers_multiplication": "De l'addition à la multiplication",
    "facteur_manquant_table_de_2": "Facteur manquant (table de 2)",
    "probleme_groupes_egaux_total": "Groupes égaux : le total",
    "probleme_groupes_egaux_quotient": "Groupes égaux : le partage",
    "moitie_via_2xn": "Trouver la moitié",
    "double_via_2xn": "Trouver le double",
    "suite_multiples_de_10_a_completer": "Suites de 10 à compléter",
    "conversion_cm_mm_vers_mm": "Convertir cm et mm",
    "completer_ligne_graduee": "Compléter une ligne graduée",
    "multiplication_groupes_egaux_modele": "Multiplication : groupes égaux",
    "multiplication_posee_2chiffres": "Multiplication posée (2 chiffres)",
    "division_exacte_partage": "Division exacte (partage)",
    "conversion_kg_g": "Convertir kg et g",
    "addition_durees_min": "Additionner des durées (min)",
    "lecture_heure_analogique": "Lire l'heure",
    "completer_tableau_proportionnalite": "Compléter un tableau de proportionnalité",
    "figure_cotee_simple": "Périmètre et aire d'une figure",
    "cercle_identifier_elements": "Le cercle et ses éléments",
    "circonference_cercle": "Circonférence du cercle",
    "aire_disque": "Aire du disque",
    "triangle_classer_cotes": "Classer un triangle par ses côtés",
    "triangle_classer_angles": "Classer un triangle par ses angles",
    "angle_type": "Reconnaître le type d'un angle",
    "echelle_plan": "Échelle et plan",
    "comparaison_decimaux": "Comparer des décimaux",
    "addition_decimaux": "Additionner des décimaux",
    "soustraction_decimaux": "Soustraire des décimaux",
    "conversion_duree_min": "Convertir une durée en minutes",
    "duree_entre_horaires": "Durée entre deux horaires",
    "pourcentage_d_une_quantite": "Pourcentage d'une quantité",
    "vitesse_distance_duree": "Vitesse, distance et durée",
}


def _libelle_concept(pattern_name: str) -> str:
    """Nom de concept lisible par un parent. Table complete des 36 concepts ;
    repli sur les underscores -> espaces pour un pattern inconnu (jamais un
    crash, au pire l'ancien comportement pour un futur pattern non encore
    ajoute a la table)."""
    key = str(pattern_name or "")
    return _LIBELLES_CONCEPTS.get(key, key.replace("_", " "))


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


# ============================================================
#  RAPPORT REDIGE PAR IA (appreciation en langage naturel)
#
#  Le LLM n'invente RIEN : il recoit uniquement des donnees deja calculees
#  (concepts, maitrise, tentatives, alertes) et les met en mots. Meme chaine
#  de fallback que le tuteur/narratif, meme timeout, meme gestion d'erreur.
#  La sortie est validee (aucun nombre non fourni) ; sinon on retombe sur le
#  texte par regles du resume hebdomadaire.
# ============================================================
RAPPORT_TIMEOUT_SECONDS = tutor.PROVIDER_TIMEOUT_SECONDS
RAPPORT_MAX_OUTPUT_TOKENS = 600
_NOMBRE_RE = re.compile(r"\d+")

_SYSTEME_RAPPORT = (
    "Tu rediges une courte appreciation d'apprentissage en francais, comme un enseignant "
    "qui remplit un bulletin. Tu t'appuies UNIQUEMENT sur les donnees fournies : tu "
    "n'inventes aucun chiffre, aucun concept, aucun fait qui n'y figure pas. "
    "Tu ecris 3 a 4 phrases, en un seul paragraphe, sans liste ni markdown. "
    "Tu n'ecris aucun nombre qui ne soit pas deja present dans les donnees."
)

# Ton et niveau de detail selon le destinataire.
_TON_RAPPORT = {
    "enseignant": (
        "Destinataire : l'enseignant. Ton professionnel, factuel et precis. Tu peux nommer "
        "les notions telles quelles et rester synthetique. Enchaine : ce qui est acquis, ce "
        "qui merite attention, puis une suggestion pedagogique concrete."
    ),
    "parent": (
        "Destinataire : le parent. Ton simple, chaleureux et rassurant, sans jargon ni terme "
        "technique. Enchaine : ce qui va bien, ce sur quoi accompagner doucement l'enfant, "
        "puis une suggestion concrete et encourageante a faire a la maison."
    ),
}

# Chaine de fallback (meme ordre et memes modeles que tuteur/narratif). Les
# callables sont resolus par nom au moment de l'appel pour rester mockables.
RAPPORT_PROVIDERS = (
    ("gemini", tutor.MODEL_NAME, "_appel_gemini_rapport"),
    ("groq", tutor.GROQ_MODEL_NAME, "_appel_groq_rapport"),
    ("mistral", tutor.MISTRAL_MODEL_NAME, "_appel_mistral_rapport"),
)


@lru_cache(maxsize=1)
def _modele_gemini_rapport() -> genai.GenerativeModel:
    api_key = tutor.ensure_tutor_configured()
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(tutor.MODEL_NAME, system_instruction=_SYSTEME_RAPPORT)


def _appel_gemini_rapport(prompt: str) -> str:
    """Priorite 1 : Gemini. Timeout explicite obligatoire (meme fix que le
    tuteur) : sans lui le SDK attend son defaut de 600 s et bloque tout le
    fallback quand Gemini traine en limite de quota."""
    modele = _modele_gemini_rapport()
    reponse = modele.generate_content(
        prompt,
        generation_config={"temperature": 0.4, "max_output_tokens": RAPPORT_MAX_OUTPUT_TOKENS},
        request_options={"timeout": RAPPORT_TIMEOUT_SECONDS},
    )
    texte = getattr(reponse, "text", None)
    return texte.strip() if isinstance(texte, str) else ""


def _appel_groq_rapport(prompt: str) -> str:
    """Priorite 2 : Groq. Reutilise le meme client que le tuteur (timeout et
    max_retries deja configures)."""
    client = tutor._build_groq_client()
    completion = client.chat.completions.create(
        model=tutor.GROQ_MODEL_NAME,
        messages=[
            {"role": "system", "content": _SYSTEME_RAPPORT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
        max_tokens=RAPPORT_MAX_OUTPUT_TOKENS,
    )
    return (completion.choices[0].message.content or "").strip()


def _appel_mistral_rapport(prompt: str) -> str:
    """Priorite 3 : Mistral. Meme client que le tuteur, timeout explicite."""
    client = tutor._build_mistral_client()
    reponse = client.chat.complete(
        model=tutor.MISTRAL_MODEL_NAME,
        messages=[
            {"role": "system", "content": _SYSTEME_RAPPORT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
        max_tokens=RAPPORT_MAX_OUTPUT_TOKENS,
        timeout_ms=RAPPORT_TIMEOUT_SECONDS * 1000,
    )
    return (reponse.choices[0].message.content or "").strip()


def _donnees_rapport(resume: dict, alerte: dict, fenetre_jours: int) -> tuple[str, set[str]]:
    """Construit le bloc de donnees VERIFIEES fourni au LLM, et l'ensemble des
    nombres autorises : exactement ceux qui apparaissent dans ce bloc. Tout
    autre nombre dans la sortie sera considere comme invente."""
    prenom = resume.get("prenom") or "L'eleve"
    travailles = resume.get("concepts_travailles", [])
    maitrises = resume.get("nouvellement_maitrises", [])
    difficiles = resume.get("en_difficulte", [])

    lignes = [
        f"Prenom de l'eleve : {prenom}",
        f"Periode couverte : les {fenetre_jours} derniers jours",
        f"Nombre de notions travaillees sur la periode : {len(travailles)}",
    ]
    if maitrises:
        lignes.append(
            f"Notions desormais bien maitrisees ({len(maitrises)}) : "
            + " ; ".join(c["libelle"] for c in maitrises)
        )
    else:
        lignes.append("Notions nouvellement maitrisees : aucune sur la periode")
    if difficiles:
        details = " ; ".join(
            f"{c['libelle']} (retravaillee {c['nb_tentatives']} fois)" for c in difficiles
        )
        lignes.append(f"Notions encore en difficulte ({len(difficiles)}) : {details}")
    else:
        lignes.append("Notions en difficulte : aucune sur la periode")
    if alerte.get("active"):
        lignes.append("Alertes detectees par le systeme (regles) :")
        lignes.extend(f"- {a['message']}" for a in alerte.get("alertes", []))
    else:
        lignes.append("Alerte de blocage : aucune")

    bloc = "\n".join(lignes)
    nombres_autorises = set(_NOMBRE_RE.findall(bloc))
    return bloc, nombres_autorises


def _prompt_rapport(bloc_donnees: str, destinataire: str) -> str:
    ton = _TON_RAPPORT.get(destinataire, _TON_RAPPORT["parent"])
    return (
        f"{ton}\n\n"
        "Donnees verifiees (les SEULES que tu peux utiliser) :\n"
        f"{bloc_donnees}\n\n"
        "Redige l'appreciation en 3 a 4 phrases. N'invente aucun chiffre ni aucune "
        "information absente des donnees ci-dessus. Utilise les noms de notions tels "
        "quels, en langage naturel."
    )


def _texte_rapport_valide(texte: str) -> bool:
    """Garde-fou minimal : un rapport exploitable fait au moins quelques mots."""
    return len(texte.strip()) >= 20


def _nombres_tous_autorises(texte: str, nombres_autorises: set[str]) -> bool:
    """Vrai si AUCUN nombre du texte n'est absent des donnees fournies (meme
    esprit que la validation stricte de narrative.py, mais on autorise les
    nombres qui viennent reellement des donnees)."""
    return all(token in nombres_autorises for token in _NOMBRE_RE.findall(texte))


def _generer_texte_rapport(
    prompt: str, nombres_autorises: set[str]
) -> tuple[str, str] | None:
    """Parcourt la chaine Gemini -> Groq -> Mistral. La MEME validation
    s'applique a chaque fournisseur : texte exploitable ET aucun nombre non
    fourni. Toute sortie invalide compte comme un echec et passe au suivant.
    Renvoie (texte, nom_du_modele) au premier succes, sinon None."""
    for nom, modele_nom, caller_nom in RAPPORT_PROVIDERS:
        caller = globals()[caller_nom]
        try:
            texte = caller(prompt)
        except Exception as exc:  # SDK, reseau, quota, timeout...
            logger.warning("Rapport IA : fournisseur '%s' en echec : %s", nom, exc)
            continue
        if not _texte_rapport_valide(texte):
            logger.warning("Rapport IA : '%s' a renvoye un texte vide ou trop court.", nom)
            continue
        if not _nombres_tous_autorises(texte, nombres_autorises):
            logger.warning(
                "Rapport IA : '%s' a produit un nombre absent des donnees -> rejete.", nom
            )
            continue
        logger.info("Rapport IA fourni par '%s'.", nom)
        return texte, modele_nom
    return None


def generer_rapport_ia(
    db: Session,
    eleve_id: int,
    destinataire: str,
    fenetre_jours: int = FENETRE_RESUME_JOURS,
) -> dict:
    """Rapport d'apprentissage redige par IA pour 'enseignant' ou 'parent'.

    Le LLM ne recoit que des donnees deja calculees et verifiees (resume hebdo
    + alertes par regles) et se contente de les mettre en mots. Sa sortie est
    validee (aucun nombre invente) ; si les trois fournisseurs echouent ou si
    la validation echoue, on retombe sur le texte par regles du resume (jamais
    de texte non fiable affiche). `source` indique 'ia' ou 'regles'."""
    if destinataire not in ("enseignant", "parent"):
        raise ValueError("destinataire doit valoir 'enseignant' ou 'parent'.")

    resume = generer_resume_hebdomadaire(db, eleve_id, fenetre_jours=fenetre_jours)
    alerte = detecter_alerte_blocage(db, eleve_id)
    bloc, nombres_autorises = _donnees_rapport(resume, alerte, fenetre_jours)
    prompt = _prompt_rapport(bloc, destinataire)

    resultat = _generer_texte_rapport(prompt, nombres_autorises)
    if resultat is not None:
        texte, modele = resultat
        source = "ia"
    else:
        # Repli sur le texte deja genere par regles (fiable par construction).
        logger.info("Rapport IA indisponible : repli sur le texte par regles.")
        texte, modele, source = resume["texte"], None, "regles"

    return {
        "eleve_id": eleve_id,
        "prenom": resume["prenom"],
        "destinataire": destinataire,
        "periode": resume["periode"],
        "texte": texte,
        "source": source,
        "modele": modele,
    }
