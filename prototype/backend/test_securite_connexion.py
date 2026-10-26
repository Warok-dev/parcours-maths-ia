"""Tests du durcissement de l'entree eleve (code de classe + PIN).

Couvre :
- le code de classe non devinable (secrets, grand espace) ;
- la limite de debit sur GET /classe/rejoindre/{code} (anti enumeration des
  prenoms d'enfants) ;
- le verrouillage du PIN PAR ELEVE apres trop d'echecs, son expiration, sa
  remise a zero au succes et a la reinitialisation du PIN ;
- la micro-migration qui ajoute les colonnes de verrouillage a une base
  existante.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, sessionmaker

import comptes
import rate_limit
from database import Eleve, create_db_engine, generer_code_classe, init_db
from main import app


class _BaseConnexion(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )

        def override_get_db():
            db = self.session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[comptes.get_db] = override_get_db
        comptes._reset_tokens()
        rate_limit.reinitialiser()
        rate_limit.desactiver()
        self.client = TestClient(app)

        # Un enseignant, une classe, un eleve.
        self.client.post(
            "/enseignant/inscription",
            json={"nom": "Prof", "identifiant": "prof1", "mot_de_passe": "secret123"},
        )
        token = self.client.post(
            "/enseignant/connexion", json={"identifiant": "prof1", "mot_de_passe": "secret123"}
        ).json()["token"]
        self.auth = {"Authorization": f"Bearer {token}"}
        self.classe = self.client.post(
            "/classe", json={"nom": "Les Renards", "niveau_scolaire": "CE1"}, headers=self.auth
        ).json()
        self.eleve = self.client.post(
            f"/classe/{self.classe['id']}/eleve", json={"prenom": "Lea"}, headers=self.auth
        ).json()

    def tearDown(self) -> None:
        rate_limit.desactiver()
        rate_limit.reinitialiser()
        app.dependency_overrides.clear()
        comptes._reset_tokens()
        self.engine.dispose()

    def _connexion(self, pin: str, code: str | None = None):
        return self.client.post(
            f"/eleve/{self.eleve['id']}/connexion",
            json={"code_classe": code or self.classe["code_classe"], "pin": pin},
        )

    def _mauvais_pin(self) -> str:
        return "0000" if self.eleve["pin"] != "0000" else "1111"

    def _eleve_en_base(self) -> Eleve:
        with self.session_factory() as db:
            return db.get(Eleve, self.eleve["id"])


class CodeClasseTests(unittest.TestCase):
    def test_code_non_devinable(self) -> None:
        codes = {generer_code_classe("CE2") for _ in range(500)}
        # Avec l'ancien format (1 260 codes par niveau), 500 tirages donnaient
        # presque surement des doublons ; ici, aucun.
        self.assertEqual(len(codes), 500)
        for code in codes:
            self.assertRegex(code, r"^CE2-[A-Z]+-[A-HJKMNP-Z2-9]{5}$")


class RejoindreClasseTests(_BaseConnexion):
    def test_code_insensible_a_la_casse_et_aux_espaces(self) -> None:
        code = f"  {self.classe['code_classe'].lower()} "
        reponse = self.client.get(f"/classe/rejoindre/{code}")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.json()["classe"]["id"], self.classe["id"])

    def test_connexion_accepte_le_code_en_minuscules(self) -> None:
        reponse = self._connexion(self.eleve["pin"], code=self.classe["code_classe"].lower())
        self.assertEqual(reponse.status_code, 200)

    def test_rejoindre_est_limite_par_ip(self) -> None:
        rate_limit.activer()
        statuts = [
            self.client.get(f"/classe/rejoindre/CE1-LOUP-ZZZZ{i}").status_code for i in range(12)
        ]
        self.assertEqual(statuts[:10], [404] * 10)
        self.assertEqual(statuts[10], 429)
        # Message adapte a l'enfant (c'est lui qui saisit le code).
        reponse = self.client.get(f"/classe/rejoindre/{self.classe['code_classe']}")
        self.assertEqual(reponse.status_code, 429)
        self.assertEqual(reponse.json()["detail"], rate_limit._MESSAGE_ENFANT)


class VerrouPinTests(_BaseConnexion):
    def test_verrou_apres_echecs_meme_avec_le_bon_pin(self) -> None:
        for _ in range(comptes.PIN_ECHECS_MAX):
            self.assertEqual(self._connexion(self._mauvais_pin()).status_code, 403)

        # Verrouille : meme le BON PIN est refuse, avec un message clair.
        reponse = self._connexion(self.eleve["pin"])
        self.assertEqual(reponse.status_code, 429)
        self.assertEqual(reponse.json()["detail"], comptes.MESSAGE_PIN_VERROUILLE)
        self.assertGreater(int(reponse.headers["Retry-After"]), 0)

    def test_echecs_sous_le_seuil_puis_succes_remet_a_zero(self) -> None:
        for _ in range(comptes.PIN_ECHECS_MAX - 1):
            self._connexion(self._mauvais_pin())
        self.assertEqual(self._connexion(self.eleve["pin"]).status_code, 200)
        self.assertEqual(self._eleve_en_base().echecs_pin, 0)

        # Le compteur est reparti de zero : de nouveaux echecs isoles ne
        # verrouillent pas.
        for _ in range(comptes.PIN_ECHECS_MAX - 1):
            self._connexion(self._mauvais_pin())
        self.assertEqual(self._connexion(self.eleve["pin"]).status_code, 200)

    def test_verrou_expire(self) -> None:
        for _ in range(comptes.PIN_ECHECS_MAX):
            self._connexion(self._mauvais_pin())
        with self.session_factory() as db:
            eleve = db.get(Eleve, self.eleve["id"])
            eleve.pin_verrouille_jusqu = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        self.assertEqual(self._connexion(self.eleve["pin"]).status_code, 200)
        self.assertIsNone(self._eleve_en_base().pin_verrouille_jusqu)

    def test_essais_pendant_le_verrou_ne_comptent_pas(self) -> None:
        for _ in range(comptes.PIN_ECHECS_MAX):
            self._connexion(self._mauvais_pin())
        verrou_initial = self._eleve_en_base().pin_verrouille_jusqu
        for _ in range(3):
            self.assertEqual(self._connexion(self._mauvais_pin()).status_code, 429)
        eleve = self._eleve_en_base()
        self.assertEqual(eleve.echecs_pin, 0)
        self.assertEqual(eleve.pin_verrouille_jusqu, verrou_initial)

    def test_mauvais_code_classe_ne_compte_pas(self) -> None:
        # Sans le code de la classe, on ne peut pas verrouiller un eleve.
        for _ in range(comptes.PIN_ECHECS_MAX + 2):
            self._connexion(self._mauvais_pin(), code="CE1-LOUP-ZZZZZ")
        self.assertEqual(self._eleve_en_base().echecs_pin, 0)
        self.assertEqual(self._connexion(self.eleve["pin"]).status_code, 200)

    def test_reinitialisation_du_pin_debloque(self) -> None:
        for _ in range(comptes.PIN_ECHECS_MAX):
            self._connexion(self._mauvais_pin())
        nouveau = self.client.post(
            f"/classe/{self.classe['id']}/eleve/{self.eleve['id']}/reinitialiser_pin",
            headers=self.auth,
        ).json()["pin"]
        self.assertEqual(self._connexion(nouveau).status_code, 200)


class MigrationVerrouTests(unittest.TestCase):
    def test_colonnes_ajoutees_a_une_base_existante(self) -> None:
        engine = create_db_engine("sqlite://")
        init_db(engine)
        # Simule une base creee avant l'ajout du verrou.
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE eleve DROP COLUMN echecs_pin"))
            conn.execute(text("ALTER TABLE eleve DROP COLUMN pin_verrouille_jusqu"))
        init_db(engine)
        colonnes = {c["name"] for c in inspect(engine).get_columns("eleve")}
        self.assertIn("echecs_pin", colonnes)
        self.assertIn("pin_verrouille_jusqu", colonnes)
        init_db(engine)  # idempotent
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
