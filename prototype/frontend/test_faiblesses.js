/* Tests de la memoire des faiblesses (faiblesses.js).
   Lancer avec : node test_faiblesses.js
   localStorage est simule ; faiblesses.js se charge sans navigateur. */

/* Stub de localStorage installe AVANT le require (le module lit le
   stockage a la demande, mais autant refleter l'ordre du navigateur). */
const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const faiblesses = require("./faiblesses.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* Snapshot de fin de lecon tel que le backend le publie. */
function snapshot(lecon_id, concepts, maitrises, niveau = "CE1") {
  return {
    session_id: `s-${lecon_id}-${maitrises.join("")}`,
    niveau_scolaire: niveau,
    lecon_id,
    lecon_nom: lecon_id,
    concepts,
    maitrises_concepts_terminees: maitrises,
    terminee: true,
  };
}

function patterns(entries) {
  return entries.map((entry) => entry.pattern_name);
}

/* --- 1. Lecture de la maitrise par concept --- */
{
  const concepts = faiblesses.conceptsTermines(
    snapshot("addition", ["a", "b", "c"], [1, 3, 2]),
  );
  check(
    JSON.stringify(concepts) ===
      JSON.stringify([
        { pattern_name: "a", maitrise: 1 },
        { pattern_name: "b", maitrise: 3 },
        { pattern_name: "c", maitrise: 2 },
      ]),
    "maitrises alignees sur l'ordre des concepts",
  );

  const partiel = faiblesses.conceptsTermines(snapshot("addition", ["a", "b"], [2]));
  check(partiel[1].maitrise === 1, "concept sans maitrise connue compte comme 1");
}

/* --- 2. Ajout : seules les maitrises 1 et 2 entrent dans la liste --- */
{
  const entries = faiblesses.appliquerFinDeLecon(
    [],
    snapshot("addition", ["concept_1", "concept_2", "concept_3"], [1, 3, 2]),
  );
  check(patterns(entries).join(",") === "concept_1,concept_3", "maitrises 1 et 2 memorisees, 3 ignoree");
  check(entries[0].maitrise === 1 && entries[1].maitrise === 2, "la maitrise atteinte est conservee");
  check(
    entries.every((entry) => entry.lecon_id === "addition" && entry.niveau_scolaire === "CE1"),
    "pattern_name, lecon_id et niveau sont stockes ensemble",
  );
}

/* --- 3. Retrait apres maitrise 3 (mise a jour, pas accumulation) --- */
{
  let entries = faiblesses.appliquerFinDeLecon(
    [],
    snapshot("addition", ["concept_1", "concept_2"], [1, 1]),
  );
  check(patterns(entries).join(",") === "concept_1,concept_2", "deux faiblesses au depart");

  entries = faiblesses.appliquerFinDeLecon(
    entries,
    snapshot("revision_ciblee", ["concept_1"], [3]),
  );
  check(patterns(entries).join(",") === "concept_2", "concept repasse a 3 : retire de la liste");

  entries = faiblesses.appliquerFinDeLecon(
    entries,
    snapshot("revision_ciblee", ["concept_2"], [2]),
  );
  check(patterns(entries).join(",") === "concept_2", "concept encore a 2 : toujours present, pas duplique");
  check(entries[0].maitrise === 2, "sa maitrise est mise a jour (1 -> 2)");
  check(entries[0].lecon_id === "addition", "la lecon d'origine est conservee malgre la revision");

  entries = faiblesses.appliquerFinDeLecon(
    entries,
    snapshot("revision_ciblee", ["concept_2"], [3]),
  );
  check(entries.length === 0, "dernier concept acquis : liste vide");
}

/* --- 4. Les niveaux ne se melangent pas --- */
{
  let entries = faiblesses.appliquerFinDeLecon([], snapshot("addition", ["concept_1"], [1], "CE1"));
  entries = faiblesses.appliquerFinDeLecon(entries, snapshot("addition", ["concept_1"], [1], "CE2"));
  check(entries.length === 2, "le meme pattern en CE1 et CE2 fait deux entrees");

  entries = faiblesses.appliquerFinDeLecon(entries, snapshot("addition", ["concept_1"], [3], "CE2"));
  check(
    entries.length === 1 && entries[0].niveau_scolaire === "CE1",
    "acquis en CE2 : seule l'entree CE2 disparait",
  );
}

/* --- 5. Snapshot inexploitable : la liste ne bouge pas --- */
{
  const avant = [{ pattern_name: "concept_1", niveau_scolaire: "CE1", maitrise: 1 }];
  check(faiblesses.appliquerFinDeLecon(avant, {}) === avant, "snapshot sans niveau : liste inchangee");
  check(
    faiblesses.appliquerFinDeLecon(avant, snapshot("addition", [], [])).length === 1,
    "lecon sans concept : liste inchangee",
  );
}

/* --- 6. Aller-retour reel via localStorage --- */
{
  localStorage.clear();
  faiblesses.enregistrerFinDeLecon(
    snapshot("soustraction", ["concept_faible", "concept_acquis"], [2, 3], "CE1"),
  );
  const brut = localStorage.getItem(faiblesses.STORAGE_KEY);
  check(typeof brut === "string" && brut.includes("concept_faible"), "ecrit sous la cle faiblesses_v1");
  check(!brut.includes("concept_acquis"), "le concept acquis n'est pas ecrit");

  check(
    faiblesses.patternsPourNiveau("CE1").join(",") === "concept_faible",
    "relecture : patterns du niveau demande",
  );
  check(faiblesses.patternsPourNiveau("CE2").length === 0, "aucun pattern pour l'autre niveau");

  faiblesses.enregistrerFinDeLecon(snapshot("revision_ciblee", ["concept_faible"], [3], "CE1"));
  check(faiblesses.patternsPourNiveau("CE1").length === 0, "apres maitrise 3 : plus rien a revoir");

  /* Stockage illisible : on repart d'une liste vide sans planter. */
  localStorage.setItem(faiblesses.STORAGE_KEY, "{pas du json");
  check(faiblesses.loadEntries().length === 0, "stockage corrompu : liste vide, aucune exception");
}

/* --- 7. Ordre : les faiblesses les plus anciennes en premier --- */
{
  localStorage.clear();
  faiblesses.saveEntries([
    { pattern_name: "recent", niveau_scolaire: "CE1", maitrise: 1, date: "2026-07-20T10:00:00.000Z" },
    { pattern_name: "ancien", niveau_scolaire: "CE1", maitrise: 1, date: "2026-01-05T10:00:00.000Z" },
  ]);
  check(
    faiblesses.patternsPourNiveau("CE1").join(",") === "ancien,recent",
    "les faiblesses les plus anciennes passent devant",
  );
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
