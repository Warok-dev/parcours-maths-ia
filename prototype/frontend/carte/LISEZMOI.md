# carte/ — le jeu (ancien `map.js`)

L'ancien `map.js` (4 500 lignes) est découpé en scripts **classiques** chargés dans l'ordre par `index.html`. Il n'y a pas d'étape de build : les fonctions et les constantes de premier niveau restent globales et sont partagées entre les fichiers, exactement comme avant.

| Fichier | Contenu |
|---|---|
| `etat.js` | Constantes, références DOM, état global (`state`) |
| `interface.js` | Bandeau de retour, sauvegarde de session, score, thèmes d'obstacles, apartés de confiance |
| `assets.js` | Bibliothèque des dessins SVG (`ASSETS`) |
| `camera.js` | Orientation du parcours, caméra |
| `monde.js` | Modèle de scène : routes, arrêts, trésor, ambiance, obstacles |
| `rendu.js` | Rendu de la scène, décor vivant, variante visuelle par niveau |
| `deplacement.js` | Navigation entre écrans, mouvement et collisions, particules |
| `exercice.js` | Fenêtre d'exercice : énoncé, mécanique, validation, correction |
| `session.js` | Session de jeu, mode hors-ligne, reprise au chargement |
| `boucle.js` | Clavier, boucle de jeu, boussole |
| `demarrage.js` | Menu, branchements d'interface, tactile, API `window.ParcoursApp`, démarrage |

## La seule règle

Un fichier peut **appeler** à tout moment une fonction d'un autre fichier, tant que l'appel se fait dans une fonction, donc après le chargement de tous les scripts. En revanche, le code exécuté **au chargement** (hors fonction) ne peut utiliser que ce qui est déclaré dans le même fichier ou dans un fichier précédent. C'est pour cela que tous les branchements d'interface et l'appel `demarrerApplication()` sont dans `demarrage.js`, le dernier.

L'ordre de chargement est défini dans `ordre.json`. `outils/verifier_decoupage.js` vérifie que `index.html` le respecte et qu'aucun fichier n'enfreint la règle. La CI lance ce contrôle.
