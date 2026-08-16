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
ACTIVE au demarrage du serveur reel via activer_selon_env() (appele dans le hook
startup de main.py ; le lifespan ne s'ouvre pas pendant les tests). En prod on
peut forcer off avec RATE_LIMIT_ENABLED=0. Les tests dedies l'activent
explicitement (activer()/desactiver()/reinitialiser()).
"""

from __future__ import annotations

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

# --- Limites (par IP) ---
LIMITE_GENERALE = "60/minute"  # usage normal intensif (eleve qui enchaine)
LIMITE_AUTH = "10/minute"  # PIN eleve, code parent, mot de passe enseignant (anti force brute)
LIMITE_IA = "20/minute"  # endpoints appelant les fournisseurs IA / TTS (anti sur-consommation quota)
LIMITE_DEMO = "3/hour"  # creation d'ecoles de demo (anti abus : eviter de remplir la base)

# Limiteur slowapi : porte UNIQUEMENT la limite generale, appliquee via
# SlowAPIMiddleware. `enabled` pilote AUSSI les limites strictes ci-dessous.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[LIMITE_GENERALE],
    enabled=False,  # active en production par activer_selon_env()
)

# Stockage/strategie dedies aux limites strictes (independants du compteur
# general de slowapi : les deux comptent, la plus stricte declenche en premier).
_storage = MemoryStorage()
_strategie = MovingWindowRateLimiter(_storage)


def activer_selon_env() -> None:
    """Active le limiteur sauf si RATE_LIMIT_ENABLED=0. Appele au startup du
    serveur reel (pas pendant les tests, qui n'ouvrent pas le lifespan)."""
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


def limite(regle: str, portee: str) -> Callable[[Request], None]:
    """Fabrique une DEPENDANCE FastAPI qui applique la limite `regle` (ex.
    "10/minute") a un endpoint, isolee par `portee` (chaque type d'endpoint a
    son propre compteur par IP : bruteforcer le PIN ne bloque pas l'acces
    parent). Leve un 429 clair (meme message que le middleware) au depassement.
    Ne bride rien tant que le limiteur est desactive (tests)."""
    item = parse(regle)

    def dependance(request: Request) -> None:
        if not limiter.enabled:
            return
        identite = get_remote_address(request) or "anonyme"
        if not _strategie.hit(item, portee, identite):
            raise HTTPException(
                status_code=429,
                detail=_message_429(request.url.path),
                headers={"Retry-After": str(item.get_expiry())},
            )

    return dependance
