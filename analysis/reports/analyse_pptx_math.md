# Analyse des fichiers PowerPoint de mathématiques

Les contenus des slides sont majoritairement en arabe. Le compte rendu ci-dessous est en français, avec des extraits réels des énoncés.

## MATH_N1_P4_SEM1_S1.pptx

### 1. Métadonnées
- Nom du fichier : `MATH_N1_P4_SEM1_S1.pptx`
- Niveau scolaire : `N1` d’après le nom du fichier (probablement CE1 si la convention `N1..N6 = CE1..CE6` est bien celle du projet)
- Nombre de slides : `68`

### 2. Structure générale
- Structure très répétitive et fortement scénarisée.
- Pattern global : slides d’introduction et de consignes enseignant -> rappel / calcul mental -> leçon du jour -> vidéo de modélisation -> pratique guidée -> pratique en cahier -> pratique autonome -> clôture.
- Pattern micro très visible dans les exercices : `consigne -> "ارفعوا الألواح" (montrez les ardoises) -> "صححوا" (correction)`.

### 3. Types d’exercices présents
- Calcul mental / réponse courte.
  - Extrait : `37 ناقص 2 تساوي كم؟`
  - Extrait : `احسبوا فرق العددين على السطر`
- Identification visuelle sur image.
  - Extrait : `اكتبوا على الألواح العدد الذي يشير إليه العقرب الصغير`
  - Extrait : `اكتبوا العدد الذي يقف عنده عقرب الدقائق`
- Correspondance image -> réponse textuelle / numérique.
  - Extrait : `اقرؤوا الساعة العقربية واكتبوا الساعة الرقمية الموافقة لها على الألواح`
  - Extrait : `اقرؤوا الساعة العقربية واكتبوا رقم الساعة الرقمية الموافقة لها على الألواح. | 1 | 2 | 3`
- Exercice à trous / complétion.
  - Extrait : `اقرؤوا الساعة العقربية وأكملوا الساعة الرقمية الموافقة لها على الألواح. | .. : | ..`

### 4. Format des réponses attendues
- Les corrections sont presque toujours présentes dans la slide suivante ou quelques slides après la question.
- Exemples :
  - `صححوا : يشير عقرب الساعات إلى الساعة الحادية عشرة 11`
  - `صححوا : الثالثة تماما`
- Les notes de présentateur existent techniquement sur certaines slides, mais l’extraction montre seulement des marqueurs comme `19`, `22`, `46` ; elles ne contiennent pas de correction exploitable.

### 5. Niveau de complexité du langage
- Langage simple, très directif, formulé pour l’oral enseignant-élèves.
- Beaucoup de verbes d’action courts : `اكتبوا`, `اقرؤوا`, `ارفعوا`, `صححوا`.
- Le contenu n’est pas du texte pur : la compréhension dépend souvent d’horloges analogiques et de supports visuels.

### 6. Éléments non-textuels
- Très forte dépendance aux images.
- Nombreuses slides avec horloges analogiques, personnages, icônes et probablement vidéo.
- Extraction purement textuelle insuffisante pour reconstituer les questions du type “lire l’heure” sans interprétation visuelle.

## MATH_N2_P4_SEM1_S1.pptx

### 1. Métadonnées
- Nom du fichier : `MATH_N2_P4_SEM1_S1.pptx`
- Niveau scolaire : `N2` d’après le nom du fichier
- Nombre de slides : `41`

### 2. Structure générale
- Même trame pédagogique que le fichier précédent, mais plus compacte.
- Pattern dominant : calcul mental -> modélisation -> activité guidée par étapes -> exercice cahier -> exercice autonome -> clôture.
- Les exercices sont organisés en séquences courtes question/correction.

### 3. Types d’exercices présents
- Calcul mental / calcul direct.
  - Extrait : `لديكم دقيقة لإنجاز هذه العمليات`
  - Extrait : `صححوا واكتبوا عدد الإجابات الصحيحة. | 90 | 60 | 50 | 20 | 80 | 70 | 40`
