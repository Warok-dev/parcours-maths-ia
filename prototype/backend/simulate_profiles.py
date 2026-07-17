from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from fastapi.testclient import TestClient

from main import EXERCICE_CACHE, SESSION_STATE, app


CONCEPTS_TO_SIMULATE = 3


def answer_for(exercice: dict) -> str:
    value = exercice["reponse_attendue"]["valeur"]
    if isinstance(value, list):
        return ", ".join(map(str, value))
    return str(value)


def wrong_answer_for(exercice: dict) -> str:
    correct = answer_for(exercice)
    return "__incorrect__" if correct != "__incorrect__" else "__vraiment_incorrect__"


@dataclass
class ConceptTrace:
    concept: str
    statuses: list[str] = field(default_factory=list)
    tutor_calls: list[str] = field(default_factory=list)
    tutor_results: list[str] = field(default_factory=list)
    mastery: int | None = None
    reinforcement_planned: int | None = None
    reinforcement_started_with_status: str | None = None
    reinforcement_exercises_completed: int = 0


@dataclass
class SessionContext:
    client: TestClient
    session_id: str
    niveau: str
    exercice: dict
    progression: dict


def reset_state() -> None:
    EXERCICE_CACHE.clear()
    SESSION_STATE.clear()


def start_session(client: TestClient, niveau: str = "CE1") -> SessionContext:
    response = client.post("/session/demarrer", json={"niveau_scolaire": niveau})
    response.raise_for_status()
    payload = response.json()
    return SessionContext(
        client=client,
        session_id=payload["session_id"],
        niveau=niveau,
        exercice=payload["exercice"],
        progression=payload["progression"],
    )


def post_eval(context: SessionContext, answer: str) -> dict:
    response = context.client.post(
        "/evaluer",
        json={
            "session_id": context.session_id,
            "exercice_id": context.exercice["id"],
            "reponse_donnee": answer,
        },
    )
    response.raise_for_status()
    payload = response.json()
    context.progression = payload["progression"]
    context.exercice = payload.get("exercice_suivant", context.exercice)
    return payload


def post_tutor(context: SessionContext, question: str) -> dict:
    response = context.client.post(
        "/tuteur/aide",
        json={
            "session_id": context.session_id,
            "exercice_id": context.exercice["id"],
            "niveau": context.niveau,
            "question": question,
        },
    )
    if response.status_code == 200:
        payload = response.json()
        context.progression = payload["progression"]
        return payload

    if response.status_code == 503:
        session_response = context.client.get(f"/session/{context.session_id}")
        session_response.raise_for_status()
        context.progression = session_response.json()
        return {
            "http_status": 503,
            "detail": response.json()["detail"],
            "progression": context.progression,
        }

    response.raise_for_status()
    raise AssertionError("Reponse tuteur inattendue.")


def ensure_reinforcement_metadata(trace: ConceptTrace, progression: dict, statut: str) -> None:
    if progression["phase"] != "renforcement" or trace.mastery is not None:
        return
    trace.mastery = progression["maitrise_actuelle"]
    trace.reinforcement_planned = progression["exercices_renforcement_restants"]
    trace.reinforcement_started_with_status = statut


def simulate_concept(
    context: SessionContext,
    concept_behavior: Callable[[SessionContext, ConceptTrace], None],
) -> ConceptTrace:
    trace = ConceptTrace(concept=context.progression["concept_courant"])
    while True:
        before = context.progression.copy()
        concept_behavior(context, trace)
        after = context.progression

        if (
            before["phase"] == "renforcement"
            and before["niveau_resolution_courant"] == 3
            and trace.statuses
            and trace.statuses[-1] in {"correct_nouveau_renforcement", "correct_concept_debloque", "carte_terminee"}
        ):
            trace.reinforcement_exercises_completed += 1

        if after["concept_courant"] != trace.concept or after["terminee"]:
            return trace


def brilliant_behavior(context: SessionContext, trace: ConceptTrace) -> None:
    payload = post_eval(context, answer_for(context.exercice))
    trace.statuses.append(payload["statut"])
    ensure_reinforcement_metadata(trace, payload["progression"], payload["statut"])


def difficult_behavior(context: SessionContext, trace: ConceptTrace) -> None:
    wrong = post_eval(context, wrong_answer_for(context.exercice))
    trace.statuses.append(wrong["statut"])
    assert wrong["statut"] == "incorrect", f"Echec attendu, obtenu: {wrong['statut']}"

    payload = post_eval(context, answer_for(context.exercice))
    trace.statuses.append(payload["statut"])
    ensure_reinforcement_metadata(trace, payload["progression"], payload["statut"])


def average_behavior(context: SessionContext, trace: ConceptTrace) -> None:
    level = context.progression["niveau_resolution_courant"]
    if context.progression["phase"] == "detection_maitrise" and level == 3 and trace.mastery is None:
        wrong = post_eval(context, wrong_answer_for(context.exercice))
        trace.statuses.append(wrong["statut"])
        assert wrong["statut"] == "incorrect", f"Echec attendu, obtenu: {wrong['statut']}"

    payload = post_eval(context, answer_for(context.exercice))
    trace.statuses.append(payload["statut"])
    ensure_reinforcement_metadata(trace, payload["progression"], payload["statut"])


def tutor_abuse_behavior(context: SessionContext, trace: ConceptTrace) -> None:
    level = context.progression["niveau_resolution_courant"]
    if context.progression["phase"] == "detection_maitrise" and level == 2 and not trace.tutor_calls:
        tutor = post_tutor(context, f"Aide-moi au niveau {level}.")
        trace.tutor_calls.append(f"niveau {level}")
        trace.tutor_results.append(f"HTTP {tutor.get('http_status', 200)}")
        assert tutor["progression"]["erreurs_sur_chaine_actuelle"], (
            "L'appel tuteur au niveau 2 doit casser la chaine parfaite."
        )

    payload = post_eval(context, answer_for(context.exercice))
    trace.statuses.append(payload["statut"])
    ensure_reinforcement_metadata(trace, payload["progression"], payload["statut"])


