/* Tests du mode hors-ligne (offline.js) : tampon, évaluation locale et
   bascule en ligne/hors-ligne, séparés de tout rendu.
   Lancer avec : node test_offline.js
   localStorage est simulé ; offline.js se charge sans navigateur. */

const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const offline = require("./offline.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

function reset() {
  store.clear();
  offline._reset();
}

/* Fabrique un exercice procédural minimal au format du générateur backend. */
function exProcedural(pattern_name, variables, valeur, extra = {}) {
  return {
    id: `X-${pattern_name}-${Math.random().toString(36).slice(2)}`,
    pattern: {
      pattern_name,
      pattern_family: extra.family || "calcul_direct",
      generation_method: extra.method || "substitution",
    },
    variables: variables || { a: 1 },
    enonce: `${pattern_name} ?`,
    reponse_attendue: {
      valeur,
      format: extra.format || "nombre_entier",
      tolerance: {
        ignorer_espaces: true,
        equivalences_acceptees: extra.equivalences || [],
      },
    },
  };
}

/* ====================================================================
   1. ÉVALUATION LOCALE (miroir de evaluation.py)
   ==================================================================== */
{
  const ex = exProcedural("addition", { a: 24, b: 6 }, 30, {
    equivalences: ["30", "30.0"],
  });
  check(offline.evaluer(ex, "30"), "réponse exacte acceptée");
  check(offline.evaluer(ex, " 30 "), "espaces autour ignorés");
  check(offline.evaluer(ex, "30.0"), "équivalence acceptée");
  check(!offline.evaluer(ex, "31"), "mauvaise réponse rejetée");
  check(!offline.evaluer(ex, ""), "réponse vide rejetée");
}

/* Commutativité de la multiplication et signes équivalents. */
{
  const ex = exProcedural(
    "addition_repetee_vers_multiplication",
    { k: 7, n: 3, total: 21 },
    "21 = 3 x 7",
    { format: "expression", equivalences: ["3 x 7", "7 x 3", "21 = 7 x 3"] },
  );
  check(offline.evaluer(ex, "21 = 3 x 7"), "expression exacte");
  check(offline.evaluer(ex, "3 x 7"), "facteurs seuls acceptés");
  check(offline.evaluer(ex, "7 x 3"), "ordre inverse (commutativité)");
  check(offline.evaluer(ex, "3 * 7"), "signe * équivaut à x");
  check(offline.evaluer(ex, "3 × 7"), "signe × équivaut à x");
  check(!offline.evaluer(ex, "2 x 7"), "mauvais facteur rejeté");
  check(
    offline.multiplicationsEquivalentes("21=3x7", "21=7x3"),
    "helper commutativité direct",
  );
}

/* Listes ordonnées : la comparaison passe par l'équivalence jointe. */
{
  const ex = exProcedural(
    "suite_multiples_de_10_a_completer",
    { suite_complete: [10, 20, 30] },
    [10, 20, 30],
    { format: "liste_ordonnee", equivalences: ["10, 20, 30"] },
  );
  check(offline.evaluer(ex, "10, 20, 30"), "liste avec espaces");
  check(offline.evaluer(ex, "10,20,30"), "liste sans espaces");
  check(!offline.evaluer(ex, "10, 20"), "liste incomplète rejetée");
}

/* ====================================================================
   2. RECONNAISSANCE PROCÉDURAL vs NARRATIF
   ==================================================================== */
{
  check(
    offline.estProcedural(exProcedural("addition", {}, 3, { family: "calcul_direct" })),
    "famille calcul_direct = procédural",
  );
  check(
    offline.estProcedural(exProcedural("suite", {}, 3, { family: "exercice_a_trous_serie" })),
    "famille exercice_a_trous_serie = procédural",
  );
  check(
    !offline.estProcedural(exProcedural("heure", {}, 3, { family: "lecture_horloge" })),
    "horloge écartée (hors périmètre demandé)",
  );
  check(
    !offline.estProcedural(
      exProcedural("recette", {}, 3, { family: "probleme_narratif_simple", method: "llm" }),
    ),
    "problème narratif (LLM) écarté",
  );
  check(!offline.estProcedural({}), "objet vide n'est pas procédural");
}

/* ====================================================================
   3. TAMPON : remplissage, consommation, épuisement
   ==================================================================== */
{
  reset();
  check(offline.estVide(), "tampon vide au départ");
  check(offline.taille() === 0, "taille initiale 0");

  const a = exProcedural("addition", { a: 1, b: 2 }, 3);
  check(offline.ajouter(a), "ajout d'un exercice procédural");
  check(offline.taille() === 1, "taille passe à 1");
  check(!offline.ajouter(a), "doublon (même signature) refusé");
  check(offline.taille() === 1, "taille inchangée après doublon");

  check(
    !offline.ajouter(exProcedural("recit", {}, 3, { family: "probleme_narratif_simple", method: "llm" })),
    "narratif refusé à l'ajout",
  );

  const b = offline.consommer();
  check(b && b.pattern.pattern_name === "addition", "consommation renvoie l'exercice");
  check(offline.estVide(), "tampon vidé après consommation");
  check(offline.consommer() === null, "consommer un tampon vide renvoie null");
}

/* Persistance réelle via localStorage entre deux "sessions". */
{
  reset();
  offline.ajouter(exProcedural("m", { a: 5 }, 5));
  offline.ajouter(exProcedural("m", { a: 6 }, 6));
  offline._reset(); // simule un rechargement de page (RAM vidée, storage gardé)
  check(offline.taille() === 2, "le tampon est relu depuis localStorage");
  check(offline.consommer().variables.a === 5, "ordre FIFO préservé après relecture");
}

/* Changement de niveau : le tampon est reparti de zéro. */
{
  reset();
  offline.definirNiveau("CE1");
  offline.ajouter(exProcedural("m", { a: 1 }, 1));
  check(offline.taille() === 1, "un exercice en CE1");
  offline.definirNiveau("CE2");
  check(offline.estVide(), "changer de niveau vide le tampon");
}

/* ====================================================================
   4. REMPLISSAGE via un fetch injecté
   ==================================================================== */
(async () => {
  /* 4a. Remplissage nominal jusqu'à une cible. */
  {
    reset();
    let compteur = 0;
    const fetchExercice = async (pattern) =>
      exProcedural(pattern, { a: compteur++ }, compteur);
    const ajouts = await offline.remplir({
      fetchExercice,
      patterns: ["addition", "soustraction"],
      cible: 5,
    });
    check(ajouts === 5, "remplit exactement jusqu'à la cible");
    check(offline.taille() === 5, "tampon à la cible");
  }

  /* 4b. Les patterns narratifs (404) sont écartés sans planter. */
  {
    reset();
    const fetchExercice = async (pattern) => {
      if (pattern === "narratif") {
        const err = new Error("Not Found");
        err.status = 404;
        throw err;
      }
      return exProcedural(pattern, { a: Math.random() }, 1);
    };
    const ajouts = await offline.remplir({
      fetchExercice,
      patterns: ["narratif"],
      cible: 3,
    });
    check(ajouts === 0, "pool uniquement narratif : rien n'est ajouté");
    check(offline.estVide(), "tampon reste vide sans boucler à l'infini");
  }

  /* 4c. Une erreur RÉSEAU (sans statut) stoppe le remplissage. */
  {
    reset();
    let appels = 0;
    const fetchExercice = async () => {
      appels += 1;
      throw new TypeError("Failed to fetch"); // pas de .status => réseau
    };
    const ajouts = await offline.remplir({
      fetchExercice,
      patterns: ["addition", "soustraction"],
      cible: 5,
    });
    check(ajouts === 0, "erreur réseau : aucun ajout");
    check(appels === 1, "erreur réseau : on arrête tout de suite (1 appel)");
  }

  /* 4d. Exercice non procédural renvoyé (horloge) : pattern écarté. */
  {
    reset();
    const fetchExercice = async (pattern) =>
      pattern === "heure"
        ? exProcedural("heure", {}, "3:00", { family: "lecture_horloge" })
        : exProcedural(pattern, { a: Math.random() }, 1);
    const ajouts = await offline.remplir({
      fetchExercice,
      patterns: ["heure"],
      cible: 3,
    });
    check(ajouts === 0, "pattern horloge écarté du tampon");
  }

  /* ====================================================================
     5. BASCULE EN LIGNE / HORS-LIGNE
     ==================================================================== */
  {
    reset();
    const transitions = [];
    offline.onChangement((horsLigne) => transitions.push(horsLigne));

    check(!offline.estHorsLigne(), "en ligne par défaut");
    check(offline.basculerHorsLigne() === true, "1re bascule hors-ligne = transition");
    check(offline.estHorsLigne(), "état hors-ligne");
    check(offline.basculerHorsLigne() === false, "re-bascule hors-ligne = pas de transition");
    check(offline.basculerEnLigne() === true, "retour en ligne = transition");
    check(!offline.estHorsLigne(), "état en ligne");
    check(offline.basculerEnLigne() === false, "re-bascule en ligne = pas de transition");
    check(
      transitions.join(",") === "true,false",
      "les abonnés reçoivent exactement les deux transitions",
    );
  }

  /* Distinction erreur réseau vs erreur serveur. */
  {
    const reseau = new TypeError("Failed to fetch");
    const http404 = Object.assign(new Error("Not Found"), { status: 404 });
    const http503 = Object.assign(new Error("Service Unavailable"), { status: 503 });
    check(offline.estErreurReseau(reseau), "fetch rejeté = erreur réseau");
    check(!offline.estErreurReseau(http404), "404 = serveur joignable (pas réseau)");
    check(!offline.estErreurReseau(http503), "503 = serveur joignable (pas réseau)");
    check(!offline.estErreurReseau(null), "absence d'erreur = pas réseau");
  }

  console.log(`\n${total - failures}/${total} cas passent`);
  if (failures > 0) {
    process.exit(1);
  }
})();
