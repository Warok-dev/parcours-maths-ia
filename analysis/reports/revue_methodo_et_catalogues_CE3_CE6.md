# Revue de la méthodologie d'extraction + catalogues de patterns CE3–CE6

Périmètre : 150 fichiers PowerPoint (`data/raw/N1`…`N6`, période 4), le script
`analysis/scripts/analyze_pptx_corpus_v2.py`, le rapport
`analyse_pptx_math_all_levels_v2.md`, le catalogue en production
`pattern_catalog.json` (N1/N2) et son implémentation `generation/substitution.py`.

Reproduction : l'extraction relancée sur les fichiers du repo redonne **exactement**
les taux du rapport livré (N1 50.9 %, N2 54.2 %, N3 48.7 %, N4 38.7 %, N5 5.4 %,
N6 45.5 % ; global 40.7 % ; 148 fichiers, 2 « échecs »). La méthodo est donc
déterministe et reproductible.

---

## 1. Fiabilité de la méthodologie existante

### 1.1 Ce qui est solide

- **Détection de correction via `صححوا`** : robuste et stable sur les 6 niveaux.
  Le nombre de slides de correction détectées reste élevé partout, y compris
  N5 (103) et N6 (280) — le rituel « صححوا » (corrigez !) est une constante du
  corpus. Ce n'est **pas** le maillon faible.
- **Politique de non-invalidation** : marquer une question isolée « correction
  non trouvée » plutôt que jeter tout le fichier est le bon choix ; il rend le
  taux d'appariement interprétable comme un indicateur de *substituabilité
  textuelle*, pas de qualité du fichier.
- **Fenêtre de proximité 1→3 slides + score** (nombres partagés ×2, tokens ×0.5,
  opérateurs, bonus) : raisonnable pour un corpus où question et correction se
  suivent. Le seuil 2.5 filtre correctement le bruit sur N1–N4.

### 1.2 Angles morts et approximations risquées

1. **L'appariement repose sur le recouvrement numérique — il s'effondre dès que
   la réponse est visuelle.** Le score est dominé par les nombres partagés
   (2 pts chacun). Si l'énoncé vit dans une figure (le texte de la slide ne
   contient qu'un label ou un nombre isolé) et que la correction introduit un
   nombre calculé *absent* de l'énoncé, aucun appariement ne se forme. C'est
   **exactement** ce qui tue N5 (13/240 alors que 103 corrections existent) :
   panne d'**appariement**, pas de **détection**. Ce biais s'aggrave à mesure
   que la géométrie et les diagrammes montent (N5, et partiellement N4/N6).

2. **Le « découpage en phases » n'est pas un découpage.** `infer_structure`
   fait une simple recherche de sous-chaînes (النمذجة, ممارسة موجهة, ممارسة
   مستقلة…) et liste les phases *mentionnées quelque part* dans le fichier.
   Il n'assigne aucun exercice à une phase. Il ne faut donc **pas** s'en servir
   pour dériver le niveau de guidage pédagogique (guidé/semi/autonome) : dans le
   jeu, ces 3 niveaux viennent du design, pas de cette détection.

3. **La catégorisation des types d'exercices est indicative, pas fiable.**
   `detect_exercise_types` est un ensemble de buckets par mots-clés, non
   exclusifs et très larges : « Calcul / réponse courte » se déclenche sur un
   simple `+`, `-` ou `=`, présents presque partout. Utile pour explorer, à ne
   **pas** utiliser comme classifieur automatique pour générer des patterns.

4. **Petits défauts techniques.**
   - Le regex `صحح(?:وا|ي|وا\.)` ne couvre pas la forme avec chadda (صحّحوا) ni
     les tournures « نصحّح / التصحيح » ; sans impact mesuré ici (le corpus
     utilise صححوا), mais fragile si un niveau change de convention.
   - Le glob `*.pptx` embarque les fichiers verrous Office `~$*.pptx` (les 2
     « échecs » du rapport) ; cosmétique, mais à filtrer (`not name.startswith("~$")`).
   - L'extraction éclate parfois les nombres décimaux sur les espaces OpenXML
     (`34, 6` au lieu de `34,6`) — à normaliser avant de dériver des templates.

### 1.3 Conséquence pour CE3–CE6

La méthode reste fiable là où **la réponse est un nombre présent dans le texte**
(calcul direct, décimaux, proportionnalité numérique) — donc utilisable telle
quelle pour N3, N4, N6. Elle devient **non fiable** dès que la réponse se lit sur
une figure/diagramme (N5, et sous-parties géométriques de N4/N6). Le taux
d'appariement doit se lire comme un **plancher de substituabilité**, jamais comme
une mesure de couverture du programme.

