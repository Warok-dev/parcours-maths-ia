/* Tests du coeur de decision du tuteur proactif (proactive.js).
   Lancer avec : node test_proactive.js
   Horloge simulee : les timestamps sont passes explicitement. */
const { createTracker, COOLDOWN_MS, THRESHOLDS } = require("./proactive.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* --- 1. Declenchement apres 2 echecs consecutifs (niveaux 1 et 2) --- */
{
  const t = createTracker();
  t.exerciseShown("ex-a", 1, 0);
  check(t.recordWrongAnswer(1000) === false, "niveau 1 : pas de proposition au 1er echec");
  check(t.recordWrongAnswer(2000) === true, "niveau 1 : proposition au 2e echec");
}
{
  const t = createTracker();
  t.exerciseShown("ex-a", 2, 0);
  t.recordWrongAnswer(1000);
  check(t.recordWrongAnswer(2000) === true, "niveau 2 : memes seuils que le niveau 1");
}

/* --- 2. Declenchement apres le delai d'inactivite --- */
{
  const t = createTracker();
  t.exerciseShown("ex-b", 1, 0);
  check(t.checkInactivity(THRESHOLDS.standard.inactiviteMs - 1) === false, "niveau 1 : pas de proposition juste avant 25 s");
  check(t.checkInactivity(THRESHOLDS.standard.inactiviteMs) === true, "niveau 1 : proposition a 25 s d'inactivite");
}
{
  const t = createTracker();
  t.exerciseShown("ex-b", 1, 0);
  t.recordActivity(20000); /* interaction : le chrono repart */
  check(t.checkInactivity(30000) === false, "l'interaction remet le chrono d'inactivite a zero");
  check(t.checkInactivity(20000 + THRESHOLDS.standard.inactiviteMs) === true, "puis proposition 25 s apres la derniere interaction");
}

/* --- 3. Pas de sur-sollicitation avant le delai d'espacement (45 s) --- */
{
  const t = createTracker();
  t.exerciseShown("ex-c", 1, 0);
  t.recordWrongAnswer(1000);
  check(t.recordWrongAnswer(2000) === true, "proposition initiale declenchee");
  check(t.recordWrongAnswer(3000) === false, "3e echec 1 s apres : pas de relance");
  check(t.checkInactivity(2000 + THRESHOLDS.standard.inactiviteMs) === false, "inactivite pendant le cooldown : pas de relance");
  check(t.recordWrongAnswer(2000 + COOLDOWN_MS) === true, "relance possible apres 45 s d'espacement");
}

/* --- 4. Seuils plus prudents au niveau 3 (autonome) --- */
{
  const t = createTracker();
  t.exerciseShown("ex-d", 3, 0);
  check(t.recordWrongAnswer(1000) === false, "niveau 3 : pas de proposition au 1er echec");
  check(t.recordWrongAnswer(2000) === false, "niveau 3 : pas de proposition au 2e echec");
  check(t.recordWrongAnswer(3000) === true, "niveau 3 : proposition au 3e echec");
}
{
  const t = createTracker();
  t.exerciseShown("ex-e", 3, 0);
  check(t.checkInactivity(THRESHOLDS.standard.inactiviteMs) === false, "niveau 3 : rien a 25 s (seuil standard ignore)");
  check(t.checkInactivity(THRESHOLDS.autonome.inactiviteMs - 1) === false, "niveau 3 : rien juste avant 40 s");
  check(t.checkInactivity(THRESHOLDS.autonome.inactiviteMs) === true, "niveau 3 : proposition a 40 s");
}

/* --- 5. Changement d'exercice : compteurs remis a zero, cooldown conserve --- */
{
  const t = createTracker();
  t.exerciseShown("ex-f", 1, 0);
  t.recordWrongAnswer(1000);
  t.exerciseShown("ex-g", 1, 2000); /* nouvel exercice */
  check(t.recordWrongAnswer(3000) === false, "les echecs ne se cumulent pas d'un exercice a l'autre");
  check(t.recordWrongAnswer(4000) === true, "2 echecs sur le nouvel exercice : proposition");
  t.exerciseShown("ex-f", 1, 5000); /* retour sur l'exercice deja aide ? non : ex-f n'a pas eu de proposition */
  t.recordWrongAnswer(6000);
  check(t.recordWrongAnswer(7000) === true, "le cooldown est bien suivi PAR exercice");
}

/* --- 6. Panneau ferme : plus aucune proposition --- */
{
  const t = createTracker();
  t.exerciseShown("ex-h", 1, 0);
  t.panelClosed();
  check(t.recordWrongAnswer(1000) === false && t.recordWrongAnswer(2000) === false, "panneau ferme : echecs ignores");
  check(t.checkInactivity(60000) === false, "panneau ferme : inactivite ignoree");
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
