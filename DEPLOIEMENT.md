# Déploiement en production — Parcours Maths IA

Ce guide décrit **pas à pas** comment mettre le projet en ligne :

- **Base de données** : PostgreSQL hébergé sur **Neon** (gratuit, permanent, découplé du backend).
- **Backend** (API FastAPI) : hébergé sur **Render**.
- **Frontend** (pages statiques HTML/JS) : hébergé où vous voulez (Render, Netlify, GitHub Pages…).

> ⚠️ **Aucun identifiant ni secret réel ne doit figurer dans ce fichier ni être commité.**
> Les clés d'API, mots de passe de base et fichiers de credentials se configurent
> uniquement dans les tableaux de bord Neon / Render.

---

## Architecture cible

```
   Navigateur de l'élève / prof
              │  (HTTPS)
   ┌──────────┴───────────┐
   │   Frontend statique  │   ex. https://parcours-maths.onrender.com
   │   (HTML / JS / audio)│
   └──────────┬───────────┘
              │  appels fetch() → API
   ┌──────────┴───────────┐
   │   Backend FastAPI    │   ex. https://parcours-maths-api.onrender.com
   │   (Render, uvicorn)  │
   └──────────┬───────────┘
              │  SQLAlchemy + psycopg2 (SSL)
   ┌──────────┴───────────┐
   │  PostgreSQL (Neon)   │   base permanente, gratuite
   └──────────────────────┘
```

Le backend et le frontend seront sur des **domaines différents** : c'est prévu,
le CORS est déjà configuré pour l'autoriser (voir la section CORS plus bas).

---

## Étape 1 — Créer la base PostgreSQL sur Neon

1. Aller sur **https://neon.tech** et créer un compte gratuit (connexion possible via GitHub / Google).
2. Cliquer sur **Create project** (ou **New Project**).
   - Donner un nom au projet, par ex. `parcours-maths`.
   - Choisir une région proche de vos utilisateurs (ex. *Europe (Frankfurt)*).
   - Laisser la version de PostgreSQL par défaut (récente).
