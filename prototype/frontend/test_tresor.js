/* Tests du tresor du raccourci (tresor.js).
   Lancer avec : node test_tresor.js
   Regle centrale : le tresor n'existe QUE sur la route courte. */
const tresor = require("./tresor.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* Session de renforcement telle que le backend la publie. */
function session(maitrise, extra = {}) {
  return {
    phase: "renforcement",
    maitrise_actuelle: maitrise,
    concept_index: 0,
    terminee: false,
    ...extra,
  };
}

/* --- 1. Correspondance maitrise -> route (source unique, utilisee aussi
       par map.js pour tracer le chemin reellement emprunte) --- */
{
  check(tresor.routePourMaitrise(3) === "courte", "maitrise 3 -> route courte");
  check(tresor.routePourMaitrise(2) === "moyenne", "maitrise 2 -> route moyenne");
  check(tresor.routePourMaitrise(1) === "longue", "maitrise 1 -> route longue");
  check(tresor.routePourMaitrise(0) === "moyenne", "maitrise inconnue -> route moyenne par defaut");
  check(tresor.routePourMaitrise(undefined) === "moyenne", "maitrise absente -> route moyenne par defaut");
  check(tresor.ROUTE_AVEC_TRESOR === "courte", "la route au tresor est la courte");
}

/* --- 2. LE test central : un tresor sur la courte, jamais sur les autres --- */
{
  check(tresor.tresorSurRoute(3) === true, "route courte (maitrise 3) : tresor");
  check(tresor.tresorSurRoute(2) === false, "route moyenne (maitrise 2) : AUCUN tresor");
  check(tresor.tresorSurRoute(1) === false, "route longue (maitrise 1) : AUCUN tresor");

  /* Aucune autre valeur de maitrise ne doit ouvrir une porte derobee. */
  const autres = [undefined, null, 0, 4, 99, -1, "3", 2.5];
  check(
    autres.every((maitrise) => tresor.tresorSurRoute(maitrise) === false),
    `aucune maitrise inattendue ne donne de tresor (${autres.length} cas testes)`,
  );
  check(
    Object.entries(tresor.ROUTE_PAR_MAITRISE).filter(([, r]) => r === tresor.ROUTE_AVEC_TRESOR).length === 1,
    "une seule maitrise mene a la route au tresor",
  );
}

/* --- 3. Disponibilite complete, en situation --- */
{
  check(tresor.tresorDisponible(session(3), new Set()), "renforcement maitrise 3 : tresor affiche");
  check(!tresor.tresorDisponible(session(2), new Set()), "renforcement maitrise 2 : rien");
  check(!tresor.tresorDisponible(session(1), new Set()), "renforcement maitrise 1 : rien");

  check(
    !tresor.tresorDisponible(session(3, { phase: "detection_maitrise" }), new Set()),
    "hors renforcement : rien, meme avec une maitrise 3 affichee",
  );
  check(!tresor.tresorDisponible(session(3, { terminee: true }), new Set()), "carte terminee : rien");
  check(!tresor.tresorDisponible(null, new Set()), "sans session : rien");
}

/* --- 4. Un seul ramassage par tresor --- */
{
  const ramasses = new Set();
  const s = session(3);
  check(tresor.tresorDisponible(s, ramasses), "avant ramassage : present");

  ramasses.add(tresor.cleTresor(s));
  check(!tresor.tresorDisponible(s, ramasses), "apres ramassage : plus de tresor (pas de farming)");
  check(tresor.estRamasse(s, ramasses), "le tresor est marque comme ramasse");

  /* Le concept suivant a le sien : la cle depend du troncon. */
  const suivant = session(3, { concept_index: 1 });
  check(tresor.cleTresor(suivant) !== tresor.cleTresor(s), "un tresor par troncon de concept");
  check(tresor.tresorDisponible(suivant, ramasses), "nouveau concept en maitrise 3 : nouveau tresor");

  /* La forme persistee est un tableau (localStorage), pas un Set. */
  check(tresor.estRamasse(s, [...ramasses]), "la liste persistee est relue correctement");
  check(!tresor.estRamasse(s, []), "liste vide : rien de ramasse");
  check(!tresor.estRamasse(s, null), "liste absente : rien de ramasse");
}

/* --- 5. Ramassage au contact --- */
{
  check(tresor.estARamasser(0), "pile dessus : ramasse");
  check(tresor.estARamasser(tresor.DISTANCE_RAMASSAGE), "a la distance limite : ramasse");
  check(!tresor.estARamasser(tresor.DISTANCE_RAMASSAGE + 1), "un pixel plus loin : pas encore");
  check(!tresor.estARamasser(Infinity) && !tresor.estARamasser(NaN), "distance invalide : pas de ramassage");
  check(
    tresor.DISTANCE_RAMASSAGE < 118,
    "le rayon de ramassage reste sous celui des interactions d'exercice (118)",
  );
}

/* --- 6. Bonus et placement --- */
{
  check(tresor.BONUS === 50, "le bonus vaut 50 etoiles");
  check(
    tresor.FRACTION_SUR_ROUTE > 0.18 && tresor.FRACTION_SUR_ROUTE < 0.85,
    "le tresor se pose entre les deux haltes d'entrainement (18 % et 85 %)",
  );
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
