from __future__ import annotations

import unittest

from diagnostic import (
    ERREUR_DISTRACTION,
    INVERSION_OPERANDES,
    OPERATION_INVERSEE,
    RETENUE_OUBLIEE,
    TABLE_MULTIPLICATION_PROCHE,
    ZERO_OUBLIE,
    diagnostiquer_erreur,
)


class DiagnosticTests(unittest.TestCase):
    def test_inversion_operandes_soustraction_partie_tout(self) -> None:
        # tout=9, partie_connue=3 : attendu 9-3=6, l'eleve calcule 3-9=-6.
        self.assertEqual(
            diagnostiquer_erreur(
                "partie_tout_soustraction_non_narratif",
                {"tout": 9, "partie_connue": 3, "partie_manquante": 6},
                6,
                "-6",
            ),
            INVERSION_OPERANDES,
        )

    def test_inversion_operandes_comparaison_narrative(self) -> None:
        # grand=40, petit=15 : attendu 25, l'eleve calcule 15-40=-25.
        self.assertEqual(
            diagnostiquer_erreur(
                "probleme_comparaison_difference",
                {"grand": 40, "petit": 15},
                25,
                "-25",
            ),
            INVERSION_OPERANDES,
        )

    def test_erreur_distraction_reponse_proche(self) -> None:
        # attendu 8, l'eleve donne 9 : +/- 1, erreur d'inattention probable.
        self.assertEqual(
            diagnostiquer_erreur(
                "partie_tout_addition_non_narratif",
                {"partie1": 5, "partie2": 3, "tout": 8},
                8,
                "9",
            ),
            ERREUR_DISTRACTION,
        )

    def test_zero_oublie_multiplication_par_10(self) -> None:
        # 19 x 10 = 190, l'eleve donne 19 (le bon calcul sans le zero final).
        self.assertEqual(
            diagnostiquer_erreur(
                "multiplication_par_10",
                {"a": 19, "total": 190},
                190,
                "19",
            ),
            ZERO_OUBLIE,
        )

    def test_zero_oublie_chiffre_x_multiple_de_10(self) -> None:
        # 3 x 40 = 120, l'eleve donne 12 (3 x 4, zero oublie).
        self.assertEqual(
            diagnostiquer_erreur(
                "multiplication_chiffre_x_multiple_de_10",
                {"a": 3, "b": 4, "b0": 40, "total": 120},
                120,
                "12",
            ),
            ZERO_OUBLIE,
        )

    def test_operation_inversee_addition_au_lieu_de_soustraction(self) -> None:
        # total=9, partie_connue=5 : attendu 9-5=4, l'eleve additionne 9+5=14.
        self.assertEqual(
            diagnostiquer_erreur(
                "probleme_reste_partie_tout",
                {"total": 9, "partie_connue": 5},
                4,
                "14",
            ),
            OPERATION_INVERSEE,
        )

    def test_operation_inversee_soustraction_au_lieu_d_addition(self) -> None:
        # partie1=6, partie2=2 : attendu 6+2=8, l'eleve soustrait 6-2=4.
        self.assertEqual(
            diagnostiquer_erreur(
                "probleme_total_partie_tout",
                {"partie1": 6, "partie2": 2},
                8,
                "4",
            ),
            OPERATION_INVERSEE,
        )

    def test_table_multiplication_proche(self) -> None:
        # 3 x 24 = 72, l'eleve donne 96 = 4 x 24 (table voisine sur le 1er facteur).
        self.assertEqual(
            diagnostiquer_erreur(
                "multiplication_decomposee_chiffre_x_2chiffres",
                {"a": 3, "bc": 24, "b": 2, "c": 4, "b0": 20, "p1": 60, "p2": 12, "total": 72},
                72,
                "96",
            ),
            TABLE_MULTIPLICATION_PROCHE,
        )

    def test_table_multiplication_proche_prioritaire_sur_distraction(self) -> None:
        # 2 x 31 = 62, l'eleve donne 64 = 2 x 32 : signature de table voisine,
        # meme si l'ecart (+2) correspondrait aussi a une distraction.
        self.assertEqual(
            diagnostiquer_erreur(
                "multiplication_decomposee_chiffre_x_2chiffres",
                {"a": 2, "bc": 31, "total": 62},
                62,
                "64",
            ),
            TABLE_MULTIPLICATION_PROCHE,
        )

    def test_aucune_signature_retourne_none(self) -> None:
        # attendu 6, l'eleve donne 42 : aucun rapprochement possible.
        self.assertIsNone(
            diagnostiquer_erreur(
                "partie_tout_soustraction_non_narratif",
                {"tout": 9, "partie_connue": 3},
                6,
                "42",
            )
        )

    def test_reponse_non_numerique_retourne_none(self) -> None:
        self.assertIsNone(
            diagnostiquer_erreur(
                "partie_tout_soustraction_non_narratif",
                {"tout": 9, "partie_connue": 3},
                6,
                "je ne sais pas",
            )
        )

    def test_bonne_reponse_retourne_none(self) -> None:
        self.assertIsNone(
            diagnostiquer_erreur(
                "partie_tout_soustraction_non_narratif",
                {"tout": 9, "partie_connue": 3},
                6,
                "6",
            )
        )


class RetenueOublieeTests(unittest.TestCase):
    def test_addition_posee_sans_la_retenue(self) -> None:
        # 37 + 24 = 61 ; sans la retenue des unites (7 + 4 = 11), l'eleve ecrit 51.
        self.assertEqual(diagnostiquer_erreur("addition_posee", {"a": 37, "b": 24}, 61, 51), RETENUE_OUBLIEE)

    def test_addition_posee_sans_retenue_a_faire(self) -> None:
        # 32 + 24 = 56 : pas de retenue, 46 n'est pas un oubli de retenue.
        self.assertNotEqual(diagnostiquer_erreur("addition_posee", {"a": 32, "b": 24}, 56, 46), RETENUE_OUBLIEE)

    def test_soustraction_posee_sans_l_echange(self) -> None:
        # 52 - 18 = 34 : dizaine echangee non retiree (44) ou 8 - 2 aux unites (46).
        for faux in (44, 46):
            self.assertEqual(diagnostiquer_erreur("soustraction_posee", {"a": 52, "b": 18}, 34, faux), RETENUE_OUBLIEE)

    def test_soustraction_posee_sans_emprunt_a_faire(self) -> None:
        self.assertNotEqual(diagnostiquer_erreur("soustraction_posee", {"a": 58, "b": 12}, 46, 56), RETENUE_OUBLIEE)


if __name__ == "__main__":
    unittest.main()
