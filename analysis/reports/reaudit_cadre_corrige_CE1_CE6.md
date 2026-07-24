# Re-audit du corpus avec le cadre corrigé (CE1 → CE6)

Analyse **uniquement** — aucun code de génération n'est modifié à ce stade.
Deux corrections structurelles appliquées à l'ensemble du corpus (150 fichiers,
data/raw/N1…N6) :

- **Correction 1** — la correction appariée n'est plus une condition stricte
  pour les patterns `calcul_direct` / `exercice_a_trous_serie` sans ambiguïté :
  on retient l'exercice et on calcule la réponse, avec deux niveaux de confiance
  `confirmé` (correction du corpus trouvée) vs `déduit` (calculable sans
  correction). Les **problèmes narratifs gardent** l'exigence d'appariement.
- **Correction 2** — on distingue le **visuel générable** (descriptible par
  quelques paramètres numériques et rendu en SVG procédural, comme le jeu le
  fait déjà) du **visuel complexe** (compas, tracé, solide 3D, diagramme) qui
  reste exclu.

Chaque question du corpus (appariée **ou non**) a été repassée dans cette grille.

---

## 1. Décompte global recatégorisé

Notation `c` = confirmé (apparié), `d` = déduit (non apparié mais calculable).
Les comptes bruts incluent des sous-slides « étape 1 / étape 2 » d'un même
exercice : ils indiquent le **poids relatif** d'une catégorie, pas un nombre
exact d'exercices distincts.

| Catégorie | N1 | N2 | N3 | N4 | N5 | N6 |
|---|---|---|---|---|---|---|
| **calcul_direct** | 3c+2d | 33c+**27d** | 14c+11d | 7c+1d | 1c+**38d** | 9c+13d |
| **suite** (déductible) | 1c+8d | 11c+1d | 3c+2d | 5c | – | 11c+18d |
| **VG – horloge** | **14c+15d** | – | 1c+7d | – | – | – |
| **VG – ligne graduée** | 2c | – | – | – | – | – |
| **VG – tableau** | 1c | – | – | 2c | 5d | 5c |
| **VG – figure cotée** | 2c | – | – | 1c+3d | 2c | – |
| narratif (inchangé) | 15c+54d | 15c+2d | 9c+13d | 4c+24d | 1c+56d | 3c+23d |
| **visuel complexe** (exclu) | 5c+5d | 6c+5d | 10c+19d | 2c+24d | **2c+74d** | 25c+21d |

VG = visuel générable. Total visuel générable par niveau :
**N1 ≈ 34**, N2 = 0, **N3 = 8**, N4 = 6, N5 = 7, N6 = 5.

---

## 2. Recompte CE1 / CE2 (déjà catalogués)

### CE1 (N1) — le gros gain est l'horloge
- **Lecture de l'heure : ~29 exercices** (14 confirmés + 15 déduits), leçons
  `قراءة الساعة (1)` et `(2)`. **Explicitement écartées au tout début de
  l'analyse** comme « reconnaissance visuelle non générable ». Or un cadran
  analogique = **2 paramètres** (position des aiguilles) → SVG déterministe →
  **visuel générable**. C'est le pattern générable le plus fréquent de CE1.
- **Ligne graduée : 2** (`الشريط العددي`) — support visuel des suites, réutilise
  le format de réponse `liste_ordonnee` déjà en place.
- **Tableau simple : 1**, **figure cotée : 2** (carrés colorés du part-tout).
- `calcul_direct` déduit : +2 seulement (l'arithmétique CE1 est présentée en
  modèles de barres sans opérateur explicite, donc classée figure/narratif).
