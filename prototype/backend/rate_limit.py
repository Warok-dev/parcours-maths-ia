"""Limitation de debit (rate limiting) de l'API, basee sur slowapi / limits.

Objectif : empecher qu'un usage abusif (bug client qui spamme, force brute sur
le PIN/mot de passe, sur-consommation des quotas IA) ne fasse tomber le service
pour tout le monde. Stockage EN MEMOIRE (pas de Redis) : suffisant a l'echelle
de ce prototype.

Deux mecanismes complementaires :
- la LIMITE GENERALE (60/min par IP) s'applique a TOUTE l'API via
  SlowAPIMiddleware (niveau ASGI, aucune signature d'endpoint touchee) ;
- les LIMITES STRICTES/IA s'appliquent endpoint par endpoint via une
  DEPENDANCE FastAPI (`limite(...)`), et non via un decorateur : un decorateur
  enveloppe la fonction, et avec `from __future__ import annotations` FastAPI ne
  resout plus les annotations du vrai endpoint (elles deviennent des query
  params -> 422). Une dependance evite ce piege : la signature de l'endpoint
  reste intacte.

Activation : le limiteur est DESACTIVE a l'import (pour que la suite de tests,
qui rejoue des centaines de requetes depuis la meme IP, ne soit pas bridee), et
ACTIVE au demarrage du serveur reel via activer_selon_env() (appele dans le
lifespan de main.py, qui ne s'ouvre pas pendant les tests). En prod on peut
forcer off avec RATE_LIMIT_ENABLED=0. Les tests dedies l'activent
explicitement (activer()/desactiver()/reinitialiser()).
"""

from __future__ import annotations

import logging
import os
from typing import Callable

from fastapi import HTTPException, Request
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

# --- Limites ---
# Une CLASSE entiere partage souvent une seule IP publique (routeur de
# l'ecole) : les limites PAR IP sont donc dimensionnees pour ~30 eleves
# simultanes, et la protection fine (force brute) se fait PAR CIBLE (un
# eleve, un identifiant) plutot que par IP. Toutes surchargeables par
# variable d'environnement (ex. RATE_LIMIT_GENERALE="900/minute").


def _env(nom: str, defaut: str) -> str:
    return os.environ.get(nom, defaut)


LIMITE_GENERALE = _env("RATE_LIMIT_GENERALE", "600/minute")  # ~20 req/min/eleve pour 30 eleves
LIMITE_AUTH = _env("RATE_LIMIT_AUTH", "10/minute")  # PAR CIBLE : un eleve, un identifiant, un code
LIMITE_AUTH_IP = _env("RATE_LIMIT_AUTH_IP", "60/minute")  # par IP, toutes cibles confondues
LIMITE_REJOINDRE = _env("RATE_LIMIT_REJOINDRE", "40/minute")  # une classe tape le meme code
LIMITE_IA = _env("RATE_LIMIT_IA", "60/minute")  # tuteur / rapports IA (quota fournisseurs)
LIMITE_TTS = _env("RATE_LIMIT_TTS", "120/minute")  # lecture d'enonces (cache cote serveur)
LIMITE_DEMO = _env("RATE_LIMIT_DEMO", "3/hour")  # creation d'ecoles de demo
LIMITE_INSCRIPTION = _env("RATE_LIMIT_INSCRIPTION", "5/hour")  # creation de comptes enseignant

# --- IP reelle du client derriere le proxy de l'hebergeur ---
# Derriere Render (et son CDN), request.client.host est l'IP du PROXY : tous
# les utilisateurs partageraient alors le meme compteur. X-Forwarded-For porte
# la vraie IP, mais le client peut y glisser de fausses valeurs EN TETE de
# liste (le proxy ajoute a la fin sans nettoyer). On lit donc la N-ieme entree
# EN PARTANT DE LA FIN, N = nombre de proxys de confiance (TRUSTED_PROXY_HOPS) :
# cette entree a ete ecrite par notre propre proxy, elle n'est pas falsifiable.
# 0 (defaut, developpement local) = on ignore l'en-tete. Pour calibrer en
# production : RATE_LIMIT_LOG_IP=1 journalise X-Forwarded-For et l'IP retenue.
TRUSTED_PROXY_HOPS = int(_env("TRUSTED_PROXY_HOPS", "0") or 0)
_LOG_IP = _env("RATE_LIMIT_LOG_IP", "0") == "1"
_log = logging.getLogger("rate_limit")


