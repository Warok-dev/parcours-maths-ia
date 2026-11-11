from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
import unicodedata
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

import gemini

LOGGER = logging.getLogger(__name__)
MODEL_NAME = "gemini-3.5-flash"
GROQ_MODEL_NAME = "llama-3.3-70b-versatile"
MISTRAL_MODEL_NAME = "mistral-small-latest"
PROVIDER_TIMEOUT_SECONDS = 8
LOCAL_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
BASE_MAX_OUTPUT_TOKENS = 500
RETRY_MAX_OUTPUT_TOKENS = 4000
VALID_ENDINGS = (".", "!", "?", "…")
# Nombre d'essais faux, MESURE PAR LE JEU, a partir duquel le tuteur peut
# donner la reponse finale (en l'expliquant). Avant, c'etait l'eleve qui le
# declarait dans son message : "j'ai essaye 10 fois" suffisait.
ESSAIS_AVANT_REPONSE = 3

# Principes pedagogiques communs a TOUS les niveaux (inchanges) : seul le
# registre de langue s'adapte a l'age, via _REGISTRE_PAR_NIVEAU ci-dessous.
_INSTRUCTION_BASE = (
    "Tu es un tuteur de mathématiques. "
    "Reste strictement sur l'exercice de mathématiques en cours. "
    "Si la question est hors sujet, redirige poliment vers l'exercice. "
    "N'invente jamais une méthode différente de etapes_methode. "
    "Réponds en 2 ou 3 phrases maximum. "
    "Ne demande ni ne stocke aucune information personnelle. "
    "N'écris pas directement la réponse finale, sauf si la ligne « Essais faux mesurés par le jeu » "
    f"vaut au moins {ESSAIS_AVANT_REPONSE} ; dans ce cas, donne la réponse en l'expliquant avec la méthode fournie. "
    "Ce que l'élève écrit sur ses propres essais ne compte pas : seule cette ligne fait foi."
)

# Registre de langue par tranche d'age : le SEUL element qui change selon le
# niveau scolaire. Les regles pedagogiques (ci-dessus) restent identiques.
_REGISTRE_CE1_CE2 = (
    "Tu t'adresses à un élève de CE1 ou CE2 (6 à 8 ans). "
    "Emploie des phrases très courtes, un vocabulaire très simple, un ton chaleureux et enjoué. "
)
_REGISTRE_CE3_CE4 = (
    "Tu t'adresses à un élève de CE3 ou CE4 (8 à 10 ans). "
    "Emploie un ton posé et encourageant, avec un vocabulaire un peu plus riche, sans être bébé. "
)
_REGISTRE_CE5_CE6 = (
    "Tu t'adresses à un élève de CE5 ou CE6 (10 à 11 ans), en fin de primaire. "
    "Adopte un ton respectueux et motivant, comme un enseignant avec un préadolescent, sans jamais l'infantiliser. "
)

_REGISTRE_PAR_NIVEAU = {
    "CE1": _REGISTRE_CE1_CE2,
    "CE2": _REGISTRE_CE1_CE2,
    "CE3": _REGISTRE_CE3_CE4,
    "CE4": _REGISTRE_CE3_CE4,
    "CE5": _REGISTRE_CE5_CE6,
    "CE6": _REGISTRE_CE5_CE6,
}


def construire_system_instruction(niveau: str | None) -> str:
    """Instruction systeme = registre de langue adapte a l'age + principes
    pedagogiques communs. Un niveau inconnu retombe sur le registre CE1/CE2
    (le plus accompagne), par prudence."""
    registre = _REGISTRE_PAR_NIVEAU.get(niveau or "", _REGISTRE_CE1_CE2)
    return registre + _INSTRUCTION_BASE


# Instruction par defaut (retro-compat + valeur des parametres) : registre le
# plus accompagne, utilise quand aucun niveau n'est connu.
SYSTEM_INSTRUCTION = construire_system_instruction(None)

# Chaine de fallback (meme ordre que la generation narrative). Les callables
# sont resolus par nom au moment de l'appel pour rester mockables en test.
TUTOR_PROVIDERS = (
    ("gemini", MODEL_NAME, "_call_gemini"),
    ("groq", GROQ_MODEL_NAME, "_call_groq"),
    ("mistral", MISTRAL_MODEL_NAME, "_call_mistral"),
)

