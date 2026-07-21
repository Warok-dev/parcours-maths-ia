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


if __name__ == "__main__":
    unittest.main()