def ip_client(request: Request) -> str:
    """IP a utiliser pour les compteurs (voir TRUSTED_PROXY_HOPS)."""
    directe = get_remote_address(request) or "anonyme"
    if TRUSTED_PROXY_HOPS <= 0:
        return directe
    entrees = [
        e.strip() for e in request.headers.get("x-forwarded-for", "").split(",") if e.strip()
    ]
    ip = entrees[-TRUSTED_PROXY_HOPS] if len(entrees) >= TRUSTED_PROXY_HOPS else directe
    if _LOG_IP:
        _log.info("IP client : x-forwarded-for=%r directe=%s -> %s", entrees, directe, ip)
    return ip

# Limiteur slowapi : porte UNIQUEMENT la limite generale, appliquee via
# SlowAPIMiddleware. `enabled` pilote AUSSI les limites strictes ci-dessous.
limiter = Limiter(
    key_func=lambda request: ip_client(request),
    default_limits=[LIMITE_GENERALE],
    enabled=False,  # active en production par activer_selon_env()
)

# Stockage/strategie dedies aux limites strictes (independants du compteur
# general de slowapi : les deux comptent, la plus stricte declenche en premier).
_storage = MemoryStorage()
_strategie = MovingWindowRateLimiter(_storage)


def activer_selon_env() -> None:
    """Active le limiteur sauf si RATE_LIMIT_ENABLED=0. Appele par le lifespan
    du serveur reel (pas pendant les tests, qui n'ouvrent pas le lifespan)."""
    limiter.enabled = os.environ.get("RATE_LIMIT_ENABLED", "1") != "0"


def activer() -> None:
    limiter.enabled = True


def desactiver() -> None:
    limiter.enabled = False


def reinitialiser() -> None:
    """Vide les compteurs (limite generale + limites strictes). Pour les tests."""
    limiter.reset()
    _storage.reset()


# Prefixes d'URL cote ELEVE (enfant) : le message d'erreur 429 y est adapte
# (ton rassurant), le reste (enseignant/parent/admin) recoit un message standard.
_PREFIXES_ENFANT = (
    "/session",
    "/evaluer",
    "/exercices",
    "/lecons",
    "/tuteur",
    "/synthese-vocale",
    "/eleve",  # dont /eleve/{id}/connexion (pave PIN)
    "/carte",
    "/themes",
    "/classe/rejoindre",  # saisie du code de classe par l'enfant
)

_MESSAGE_ENFANT = "Oh la la, tu vas un peu trop vite ! Attends quelques secondes, puis reessaie."
_MESSAGE_STANDARD = "Trop de requetes en peu de temps. Merci de patienter un instant avant de reessayer."


def _audience_enfant(path: str) -> bool:
    return any(path.startswith(prefixe) for prefixe in _PREFIXES_ENFANT)


def _message_429(path: str) -> str:
    return _MESSAGE_ENFANT if _audience_enfant(path) else _MESSAGE_STANDARD


def gestion_depassement(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Handler du 429 leve par le MIDDLEWARE (limite generale) : message clair
    adapte a l'audience, jamais une erreur technique brute."""
    reponse = JSONResponse(status_code=429, content={"detail": _message_429(request.url.path)})
    try:
        reponse.headers["Retry-After"] = str(exc.limit.limit.get_expiry())
    except Exception:  # noqa: BLE001 - Retry-After est un bonus, jamais bloquant
        pass
    return reponse


def par_chemin(nom: str) -> Callable[[Request], str]:
    """Discriminant de compteur : un parametre de chemin (ex. l'eleve vise)."""
    return lambda request: str(request.path_params.get(nom, ""))


def limite(
    regle: str, portee: str, discriminant: Callable[[Request], str] | None = None
) -> Callable[[Request], None]:
    """Fabrique une DEPENDANCE FastAPI qui applique la limite `regle` (ex.
    "10/minute") a un endpoint, isolee par `portee` (chaque type d'endpoint a
    son propre compteur par IP : bruteforcer le PIN ne bloque pas l'acces
    parent). Leve un 429 clair (meme message que le middleware) au depassement.
    Ne bride rien tant que le limiteur est desactive (tests)."""
    item = parse(regle)

    def dependance(request: Request) -> None:
        if not limiter.enabled:
            return
        identite = ip_client(request)
        cles = [portee, identite]
        if discriminant is not None:
            # Compteur par (IP, cible) : 30 eleves d'une meme classe qui se
            # connectent chacun a SON compte ne se bloquent pas entre eux.
            cles.append(discriminant(request))
        if not _strategie.hit(item, *cles):
            raise HTTPException(
                status_code=429,
                detail=_message_429(request.url.path),
                headers={"Retry-After": str(item.get_expiry())},
            )

    return dependance
