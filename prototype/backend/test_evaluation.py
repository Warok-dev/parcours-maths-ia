import unittest

from evaluation import compare_reponse


def _attendue(valeur, equivalences=None, ignorer_espaces=True):
    return {
        "valeur": valeur,
        "format": "expression",
        "tolerance": {
            "ignorer_espaces": ignorer_espaces,
            "equivalences_acceptees": equivalences or [],
        },
    }


class TestCompareReponse(unittest.TestCase):
    def test_egalite_directe_nombre(self) -> None:
        self.assertTrue(compare_reponse("70", {"valeur": 70})["correct"])
        self.assertFalse(compare_reponse("71", {"valeur": 70})["correct"])

    def test_equivalence_declaree(self) -> None:
        attendue = _attendue("70 = 7 x 10", ["7 x 10"])
        self.assertTrue(compare_reponse("7x10", attendue)["correct"])

    def test_multiplication_commutative_sans_total(self) -> None:
        attendue = _attendue("70 = 7 x 10", ["7 x 10", "70=7x10"])
        self.assertTrue(compare_reponse("10 x 7", attendue)["correct"])

    def test_multiplication_commutative_avec_total(self) -> None:
        attendue = _attendue("70 = 7 x 10")
        self.assertTrue(compare_reponse("70 = 10 x 7", attendue)["correct"])

    def test_multiplication_signes_equivalents(self) -> None:
        attendue = _attendue("70 = 7 x 10")
        self.assertTrue(compare_reponse("70 = 10 × 7", attendue)["correct"])
        self.assertTrue(compare_reponse("70 = 10 * 7", attendue)["correct"])

    def test_multiplication_mauvais_facteurs_refusee(self) -> None:
        attendue = _attendue("70 = 7 x 10")
        self.assertFalse(compare_reponse("70 = 5 x 14", attendue)["correct"])
        self.assertFalse(compare_reponse("70 = 7 x 11", attendue)["correct"])

    def test_multiplication_mauvais_total_refusee(self) -> None:
        attendue = _attendue("70 = 7 x 10")
        self.assertFalse(compare_reponse("71 = 10 x 7", attendue)["correct"])

    def test_pas_de_commutativite_hors_multiplication(self) -> None:
        attendue = {"valeur": "10 - 7", "tolerance": {"ignorer_espaces": True}}
        self.assertFalse(compare_reponse("7 - 10", attendue)["correct"])

    def test_soustraction_resultat_apres_ou_absent(self) -> None:
        attendue = _attendue("8 = 13 - 5")
        self.assertTrue(compare_reponse("13 - 5 = 8", attendue)["correct"])
        self.assertTrue(compare_reponse("13 - 5", attendue)["correct"])
        self.assertTrue(compare_reponse("8 = 13 - 5", attendue)["correct"])

    def test_soustraction_ordre_operandes_fige(self) -> None:
        attendue = _attendue("8 = 13 - 5")
        # Inverser les termes change le sens : refuse.
        self.assertFalse(compare_reponse("5 - 13", attendue)["correct"])
        self.assertFalse(compare_reponse("5 - 13 = 8", attendue)["correct"])

    def test_soustraction_mauvais_resultat_refuse(self) -> None:
        attendue = _attendue("8 = 13 - 5")
        self.assertFalse(compare_reponse("13 - 5 = 9", attendue)["correct"])


class TestComparaisonNumerique(unittest.TestCase):
    """Un nombre se compare par sa VALEUR, pas par son texte."""

    def _ok(self, reponse, valeur, **extra) -> bool:
        return compare_reponse(reponse, {"valeur": valeur, **extra})["correct"]

    def test_zeros_non_significatifs(self) -> None:
        self.assertTrue(self._ok("08", "8"))
        self.assertTrue(self._ok("3,50", "3,5"))

    def test_virgule_ou_point(self) -> None:
        self.assertTrue(self._ok("3.5", "3,5"))
        self.assertTrue(self._ok("3,5", "3.5"))

    def test_espaces_de_milliers(self) -> None:
        sans_tolerance = {"tolerance": {"ignorer_espaces": False}}
        self.assertTrue(self._ok("1 000", "1000", **sans_tolerance))
        self.assertTrue(self._ok("12\u00a0500", "12500", **sans_tolerance))
        # Un espace qui n'est pas un separateur de milliers ne fabrique pas
        # un nombre.
        self.assertFalse(self._ok("12 5", "125", **sans_tolerance))

    def test_valeur_differente_refusee(self) -> None:
        self.assertFalse(self._ok("7", "70"))
        self.assertFalse(self._ok("3,49", "3,5"))

    def test_pas_de_nombre_avec_suffixe(self) -> None:
        # Volontairement strict : une unite ou un point final n'est pas
        # interprete (l'exercice pourrait attendre une autre unite).
        self.assertFalse(self._ok("12 cm", "12"))
        self.assertFalse(self._ok("12.", "12"))

    def test_equivalence_numerique(self) -> None:
        attendue = {"valeur": "a", "tolerance": {"equivalences_acceptees": ["0,5"]}}
        self.assertTrue(compare_reponse("0.50", attendue)["correct"])

    def test_expressions_inchangees(self) -> None:
        attendue = _attendue("8 = 13 - 5")
        self.assertFalse(compare_reponse("8", attendue)["correct"])


class TestComparaisonHeure(unittest.TestCase):
    def setUp(self) -> None:
        self.attendue = {
            "valeur": "3:00",
            "format": "heure",
            "tolerance": {"ignorer_espaces": True, "equivalences_acceptees": ["3h00"]},
        }

    def test_ecritures_equivalentes(self) -> None:
        for reponse in ("03:00", "3h", "3 h", "3H00", "3:00"):
            with self.subTest(reponse=reponse):
                self.assertTrue(compare_reponse(reponse, self.attendue)["correct"])

    def test_heures_fausses_ou_invalides(self) -> None:
        for reponse in ("4:00", "3:30", "3:60", "3"):
            with self.subTest(reponse=reponse):
                self.assertFalse(compare_reponse(reponse, self.attendue)["correct"])

    def test_heure_seulement_pour_le_format_heure(self) -> None:
        attendue = {"valeur": "3:00"}
        self.assertFalse(compare_reponse("3h", attendue)["correct"])


if __name__ == "__main__":
    unittest.main()