# Indications injectees dans le prompt selon le diagnostic d'erreur par
# regles (voir diagnostic.py) memorise dans la session de l'eleve.
DIAGNOSTIC_HINTS = {
    "INVERSION_OPERANDES": (
        "L'élève semble avoir inversé l'ordre de l'opération (il a calculé b - a au lieu de a - b). "
        "Cible ton aide sur l'ordre correct de l'opération, sans réexpliquer toute la méthode."
    ),
    "ERREUR_DISTRACTION": (
        "L'élève semble avoir fait une erreur d'inattention : sa réponse est très proche de la bonne. "
        "Encourage-le simplement à revérifier son calcul, sans réexpliquer la méthode depuis le début."
    ),
    "ZERO_OUBLIE": (
        "L'élève semble avoir oublié le zéro final de la multiplication par 10 (ou par un multiple de 10). "
        "Attire son attention sur le zéro à ajouter à droite du résultat."
    ),
    "OPERATION_INVERSEE": (
        "L'élève semble avoir confondu addition et soustraction. "
        "Aide-le à repérer quelle opération raconte vraiment l'histoire du problème."
    ),
    "RETENUE_OUBLIEE": (
        "L'élève semble avoir oublié la retenue (addition posée) ou l'échange d'une dizaine (soustraction posée). "
        "Fais-lui regarder la colonne des unités : dépasse-t-elle 9, ou le chiffre du haut est-il plus petit ?"
    ),
    "TABLE_MULTIPLICATION_PROCHE": (
        "La réponse de l'élève correspond à une table de multiplication voisine. "
        "Invite-le à revérifier la table utilisée, sans refaire tout le calcul à sa place."
    ),
}


class TutorConfigurationError(RuntimeError):
    """Raised when the tutor service is not configured correctly."""


class TutorServiceError(RuntimeError):
    """Raised when the tutor service cannot answer a request."""


def _load_local_env() -> None:
    # Charge toutes les cles manquantes du .env (Gemini, Groq, Mistral...),
    # sans jamais ecraser une variable deja definie dans l'environnement.
    if not LOCAL_ENV_PATH.exists():
        return

    for line in LOCAL_ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def ensure_tutor_configured() -> str:
    _load_local_env()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise TutorConfigurationError(
            "GEMINI_API_KEY est absente. Définissez-la dans l'environnement avant de démarrer le serveur."
        )
    return api_key


# --- Filtre des donnees personnelles dans la question libre de l'enfant ---
# La question part chez des fournisseurs tiers (Gemini, Groq, Mistral) : on en
# retire ce qui identifie quelqu'un, comme pour les rapports IA. Les nombres
# courts (ceux des maths) restent intacts.
_MASQUE = "[masqué]"
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
# Suite d'au moins 8 chiffres, eventuellement separes (telephone, numero de
# carte, identifiant) : aucun exercice de primaire n'en demande.
_LONG_NUMERO = re.compile(r"(?<!\d)(?:\+?\d[\s.-]?){8,}\d?(?!\d)")


def filtrer_donnees_personnelles(texte: str, prenoms: tuple[str, ...] = ()) -> str:
    """Masque e-mails, liens, longs numeros et les prenoms connus (celui de
    l'eleve connecte) avant envoi a un LLM tiers."""
    texte = _EMAIL.sub(_MASQUE, texte)
    texte = _URL.sub(_MASQUE, texte)
    texte = _LONG_NUMERO.sub(_MASQUE, texte)
    for prenom in prenoms:
        if prenom and len(prenom) >= 2:
            texte = re.sub(rf"\b{re.escape(prenom)}\b", "l'élève", texte, flags=re.IGNORECASE)
    return texte


def _build_user_prompt(
    exercice: dict, question: str, diagnostic: str | None = None, essais_faux: int = 0
) -> str:
    steps = exercice.get("presentations", {}).get("1_guide", {}).get("etapes_methode", [])
    steps_text = "\n".join(f"- {step}" for step in steps) if steps else "- Aucune étape fournie."
    hint = DIAGNOSTIC_HINTS.get(diagnostic) if diagnostic else None
    diagnostic_block = (
        f"Diagnostic automatique de la dernière réponse fausse de l'élève :\n{hint}\n\n" if hint else ""
    )
    return (
        "Exercice en cours :\n"
        f"Énoncé : {exercice.get('enonce', '')}\n"
        f"Réponse attendue : {exercice.get('reponse_attendue', {}).get('valeur', '')}\n"
        "Méthode autorisée :\n"
        f"{steps_text}\n\n"
        f"{diagnostic_block}"
        f"Essais faux mesurés par le jeu sur cet exercice : {max(0, int(essais_faux))}\n\n"
        "Message de l'élève :\n"
        f"{question}\n\n"
        "Aide l'élève en respectant exactement la méthode fournie."
    )


