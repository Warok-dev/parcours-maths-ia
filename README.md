# Parcours Maths IA

Jeu éducatif 2D de mathématiques pour l'école primaire (CE1 à CE6). L'élève avance sur une carte en résolvant des exercices générés automatiquement. Un tuteur IA (le hibou) l'aide sans lui donner la réponse, et la difficulté s'adapte à sa maîtrise.

Projet de stage réalisé pour le Ministère de l'Éducation nationale (Maroc).

[![Tests](https://github.com/Warok-dev/parcours-maths-ia/actions/workflows/tests.yml/badge.svg)](https://github.com/Warok-dev/parcours-maths-ia/actions/workflows/tests.yml)

## Fonctionnalités

**Pour l'élève**
- Une carte d'aventure, organisée en leçons et en obstacles à débloquer.
- Des exercices **générés automatiquement**, de deux sortes :
  - **procéduraux** : des patterns de calcul, géométrie, mesures et graphiques extraits du corpus officiel ;
  - **narratifs** : des problèmes mis en histoire par un LLM, dans l'univers choisi par l'élève (foot, dinosaures, espace…).
- Une progression **guidé → semi-guidé → autonome**, avec détection de maîtrise et exercices de renforcement.
- Un **tuteur IA** qui suit la méthode officielle et s'appuie sur un diagnostic d'erreur par règles. Il ne donne la réponse qu'après plusieurs essais faux, comptés par le jeu.
- Des **apartés de confiance** quand le jeu détecte un découragement, une révision ciblée des points faibles, des mini-jeux, un personnage à personnaliser et une lecture vocale.
- Un **mode hors-ligne** pour les exercices procéduraux.

**Pour l'enseignant et l'école**
- Classes, élèves (connexion par code de classe et PIN), tableau de bord, concepts difficiles et assignation de travail.
- Des rapports d'apprentissage rédigés par IA à partir de données anonymisées, et un export Excel.
- Plusieurs écoles isolées les unes des autres, avec invitation d'enseignants et un mode démo qui s'efface au bout de 48 h.

**Pour les parents**
- Un accès en lecture seule par code, avec un résumé hebdomadaire, des alertes de blocage et un rapport IA.

**Données et sécurité**
- Minimisation des données, rétention de 2 ans, droit à l'effacement (élève ou école entière) et journal des suppressions.
- Mots de passe et PIN hachés avec bcrypt. Les jetons sont stockés hachés en base, expirent et sont révoqués dès qu'un droit est retiré.
- Verrouillage du PIN par élève, limites de débit dimensionnées pour une classe, et données personnelles masquées avant tout envoi à un LLM.

## Architecture

```text
Navigateur (HTML/CSS/JS vanilla)  ──HTTPS──▶  API FastAPI  ──▶  PostgreSQL (Neon) / SQLite en local
                                                  │
                                                  ├─▶ LLM : Gemini → Groq → Mistral (bascule automatique)
                                                  └─▶ Google Text-to-Speech (repli : voix du navigateur)
```

## Structure du dépôt

```text
prototype/
├── backend/          API FastAPI, génération d'exercices, tuteur, comptes, tests
│   ├── generation/   générateurs procéduraux (substitution) et narratifs (LLM)
│   ├── data/         leçons, cartes, exercices de référence (JSON)
│   └── scripts/      vérifications d'exploitation (ex. PostgreSQL de bout en bout)
├── frontend/         jeu, espaces enseignant et parent (sans build)
└── schema/           schéma JSON d'un exercice
landing/              page de présentation
design/               instantané du style, pour le travail de design visuel
pattern_catalog.json  catalogue des patterns extraits du corpus
DEPLOIEMENT.md        mise en production (Neon + Render)
```

## Démarrer en local

Prérequis : Python 3.13 et Node 22 (Node ne sert qu'aux tests du frontend).

```bash
cd prototype/backend
python -m venv .venv && source .venv/bin/activate   # Windows : .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp ../.env.example ../.env                          # facultatif : clés IA
uvicorn main:app --reload                           # http://127.0.0.1:8000
```

Ensuite, servez le frontend, par exemple avec `python -m http.server 5500` depuis `prototype/frontend/`, et ouvrez http://localhost:5500.

- En local, le frontend appelle automatiquement le backend local (`config.js`).
- Pour viser un autre backend, ajoutez `?api=https://…` à l'adresse de la page.
- Sans clé IA, les exercices procéduraux fonctionnent. Le tuteur et les énoncés narratifs ont besoin d'au moins une des clés `GEMINI_API_KEY`, `GROQ_API_KEY` ou `MISTRAL_API_KEY`.

## Tests

```bash
cd prototype/backend && BCRYPT_ROUNDS=4 python -m unittest discover -p "test_*.py"
cd prototype/frontend && for t in test_*.js; do node "$t"; done
```

L'intégration continue (GitHub Actions) lance ces suites à chaque push. La suite backend tourne aussi contre un vrai PostgreSQL, et `scripts/verifier_postgres.py` y rejoue un parcours complet.

## Licence

MIT, voir [LICENSE](LICENSE).
