"""Tests de la limitation de debit (rate limiting).

Le limiteur est desactive par defaut (pour ne pas brider la suite) ; on l'active
explicitement ici, et on le reinitialise entre chaque test pour l'isolation.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import comptes
import rate_limit
from database import create_db_engine, init_db
from main import app


class RateLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        testing_session = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )

        def override_get_db():
            db = testing_session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        comptes._reset_tokens()
        # Active le limiteur pour CE test, sur des compteurs vierges.
        rate_limit.reinitialiser()
        rate_limit.activer()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        # Remet le limiteur dans l'etat par defaut (desactive + vide) : les
        # autres tests ne doivent jamais etre brides.
        rate_limit.desactiver()
        rate_limit.reinitialiser()
        app.dependency_overrides.clear()
        comptes._reset_tokens()
        self.engine.dispose()

    def _connexion_eleve(self):
        # Eleve inexistant : le corps renvoie 403 (tant que la limite n'est pas
        # atteinte). Ce qui nous interesse est le passage a 429.
        return self.client.post(
            "/eleve/999/connexion", json={"code_classe": "CE1-X-00", "pin": "0000"}
        )

    # ---------- La limite stricte declenche un 429 ----------
    def test_depassement_limite_stricte_donne_429(self) -> None:
        # LIMITE_AUTH = 10/minute : 10 requetes passent (403), la 11e -> 429.
        statuts = [self._connexion_eleve().status_code for _ in range(10)]
        self.assertTrue(all(s != 429 for s in statuts), statuts)
        onzieme = self._connexion_eleve()
        self.assertEqual(onzieme.status_code, 429)
        # Message clair et adapte a l'enfant (endpoint cote eleve), pas technique.
        detail = onzieme.json()["detail"]
        self.assertIn("trop vite", detail.lower())
        self.assertIn("retry-after", {k.lower() for k in onzieme.headers})

    # ---------- La limite se reinitialise (fenetre ecoulee -> compteurs vides) ----------
    def test_reinitialisation_reautorise(self) -> None:
        for _ in range(11):
            self._connexion_eleve()
        self.assertEqual(self._connexion_eleve().status_code, 429)  # bloque
        # reinitialiser() simule l'ecoulement de la fenetre de temps.
        rate_limit.reinitialiser()
        self.assertNotEqual(self._connexion_eleve().status_code, 429)  # de nouveau OK

    # ---------- Les autres endpoints ne sont pas affectes par la limite d'un autre ----------
    def test_autres_endpoints_non_affectes(self) -> None:
        for _ in range(11):
            self._connexion_eleve()
        self.assertEqual(self._connexion_eleve().status_code, 429)  # connexion eleve bloquee
        # Un endpoint sans limite stricte reste disponible (compteur general large).
        self.assertEqual(self.client.get("/health").status_code, 200)
        # Un AUTRE endpoint strict (connexion enseignant) a son PROPRE compteur :
        # il n'est pas bloque par le bruteforce sur le PIN eleve.
        rep = self.client.post(
            "/enseignant/connexion", json={"identifiant": "inconnu", "mot_de_passe": "x"}
        )
        self.assertEqual(rep.status_code, 401)  # 401 (mauvais identifiant), pas 429

    def test_message_standard_pour_endpoint_non_enfant(self) -> None:
        # La connexion enseignant est cote adulte : message standard (pas enfant).
        for _ in range(10):
            self.client.post(
                "/enseignant/connexion", json={"identifiant": "inconnu", "mot_de_passe": "x"}
            )
        rep = self.client.post(
            "/enseignant/connexion", json={"identifiant": "inconnu", "mot_de_passe": "x"}
        )
        self.assertEqual(rep.status_code, 429)
        self.assertNotIn("trop vite", rep.json()["detail"].lower())

    # ---------- Limiteur desactive : aucun bridage (protege la suite existante) ----------
    def test_desactive_aucune_limite(self) -> None:
        rate_limit.desactiver()
        statuts = [self._connexion_eleve().status_code for _ in range(20)]
        self.assertTrue(all(s != 429 for s in statuts), statuts)


class LimitesSalleDeClasseTests(unittest.TestCase):
    """Une classe entiere partage une IP : les limites ne doivent pas bloquer
    des eleves differents, tout en bridant la force brute sur UN eleve."""

    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        fabrique = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)

        def override_get_db():
            db = fabrique()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        rate_limit.reinitialiser()
        rate_limit.activer()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        rate_limit.desactiver()
        rate_limit.reinitialiser()
        app.dependency_overrides.clear()
        self.engine.dispose()

    def test_trente_eleves_se_connectent_depuis_la_meme_ip(self) -> None:
        statuts = [
            self.client.post(
                f"/eleve/{1000 + i}/connexion", json={"code_classe": "CE1-X-AAAAA", "pin": "0000"}
            ).status_code
            for i in range(30)
        ]
        self.assertNotIn(429, statuts)

    def test_force_brute_sur_un_eleve_toujours_bridee(self) -> None:
        statuts = [
            self.client.post(
                "/eleve/7/connexion", json={"code_classe": "CE1-X-AAAAA", "pin": "0000"}
            ).status_code
            for i in range(11)
        ]
        self.assertEqual(statuts[-1], 429)

    def test_inscription_enseignant_limitee(self) -> None:
        from limits import parse

        n = parse(rate_limit.LIMITE_INSCRIPTION).amount
        statuts = [
            self.client.post(
                "/enseignant/inscription",
                json={"nom": "P", "identifiant": f"prof{i}", "mot_de_passe": "secret123"},
            ).status_code
            for i in range(n + 1)
        ]
        self.assertEqual(statuts[:n], [201] * n)
        self.assertEqual(statuts[n], 429)


class IpClientTests(unittest.TestCase):
    def _requete(self, xff: str | None, directe: str = "10.0.0.1"):
        from starlette.requests import Request

        headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
        return Request({"type": "http", "headers": headers, "client": (directe, 1234)})

    def test_sans_proxy_de_confiance_l_en_tete_est_ignore(self) -> None:
        with patch.object(rate_limit, "TRUSTED_PROXY_HOPS", 0):
            self.assertEqual(rate_limit.ip_client(self._requete("1.2.3.4")), "10.0.0.1")

    def test_un_proxy_prend_la_derniere_entree(self) -> None:
        with patch.object(rate_limit, "TRUSTED_PROXY_HOPS", 1):
            # "6.6.6.6" a ete injecte par le client : ignore.
            requete = self._requete("6.6.6.6, 203.0.113.9")
            self.assertEqual(rate_limit.ip_client(requete), "203.0.113.9")

    def test_deux_proxys(self) -> None:
        with patch.object(rate_limit, "TRUSTED_PROXY_HOPS", 2):
            requete = self._requete("6.6.6.6, 203.0.113.9, 172.16.0.5")
            self.assertEqual(rate_limit.ip_client(requete), "203.0.113.9")

    def test_en_tete_absent_ou_trop_court(self) -> None:
        with patch.object(rate_limit, "TRUSTED_PROXY_HOPS", 2):
            self.assertEqual(rate_limit.ip_client(self._requete(None)), "10.0.0.1")
            self.assertEqual(rate_limit.ip_client(self._requete("1.1.1.1")), "10.0.0.1")


if __name__ == "__main__":
    unittest.main()
