"""Cache des reponses du tuteur : meme question generique sur le meme calcul
-> un seul appel LLM ; tout ce qui change la reponse change la cle."""

from __future__ import annotations

import unittest
from unittest.mock import patch

import tutor

EXERCICE = {
    "enonce": "Calcule : 3 + 4 = ...",
    "niveau_scolaire": "CE1",
    "reponse_attendue": {"valeur": 7},
    "presentations": {"1_guide": {"etapes_methode": ["Pars de 3.", "Ajoute 4.", "3 + 4 = 7."]}},
}


class CacheTuteurTests(unittest.TestCase):
    def setUp(self) -> None:
        tutor.CACHE_REPONSES.vider()
        self.appels = 0

        def gemini(_prompt, _instruction):
            self.appels += 1
            return f"Pars de 3 et compte 4 de plus (appel {self.appels})."

        self.patch = patch.object(tutor, "_call_gemini", side_effect=gemini)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        tutor.CACHE_REPONSES.vider()

    def _demander(self, question: str, **kwargs) -> dict:
        return tutor.build_tutor_reply(EXERCICE, question, niveau="CE1", **kwargs)

    def test_meme_question_un_seul_appel(self) -> None:
        premiere = self._demander("Je comprends pas")
        seconde = self._demander("je comprends PAS !!!")
        self.assertEqual(self.appels, 1)
        self.assertFalse(premiere["depuis_cache"])
        self.assertTrue(seconde["depuis_cache"])
        self.assertEqual(premiere["reponse"], seconde["reponse"])
        self.assertEqual(seconde["question_recue"], "je comprends PAS !!!")

    def test_ce_qui_change_la_reponse_change_la_cle(self) -> None:
        self._demander("aide")
        self._demander("aide", essais_faux=3)  # le tuteur peut alors donner la reponse
        self._demander("aide", diagnostic="inversion_operandes")
        tutor.build_tutor_reply({**EXERCICE, "enonce": "Calcule : 5 + 4 = ..."}, "aide", niveau="CE1")
        tutor.build_tutor_reply(EXERCICE, "aide", niveau="CE5")  # autre registre de langue
        self.assertEqual(self.appels, 5)

    def test_essais_au_dela_du_seuil_partagent_la_cle(self) -> None:
        self._demander("aide", essais_faux=3)
        self._demander("aide", essais_faux=7)
        self.assertEqual(self.appels, 1)

    def test_question_longue_jamais_en_cache(self) -> None:
        longue = "je ne comprends pas pourquoi on doit commencer par le premier nombre et pas par le second nombre"
        self._demander(longue)
        self._demander(longue)
        self.assertEqual(self.appels, 2)

    def test_echec_jamais_mis_en_cache(self) -> None:
        with patch.object(tutor, "_call_gemini", side_effect=RuntimeError("quota")), \
             patch.object(tutor, "_call_groq", side_effect=RuntimeError("quota")), \
             patch.object(tutor, "_call_mistral", side_effect=RuntimeError("quota")):
            with self.assertRaises(tutor.TutorServiceError):
                self._demander("aide")
        self._demander("aide")
        self.assertEqual(self.appels, 1)
        self.assertEqual(len(tutor.CACHE_REPONSES), 1)

    def test_prenom_masque_avant_la_cle(self) -> None:
        self._demander("Lina comprend pas", prenoms=("Lina",))
        reponse = self._demander("Sami comprend pas", prenoms=("Sami",))
        self.assertTrue(reponse["depuis_cache"], "les deux questions deviennent « l'eleve comprend pas »")

    def test_lru_borne_et_expiration(self) -> None:
        cache = tutor._CacheReponses(taille=2, duree_s=0)
        for i in range(3):
            cache.ecrire(str(i), {"reponse": i})
        self.assertIsNone(cache.lire("0"))
        self.assertEqual(cache.lire("2"), {"reponse": 2})
        expirant = tutor._CacheReponses(taille=5, duree_s=60)
        expirant.ecrire("a", {"reponse": 1})
        with patch.object(tutor.time, "monotonic", return_value=tutor.time.monotonic() + 61):
            self.assertIsNone(expirant.lire("a"))

    def test_normalisation(self) -> None:
        self.assertEqual(tutor.normaliser_question("  Aiiide-moi,  STP ! "), "aide moi stp")
        self.assertEqual(tutor.normaliser_question("Je n'ai pas compris l'énoncé"), "je n ai pas compris l enonce")


if __name__ == "__main__":
    unittest.main()