---

## 2. Revue de fidélité de N1/N2 (déjà en production)

Vérification concrète : re-clustering d'un échantillon des paires N1/N2 appariées
et comparaison template par template avec `pattern_catalog.json` **et** le
générateur `substitution.py`.

### 2.1 Une vraie erreur de fidélité trouvée (et corrigée) — les compléments à 10

Les deux patterns part-tout à un chiffre excluaient **systématiquement** le
`tout = 10`, alors que c'est le cas emblématique du corpus N1 :

- `partie_tout_soustraction_non_narratif` : le corpus montre `10 − 4 = 6`,
  `10 − 7 = 3`, `10 − 8 = 2` (2 des 3 exemples du catalogue ont `tout = 10`). Or
  la contrainte « sans retenue » `(tout%10) >= (partie%10)` appliquée à des
  nombres ≤ 10 rend `tout = 10` impossible (10 % 10 = 0 < toute unité de partie).
- `partie_tout_addition_non_narratif` : même mécanique, `somme = 10` (4 + 6,
  3 + 7) exclue.

Mesuré empiriquement avant correction (5000 tirages) : `tout` ∈ {3…9}, **jamais
10** ; `somme` ∈ {2…9}, **jamais 10**. Détail aggravant : le test
`test_partie_tout_soustraction_non_narratif` *encodait* la contrainte fautive
(`assertGreaterEqual(tout%10, partie%10)`), donc l'erreur était « verrouillée »
par un test vert.

**Correction appliquée (Phase 2)** dans `generation/substitution.py` :
tirage direct `tout ∈ [3,10]`, `partie ∈ [1, tout−1]` (soustraction) et
`partie1 ∈ [1,9]`, `partie2 ∈ [1, 10−partie1]` (addition) — la retenue n'a aucun
sens sur des nombres ≤ 10, la contrainte était à la fois inutile et nuisible.
Helpers `_rand_non_carry_addition` / `_rand_non_borrow_subtraction` supprimés
(devenus morts). Test fautif corrigé + **garde anti-régression** ajoutée
(`test_complements_a_dix_sont_generables`). Suite backend : **115 tests OK**.

### 2.2 Imprécisions mineures de documentation (pas des erreurs de génération)

- Les mentions « sans retenue dans le corpus observé » sont parfois contredites
  par le corpus lui-même : `12 = 3 + 9` (retenue) en addition part-tout N1, et
  `5 × 6 = 30` (retenue dans un sous-produit) en multiplication décomposée N2.
  Les **générateurs** gèrent ces cas correctement ; seules les notes du
  catalogue sont trop absolues. À reformuler en « retenue possible ».
- Un cas 3 opérandes (`6 + 3 + 5 = 14`, N2) et un pas-à-pas atteignant 12 ne sont
  pas couverts explicitement — rares, non bloquants.

### 2.3 Ce qui est fidèle (confirmé)

- Tous les autres patterns purs (×10, ×multiple de 10, décomposée, moitié/double,
  comparaison, addition 2 chiffres, conversion cm/mm, identifier multiple de 10,
  suites) apparaissent bien dans le corpus et sont **fidèlement** générés.
  `identifier_multiple_de_10` reproduit même exactement la forme des distracteurs
  du corpus (`45 | 40 | 54`).