- **Patterns supplémentaires pour CE1 : 2 nouveaux types générables**
  (`lecture_heure_analogique`, `completer_ligne_graduee`). Aucun nouveau type
  « déduit » (l'arithmétique CE1 est déjà couverte).

### CE2 (N2) — surtout de la fréquence, peu de nouveaux types
- `calcul_direct` déduit : **+27** — mais ce sont les **mêmes types déjà
  catalogués** (×10, ×multiple de 10, décomposée, addition 2 chiffres, conversion
  cm/mm), simplement bien plus fréquents que le « confirmé » ne le montrait
  (beaucoup d'énoncés `4 x 60 = …`, `45 x 10 = …` sans correction appariée).
- Suites : +1. **Aucun visuel générable** (les `المجسمات` = solides 3D sont du
  **visuel complexe**, correctement exclus).
- **Patterns supplémentaires pour CE2 : 0 nouveau type.** Gain = confiance et
  couverture (les patterns existants sont ~2× plus fréquents qu'estimé).

---

## 3. Recompte CE3 → CE6

### CE3 (N3)
- **Horloge : 8** (`قراءة الساعات: الساعات والدقائق`, L17) — comptée « visuelle »
  au tour précédent, elle devient **générable** (heures + minutes, pas de 5 min).
- `calcul_direct` déduit : +11 (multiplication posée, division, conversions,
  durées) — mêmes types que les 5 déjà branchés.
- Visuel complexe confirmé : 29 (triangles, cercle/compas, solides, symétrie) —
  socle géométrique réel du niveau.
- **Nouveau type générable : `lecture_heure_analogique`** (partagé avec CE1).

### CE4 (N4)
- `calcul_direct` : décimaux (déjà identifiés) ; **figure cotée : 4** (périmètre
  de rectangle avec dimensions données) → **générable** (à distinguer des angles
  au rapporteur / symétrie, qui restent complexes).
- **Nouveau type générable : `figure_cotee_simple`** (périmètre/aire rectangle).

### CE5 (N5) — récupération majeure
- **`calcul_direct` déduit : +38.** Le fameux « 5.4 % d'appariement » masquait un
  **socle calculable substantiel** : circonférence du cercle (`d = 2 × 10 = 20`,
  `P = π × d`), périmètre de polygone régulier (`n × côté`), aire de base
  (`6 × 6 = 36 cm²`), aire/surface latérale de solides. Ces calculs sont
  **déductibles** car les dimensions sont **données en nombres** dans l'énoncé.
- **Tableau : 5 déduit** (lecture de données), **figure cotée : 2**.
- Mais le **visuel complexe reste dominant : 76** (solides 3D moshour/cylindre,
  patrons, compas). Donc N5 = **noyau calculable récupérable (~40) enrobé dans
  une majorité de géométrie complexe**.
- **Reclassement de la conclusion précédente** : CE5 n'est pas « inexploitable ».
  Les figures simples (cercle, polygone régulier, rectangle) sont **générables**
  et leur calcul est déductible ; seuls les solides 3D et les patrons restent
  hors de portée. `pourcentage_d_une_quantite` est confirmé comme calculable.

### CE6 (N6)
- `calcul_direct` déduit : +13 (pourcentage `100 % = 520 g / 25 % = ?`,
  vitesse-distance-durée `85 km/h`).
- **Tableau de proportionnalité : 5** → **générable** (2 lignes, une case
  masquée). Suites : +18 déduit.
- **Nouveau type déduit : `echelle_plan`** (`1 cm sur le plan : 10 000 cm réel`)
  — absent des catalogues précédents.

---

## 4. Combien de patterns supplémentaires apparaissent ?

| Niveau | Nouveaux types **générables** | Nouveaux types **déduits** | Gain principal |
|---|---|---|---|
| CE1 | 2 (horloge, ligne graduée) | 0 | **Horloge (~29 ex.)** |
| CE2 | 0 | 0 | Fréquence ×~2 des patterns existants (+27 déduits) |
| CE3 | 1 (horloge) | 0 | Horloge (8) + volume déduit |
| CE4 | 1 (figure cotée) | 0 | Périmètre/aire rectangle |
| CE5 | 1 (figure cotée) | 1 (pourcentage confirmé calculable) | **+38 déduits récupérés** |
| CE6 | 1 (tableau proportionnalité) | 1 (échelle/plan) | Tableaux + échelle + % |

Types **génériques** transverses qui émergent : `lecture_heure_analogique`,
`completer_ligne_graduee`, `completer_tableau_proportionnalite`,
`figure_cotee_simple` (rectangle/carré/polygone régulier/cercle). Détail complet
dans `analysis/catalogs/pattern_catalog_visuel_generable.json`.

---

## 5. Liste priorisée des nouveaux patterns à intégrer

1. **`lecture_heure_analogique` — PRIORITÉ 1.** Le plus fréquent (CE1 ~29, CE3 8),
   2 paramètres, rendu SVG trivial (cadran + 2 aiguilles :
   angle_h = h×30 + m×0.5, angle_m = m×6). CE1 en heures/demies, CE3 en pas de
   5 min. Réponse : heure H:MM (ou choix parmi 3 horloges digitales, comme le
   corpus). Confiance mixte confirmé+déduit. **Renverse l'exclusion initiale.**
2. **`completer_ligne_graduee` — PRIORITÉ 2.** CE1 ; réutilise le format
   `liste_ordonnee` déjà supporté ; donne un support visuel aux suites.
3. **`completer_tableau_proportionnalite` — PRIORITÉ 3.** CE6 (et tableaux de
   données CE5, prix CE4). Rendu tableau 2 lignes, une case masquée ; réponse
   entière.
4. **`figure_cotee_simple` — PRIORITÉ 4.** CE4 (périmètre/aire rectangle), CE5
   (périmètre polygone régulier, circonférence cercle). Débloque une grande part
   du socle CE5 récupéré. À bien séparer de la géométrie au compas (exclue).
5. **Relâcher l'exigence de correction (confiance `déduit`) pour le calcul
   direct — PRIORITÉ 5, coût quasi nul.** Aucun nouveau rendu : on autorise
   simplement les patterns calcul_direct existants à être alimentés par les
   énoncés non appariés. Impact fort surtout **CE5 (+38)**, **CE2 (+27)**,
   **CE6 (+13)**. Marquer ces exercices `deduit` en métadonnée.
6. **`echelle_plan` (CE6) — PRIORITÉ 6.** Nouveau type déduit (proportionnalité
   d'échelle) ; pas de rendu spécifique requis.

---

## 6. Ce qui reste exclu (visuel complexe, inchangé)

Compas et tracés (cercle au compas, construction du triangle rectangle),
solides 3D et leurs patrons (moshour, cylindre), symétrie à tracer, mesure
d'angles au rapporteur, lecture de diagrammes/histogrammes dessinés. Ces
catégories dominent CE5 (76) et pèsent lourd en CE3 (29) et CE6 (46) — l'écart
géométrique de CE3–CE6 par rapport à CE1/CE2 est donc **en partie structurel**,
mais nettement **moins extrême** qu'avant re-cadrage (l'horloge et le calcul
déduit récupèrent une part importante de ce qui était classé « visuel »).

---

## 7. Livrables de ce lot (analyse seule)

- Ce rapport : `analysis/reports/reaudit_cadre_corrige_CE1_CE6.md`.
- Catalogue des patterns révélés : `analysis/catalogs/pattern_catalog_visuel_generable.json`
  (patterns visuel-générable + tableau des calculs déduits récupérés par niveau).
- **Aucun code de génération modifié.** L'intégration (à commencer par la lecture
  de l'heure) viendra après validation, dans un lot dédié.
