"""Aides partagees par les tests : la bonne reponse ne part plus au client,
les tests la lisent donc cote serveur (cache ou etat persiste de la session)."""

from __future__ import annotations

import main


def exercice_complet(exercice_client: dict, session_id: str | None = None) -> dict:
    exercice_id = exercice_client["id"]
    complet = main.EXERCICE_CACHE.get(exercice_id)
    if complet is None and session_id is not None:
        complet = main._exercice_de_session(main._get_session(session_id), exercice_id)
    if complet is None:
        raise AssertionError(f"exercice {exercice_id} introuvable cote serveur")
    return complet


def bonne_reponse(exercice_client: dict, session_id: str | None = None) -> str:
    valeur = exercice_complet(exercice_client, session_id)["reponse_attendue"]["valeur"]
    if isinstance(valeur, list):
        return ", ".join(map(str, valeur))
    return str(valeur)
