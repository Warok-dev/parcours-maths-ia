# Prototype Parcours Maths IA

Ce dossier contient le code du jeu : l'API (`backend/`), le client web (`frontend/`) et le schéma d'un exercice (`schema/`). La vue d'ensemble se trouve dans le [README racine](../README.md), la mise en production dans [DEPLOIEMENT.md](../DEPLOIEMENT.md).

## Backend (`backend/`)

| Module | Rôle |
|---|---|
| `main.py` | API de jeu : sessions, progression (détection de maîtrise, renforcement, apartés de confiance), évaluation, tuteur, synthèse vocale |
| `comptes.py` | Comptes enseignant, élève et parent, écoles, classes, assignations, tableaux de bord, démo, RGPD (effacement, rétention), jetons |
| `database.py` | Modèles SQLAlchemy et micro-migrations (SQLite en local, PostgreSQL en production) |
| `generation/substitution.py` | Générateurs procéduraux (calcul, géométrie, mesures, graphiques), CE1 à CE6 |
| `generation/narrative.py` | Énoncés narratifs par LLM, avec thèmes, contrôle des valeurs et repli procédural |
| `tutor.py` | Tuteur IA (Gemini → Groq → Mistral), registre adapté à l'âge, filtrage des données personnelles |
| `exercice_client.py` | Vue « client » d'un exercice : sans la réponse ni les variables de résultat, avec la mécanique choisie et ses seuls indices, et des empreintes salées pour la correction hors-ligne |
| `evaluation.py` / `diagnostic.py` | Correction tolérante (valeur numérique, commutativité, heures) et diagnostic d'erreur par règles |
| `notifications.py` | Résumé hebdomadaire, alertes de blocage, rapports IA anonymisés |
| `rate_limit.py` | Limites de débit (par IP réelle derrière le proxy, et par cible pour l'authentification) |
| `tts.py` | Synthèse vocale Google, avec cache |

La documentation interactive de l'API (Swagger) est servie sur `/docs` quand le serveur tourne.

### Stockage

Tout ce qui persiste est en base : comptes, classes, progressions, **jetons** (seule leur empreinte SHA-256 est stockée) et **état des parties en cours** (table `etat_session_jeu`). Un redémarrage du serveur ne déconnecte personne et ne perd aucune partie. Sans `DATABASE_URL`, une base SQLite est créée dans `backend/data/parcours.db`.

## Frontend (`frontend/`)

Le client est en JavaScript vanilla, sans étape de build. `index.html` charge les scripts dans l'ordre ; `config.js` doit passer en premier, car il choisit l'adresse du backend :

- **local** (`localhost`, `127.0.0.1`, fichier ouvert directement) : `http://127.0.0.1:8000` ;
- **sinon** : le backend de production ;
- **surcharge** : `?api=https://…` dans l'adresse de la page.

Chaque module a son fichier `test_*.js`, à lancer avec `node`.

## Lancer et tester

Voir le [README racine](../README.md#démarrer-en-local). En résumé :

```bash
cd backend
uvicorn main:app --reload
BCRYPT_ROUNDS=4 python -m unittest discover -p "test_*.py"   # environ 15 s
```

`BCRYPT_ROUNDS=4` baisse le coût de bcrypt pour les tests uniquement. En production, laissez la valeur par défaut (12).