def run_profile(
    client: TestClient,
    profile_name: str,
    concept_behavior: Callable[[SessionContext, ConceptTrace], None],
    validator: Callable[[list[ConceptTrace]], None],
) -> list[ConceptTrace]:
    reset_state()
    context = start_session(client)
    traces: list[ConceptTrace] = []
    for _ in range(CONCEPTS_TO_SIMULATE):
        traces.append(simulate_concept(context, concept_behavior))
        if context.progression["terminee"]:
            break

    assert len(traces) == CONCEPTS_TO_SIMULATE, (
        f"{profile_name}: {CONCEPTS_TO_SIMULATE} concepts attendus, obtenus {len(traces)}."
    )
    validator(traces)
    return traces


def validate_brilliant(traces: list[ConceptTrace]) -> None:
    for trace in traces:
        assert trace.mastery == 3, f"{trace.concept}: maitrise 3 attendue, obtenu {trace.mastery}"
        assert trace.reinforcement_planned == 2, (
            f"{trace.concept}: 2 renforcements attendus, obtenu {trace.reinforcement_planned}"
        )
        assert trace.reinforcement_exercises_completed == 2, (
            f"{trace.concept}: 2 exercices de renforcement attendus, obtenu {trace.reinforcement_exercises_completed}"
        )


def validate_difficult(traces: list[ConceptTrace]) -> None:
    for trace in traces:
        assert trace.mastery == 1, f"{trace.concept}: maitrise 1 attendue, obtenu {trace.mastery}"
        assert trace.reinforcement_planned == 4, (
            f"{trace.concept}: 4 renforcements attendus, obtenu {trace.reinforcement_planned}"
        )
        assert trace.reinforcement_exercises_completed == 4, (
            f"{trace.concept}: 4 exercices de renforcement attendus, obtenu {trace.reinforcement_exercises_completed}"
        )


def validate_average(traces: list[ConceptTrace]) -> None:
    for trace in traces:
        assert trace.mastery == 2, (
            f"{trace.concept}: maitrise 2 attendue apres un echec au niveau 3, obtenu {trace.mastery}"
        )
        assert trace.reinforcement_planned == 3, (
            f"{trace.concept}: 3 renforcements attendus, obtenu {trace.reinforcement_planned}"
        )
        assert trace.reinforcement_exercises_completed == 3, (
            f"{trace.concept}: 3 exercices de renforcement attendus, obtenu {trace.reinforcement_exercises_completed}"
        )
        assert any(status == "incorrect" for status in trace.statuses), (
            f"{trace.concept}: un echec au niveau 3 devait etre observe."
        )


def validate_tutor_abuse(traces: list[ConceptTrace]) -> None:
    for trace in traces:
        assert trace.mastery is not None and trace.mastery != 3, (
            f"{trace.concept}: la maitrise ne doit pas rester a 3 apres recours au tuteur, obtenu {trace.mastery}"
        )
        assert trace.tutor_calls, f"{trace.concept}: au moins un appel tuteur attendu."


def format_trace(trace: ConceptTrace) -> str:
    tutor = ", ".join(trace.tutor_calls) if trace.tutor_calls else "aucun"
    tutor_results = ", ".join(trace.tutor_results) if trace.tutor_results else "aucun"
    return (
        f"- Concept: {trace.concept}\n"
        f"  maitrise: {trace.mastery}\n"
        f"  renforcements prevus: {trace.reinforcement_planned}\n"
        f"  renforcements completes: {trace.reinforcement_exercises_completed}\n"
        f"  appels tuteur: {tutor}\n"
        f"  resultat tuteur: {tutor_results}\n"
        f"  statuts: {', '.join(trace.statuses)}"
    )


def run_stability_test(client: TestClient) -> None:
    reset_state()
    context = start_session(client)
    initial = context.progression.copy()
    statuses: list[str] = []

    for _ in range(10):
        payload = post_eval(context, wrong_answer_for(context.exercice))
        statuses.append(payload["statut"])
        assert payload["statut"] == "incorrect", f"Stabilite: 'incorrect' attendu, obtenu {payload['statut']}"
        assert payload["progression"]["concept_courant"] == initial["concept_courant"]
        assert payload["progression"]["phase"] == initial["phase"]
        assert payload["progression"]["niveau_resolution_courant"] == initial["niveau_resolution_courant"]

    print("=== Profil de robustesse : echecs en boucle ===")
    print(f"- Concept stable: {context.progression['concept_courant']}")
    print(f"- Statuts recus: {', '.join(statuses)}")
    print("- Resultat: aucune erreur serveur, aucune progression absurde.")
    print()


def main() -> None:
    client = TestClient(app)

    profiles = [
        ("ELEVE BRILLANT", brilliant_behavior, validate_brilliant),
        ("ELEVE EN DIFFICULTE", difficult_behavior, validate_difficult),
        ("ELEVE MOYEN", average_behavior, validate_average),
        ("ELEVE QUI ABUSE DU TUTEUR", tutor_abuse_behavior, validate_tutor_abuse),
    ]

    for profile_name, behavior, validator in profiles:
        traces = run_profile(client, profile_name, behavior, validator)
        print(f"=== {profile_name} ===")
        for trace in traces:
            print(format_trace(trace))
        print("- Asserts: OK")
        print()

    run_stability_test(client)
    print("Tous les asserts des 4 profils et du test de robustesse sont passes.")


if __name__ == "__main__":
    main()