- Procédure guidée pas à pas.
  - Extrait : `45 x 10 = …`
  - Extrait : `ماذا نفعل في الخطوة الأولى؟ | أَكْتُبُ الْعَدَدَ الْمُكَوَّنَ مِنْ رَقْمَيْنِ | 1 | أُضيفُ صِفْراً عَلى يَمينِ الْعَدَدِ | 2`
- Réponse libre de calcul.
  - Extrait : `احسبوا على الألواح جداء العددين. | 76 x 10 = …`
- Exercices sur cahier avec correction finale chiffrée.
  - Extrait correction : `صححوا. لديكم دقيقة | 1 | 180 | 300 | 490`
  - Extrait correction : `صححوا | . | 150 | 520 | 170 | 800 | 240 | 510`

### 4. Format des réponses attendues
- Les réponses sont présentes dans les slides de correction, généralement immédiatement après la question.
- Exemples :
  - `45 x 10 = 450`
  - `76 x 10 = 760`
- Les notes ne portent pas d’information pédagogique utile ; elles contiennent surtout des identifiants de slide (`8`, `9`, `10`, etc.).

### 5. Niveau de complexité du langage
- Langage très simple, procédural, orienté consigne.
- Peu de narration.
- Une grande partie du contenu reste compréhensible en texte seul, car les questions portent surtout sur des opérations numériques.

### 6. Éléments non-textuels
- Présence d’images et d’icônes, mais dépendance visuelle plus faible que dans `N1`.
- Ce fichier est l’un des plus favorables à une extraction automatique texte -> JSON.

## MATH_N3_P4_SEM1_S1.pptx

### 1. Métadonnées
- Nom du fichier : `MATH_N3_P4_SEM1_S1.pptx`
- Niveau scolaire : `N3` d’après le nom du fichier
- Nombre de slides : `61`

### 2. Structure générale
- Trame identique : rappel / calcul mental -> modélisation -> pratique guidée -> travail sur cahier -> pratique autonome -> clôture.
- Pattern micro très clair sur les activités de géométrie : `identifier -> lever l’ardoise -> corriger`.

### 3. Types d’exercices présents
- Calcul mental.
  - Extrait : `ضرب 8 على السطر`
  - Extrait correction : `صححوا | 16 | 48 | 24 | 32 | 56 | 64 | 40 | 72`
- Classification d’objets géométriques.
  - Extrait : `اكتبوا رقم المثلث متساوي الساقين من بين هذه المثلثات`
  - Extrait : `اكتبوا حرف المثلث قائم الزاوية`
- Choix parmi objets visuels étiquetés.
  - Extrait correction : `صححوا، المثلث المتساوي الساقين هو المثلث رقم 3.`
  - Extrait correction : `صححوا، المثلث القائم الزاوية هو المثلث A.`
- Réponse libre de catégorisation.
  - Extrait : `اكتبوا، على ألواحكم، نوع المثلث التالي`
  - Extrait correction : `صححوا: هذا مثلث متساوي الأضلاع، لأن له ثلاث زوايا متقايسة.`

### 4. Format des réponses attendues
- Les réponses/corrections sont présentes directement dans les slides de correction qui suivent.
- Les justifications apparaissent parfois, ce qui est utile pour structurer un couple `réponse + explication`.
- Les notes ne semblent pas contenir de correction supplémentaire utile.

### 5. Niveau de complexité du langage
- Langage simple à intermédiaire.
- Le vocabulaire disciplinaire géométrique est plus riche : `متساوي الساقين`, `متساوي الأضلاع`, `قائم الزاوية`.
- Le texte seul ne suffit pas toujours car la tâche dépend de figures de triangles.

### 6. Éléments non-textuels
- Forte dépendance aux schémas géométriques.
- Les réponses demandent souvent d’identifier un triangle par sa forme ou ses marques de congruence ; extraction texte seule insuffisante.

