/* Tests du coeur pur de l'espace parent (parent.js).
   Lancer avec : node test_parent.js
   En Node, parent.js n'exporte que la logique testable (comptage de maitrise,
   phrase de bilan) : pas de DOM, pas de fetch. */

const parent = require("./parent.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* --- 1. Comptage par niveau de maitrise --- */
{
  const c = parent.compterMaitrise([
    { maitrise: 3 },
    { maitrise: 3 },
    { maitrise: 2 },
    { maitrise: 1 },
  ]);
  check(c.acquis === 2, "deux concepts acquis (maitrise 3)");
  check(c.enCours === 1, "un concept en bonne voie (maitrise 2)");
  check(c.aRetravailler === 1, "un concept a retravailler (maitrise 1)");
  check(c.total === 4, "total = somme des trois");
}

/* --- 2. Entrees vides ou invalides : aucun plantage --- */
{
  check(parent.compterMaitrise([]).total === 0, "liste vide -> total 0");
  check(parent.compterMaitrise(null).total === 0, "entree nulle -> total 0");
  const c = parent.compterMaitrise([{}, { maitrise: 0 }, { maitrise: 9 }]);
  check(c.total === 0, "maitrises absentes / hors bornes ignorees");
}

/* --- 3. Phrase de bilan : langage accessible, sans jargon --- */
{
  const vide = parent.phraseBilan("Sofia", { acquis: 0, enCours: 0, aRetravailler: 0, total: 0 });
  check(/pas encore/.test(vide), "sans progression -> phrase 'pas encore'");
  check(/Sofia/.test(vide), "la phrase nomme l'enfant");

  const c = parent.compterMaitrise([{ maitrise: 3 }, { maitrise: 2 }, { maitrise: 1 }]);
  const phrase = parent.phraseBilan("Sofia", c);
  check(/3 notions/.test(phrase), "mentionne le total de notions travaillees");
  check(
    /maitrisee/.test(phrase) && /bonne voie/.test(phrase) && /retravailler/.test(phrase),
    "detaille les trois categories en mots simples",
  );
  check(!/pattern|maitrise:|niveau_scolaire/.test(phrase), "aucun jargon technique dans la phrase");
}

/* --- 4. Singulier / pluriel --- */
{
  const une = parent.phraseBilan("Adam", { acquis: 1, enCours: 0, aRetravailler: 0, total: 1 });
  check(/1 notion /.test(une) && /maitrisee/.test(une), "singulier pour une seule notion");
}

/* --- 5. Libelles de badges alignes sur le reste du site --- */
{
  check(
    parent.BADGES_MAITRISE[3] === "Acquis" &&
      parent.BADGES_MAITRISE[2] === "En bonne voie" &&
      parent.BADGES_MAITRISE[1] === "A retravailler",
    "libelles de maitrise identiques au bilan eleve / enseignant",
  );
}

/* --- 6. Extraction des messages d'alerte de blocage --- */
{
  const actif = {
    active: true,
    alertes: [
      { type: "stagnation", message: "Sofia s'entraine mais stagne." },
      { type: "concept_bloque", message: "Sofia bute sur la division." },
    ],
  };
  const msgs = parent.messagesAlerte(actif);
  check(msgs.length === 2, "deux messages d'alerte extraits");
  check(/division/.test(msgs[1]), "le message de blocage est conserve");

  check(parent.messagesAlerte({ active: false, alertes: [] }).length === 0, "alerte inactive -> aucun message");
  check(parent.messagesAlerte(null).length === 0, "entree nulle -> aucun message");
  check(
    parent.messagesAlerte({ active: true, alertes: [{ type: "x" }, { message: 5 }] }).length === 0,
    "alertes mal formees ignorees",
  );
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