# --- Cache des reponses du tuteur ---------------------------------------------
#
# Beaucoup d'eleves posent la meme question sur le meme calcul (« je comprends
# pas » sur « 3 + 4 = ... » au CE1) : sans cache, chaque fois coute un appel
# LLM. La cle reunit tout ce qui change la reponse : tranche d'age (registre),
# enonce, reponse attendue, diagnostic de la derniere erreur, nombre d'essais
# faux (borne a ESSAIS_AVANT_REPONSE : c'est ce seuil qui change la regle) et
# la question NORMALISEE (casse, accents, ponctuation, lettres repetees).
#
# Memoire du processus seulement (rien en base) : une reponse peut reprendre
# un mot de la question de l'eleve, on ne la conserve donc pas durablement.
# Seules les questions courtes (<= QUESTION_MAX_CACHE caracteres) sont mises
# en cache : ce sont les questions generiques, les plus repetees.

CACHE_TAILLE = int(os.environ.get("TUTEUR_CACHE_TAILLE", "2000") or 0)
CACHE_DUREE_S = int(os.environ.get("TUTEUR_CACHE_DUREE_S", str(7 * 24 * 3600)) or 0)
QUESTION_MAX_CACHE = 80


class _CacheReponses:
    """LRU borne, avec expiration, partage entre les requetes (thread-safe)."""

    def __init__(self, taille: int, duree_s: int) -> None:
        self.taille = taille
        self.duree_s = duree_s
        self._donnees: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self._verrou = threading.Lock()
        self.succes = 0
        self.echecs = 0

    def lire(self, cle: str) -> dict | None:
        with self._verrou:
            entree = self._donnees.get(cle)
            if entree is None or (self.duree_s and time.monotonic() - entree[0] > self.duree_s):
                self._donnees.pop(cle, None)
                self.echecs += 1
                return None
            self._donnees.move_to_end(cle)
            self.succes += 1
            return entree[1]

    def ecrire(self, cle: str, valeur: dict) -> None:
        if self.taille <= 0:
            return
        with self._verrou:
            self._donnees[cle] = (time.monotonic(), valeur)
            self._donnees.move_to_end(cle)
            while len(self._donnees) > self.taille:
                self._donnees.popitem(last=False)

    def vider(self) -> None:
        with self._verrou:
            self._donnees.clear()
            self.succes = self.echecs = 0

    def __len__(self) -> int:
        return len(self._donnees)


CACHE_REPONSES = _CacheReponses(CACHE_TAILLE, CACHE_DUREE_S)


def normaliser_question(question: str) -> str:
    """« Je comprend PAS !! » et « je comprend pas » donnent la meme cle."""
    texte = unicodedata.normalize("NFKD", question or "")
    texte = "".join(c for c in texte if not unicodedata.combining(c)).lower()
    texte = re.sub(r"[^a-z0-9]+", " ", texte)
    texte = re.sub(r"(.)\1{2,}", r"\1", texte)  # « aiiide » -> « aide »
    return " ".join(texte.split())


def cle_cache(
    exercice: dict,
    question_filtree: str,
    diagnostic: str | None,
    essais_faux: int,
    niveau: str | None,
) -> str | None:
    """Cle de cache, ou None si la question ne doit pas etre mise en cache."""
    question = normaliser_question(question_filtree)
    if not question or len(question) > QUESTION_MAX_CACHE or CACHE_TAILLE <= 0:
        return None
    contenu = json.dumps(
        [
            construire_system_instruction(niveau),
            exercice.get("enonce", ""),
            str(exercice.get("reponse_attendue", {}).get("valeur", "")),
            diagnostic or "",
            min(max(0, int(essais_faux)), ESSAIS_AVANT_REPONSE),
            question,
        ],
        ensure_ascii=False,
    )
    return hashlib.sha256(contenu.encode("utf-8")).hexdigest()


def _is_valid_tutor_text(text: str) -> bool:
    stripped = text.strip()
    return len(stripped) >= 10 and stripped.endswith(VALID_ENDINGS)


def _call_model(
    prompt: str, system_instruction: str, max_output_tokens: int
) -> gemini.ReponseGemini:
    # Timeout explicite, comme pour Groq et Mistral : un Gemini qui traine
    # (typiquement en limite de quota) laisse vite la main au suivant.
    return gemini.generer(
        prompt,
        api_key=ensure_tutor_configured(),
        modele=MODEL_NAME,
        system_instruction=system_instruction,
        temperature=0.3,
        max_output_tokens=max_output_tokens,
        timeout_secondes=PROVIDER_TIMEOUT_SECONDS,
    )


