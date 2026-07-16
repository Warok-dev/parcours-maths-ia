# Prototype Parcours Maths IA

Squelette du prototype CE1/CE2 pour un jeu 2D de parcours mathematique.

## Stack

- Backend: FastAPI
- Stockage: fichiers JSON dans `backend/data/`
- Frontend: HTML, CSS, JavaScript vanilla
- Tuteur IA: Google Gemini via `GEMINI_API_KEY` (non implemente pour l'instant)

## Arborescence

```text
prototype/
├── .env.example
├── README.md
├── backend/
│   ├── data/
│   ├── evaluation.py
│   ├── generation/
│   ├── main.py
│   ├── requirements.txt
│   └── tutor.py
├── frontend/
└── schema/
```

## Installation

```bash
cd prototype/backend
python -m venv .venv
```

Activation sous PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Installation des dependances:

```bash
pip install -r requirements.txt
```

## Variable d'environnement

Copier `prototype/.env.example` ou definir directement:

```powershell
$env:GEMINI_API_KEY="votre_cle"
```

La cle n'est pas encore utilisee tant que l'appel Gemini reste en TODO.

## Lancer le backend

Depuis `prototype/backend`:

```bash
uvicorn main:app --reload
```

API de base:

- `GET /health`
- `GET /exercices/CE1`
- `GET /exercices/CE2`
- `POST /evaluer`
- `POST /tuteur/aide`
- `GET /carte/CE1`
- `GET /carte/CE2`

## Ouvrir le frontend

Le frontend est statique. Ouvrir `prototype/frontend/index.html` dans un navigateur.

## Notes

- Les exercices servis sont factices mais respectent la structure cible du schema JSON.
- La generation procedurale et narrative contient des TODO explicites.
- L'evaluation est minimale, avec une normalisation de base pour les reponses textuelles.
- Le tuteur IA renvoie pour l'instant une reponse factice ancree sur `etapes_methode`.
