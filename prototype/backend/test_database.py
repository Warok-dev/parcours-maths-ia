"""Tests de la fondation de donnees (database.py), isolee des endpoints.

Chaque test utilise une base SQLite EN MEMOIRE fraiche (StaticPool) : rien
n'est ecrit dans backend/data/. Couvre la creation des modeles, les relations,
les contraintes d'unicite, et les comportements de suppression (cascade /
set null).
"""

from __future__ import annotations

import unittest

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import database
from database import (
    Classe,
    Ecole,
    Eleve,
    Enseignant,
    Progression,
    SessionJeu,
    create_db_engine,
    generer_code_classe,
    init_db,
)


class DatabaseModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")  # en memoire (StaticPool)
        init_db(self.engine)
        self.session = Session(self.engine)

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    # --- Fabrique d'une hierarchie complete pour les tests ---
    def _hierarchie(self) -> dict:
        ecole = Ecole(nom="Ecole des Cedres")
        enseignant = Enseignant(
            ecole=ecole, nom="Mme Amrani", identifiant="amrani", mot_de_passe_hash="hash-x"
        )
        classe = Classe(
            enseignant=enseignant, nom="Les Renards", niveau_scolaire="CE1", code_classe="CE1-RENARD-42"
        )
        eleve = Eleve(classe=classe, prenom="Sofia")
        self.session.add(ecole)
        self.session.commit()
        return {"ecole": ecole, "enseignant": enseignant, "classe": classe, "eleve": eleve}

    # ---------- Creation de chaque modele ----------
    def test_creation_de_chaque_modele(self) -> None:
        h = self._hierarchie()
        eleve = h["eleve"]
        prog = Progression(eleve=eleve, pattern_name="addition_pas_a_pas_sans_retenue", lecon_id="addition", maitrise=2)
        sess = SessionJeu(eleve=eleve, niveau_scolaire="CE1", lecon_id="addition")
        self.session.add_all([prog, sess])
        self.session.commit()

        # Ids attribues + dates auto-remplies.
        for objet in (h["ecole"], h["enseignant"], h["classe"], eleve, prog, sess):
            self.assertIsNotNone(objet.id)
        self.assertIsNotNone(h["ecole"].date_creation)
        self.assertIsNotNone(prog.date_derniere_tentative)
        self.assertIsNotNone(sess.date_debut)
        self.assertFalse(sess.termine)  # defaut booleen

    # ---------- Relations ----------
    def test_relations_bidirectionnelles(self) -> None:
        h = self._hierarchie()
        # Ajout d'un second eleve pour verifier la collection.
        self.session.add(Eleve(classe=h["classe"], prenom="Adam"))
        self.session.commit()

        classe = self.session.get(Classe, h["classe"].id)
        self.assertEqual({e.prenom for e in classe.eleves}, {"Sofia", "Adam"})
        self.assertEqual(classe.eleves[0].classe.id, classe.id)  # retour eleve -> classe
        self.assertEqual(h["enseignant"].classes[0].id, classe.id)
        self.assertEqual(h["ecole"].enseignants[0].id, h["enseignant"].id)

    def test_relations_progression_et_session_depuis_eleve(self) -> None:
        h = self._hierarchie()
        eleve = h["eleve"]
        eleve.progressions.append(Progression(pattern_name="multiplication_par_10", lecon_id="multiplication_par_10", maitrise=3))
        eleve.sessions.append(SessionJeu(niveau_scolaire="CE2", lecon_id="multiplication_par_10"))
        self.session.commit()

        rafraichi = self.session.get(Eleve, eleve.id)
        self.assertEqual(len(rafraichi.progressions), 1)
        self.assertEqual(rafraichi.progressions[0].maitrise, 3)
        self.assertEqual(len(rafraichi.sessions), 1)
        self.assertEqual(rafraichi.sessions[0].eleve.id, eleve.id)

    def test_session_invitee_sans_eleve(self) -> None:
        # Mode essai libre : une session peut exister sans eleve (eleve_id nul).
        sess = SessionJeu(niveau_scolaire="CE3", lecon_id="lecture_heure", eleve_id=None)
        self.session.add(sess)
        self.session.commit()
        self.assertIsNone(sess.eleve_id)
        self.assertIsNone(sess.eleve)

    # ---------- Contraintes d'unicite ----------
    def test_unicite_identifiant_enseignant(self) -> None:
        h = self._hierarchie()
        doublon = Enseignant(
            ecole=h["ecole"], nom="Autre", identifiant="amrani", mot_de_passe_hash="hash-y"
        )
        self.session.add(doublon)
        with self.assertRaises(IntegrityError):
            self.session.commit()
        self.session.rollback()

    def test_unicite_code_classe(self) -> None:
        h = self._hierarchie()
        doublon = Classe(
            enseignant=h["enseignant"], nom="Les Loups", niveau_scolaire="CE1", code_classe="CE1-RENARD-42"
        )
        self.session.add(doublon)
        with self.assertRaises(IntegrityError):
            self.session.commit()
        self.session.rollback()

    def test_unicite_progression_eleve_pattern(self) -> None:
        # Une seule ligne par (eleve, pattern) : un doublon est refuse.
        h = self._hierarchie()
        self.session.add(Progression(eleve=h["eleve"], pattern_name="double_via_2xn", maitrise=1))
        self.session.commit()
        self.session.add(Progression(eleve=h["eleve"], pattern_name="double_via_2xn", maitrise=2))
        with self.assertRaises(IntegrityError):
            self.session.commit()
        self.session.rollback()

    # ---------- Suppression : cascade et set null ----------
    def test_suppression_classe_cascade_eleves_et_progressions(self) -> None:
        h = self._hierarchie()
        self.session.add(Progression(eleve=h["eleve"], pattern_name="moitie_via_2xn", maitrise=2))
        self.session.commit()
        classe_id, eleve_id = h["classe"].id, h["eleve"].id

        self.session.delete(h["classe"])
        self.session.commit()

        # La classe, ses eleves et leurs progressions ont disparu.
        self.assertIsNone(self.session.get(Classe, classe_id))
        self.assertIsNone(self.session.get(Eleve, eleve_id))
        restant = self.session.scalars(
            select(Progression).where(Progression.eleve_id == eleve_id)
        ).all()
        self.assertEqual(restant, [])

    def test_suppression_ecole_cascade_toute_la_hierarchie(self) -> None:
        h = self._hierarchie()
        ids = (h["enseignant"].id, h["classe"].id, h["eleve"].id)
        self.session.delete(h["ecole"])
        self.session.commit()
        self.assertIsNone(self.session.get(Enseignant, ids[0]))
        self.assertIsNone(self.session.get(Classe, ids[1]))
        self.assertIsNone(self.session.get(Eleve, ids[2]))

    def test_suppression_eleve_met_sessions_a_null(self) -> None:
        # La session de jeu survit a la suppression de l'eleve (devient anonyme).
        h = self._hierarchie()
        sess = SessionJeu(eleve=h["eleve"], niveau_scolaire="CE1", lecon_id="addition")
        self.session.add(sess)
        self.session.commit()
        sess_id = sess.id

        self.session.delete(h["eleve"])
        self.session.commit()

        survivante = self.session.get(SessionJeu, sess_id)
        self.assertIsNotNone(survivante)
        self.assertIsNone(survivante.eleve_id)

    # ---------- Generateur de code de classe ----------
    def test_generer_code_classe_format(self) -> None:
        import re

        codes = {generer_code_classe("CE1") for _ in range(50)}
        for code in codes:
            self.assertRegex(code, r"^CE1-[A-Z]+-\d{2}$")
        self.assertGreater(len(codes), 1)  # aleatoire : plusieurs codes distincts

    # ---------- init_db idempotent ----------
    def test_init_db_idempotent(self) -> None:
        # Rappeler init_db sur un engine deja initialise ne doit pas echouer.
        init_db(self.engine)
        self.session.add(Ecole(nom="Deux"))
        self.session.commit()
        self.assertEqual(self.session.scalars(select(Ecole)).all().__len__(), 1)


if __name__ == "__main__":
    unittest.main()
