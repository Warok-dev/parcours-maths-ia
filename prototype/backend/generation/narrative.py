from __future__ import annotations

from datetime import datetime, timezone


def generate_narrative_exercise(niveau: str) -> dict:
    """Return a deterministic mock exercise for narrative generation."""
    # TODO: Replace this stub with a Gemini few-shot call using GEMINI_API_KEY.
    total = 8 if niveau == "CE1" else 13
    part = 3 if niveau == "CE1" else 5
    answer = total - part
    personnage = "Yasmine" if niveau == "CE1" else "Samir"
    objet = "billes" if niveau == "CE1" else "autocollants"
    enonce = (
        f"{personnage} a {total} {objet}. "
        f"Elle en donne {part}. Combien lui en reste-t-il ?"
    )

    return {
        "id": f"{niveau}-mock-llm-001",
        "niveau_scolaire": niveau,
        "matiere": "mathematiques",
        "pattern": {
            "pattern_name": "mock_pattern_narratif",
            "pattern_family": "probleme_narratif_simple",
            "generation_method": "llm",
        },
        "variables": {"total": total, "partie_connue": part},
        "contexte_narratif": {
            "personnage": personnage,
            "objet": objet,
            "action": "donne",
            "question_restante": "Combien lui en reste-t-il ?",
        },
        "enonce": enonce,
        "reponse_attendue": {
            "valeur": answer,
            "format": "nombre_entier",
            "tolerance": {
                "ignorer_espaces": True,
                "equivalences_acceptees": [str(answer)],
            },
        },
        "presentations": {
            "1_guide": {
                "aide_affichee": True,
                "etapes_methode": [
                    f"Repere le total: {total}.",
                    f"Repere ce qui part: {part}.",
                    f"{total} - {part} = {answer}",
                ],
            },
            "2_semi_guide": {
                "aide_affichee": False,
                "correction_apres_coup": True,
            },
            "3_autonome": {
                "aide_affichee": False,
                "correction_apres_coup": False,
            },
        },
        "jeu": {"etape_id": None, "chemin_id": None},
        "metadata": {
            "source_pattern_occurrence_count": 1,
            "fichiers_source": [],
            "genere_le": datetime.now(timezone.utc).isoformat(),
            "verifie_manuellement": False,
        },
    }
