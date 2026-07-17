# Prototype Parcours Maths IA

Prototype web CE1/CE2 pour un jeu 2D de parcours mathematique.

## Etat actuel

- Backend FastAPI operationnel.
- Generateur procedural operationnel pour 14 patterns de substitution issus du catalogue CE1/CE2.
- Endpoint `POST /tuteur/aide` branche sur Gemini via `GEMINI_API_KEY`.
- Generation narrative LLM non implementee : `backend/generation/narrative.py` reste un stub de demonstration.
- Frontend statique HTML/CSS/JS vanilla pour la carte et l'affichage de l'exercice.

## Stack

- Backend : FastAPI
- Stockage : fichiers JSON dans `backend/data/`
- Frontend : HTML, CSS, JavaScript vanilla
- Tuteur IA : Google Gemini

## Arborescence

```text
prototype/
|-- .env.example
|-- README.md
|-- backend/
|   |-- data/
|   |-- evaluation.py
|   |-- generation/
|   |-- main.py
|   |-- requirements.txt
|   `-- tutor.py
|-- frontend/
`-- schema/
```

## Installation

Depuis `prototype/backend` :

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Configuration Gemini

Definir `GEMINI_API_KEY` dans l'environnement, ou copier `prototype/.env.example` vers `prototype/.env`.

```powershell
$env:GEMINI_API_KEY="votre_cle"
```

Important :
- Les routes `GET /exercices/{niveau}`, `POST /evaluer` et `GET /carte/{niveau}` fonctionnent sans cle Gemini.
- Seule la route `POST /tuteur/aide` depend de `GEMINI_API_KEY` et echouera a l'appel si la cle est absente ou invalide.

## Lancer le serveur

Depuis `prototype/backend` :

```powershell
uvicorn main:app --reload
```

Routes principales :

- `GET /health`
- `GET /exercices/CE1`
- `GET /exercices/CE2`
- `POST /evaluer`
- `POST /tuteur/aide`
- `GET /carte/CE1`
- `GET /carte/CE2`
- `GET /generation/demo/CE1`
- `GET /generation/demo/CE2`

## Tests

Depuis `prototype/backend` :

```powershell
.venv\Scripts\python -m unittest generation.test_substitution
.venv\Scripts\python -m unittest test_api
```

Couverture actuellement verifiee :

- `generation.test_substitution` : 17 tests sur le generateur procedural et le dedoublonnage.
- `test_api` : 4 tests sur `GET /exercices/{niveau}` et `POST /evaluer`.

## Patterns proceduraux actuellement implementes

- `multiplication_decomposee_chiffre_x_2chiffres`
- `addition_repetee_vers_multiplication`
- `partie_tout_soustraction_non_narratif`
- `partie_tout_addition_non_narratif`
- `moitie_via_2xn`
- `addition_pas_a_pas_sans_retenue`
- `multiplication_chiffre_x_multiple_de_10`
- `multiplication_par_10`
- `double_via_2xn`
- `conversion_cm_mm_vers_mm`
- `addition_2chiffres_sans_retenue`
- `suite_multiples_de_10_a_completer`
- `identifier_multiple_de_10`
- `facteur_manquant_table_de_2`

## Limites connues

- La generation narrative LLM n'est pas encore connectee au vrai catalogue narratif.
- La progression eleve et le deblocage de carte ne sont pas encore relies a un etat persistant.
- Le cache des exercices generes est en memoire et est perdu au redemarrage du serveur.
