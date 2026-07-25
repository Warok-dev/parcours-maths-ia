/* Tests du coeur pur du module compte eleve (compte.js).
   Lancer avec : node test_compte.js
   En Node, compte.js n'exporte que la logique testable (grouperProgression) :
   pas de DOM, pas de fetch, pas de localStorage. */

const compte = require("./compte.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* Ligne de progression telle que le backend la publie. */
function ligne(pattern_name, lecon_id, maitrise, date) {
  return { pattern_name, lecon_id, maitrise, date_derniere_tentative: date };
}

/* --- 1. Regroupement par lecon en pages de carnet --- */
{
  const entrees = compte.grouperProgression(
    [
      ligne("mult_a", "multiplication_division", 3, "2026-07-20T10:00:00Z"),
      ligne("mult_b", "multiplication_division", 2, "2026-07-20T10:05:00Z"),
      ligne("div_a", "multiplication_division", 1, "2026-07-20T10:02:00Z"),
    ],
    { niveau: "CE3", lessonNames: { multiplication_division: "Multiplication et division" } },
  );
  check(entrees.length === 1, "une seule page pour une lecon");
  const page = entrees[0];
  check(page.lecon_nom === "Multiplication et division", "nom lisible depuis lessonNames");
  check(page.niveau_scolaire === "CE3", "niveau repris depuis meta");
  check(page.concepts.length === 3, "les trois concepts sont sur la page");
  check(page.etoiles === 6, "etoiles = somme des maitrises (3+2+1)");
  check(page.etoiles_max === 9, "etoiles_max = 3 concepts x 3");
  check(page.date === "2026-07-20T10:05:00Z", "date = tentative la plus recente de la lecon");
}

/* --- 2. Plusieurs lecons : une page chacune, plus recente en premier --- */
{
  const entrees = compte.grouperProgression(
    [
      ligne("add_a", "addition", 3, "2026-07-18T09:00:00Z"),
      ligne("sous_a", "soustraction", 2, "2026-07-22T09:00:00Z"),
    ],
    { niveau: "CE1", lessonNames: { addition: "Addition", soustraction: "Soustraction" } },
  );
  check(entrees.length === 2, "deux lecons -> deux pages");
  check(
    entrees[0].lecon_id === "soustraction" && entrees[1].lecon_id === "addition",
    "la lecon la plus recemment travaillee passe en premiere page",
  );
}

/* --- 3. Nom de lecon inconnu : repli sur l'identifiant --- */
{
  const entrees = compte.grouperProgression([ligne("x", "lecon_mystere", 1, "2026-01-01T00:00:00Z")], {
    niveau: "CE2",
    lessonNames: {},
  });
  check(entrees[0].lecon_nom === "lecon_mystere", "sans nom connu, on affiche l'identifiant de lecon");
}

/* --- 4. Maitrise manquante comptee comme 1 (coherent avec le reste du jeu) --- */
{
  const entrees = compte.grouperProgression([{ pattern_name: "y", lecon_id: "l", date_derniere_tentative: "" }], {});
  check(entrees[0].concepts[0].maitrise === 1, "une maitrise absente vaut 1");
  check(entrees[0].etoiles === 1, "etoiles reflete cette maitrise par defaut");
}

/* --- 5. Entrees vides ou invalides : liste vide, aucune exception --- */
{
  check(compte.grouperProgression([], {}).length === 0, "progression vide -> aucune page");
  check(compte.grouperProgression(null, {}).length === 0, "entree nulle -> aucune page");
  const filtres = compte.grouperProgression(
    [null, { lecon_id: "l" }, ligne("ok", "l", 2, "2026-07-01T00:00:00Z")],
    {},
  );
  check(
    filtres.length === 1 && filtres[0].concepts.length === 1,
    "les lignes sans pattern_name sont ignorees",
  );
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
