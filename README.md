# parcours-maths-ia

Prototype de jeu educatif 2D (mathematiques CE1-CE2) avec generation automatique d'exercices et tuteur IA. Stage - Ministere de l'Education, Maroc.

## Structure

```text
projet-ia-maths/
├── data/
│   ├── raw/
│   │   ├── N1/
│   │   ├── N2/
│   │   ├── N3/
│   │   ├── N4/
│   │   ├── N5/
│   │   └── N6/
│   └── samples/
├── analysis/
│   ├── scripts/
│   ├── reports/
│   └── data/
├── docs/
└── prototype/
```

## Contenu

- `data/raw/`
  Contient les fichiers PowerPoint originaux, ranges par niveau scolaire.

- `data/samples/`
  Contient les echantillons utilises pour les premieres analyses manuelles.

- `analysis/scripts/`
  Contient les scripts Python d'extraction et d'analyse.

- `analysis/reports/`
  Contient les rapports Markdown produits pendant l'exploration du corpus.

- `analysis/data/`
  Contient les sorties JSON structurees produites par les scripts d'analyse.

- `docs/`
  Reserve a la note de cadrage, aux taches, au suivi produit et aux decisions de conception.

- `prototype/`
  Reserve au prototype web et aux experimentations applicatives.

## Etat actuel

- Le corpus PowerPoint a ete range sans duplication ni suppression.
- Des analyses exploratoires existent deja dans `analysis/reports/`.
- Des exports structures existent deja dans `analysis/data/`.
- Un schema JSON d'exercice existe deja dans `prototype/schema/`.

## Prochaines etapes suggerees

1. Choisir la stack technique du prototype web.
2. Coder un premier generateur procedural sur un echantillon CE1/CE2.
3. Generer les 3 variantes de presentation pour ce meme echantillon.
4. Mettre en place le pipeline generation -> evaluation -> progression.
