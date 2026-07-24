"""Tests des univers thematiques de la generation narrative.

Promesse verifiee ici : chaque theme ne propose QUE ses propres
personnages et objets, jamais ceux d'un autre theme, et la validation
stricte deja en place s'applique a l'identique dans tous les univers.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from generation import narrative

# Un pattern par ordre de grandeur d'objets, pour couvrir les trois pools.
PATTERNS_PAR_POOL = {
    "small_count": ("probleme_reste_partie_tout", "CE1", {"total": 8, "partie_connue": 3}),
    "medium_count": ("probleme_comparaison_difference", "CE2", {"grand": 91, "petit": 41}),
    "grouped_count": ("probleme_groupes_egaux_total", "CE2", {"group_count": 5, "group_size": 8}),
}

THEMES_ALTERNATIFS = [t for t in narrative.themes_disponibles() if t != narrative.THEME_NEUTRE]


class ThemeBanksTests(unittest.TestCase):
    def setUp(self) -> None:
        narrative.RECENT_CONTEXTS.clear()

    def test_catalogue_complet_et_structure_identique(self) -> None:
        self.assertIn(narrative.THEME_NEUTRE, narrative.themes_disponibles())
        # 5 univers + le neutre demande par le cahier des charges.
        self.assertGreaterEqual(len(narrative.themes_disponibles()), 6)

        for theme in narrative.themes_disponibles():
            with self.subTest(theme=theme):
                banks = narrative._theme_banks(theme)
                self.assertTrue(banks["nom"])
                self.assertTrue(banks["univers"])
                self.assertGreaterEqual(len(banks["personnages"]), 10)
                # Les trois ordres de grandeur doivent exister partout, sinon
                # _choose_object_pool n'aurait plus de quoi piocher.
                for taille in ("small_count", "medium_count", "grouped_count"):
                    self.assertGreaterEqual(len(banks["objets"][taille]), 10)

    def test_aucun_chiffre_dans_les_banques(self) -> None:
        """La validation refuse les chiffres : les banques ne doivent pas en
        contenir, sinon une sortie pourtant conforme serait rejetee."""
        for theme in narrative.themes_disponibles():
            banks = narrative._theme_banks(theme)
            valeurs = list(banks["personnages"])
            for pool in banks["objets"].values():
                valeurs.extend(pool)
            for valeur in valeurs:
                with self.subTest(theme=theme, valeur=valeur):
                    self.assertIsNone(narrative.NUMBER_RE.search(valeur))

    def test_le_neutre_conserve_les_banques_historiques(self) -> None:
        self.assertEqual(narrative.personnages_pour_theme(narrative.THEME_NEUTRE), narrative.PERSONNAGES)
        self.assertEqual(
            narrative._theme_banks(narrative.THEME_NEUTRE)["objets"],
            narrative.OBJECT_POOLS,
        )
        # Theme absent ou inconnu : repli sur le neutre, jamais d'erreur.
        self.assertEqual(narrative.personnages_pour_theme(None), narrative.PERSONNAGES)
        self.assertEqual(narrative.personnages_pour_theme("licornes"), narrative.PERSONNAGES)

    def test_chaque_theme_a_des_personnages_qui_lui_sont_propres(self) -> None:
        """Les banques peuvent se recouper (des prenoms d'enfants circulent),
        mais chaque univers doit apporter une identite qui n'est qu'a lui."""
        for theme in THEMES_ALTERNATIFS:
            with self.subTest(theme=theme):
                propres = set(narrative.personnages_pour_theme(theme))
                autres: set[str] = set()
                for other in narrative.themes_disponibles():
                    if other != theme:
                        autres |= set(narrative.personnages_pour_theme(other))
                self.assertTrue(
                    propres - autres,
                    f"Le theme '{theme}' n'a aucun personnage qui lui soit propre.",
                )

    def test_pool_dobjets_suit_le_theme_pour_les_trois_grandeurs(self) -> None:
        for taille, (pattern_name, _niveau, variables) in PATTERNS_PAR_POOL.items():
            for theme in narrative.themes_disponibles():
                with self.subTest(taille=taille, theme=theme):
                    pool = narrative._choose_object_pool(pattern_name, variables, theme)
                    self.assertEqual(pool, narrative.objets_pour_theme(theme, taille))

    def test_un_objet_dun_autre_theme_est_refuse(self) -> None:
        """Coeur du sujet : l'objet doit venir de la banque DU theme demande."""
        pattern_name = "probleme_reste_partie_tout"
        objet_foot = "maillots"
        objet_dino = "empreintes"
        self.assertIn(objet_foot, narrative.objets_pour_theme("foot", "small_count"))
        self.assertNotIn(objet_foot, narrative.objets_pour_theme("dinosaures", "small_count"))

        # Le LLM repond avec un objet foot alors que le theme est dinosaures :
        # tous les fournisseurs echouent, on tombe sur le repli procedural.
        with patch(
            "generation.narrative._call_model_json",
            return_value={
                "personnage": "Rex",
                "objet": objet_foot,
                "action": "perd",
                "question": "Combien lui en reste-t-il ?",
            },
        ), patch(
            "generation.narrative._call_groq_json",
            side_effect=narrative.NarrativeGenerationError("groq indisponible"),
        ), patch(
            "generation.narrative._call_mistral_json",
            side_effect=narrative.NarrativeGenerationError("mistral indisponible"),
        ):
            ex = narrative.generate_narrative_exercise("CE1", pattern_name, "dinosaures")
        self.assertEqual(ex["pattern"]["generation_method"], "substitution")

        # Le meme objet, mais pris dans la banque du theme : accepte.
        with patch(
            "generation.narrative._call_model_json",
            return_value={
                "personnage": "Rex",
                "objet": objet_dino,
                "action": "perd",
                "question": "Combien lui en reste-t-il ?",
            },
        ):
            ex = narrative.generate_narrative_exercise("CE1", pattern_name, "dinosaures")
        self.assertEqual(ex["pattern"]["generation_method"], "llm")
        self.assertEqual(ex["contexte_narratif"]["objet"], objet_dino)

    def test_un_personnage_dun_autre_theme_est_refuse(self) -> None:
        personnage_princesse = "Perceval"
        self.assertIn(personnage_princesse, narrative.personnages_pour_theme("princesses"))
        self.assertNotIn(personnage_princesse, narrative.personnages_pour_theme("espace"))

        with patch(
            "generation.narrative._call_model_json",
            return_value={
                "personnage": personnage_princesse,
                "objet": "cristaux",
                "action": "perd",
                "question": "Combien lui en reste-t-il ?",
            },
        ), patch(
            "generation.narrative._call_groq_json",
            side_effect=narrative.NarrativeGenerationError("groq indisponible"),
        ), patch(
            "generation.narrative._call_mistral_json",
            side_effect=narrative.NarrativeGenerationError("mistral indisponible"),
        ):
            ex = narrative.generate_narrative_exercise("CE1", "probleme_reste_partie_tout", "espace")
        self.assertEqual(ex["pattern"]["generation_method"], "substitution")

    def test_exercice_genere_reste_dans_la_banque_de_son_theme(self) -> None:
        """Pour chaque theme, un exercice reellement genere ne contient que du
        vocabulaire de SON univers."""
        pattern_name = "probleme_reste_partie_tout"
        for theme in narrative.themes_disponibles():
            with self.subTest(theme=theme):
                narrative.RECENT_CONTEXTS.clear()
                personnage = narrative.personnages_pour_theme(theme)[0]
                objet = narrative.objets_pour_theme(theme, "small_count")[0]
                with patch(
                    "generation.narrative._call_model_json",
                    return_value={
                        "personnage": personnage,
                        "objet": objet,
                        "action": "perd",
                        "question": "Combien lui en reste-t-il ?",
                    },
                ):
                    ex = narrative.generate_narrative_exercise("CE1", pattern_name, theme)

                contexte = ex["contexte_narratif"]
                self.assertEqual(ex["pattern"]["generation_method"], "llm")
                self.assertEqual(contexte["theme"], theme)
                self.assertIn(contexte["personnage"], narrative.personnages_pour_theme(theme))
                self.assertIn(contexte["objet"], narrative.objets_pour_theme(theme, "small_count"))
                self.assertIn(personnage, ex["enonce"])
                self.assertIn(objet, ex["enonce"])

    def test_le_prompt_annonce_l_univers_et_la_bonne_banque(self) -> None:
        captures: dict[str, str] = {}

        def _capture(prompt: str) -> dict:
            captures["prompt"] = prompt
            return {
                "personnage": "Rex",
                "objet": "oeufs",
                "action": "perd",
                "question": "Combien lui en reste-t-il ?",
            }

        with patch("generation.narrative._call_model_json", side_effect=_capture):
            narrative.generate_narrative_exercise("CE1", "probleme_reste_partie_tout", "dinosaures")

        prompt = captures["prompt"]
        self.assertIn("Univers impose", prompt)
        self.assertIn("Dinosaures", prompt)
        self.assertIn("oeufs", prompt)
        # Le vocabulaire d'un autre univers ne doit pas fuiter dans la consigne.
        self.assertNotIn("maillots", prompt)
        self.assertNotIn("couronnes", prompt)

    def test_validation_stricte_identique_dans_tous_les_univers(self) -> None:
        """Chiffre hallucine, cle manquante, valeur vide : meme refus partout."""
        sorties_invalides = (
            {"personnage": "Rex", "objet": "oeufs", "action": "perd", "question": "Combien de 3 ?"},
            {"personnage": "Rex", "objet": "oeufs", "action": "perd"},
            {"personnage": "", "objet": "oeufs", "action": "perd", "question": "Combien ?"},
            {"personnage": "Rex", "objet": "oeufs", "action": "perd", "question": "Ok", "extra": "x"},
        )
        for theme in narrative.themes_disponibles():
            for sortie in sorties_invalides:
                with self.subTest(theme=theme, sortie=sortie):
                    with self.assertRaises(narrative.NarrativeGenerationError):
                        narrative._validate_llm_payload(sortie)

    def test_historique_recent_cloisonne_par_theme(self) -> None:
        """Changer d'univers ne doit pas trainer les personnages du precedent
        dans les consignes du nouveau."""
        pattern_name = "probleme_reste_partie_tout"
        with patch(
            "generation.narrative._call_model_json",
            return_value={
                "personnage": "Rex",
                "objet": "oeufs",
                "action": "perd",
                "question": "Combien lui en reste-t-il ?",
            },
        ):
            narrative.generate_narrative_exercise("CE1", pattern_name, "dinosaures")

        recents_dino, _ = narrative._recent_constraints(pattern_name, "dinosaures")
        recents_foot, _ = narrative._recent_constraints(pattern_name, "foot")
        self.assertIn("Rex", recents_dino)
        self.assertEqual(recents_foot, [])


if __name__ == "__main__":
    unittest.main()