## MATH_N4_P4_SEM1_S1.pptx

### 1. Métadonnées
- Nom du fichier : `MATH_N4_P4_SEM1_S1.pptx`
- Niveau scolaire : `N4` d’après le nom du fichier
- Nombre de slides : `66`

### 2. Structure générale
- Trame commune aux autres fichiers, mais avec davantage de diversité dans les types de questions.
- On observe successivement : calcul mental -> reconnaissance d’angles -> petite opération numérique -> QCM sur instrument et unité -> modélisation sur la mesure d’un angle -> exercices cahier -> pratique autonome.

### 3. Types d’exercices présents
- Identification visuelle / réponse libre.
  - Extrait : `اكتبوا على اللوحة | نوع | الزاوية`
  - Extrait correction : `صححوا. | زاوية قائمة`
- Calcul posé ou numérique.
  - Extrait : `أنجزوا العملية على الألواح | 187 | 18`
  - Extrait correction : `صححوا. من يعيد سردية العملية للتحقق`
- QCM textuel.
  - Extrait : `اكتبوا رقم الإجابة الصحيحة. | يُقاسُ انْفِتاحُ الزّاوَيا بِ: | الْبِرْكارِ؛ | الْمِنْقَلَةِ؛ | الْكوسِ؛ | الْمسْطَرَةِ.`
  - Extrait : `اكتبوا رقم الإجابة الصحيحة. | وَحَدَةُ قِيّاسِ انْفِتاحِ الزَّاوَيا هي: | اَلْمِتْرُ؛ | اَللِّتْرُ؛ | اَلدَّرَجَةُ؛ | الدَّقيقَةُ.`
- Mesure géométrique pas à pas.
  - Extrait : `على ألواحكم ، احسبوا قياس الزاوية متبعين التدريجات`
  - Extrait correction : `قياس الزاوية هو 15 درجة`

### 4. Format des réponses attendues
- Les corrections sont bien présentes sur des slides dédiées.
- Pour les QCM, la correction donne le numéro de la bonne réponse :
  - `صححوا. | 1 | يُقاسُ انْفِتاحُ الزَّاوَيا بِ...`
  - `صححوا. | 1 | وَحَدَةُ قِيّاسِ انْفِتاحِ الزَّاوَيا هي...`
- Les notes de présentateur n’apportent pas de correction additionnelle utile.

### 5. Niveau de complexité du langage
- Langage simple mais plus technique que `N1/N2`.
- Mélange de consignes courtes et de vocabulaire spécifique (`المنقلة`, `الدرجة`).
- Une partie du contenu textuel est exploitable telle quelle, mais la mesure d’angle dépend du schéma.

### 6. Éléments non-textuels
- Présence forte de dessins d’angles et d’une représentation de rapporteur/gradations.
- Les slides de mesure sont difficiles à exploiter sans vision.
- Les QCM purement textuels sont en revanche très extractibles.

## MATH_N5_P4_SEM1_S1.pptx

### 1. Métadonnées
- Nom du fichier : `MATH_N5_P4_SEM1_S1.pptx`
- Niveau scolaire : `N5` d’après le nom du fichier
- Nombre de slides : `58`

### 2. Structure générale
- Structure commune, centrée cette fois sur la lecture d’un diagramme circulaire.
- Pattern guidé très régulier : `observer -> extraire -> déterminer`, répété sur plusieurs slides.

### 3. Types d’exercices présents
- Calcul mental.
  - Extrait correction : `صححوا | 4 | 5 | 6 | 7 | 4 | 5 | 6 | 7 | 14 | 15 | 22 | 23`
- Lecture de tableau + lecture de diagramme.
  - Extrait : `اكتبوا على الألواح اسم اللاعب الأول في الجدول`
  - Extrait : `اكتبوا اللون الذي يمثل اللاعب حكيمي في المبيان`
