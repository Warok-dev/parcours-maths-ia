"""Tests du module notifications (resume hebdomadaire + alerte de blocage).

Base SQLite en memoire, seedee directement (comme test_comptes) : on controle
les dates de derniere tentative et le nombre de tentatives pour verifier les
regles precisement. Aucun envoi reel : envoyer_email est un stub (log).
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy.orm import Session, sessionmaker

import notifications
from database import (
    Classe,
    Ecole,
    Eleve,
    Enseignant,
    Progression,
    create_db_engine,
    init_db,
)


def _il_y_a(jours: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=jours)


class NotificationsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_db_engine("sqlite://")
        init_db(self.engine)
        self.Session = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False, class_=Session
        )
        with self.Session() as db:
            ecole = Ecole(nom="Ecole Test")
            db.add(ecole)
            db.flush()
            enseignant = Enseignant(
                ecole_id=ecole.id, nom="Prof", identifiant="prof", mot_de_passe_hash="x"
            )
            db.add(enseignant)
            db.flush()
            classe = Classe(
                enseignant_id=enseignant.id, nom="Classe", niveau_scolaire="CE2", code_classe="C1"
            )
            db.add(classe)
            db.flush()
            eleve = Eleve(classe_id=classe.id, prenom="Sofia")
            db.add(eleve)
            db.commit()
            self.eleve_id = eleve.id

    def tearDown(self) -> None:
        self.engine.dispose()

    def _seed(self, pattern, maitrise, jours, lecon="lecon_a", nb_tentatives=1):
        """Insere une progression avec une date de derniere tentative controlee."""
        with self.Session() as db:
            p = Progression(
                eleve_id=self.eleve_id,
                pattern_name=pattern,
                lecon_id=lecon,
                maitrise=maitrise,
                nb_tentatives=nb_tentatives,
            )
            db.add(p)
            db.flush()
            # date_derniere_tentative a un default : on la force apres insertion.
            p.date_derniere_tentative = _il_y_a(jours)
            db.commit()

    # ---------- Resume hebdomadaire ----------
    def test_resume_reflette_activite_recente(self) -> None:
        self._seed("addition_simple", 3, jours=1)  # maitrise cette semaine
        self._seed("multiplication_x2", 2, jours=2)  # travaille, en cours
        self._seed("soustraction_retenue", 1, jours=3)  # en difficulte
        self._seed("vieille_notion", 3, jours=30)  # hors fenetre -> ignore

        with self.Session() as db:
            resume = notifications.generer_resume_hebdomadaire(db, self.eleve_id)

        travailles = {c["pattern_name"] for c in resume["concepts_travailles"]}
        self.assertEqual(
            travailles, {"addition_simple", "multiplication_x2", "soustraction_retenue"}
        )
        self.assertNotIn("vieille_notion", travailles)
        maitrises = {c["pattern_name"] for c in resume["nouvellement_maitrises"]}
        self.assertEqual(maitrises, {"addition_simple"})
        difficiles = {c["pattern_name"] for c in resume["en_difficulte"]}
        self.assertEqual(difficiles, {"soustraction_retenue"})
        # Texte par regles, langage parent, nomme l'enfant, sans jargon.
        self.assertIn("Sofia", resume["texte"])
        self.assertIn("addition simple", resume["texte"])  # libelle lisible
        self.assertNotIn("pattern", resume["texte"].lower())

    def test_resume_sans_activite_recente(self) -> None:
        self._seed("vieille_notion", 3, jours=20)
        with self.Session() as db:
            resume = notifications.generer_resume_hebdomadaire(db, self.eleve_id)
        self.assertEqual(resume["concepts_travailles"], [])
        self.assertIn("n'a pas travaille", resume["texte"])

    def test_resume_fenetre_bornee(self) -> None:
        # Juste avant la limite des 7 jours : inclus ; juste apres : exclu.
        self._seed("dans_fenetre", 2, jours=6)
        self._seed("hors_fenetre", 2, jours=8)
        with self.Session() as db:
            resume = notifications.generer_resume_hebdomadaire(db, self.eleve_id)
        travailles = {c["pattern_name"] for c in resume["concepts_travailles"]}
        self.assertIn("dans_fenetre", travailles)
        self.assertNotIn("hors_fenetre", travailles)

    # ---------- Alerte de blocage ----------
    def test_alerte_stagnation_actif_sans_nouvelle_maitrise(self) -> None:
        # Actif recemment mais aucun concept a la maitrise 3 -> stagnation.
        self._seed("concept_a", 2, jours=1)
        self._seed("concept_b", 1, jours=2)
        with self.Session() as db:
            alerte = notifications.detecter_alerte_blocage(db, self.eleve_id)
        self.assertTrue(alerte["active"])
        types = {a["type"] for a in alerte["alertes"]}
        self.assertIn("stagnation", types)

    def test_pas_de_stagnation_si_maitrise_recente(self) -> None:
        # Une nouvelle maitrise 3 recente -> pas de stagnation.
        self._seed("concept_a", 3, jours=1)
        self._seed("concept_b", 1, jours=2)
        with self.Session() as db:
            alerte = notifications.detecter_alerte_blocage(db, self.eleve_id)
        types = {a["type"] for a in alerte["alertes"]}
        self.assertNotIn("stagnation", types)

    def test_pas_de_stagnation_si_eleve_absent(self) -> None:
        # Aucune activite recente (juste une vieille notion) -> pas d'alerte
        # stagnation : c'est une pause, pas un blocage.
        self._seed("vieux", 2, jours=20)
        with self.Session() as db:
            alerte = notifications.detecter_alerte_blocage(db, self.eleve_id)
        self.assertFalse(alerte["active"])

    def test_alerte_concept_bloque_apres_plusieurs_tentatives(self) -> None:
        # Maitrise 1 apres 3 tentatives -> concept bloque.
        self._seed("division_euclidienne", 1, jours=1, nb_tentatives=3)
        with self.Session() as db:
            alerte = notifications.detecter_alerte_blocage(db, self.eleve_id)
        bloques = [a for a in alerte["alertes"] if a["type"] == "concept_bloque"]
        self.assertEqual(len(bloques), 1)
        self.assertEqual(bloques[0]["pattern_name"], "division_euclidienne")
        self.assertIn("division euclidienne", bloques[0]["message"])

    def test_pas_de_blocage_avec_peu_de_tentatives(self) -> None:
        # Maitrise 1 mais une seule tentative -> pas encore "bloque".
        self._seed("nouveau_concept", 1, jours=1, nb_tentatives=1)
        with self.Session() as db:
            alerte = notifications.detecter_alerte_blocage(db, self.eleve_id)
        types = {a["type"] for a in alerte["alertes"]}
        self.assertNotIn("concept_bloque", types)

    def test_pas_de_blocage_si_concept_debloque(self) -> None:
        # Plusieurs tentatives mais maitrise atteinte -> pas de blocage.
        self._seed("bien_acquis", 3, jours=1, nb_tentatives=4)
        with self.Session() as db:
            alerte = notifications.detecter_alerte_blocage(db, self.eleve_id)
        types = {a["type"] for a in alerte["alertes"]}
        self.assertNotIn("concept_bloque", types)

    # ---------- Composition / stub d'envoi ----------
    def test_composer_message_inclut_resume_et_alertes(self) -> None:
        resume = {"prenom": "Sofia", "texte": "Bilan de la semaine."}
        alerte = {"active": True, "alertes": [{"type": "stagnation", "message": "Coup de pouce."}]}
        sujet, corps = notifications.composer_message_parent(resume, alerte)
        self.assertIn("Sofia", sujet)
        self.assertIn("Bilan de la semaine.", corps)
        self.assertIn("Coup de pouce.", corps)

    def test_envoyer_email_stub_ne_leve_pas_et_logge(self) -> None:
        with self.assertLogs("notifications", level="INFO") as journal:
            resultat = notifications.envoyer_email("parent@test", "Sujet", "Corps")
        self.assertTrue(resultat)
        self.assertTrue(any("STUB envoyer_email" in ligne for ligne in journal.output))

    def test_envoyer_resume_hebdomadaire_compose_et_appelle_le_stub(self) -> None:
        self._seed("addition_simple", 1, jours=1, nb_tentatives=3)
        with self.Session() as db:
            eleve = db.get(Eleve, self.eleve_id)
            with self.assertLogs("notifications", level="INFO"):
                envoi = notifications.envoyer_resume_hebdomadaire(db, eleve)
        self.assertIn("resume", envoi)
        self.assertIn("alerte", envoi)
        self.assertTrue(envoi["alerte"]["active"])  # concept bloque detecte


    # ---------- Rapport redige par IA (LLM mocke) ----------
    def _seed_scenario_variee(self) -> None:
        """Un concept bien maitrise cette semaine + un concept bloque (m1 x4)."""
        self._seed("addition_simple", 3, jours=1)
        self._seed("soustraction_retenue", 1, jours=1, nb_tentatives=4)

    def test_rapport_prompt_contient_les_vraies_donnees_sans_invention(self) -> None:
        self._seed_scenario_variee()
        captures: list[str] = []

        def faux_gemini(prompt: str) -> str:
            captures.append(prompt)
            return (
                "Sofia progresse : l'addition simple est desormais bien maitrisee. "
                "La soustraction avec retenue reste difficile apres 4 essais. "
                "Proposez-lui de courts exercices reguliers."
            )

        with patch("notifications._appel_gemini_rapport", side_effect=faux_gemini):
            with self.Session() as db:
                rapport = notifications.generer_rapport_ia(db, self.eleve_id, "enseignant")

        self.assertEqual(rapport["source"], "ia")
        self.assertEqual(rapport["modele"], notifications.tutor.MODEL_NAME)
        prompt = captures[0]
        # Le prompt contient les vraies donnees (libelles + comptes reels).
        self.assertIn("addition simple", prompt)
        self.assertIn("soustraction retenue", prompt)
        self.assertIn("4 fois", prompt)  # nb_tentatives reel injecte
        # Et interdit explicitement l'invention.
        self.assertIn("N'invente aucun chiffre", prompt)

    def test_rapport_ton_differe_selon_destinataire(self) -> None:
        self._seed_scenario_variee()
        vus: dict[str, str] = {}

        def faux(prompt: str) -> str:
            vus["dernier"] = prompt
            return "Un texte d'appreciation valide et suffisamment long pour passer."

        with patch("notifications._appel_gemini_rapport", side_effect=faux):
            with self.Session() as db:
                notifications.generer_rapport_ia(db, self.eleve_id, "enseignant")
                prompt_ens = vus["dernier"]
                notifications.generer_rapport_ia(db, self.eleve_id, "parent")
                prompt_par = vus["dernier"]
        self.assertIn("enseignant", prompt_ens.lower())
        self.assertIn("parent", prompt_par.lower())
        self.assertNotEqual(prompt_ens, prompt_par)

    def test_rapport_accepte_texte_valide(self) -> None:
        self._seed_scenario_variee()
        texte = (
            "Sofia a bien avance cette semaine et maitrise l'addition simple. "
            "La soustraction avec retenue lui demande encore des efforts. "
            "Un peu d'entrainement quotidien l'aidera a progresser."
        )
        with patch("notifications._appel_gemini_rapport", return_value=texte):
            with self.Session() as db:
                rapport = notifications.generer_rapport_ia(db, self.eleve_id, "parent")
        self.assertEqual(rapport["source"], "ia")
        self.assertEqual(rapport["texte"], texte)

    def test_rapport_rejette_nombre_hallucine_et_repli_regles(self) -> None:
        self._seed_scenario_variee()
        # 25 n'apparait dans aucune donnee fournie -> chaque fournisseur rejete.
        hallucine = "Sofia a brillamment resolu 25 exercices cette semaine, bravo a elle !"
        with patch("notifications._appel_gemini_rapport", return_value=hallucine), patch(
            "notifications._appel_groq_rapport", return_value=hallucine
        ), patch("notifications._appel_mistral_rapport", return_value=hallucine):
            with self.Session() as db:
                resume = notifications.generer_resume_hebdomadaire(db, self.eleve_id)
                rapport = notifications.generer_rapport_ia(db, self.eleve_id, "enseignant")
        self.assertEqual(rapport["source"], "regles")
        self.assertIsNone(rapport["modele"])
        self.assertEqual(rapport["texte"], resume["texte"])

    def test_rapport_fallback_sur_groq_si_gemini_hallucine(self) -> None:
        self._seed_scenario_variee()
        hallucine = "Sofia a resolu 99 problemes."  # 99 non fourni -> rejete
        valide = (
            "Sofia consolide bien l'addition simple. La soustraction avec retenue "
            "reste a travailler. Quelques exercices cibles feront la difference."
        )
        with patch("notifications._appel_gemini_rapport", return_value=hallucine), patch(
            "notifications._appel_groq_rapport", return_value=valide
        ):
            with self.Session() as db:
                rapport = notifications.generer_rapport_ia(db, self.eleve_id, "enseignant")
        self.assertEqual(rapport["source"], "ia")
        self.assertEqual(rapport["modele"], notifications.tutor.GROQ_MODEL_NAME)
        self.assertEqual(rapport["texte"], valide)

    def test_rapport_repli_regles_si_les_trois_fournisseurs_echouent(self) -> None:
        self._seed_scenario_variee()

        def echec(_prompt: str) -> str:
            raise RuntimeError("fournisseur indisponible")

        with patch("notifications._appel_gemini_rapport", side_effect=echec), patch(
            "notifications._appel_groq_rapport", side_effect=echec
        ), patch("notifications._appel_mistral_rapport", side_effect=echec):
            with self.Session() as db:
                resume = notifications.generer_resume_hebdomadaire(db, self.eleve_id)
                rapport = notifications.generer_rapport_ia(db, self.eleve_id, "parent")
        self.assertEqual(rapport["source"], "regles")
        self.assertEqual(rapport["texte"], resume["texte"])

    def test_rapport_destinataire_invalide(self) -> None:
        with self.Session() as db:
            with self.assertRaises(ValueError):
                notifications.generer_rapport_ia(db, self.eleve_id, "directeur")


if __name__ == "__main__":
    unittest.main()