3. Une fois le projet créé, Neon affiche une **Connection string** (chaîne de connexion).
   Cliquer sur **Connect** / **Connection Details** et **copier la chaîne complète**.
   Elle ressemble à ceci :

   ```
   postgresql://mon_user:mon_mot_de_passe@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

   Points à vérifier :
   - Elle commence par `postgresql://` (si Neon vous donne une variante `postgres://`,
     ce n'est **pas** un problème : le code la corrige automatiquement en `postgresql://`).
   - Elle se termine par **`?sslmode=require`**. Neon **exige le SSL** ; ce paramètre
     doit rester présent, sinon la connexion sera refusée.
   - Neon propose parfois deux variantes : une directe et une **« pooled »**
     (l'hôte contient `-pooler`). Les deux fonctionnent ; la version *pooled* est
     recommandée pour une application web. Choisissez l'une ou l'autre.
4. **Conserver cette chaîne de côté** (dans un gestionnaire de mots de passe) :
   c'est la valeur de la variable `DATABASE_URL` de l'étape suivante.

> Rien d'autre à faire côté Neon : les **tables sont créées automatiquement** par
> le backend au premier démarrage (`create_all` au startup). Aucune migration
> manuelle n'est nécessaire pour une base neuve.

---

## Étape 2 — Déployer le backend sur Render

### 2.1 Créer le service

1. Aller sur **https://render.com** et créer un compte gratuit.
2. **New +** → **Web Service**.
3. Connecter votre dépôt GitHub (celui qui contient ce projet) et le sélectionner.
4. Renseigner la configuration du service :

   | Réglage Render        | Valeur                                         |
   |-----------------------|------------------------------------------------|
   | **Name**              | `parcours-maths-api` (au choix)                |
   | **Region**            | proche de la région Neon choisie               |
   | **Branch**            | `main`                                         |
   | **Root Directory**    | `prototype/backend`                            |
   | **Runtime / Language**| `Python 3`                                     |
   | **Build Command**     | `pip install -r requirements.txt`              |
   | **Start Command**     | *(laisser vide : le `Procfile` est détecté)*   |
   | **Instance Type**     | `Free`                                          |

   > **Root Directory = `prototype/backend`** est essentiel : c'est là que se
   > trouvent `requirements.txt`, `main.py`, le `Procfile` et le `.python-version`.
   > Toutes les commandes de Render s'exécutent depuis ce dossier.

   Le **`Procfile`** (déjà présent dans `prototype/backend/`) contient :

   ```
   web: uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

   Render fournit la variable `$PORT` automatiquement ; `--host 0.0.0.0` est
   indispensable pour que le service soit accessible de l'extérieur.

   Le fichier **`.python-version`** épingle Python à `3.13.3` (même version qu'en local).

### 2.2 Déclarer les variables d'environnement

Dans la configuration du service Render, section **Environment** → **Environment Variables**,
ajouter les variables **listées dans le tableau de la section « Variables
d'environnement » ci-dessous** (au minimum `DATABASE_URL`).

- Coller dans `DATABASE_URL` la chaîne de connexion Neon copiée à l'étape 1.
- Ajouter les clés d'API que vous utilisez (Gemini / Groq / Mistral).

### 2.3 Cas particulier : credentials Google TTS (fichier JSON)

La synthèse vocale (voix neurale du tuteur) utilise un **compte de service Google
Cloud**, fourni sous forme d'un **fichier JSON** — pas une simple clé. Sur Render,
on l'installe via la fonctionnalité **Secret Files** (et non une variable ordinaire) :

1. Dans le service Render : **Environment** → **Secret Files** → **Add Secret File**.
2. **Filename** : `google-tts-credentials.json`
3. **Contents** : coller **tout le contenu** du fichier JSON du compte de service.
4. Render monte ce fichier à un chemin du type `/etc/secrets/google-tts-credentials.json`.
5. Ajouter alors la variable d'environnement :

   ```
   GOOGLE_APPLICATION_CREDENTIALS = /etc/secrets/google-tts-credentials.json
   ```

> La synthèse vocale est **facultative** : si vous ne configurez pas le TTS, le
> backend renvoie proprement un 503 sur `/synthese-vocale` et le frontend retombe
> automatiquement sur la voix native du navigateur. Aucun plantage.

### 2.4 Lancer le déploiement

Cliquer sur **Create Web Service**. Render installe les dépendances, démarre uvicorn,
et crée les tables dans Neon au premier démarrage. Une fois le service *Live*, noter
son URL publique (ex. `https://parcours-maths-api.onrender.com`).

**Vérifier que ça tourne** : ouvrir dans le navigateur

```
https://<votre-service>.onrender.com/health
```

→ doit renvoyer `{"status":"ok"}`.

---

## Étape 3 — Configurer et déployer le frontend

Le frontend appelle actuellement le backend sur **`http://127.0.0.1:8000`** (adresse
codée en dur pour le développement local). Avant de le mettre en ligne, il faut
remplacer cette adresse par l'URL publique du backend Render.

Fichiers et lignes à modifier dans `prototype/frontend/` :

| Fichier          | Ligne | Variable / usage                              |
|------------------|-------|-----------------------------------------------|
| `map.js`         | 1     | `const API_BASE_URL = "http://127.0.0.1:8000";` |
| `compte.js`      | 23    | `const API_BASE = "http://127.0.0.1:8000";`   |
| `enseignant.js`  | 20    | `const API_BASE = "http://127.0.0.1:8000";`   |
| `parent.js`      | 17    | `const API_BASE = "http://127.0.0.1:8000";`   |
| `chat.js`        | 236   | `fetch("http://127.0.0.1:8000/tuteur/aide", …)` |
| `speech.js`      | 25    | `const BACKEND_URL = "http://127.0.0.1:8000/synthese-vocale";` |

Remplacer chaque occurrence de `http://127.0.0.1:8000` par l'URL Render, par ex.
`https://parcours-maths-api.onrender.com`. Un simple rechercher-remplacer global
de la chaîne `http://127.0.0.1:8000` dans le dossier `prototype/frontend/` suffit.

Ensuite, héberger le dossier `prototype/frontend/` comme **site statique** :

- **Sur Render** : **New +** → **Static Site**, Root Directory `prototype/frontend`,
  Build Command vide, Publish Directory `.`.
- ou **Netlify / Vercel / GitHub Pages** : glisser-déposer / pointer sur `prototype/frontend/`.

> Astuce : plutôt que d'éditer les URLs à la main à chaque déploiement, vous
> pouvez à terme centraliser l'adresse du backend dans une seule constante
> partagée. Ce n'est pas requis pour déployer, juste un confort de maintenance.

---

## Variables d'environnement (référence complète)

À définir dans le **tableau de bord Render** (jamais dans le code ni ce fichier).

| Variable                         | Obligatoire | Rôle |
|----------------------------------|-------------|------|
| `DATABASE_URL`                   | **Oui**     | Chaîne de connexion PostgreSQL de Neon. Format `postgresql://user:mdp@hôte/base?sslmode=require`. Sans elle, le backend retombe sur une base SQLite locale **éphémère** (à éviter en prod). |
| `GEMINI_API_KEY`                 | Recommandée | Google Gemini — fournisseur **principal** du tuteur IA (`tutor.py`). |
| `GROQ_API_KEY`                   | Recommandée | Groq — fournisseur de **repli** pour le tuteur ET la génération narrative d'énoncés. |
| `MISTRAL_API_KEY`                | Recommandée | Mistral — fournisseur de **repli** pour le tuteur ET la génération narrative. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Facultative | Chemin du fichier JSON du compte de service Google (synthèse vocale). Via **Secret File** Render (voir §2.3). Absente → voix native du navigateur en repli. |
| `RATE_LIMIT_ENABLED`             | Facultative | `1` par défaut (limitation de débit active). Mettre `0` uniquement pour désactiver le rate limiting. |

**À propos des clés IA** : le tuteur et la génération d'énoncés narratifs essaient
les fournisseurs dans l'ordre Gemini → Groq → Mistral et prennent le premier qui
répond. **Au moins une** de ces trois clés est nécessaire pour que le tuteur et les
exercices narratifs fonctionnent. Les exercices *procéduraux* (calcul direct), eux,
sont générés localement sans aucune IA et fonctionnent même sans clé.

> **En local**, ces variables sont lues depuis un fichier `prototype/.env`
> (non commité, déjà dans `.gitignore`). Sur Render, elles viennent du tableau
> de bord — et **les valeurs du tableau de bord ont toujours la priorité** sur le
> `.env` (le chargeur local n'écrase jamais une variable déjà définie).

---

## CORS (frontend et backend sur des domaines différents)

C'est **déjà géré** et fonctionnel en production. Le backend (`main.py`) autorise
toutes les origines :

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Pourquoi c'est correct ici :

- L'authentification se fait par **jeton Bearer** (en-tête `Authorization`), **pas
  par cookie**. On n'a donc pas besoin de `allow_credentials=True`, et la
  combinaison `allow_origins=["*"]` + `allow_credentials=False` est parfaitement
  valide — un frontend sur n'importe quel domaine peut appeler l'API.
- `allow_headers=["*"]` laisse passer l'en-tête `Authorization` et `Content-Type`.

**Optionnel (durcissement)** : si vous voulez restreindre l'accès au seul domaine de
votre frontend, remplacez `allow_origins=["*"]` par la liste explicite de vos
domaines, par ex. `allow_origins=["https://parcours-maths.onrender.com"]`. Ce n'est
pas nécessaire pour que ça marche, seulement pour limiter qui peut appeler l'API.

---

## Vérifications après déploiement

1. **API vivante** : `GET https://<api>.onrender.com/health` → `{"status":"ok"}`.
2. **Base connectée** : créer une école/un compte enseignant depuis le frontend en
   ligne, se déconnecter, se reconnecter → les données doivent persister (elles
   sont dans Neon). Vous pouvez aussi les voir dans le **SQL Editor** de Neon
   (`SELECT * FROM enseignant;`).
3. **Jeu** : lancer une partie, répondre à un exercice → pas d'erreur réseau dans la
   console du navigateur (F12).
4. **Tuteur IA** : demander de l'aide au hibou → réponse générée (si au moins une
   clé IA est configurée).
5. **Voix** : si le TTS est configuré, la voix neurale se déclenche ; sinon, la voix
   native du navigateur prend le relais (comportement normal).

---

## Limites connues du plan gratuit (à garder en tête)

Ces points ne bloquent pas le déploiement mais sont bons à connaître :

- **Mise en veille (Render Free)** : le service s'endort après ~15 min d'inactivité.
  La première requête suivante prend quelques secondes à réveiller le service.
  Le code prévoit ce cas côté base (`pool_pre_ping` + `pool_recycle`) pour éviter
  les connexions PostgreSQL mortes après une pause.
- **Données vraiment persistantes = uniquement PostgreSQL/Neon.** Le disque de
  Render est **éphémère** : il est remis à zéro à chaque redéploiement/réveil.
  Concrètement :
  - Les **comptes, classes, élèves, progressions** vivent dans Neon → **persistants**. ✅
  - Les **jetons de connexion** sont gardés en mémoire du backend → un redémarrage
    déconnecte les utilisateurs (ils se reconnectent, sans perte de données).
  - Les **fichiers de session de jeu en cours** (`data/sessions/*.json`) sont sur le
    disque éphémère → une partie *en cours* peut être perdue à un redémarrage. Les
    résultats déjà enregistrés (progressions) restent, eux, dans Neon.
- **Quotas des API IA** : les offres gratuites Gemini/Groq/Mistral ont des limites
  de débit. La bascule automatique entre fournisseurs aide à absorber un quota
  atteint sur l'un d'eux.

---

## Développement local (inchangé)

Rien ne change pour développer en local : **sans** `DATABASE_URL` ni
`PARCOURS_DATABASE_URL`, le backend utilise automatiquement une base **SQLite** dans
`prototype/backend/data/parcours.db`. On travaille et on teste hors-ligne sans
dépendre de Neon.

```bash
cd prototype/backend
uvicorn main:app --reload      # http://127.0.0.1:8000
```

Lancer la suite de tests (utilise SQLite en mémoire) :

```bash
cd prototype/backend
python -m unittest discover -p "test_*.py"
```

---

## État de la vérification de compatibilité PostgreSQL

- ✅ **Tests existants** : les 296 tests passent avec le repli SQLite (comportement
  de développement strictement inchangé).
- ✅ **Compatibilité du schéma** : le DDL généré par SQLAlchemy a été compilé en
  **dialecte PostgreSQL** (types de colonnes, `SERIAL`, `TIMESTAMP WITH TIME ZONE`,
  `BOOLEAN`, clés étrangères `ON DELETE CASCADE/SET NULL`, contraintes d'unicité,
  index) — aucun type ni valeur par défaut incompatible.
- ✅ **URL PostgreSQL** : lecture de `DATABASE_URL`, priorité sur l'ancien
  `PARCOURS_DATABASE_URL`, et correction automatique du préfixe `postgres://`.
- ⏳ **Connexion réelle à un PostgreSQL** : non testée localement faute de Docker/
  serviceur PostgreSQL sur la machine de développement. **À confirmer lors du
  premier déploiement** via l'étape « Vérifications après déploiement » ci-dessus
  (l'endpoint `/health` répond et un compte créé persiste dans Neon).