- Extraction de pourcentage depuis un graphique.
  - Extrait : `اكتبوا على الألواح نسبة التلاميذ الذين يفضلون حكيمي`
  - Extrait : `اكتبوا على الألواح نسبة التلاميذ الذين يفضلون دياز`
- Exercices corrigés par listes de pourcentages.
  - Extrait correction : `صححوا | 30% | 15% | 25% | 20%`
  - Extrait correction : `صححوا على كراساتكم | 40% | 10% | 20% | 30%`

### 4. Format des réponses attendues
- Les réponses sont présentes dans les slides de correction qui suivent.
- Exemple : `25%`, `20%`, `22%`, `18%`, `15%` apparaissent progressivement sur les slides de correction.
- Les notes ne donnent pas de contenu pédagogique additionnel exploitable.

### 5. Niveau de complexité du langage
- Langage assez simple.
- Les consignes sont brèves et répétitives.
- En revanche, la compréhension dépend presque entièrement d’un tableau et d’un diagramme circulaire coloré.

### 6. Éléments non-textuels
- Très forte dépendance au visuel : couleurs, segments du diagramme, correspondance tableau <-> graphique.
- Le texte seul ne suffit pas pour reconstruire l’énoncé complet de beaucoup de questions.

## MATH_N6_P4_SEM1_S1.pptx

### 1. Métadonnées
- Nom du fichier : `MATH_N6_P4_SEM1_S1.pptx`
- Niveau scolaire : `N6` d’après le nom du fichier
- Nombre de slides : `55`

### 2. Structure générale
- Même squelette pédagogique global que les autres fichiers.
- Différence notable : présence de problèmes narratifs plus longs et de tableaux explicitement intégrés dans certaines slides.
- Pattern typique : rappel de proportionnalité -> résolution guidée d’un problème -> résolution d’un second problème analogue -> exercices cahier -> clôture.

### 3. Types d’exercices présents
- Calcul mental / tableau de proportionnalité simple.
  - Extrait : `لنقم بملء الجدول التالي والذي يمثل العلاقة بين عدد دورات مدار السباقة والمسافة`
  - Extrait correction : `36 | 24 | 6 | ... | 15 | 30 | 2`
- Problème narratif.
  - Extrait : `ثَمَنُ الْقَلَمِ الْواحِدِ هوَ 3 دَراهِمَ ، اشْتَرى خالِدٌ عَدَداً مِنَ الْأَقْلَاِمِ لِزُمَلائِهِ في الْفَصْلِ. ما هوَ الْمَبْلَغُ الَّذي سَيُؤَدّيهِ خالِدٌ...؟`
  - Extrait : `ثَمَنُ قِطْعَةِ الشُّوكُولاتَةِ الْواحِدَةِ هوَ 8 دَراهِمَ، اشْتَرَتْ مَرْيَمُ عَدَداً مِنَ الْقِطَعِ...`
- Formalisation mathématique.
  - Extrait : `اكتبوا العبارة الرياضياتية الممثلة لعلاقة التناسب`
  - Extrait correction : `Y = 3 X`
- Organisation des données dans un tableau.
  - Extrait : `على الألواح، نظموا معطيات المسألة في جدول وأتموا ملأه`
  - Extrait correction : table avec `عدد الأقلام | المبلغ المؤدى بالدرهم` puis des couples comme `1 -> 3`, `9 -> 27`, `13 -> 39`

### 4. Format des réponses attendues
- Les réponses sont présentes dans les slides de correction, souvent riches.
- On y trouve non seulement la réponse finale, mais aussi la représentation algébrique et le tableau rempli.
- Les notes ne fournissent pas de correction complémentaire utile ; elles contiennent surtout des repères internes.

### 5. Niveau de complexité du langage
- Langage plus complexe que dans les autres fichiers.
- Les énoncés sont narratifs, avec relation mathématique implicite à modéliser.
- Le texte seul reste exploitable dans une large mesure, surtout pour les problèmes de proportionnalité.