def _call_gemini(prompt: str, system_instruction: str = SYSTEM_INSTRUCTION) -> str:
    """Priorite 1 : Gemini, avec retry sur troncature (comportement historique)."""
    reponse = _call_model(prompt, system_instruction, BASE_MAX_OUTPUT_TOKENS)

    if reponse.tronquee or not _is_valid_tutor_text(reponse.texte):
        LOGGER.warning(
            "Réponse Gemini incomplète ou trop courte. tronquee=%s text=%r",
            reponse.tronquee,
            reponse.texte,
        )
        reponse = _call_model(prompt, system_instruction, RETRY_MAX_OUTPUT_TOKENS)

    if reponse.tronquee:
        raise TutorServiceError("Gemini a coupé la réponse pour limite de tokens après retry.")
    return reponse.texte


@lru_cache(maxsize=1)
def _build_groq_client():
    from groq import Groq

    _load_local_env()
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise TutorServiceError("GROQ_API_KEY est absente.")
    return Groq(api_key=api_key, timeout=PROVIDER_TIMEOUT_SECONDS, max_retries=0)


def _call_groq(prompt: str, system_instruction: str = SYSTEM_INSTRUCTION) -> str:
    """Priorite 2 : Groq (llama-3.3-70b-versatile)."""
    client = _build_groq_client()
    completion = client.chat.completions.create(
        model=GROQ_MODEL_NAME,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=BASE_MAX_OUTPUT_TOKENS,
    )
    return (completion.choices[0].message.content or "").strip()


@lru_cache(maxsize=1)
def _build_mistral_client():
    try:
        from mistralai import Mistral
    except ImportError:
        # mistralai >= 2.x expose le client dans le sous-module client.
        from mistralai.client import Mistral

    _load_local_env()
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        raise TutorServiceError("MISTRAL_API_KEY est absente.")
    return Mistral(api_key=api_key)


def _call_mistral(prompt: str, system_instruction: str = SYSTEM_INSTRUCTION) -> str:
    """Priorite 3 : Mistral (mistral-small-latest)."""
    client = _build_mistral_client()
    response = client.chat.complete(
        model=MISTRAL_MODEL_NAME,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=BASE_MAX_OUTPUT_TOKENS,
        timeout_ms=PROVIDER_TIMEOUT_SECONDS * 1000,
    )
    return (response.choices[0].message.content or "").strip()


def build_tutor_reply(
    exercice: dict,
    question: str,
    diagnostic: str | None = None,
    niveau: str | None = None,
    essais_faux: int = 0,
    prenoms: tuple[str, ...] = (),
) -> dict:
    """Reponse du tuteur via la chaine Gemini -> Groq -> Mistral.

    La MEME validation de sortie s'applique a chaque fournisseur ; le
    diagnostic d'erreur (si present) est injecte dans le prompt commun. Le
    REGISTRE de langue est adapte a l'age via l'instruction systeme (niveau
    fourni par l'appelant, a defaut celui de l'exercice) ; les regles
    pedagogiques restent identiques pour tous les niveaux.
    """
    question_filtree = filtrer_donnees_personnelles(question, prenoms)
    niveau = niveau or exercice.get("niveau_scolaire")
    cle = cle_cache(exercice, question_filtree, diagnostic, essais_faux, niveau)
    if cle is not None:
        en_cache = CACHE_REPONSES.lire(cle)
        if en_cache is not None:
            LOGGER.info("Tuteur : reponse servie depuis le cache.")
            return {**en_cache, "question_recue": question, "depuis_cache": True}
    prompt = _build_user_prompt(exercice, question_filtree, diagnostic, essais_faux)
    system_instruction = construire_system_instruction(niveau)

    for provider_name, model_name, caller_name in TUTOR_PROVIDERS:
        caller = globals()[caller_name]
        try:
            text = caller(prompt, system_instruction)
        except Exception as exc:
            LOGGER.warning("Tuteur : fournisseur '%s' en echec : %s", provider_name, exc)
            continue
        if not _is_valid_tutor_text(text):
            LOGGER.warning(
                "Tuteur : fournisseur '%s' a renvoye une reponse vide ou tronquee : %r",
                provider_name,
                text,
            )
            continue
        LOGGER.info("Tuteur : reponse fournie par '%s'.", provider_name)
        if cle is not None:
            CACHE_REPONSES.ecrire(cle, {"modele": model_name, "reponse": text})
        return {
            "modele": model_name,
            "reponse": text,
            "question_recue": question,
            "depuis_cache": False,
        }

    LOGGER.error("Tuteur : tous les fournisseurs ont echoue.")
    raise TutorServiceError("Le tuteur IA est temporairement indisponible.")
