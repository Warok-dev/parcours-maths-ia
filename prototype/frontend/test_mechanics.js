/* Tests de la bibliotheque de mecaniques (mechanics.js).
   Lancer avec : node test_mechanics.js
   Couvre surtout le masquage des trous d'une suite sur la ligne numerique :
   la ligne ne doit jamais afficher les nombres que l'eleve doit trouver. */
const { maskedLinePositions, compatibleMechanics } = require("./mechanics.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

function suiteExercise(valeurs, positionsManquantes) {
  const exercise = {
    id: "CE2-suite-000001",
    pattern: {
      pattern_name: "suite_multiples_de_10_a_completer",
      pattern_family: "exercice_a_trous_serie",
    },
    variables: { suite_complete: valeurs },
    reponse_attendue: { valeur: valeurs, format: "liste_ordonnee" },
  };
  if (positionsManquantes !== undefined) {
    exercise.variables.positions_manquantes = positionsManquantes;
  }
  return exercise;
}

/* --- 1. Les positions a deviner sont masquees, les reperes restent --- */
{
  const exercise = suiteExercise([0, 10, 20, 30, 40, 50, 60, 70], [3, 4, 6]);
  const masked = maskedLinePositions(exercise);
  check(masked.has(3) && masked.has(4) && masked.has(6), "les trous de l'enonce sont masques");
  check(!masked.has(0) && !masked.has(1) && !masked.has(2), "les valeurs donnees restent visibles");
  check(!masked.has(5) && !masked.has(7), "les autres reperes restent visibles");
  check(masked.size === 3, "aucune position supplementaire n'est masquee");
}

/* --- 2. Sans metadonnee de trous : repli prudent (2 reperes suffisent) --- */
{
  const masked = maskedLinePositions(suiteExercise([5, 10, 15, 20, 25]));
  check(!masked.has(0) && !masked.has(1), "le repli garde les deux premieres valeurs");
  check(masked.has(2) && masked.has(3) && masked.has(4), "le repli masque tout le reste");
}

/* --- 3. Les autres formats ne sont jamais masques --- */
{
  const calcul = {
    id: "CE1-addition-000001",
    pattern: { pattern_name: "addition_simple", pattern_family: "calcul_direct" },
    variables: { a: 24, b: 6 },
    reponse_attendue: { valeur: 30, format: "nombre_entier" },
  };
  check(maskedLinePositions(calcul).size === 0, "un calcul direct n'a aucun label masque");
  check(maskedLinePositions({}).size === 0, "un exercice vide n'a aucun label masque");
}

/* --- 4. Positions invalides ignorees (donnees abimees) --- */
{
  const exercise = suiteExercise([0, 10, 20, 30], [1, -2, "x", null, 2]);
  const masked = maskedLinePositions(exercise);
  check(masked.has(1) && masked.has(2), "les positions valides sont retenues");
  check(masked.size === 2, "les positions invalides sont ignorees");
}

/* --- 5. L'assignation de mecanique reste inchangee --- */
{
  const suite = suiteExercise([0, 10, 20, 30], [1, 2]);
  check(compatibleMechanics(suite).includes("ligne"), "une suite reste jouable sur la ligne");
  const grand = suiteExercise([100, 110, 120], [1]);
  check(compatibleMechanics(grand).includes("ligne"), "une liste ordonnee va toujours sur la ligne");
}

console.log(`\n${total - failures}/${total} cas passent`);
process.exit(failures === 0 ? 0 : 1);