### 6. Éléments non-textuels
- Dépendance visuelle modérée.
- Certaines slides contiennent de vrais tableaux OpenXML, ce qui est un bon signe pour une extraction structurée.
- C’est un des fichiers les plus intéressants pour un prototype, car plusieurs exercices sont textuels et la correction est structurée.

## Synthèse transversale

### 1. Format commun ou structures différentes ?
- Il existe un format commun très net entre tous les niveaux.
- Tous les fichiers suivent une logique de séquence pédagogique complète, pas une simple banque d’exercices.
- Structure commune observée :
  - introduction / consignes enseignant
  - objectifs
  - rappel ou calcul mental
  - vidéo / modélisation
  - pratique guidée
  - pratique en cahier ou en binômes
  - pratique autonome
  - clôture
- À l’intérieur des activités, un micro-format récurrent revient souvent : `consigne -> réponse élève -> correction`.
- Ce qui change d’un niveau à l’autre, ce n’est pas la macro-structure, mais la nature des objets manipulés : heure, opérations, triangles, angles, diagrammes, proportionnalité.

### 2. Types d’exercices faciles à extraire et transformer en JSON
- Calculs textuels simples.
  - Exemples : `37 ناقص 2`, `76 x 10 = ...`
- QCM textuels.
  - Exemple : instrument de mesure d’un angle ; unité de mesure.
- Problèmes narratifs textuels avec correction explicite.
  - Exemples : problèmes de proportionnalité dans `N6`.
- Exercices à trous purement textuels quand la réponse est écrite ensuite.
  - Exemple : compléter une heure numérique quand l’horloge n’est pas indispensable ou déjà décrite textuellement.
- Exercices corrigés par listes de résultats numériques.
  - Exemples : séries `180 | 300 | 490`, ou pourcentages `30% | 15% | 25% | 20%`.

### 3. Types d’exercices difficiles ou très difficiles à extraire automatiquement
- Questions dépendant d’une image ou d’un schéma sans description textuelle complète.
  - lecture d’horloge analogique (`N1`)
  - reconnaissance de triangles (`N3`)
  - mesure d’angle sur figure graduée (`N4`)
  - lecture de diagramme circulaire coloré (`N5`)
- Questions où le texte dit seulement `اكتبوا نوع الزاوية` ou `من يقرأ الساعة ؟` sans décrire la figure.
- Slides où la correction est textuelle mais la question reste incompréhensible sans le visuel.

### 4. Recommandation pour le prototype
- Priorité 1 : exercices purement textuels avec correction explicite dans une slide proche.
  - calculs
  - QCM textuels
  - petits problèmes narratifs
  - tableaux textuels / proportionnalité
- Priorité 2 : exercices semi-structurés où le texte est fort mais le visuel aide.
  - certains exercices de `N6`
  - certains exercices guidés de `N2`
- À éviter dans un premier prototype :
  - `N1` lecture de l’heure
  - `N3` classification de triangles
  - `N4` mesure d’angles sur figure
  - `N5` lecture de diagramme circulaire
- Si l’objectif est un pipeline fiable `PPTX -> JSON`, le meilleur point de départ est :
  - `MATH_N2_P4_SEM1_S1.pptx` pour les calculs textuels
  - `MATH_N6_P4_SEM1_S1.pptx` pour les problèmes narratifs et tableaux
  - puis une partie des QCM de `MATH_N4_P4_SEM1_S1.pptx`

### 5. Conclusion opérationnelle
- Oui, il existe un format réutilisable au niveau structurel.
- Non, tout le contenu n’est pas extractible en texte seul.
- Le sous-ensemble le plus rentable pour un prototype est :
  - `question textuelle`
  - `réponse attendue explicite`
  - `correction sur la slide suivante ou très proche`
  - `faible dépendance à l’image`
- En pratique, cela favorise d’abord les fichiers `N2`, `N4` (QCM textuels) et `N6`.