- **Aucun pattern substituable manqué** en N1/N2 : les grandes familles non
  cataloguées (lecture d'horloge, comptage de carrés colorés, patrons de solides)
  sont **visuelles** et correctement exclues. Le catalogue N1/N2 est donc **valide
  tel quel**, à la correction §2.1 près (désormais appliquée).

---

## 3. Nouveaux catalogues CE3–CE6

Fichiers JSON produits (même modèle que `pattern_catalog.json`), un par niveau :

- `analysis/catalogs/pattern_catalog_N3.json`
- `analysis/catalogs/pattern_catalog_N4.json`
- `analysis/catalogs/pattern_catalog_N5.json`
- `analysis/catalogs/pattern_catalog_N6.json`

Chaque fichier sépare `pure_substitution_patterns` et `llm_required_patterns`,
avec template, contraintes de génération, occurrences (approximatives — voir
`extraction_caveat` de chaque fichier) et exemples du corpus.

### CE3 (N3) — 5 patterns substitution, 2 LLM — confiance **bonne**
Division exacte (partage) `24 ÷ 6 = 4` · conversion kg↔g (deux sens)
`7420 g = 7 kg 420 g` · multiplication posée 2–3 chiffres `145 × 26 = 3770` ·
groupes égaux depuis modèle `6 × 32 = 192` · (durées min, faible).
LLM : problèmes de partage/division, problèmes de groupes égaux.
Exclu (visuel) : classification de triangles, symétrie, rayon du cercle.

### CE4 (N4) — 7 patterns substitution, 2 complexes — confiance **moyenne→bonne**
Cœur = nombres décimaux : comparaison `24,93 > 24,90` · rangement ·
addition/soustraction posées `34,6 + 29,85 = 64,45`, `45,73 − 19,6 = 26,13` ·
composition/décomposition `7 unités 3 dixièmes = 7,3` · arrondi dizaine/centaine ·
grande soustraction posée `2584 − 936`.
Complexe : division posée (quotient/reste — à rendre en réponse courte, pas en
potence), périmètre du rectangle (figure cotée).
Exclu (visuel) : angles au rapporteur, axes de symétrie.

### CE5 (N5) — 4 patterns substitution (confiance **faible**), 1 LLM
`pourcentage_d_une_quantite` `25 % de 32 = 8` (le seul vraiment robuste) ·
périmètre de polygone régulier · circonférence du cercle · aire de base — tous
**inférés du sujet**, pas de paires propres (13 appariements seulement). Les
occurrences sont indicatives (≤ 3). Le reste (aires/volumes de solides, lecture
de diagrammes — 42 charts, patrons de prismes/cylindres) est **non exploitable
par texte**.

### CE6 (N6) — 4 patterns substitution, 2 LLM — confiance **moyenne (taux trompeur)**
Tableau de proportionnalité (coefficient) · pourcentage d'une quantité
`520 g × 25 %` · vitesse–distance–durée `85 km/h × 6 h` · fraction→décimal
`45/10 = 4,5`. LLM : problèmes de proportionnalité (prix × quantité), problèmes
de vitesse. **Attention** : ~37 des 110 paires sont un QCM de vocabulaire
arabe↔français (hors maths) et une part du reste est de la lecture de graphiques ;
le cœur mathématique réellement générable est plus étroit que le 45.5 % le suggère.

---

## 4. Recommandation d'intégration

| Niveau | Taux appariement | Cœur substituable | Verdict intégration |
|--------|------------------|-------------------|---------------------|
| CE1/CE2 | 50–54 % | déjà en prod | **En production** (fidèle après correctif §2.1) |
| **CE3** | 48.7 % | division, conversions, ×posée, groupes | **Réaliste maintenant** — le plus proche de CE1/CE2 |
| **CE4** | 38.7 % | décimaux (compare, ±, composition, arrondi) | **Réaliste** — cœur décimal solide ; exclure angles/symétrie |
| **CE6** | 45.5 % | proportionnalité, %, vitesse, fractions | **Réaliste avec tri** — retirer le QCM de vocabulaire FR et la lecture de graphiques ; garder le noyau proportionnalité |
| **CE5** | 5.4 % | quasi rien de fiable | **À reporter / curation manuelle** |

**Ordre conseillé** : CE3 d'abord (mécanique identique à CE1/CE2, patterns
propres), puis CE4 (décimaux — nouvelle mécanique de saisie à valeur décimale
à prévoir côté jeu), puis CE6 (proportionnalité/tableaux — nécessite une
mécanique « compléter un tableau » et un tri strict des paires vocabulaire/graphes).

**CE5 : ne pas intégrer depuis l'extraction automatique.** Le problème n'est pas
la détection de correction mais la dépendance visuelle massive (prismes,
cylindres, disques, diagrammes) qui casse l'appariement. Deux voies : (a) curation
manuelle d'un petit lot purement numérique (pourcentage d'une quantité en tête,
périmètres/aires si les dimensions sont explicitées dans l'énoncé) ; (b) reporter
CE5 jusqu'à un pipeline multimodal capable de lire figures et graphiques. Signalé
comme tel dans `pattern_catalog_N5.json` (`recommandation`).

---

## 5. Livré dans ce lot

- **Correctif de fidélité N1/N2** (compléments à 10) dans `generation/substitution.py`
  + test corrigé + garde anti-régression (`generation/test_substitution.py`).
- **4 catalogues** `analysis/catalogs/pattern_catalog_N{3,4,5,6}.json`.
- Tests : backend **115 OK**, frontend **9 suites OK**.

Note : les catalogues CE3–CE6 ne sont **pas** encore branchés dans le jeu
(`substitution.py` ne charge que `pattern_catalog.json` / `LEVEL_MAP` CE1-CE2).
Les brancher est une étape distincte (générateurs par pattern + entrées
`lessons.json` + extension de `LEVEL_MAP`), à faire niveau par niveau selon
l'ordre ci-dessus.
