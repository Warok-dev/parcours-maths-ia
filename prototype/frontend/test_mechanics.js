/* Tests de la bibliotheque de mecaniques (mechanics.js).
   Lancer avec : node test_mechanics.js
   Couvre surtout le masquage des trous d'une suite sur la ligne numerique :
   la ligne ne doit jamais afficher les nombres que l'eleve doit trouver. */
const {
  maskedLinePositions,
  compatibleMechanics,
  missingLineValues,
  shuffleMissingValues,
  clockAngles,
  formatHeure,
} = require("./mechanics.js");

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

/* --- 6. Valeurs manquantes proposees a l'eleve --- */
{
  const exercise = suiteExercise([0, 10, 20, 30, 40, 50, 60, 70], [1, 4, 6]);
  check(
    JSON.stringify(missingLineValues(exercise)) === JSON.stringify([10, 40, 60]),
    "les valeurs manquantes sont extraites dans l'ordre de la suite",
  );
  check(
    missingLineValues({ reponse_attendue: { valeur: 30, format: "nombre_entier" } }).length === 0,
    "un calcul direct n'a aucune valeur manquante",
  );
}

/* --- 7. L'ordre propose n'est jamais l'ordre croissant --- */
{
  const valeurs = [10, 40, 60];
  let toujoursCroissant = true;
  let jamaisCroissant = true;
  const ordresVus = new Set();

  /* Plusieurs generations successives du meme exercice : l'ordre doit
     varier reellement, et ne jamais livrer la suite deja triee. */
  for (let i = 0; i < 200; i += 1) {
    const propose = shuffleMissingValues(valeurs);
    ordresVus.add(propose.join(","));
    const croissant = propose.join(",") === "10,40,60";
    if (croissant) jamaisCroissant = false;
    else toujoursCroissant = false;
  }

  check(!toujoursCroissant, "l'ordre propose n'est pas systematiquement croissant");
  check(jamaisCroissant, "l'ordre croissant n'est jamais propose (il donnerait la reponse)");
  check(ordresVus.size >= 3, `l'ordre varie d'une generation a l'autre (${ordresVus.size} ordres vus)`);
  check(
    [...ordresVus].every((ordre) => ordre.split(",").sort((a, b) => a - b).join(",") === "10,40,60"),
    "chaque tirage contient exactement les valeurs manquantes",
  );
}

/* --- 8. Cas limites du melange --- */
{
  check(
    JSON.stringify(shuffleMissingValues([40, 80])) === JSON.stringify([80, 40]),
    "avec deux trous, seul l'ordre decroissant evite l'ordre croissant",
  );
  check(JSON.stringify(shuffleMissingValues([50])) === JSON.stringify([50]), "un seul trou : inchange");
  check(JSON.stringify(shuffleMissingValues([])) === JSON.stringify([]), "aucun trou : liste vide");

  /* Un generateur pseudo-aleatoire degenere ne doit pas rendre l'ordre trie. */
  const propose = shuffleMissingValues([10, 20, 30], () => 0);
  check(propose.join(",") !== "10,20,30", "un tirage degenere ne laisse pas l'ordre croissant");
  check(
    propose.slice().sort((a, b) => a - b).join(",") === "10,20,30",
    "le repli conserve toutes les valeurs",
  );
}

/* --- 9. Horloge : un exercice de format "heure" va sur la mecanique horloge --- */
{
  const clock = {
    id: "CE1-lecture_heure_analogique-000001",
    pattern: { pattern_name: "lecture_heure_analogique", pattern_family: "lecture_horloge" },
    niveau_scolaire: "CE1",
    variables: { heure: 5, minute: 30 },
    reponse_attendue: { valeur: "5:30", format: "heure" },
  };
  const options = compatibleMechanics(clock);
  check(options.length === 1 && options[0] === "horloge", "un exercice heure va sur la mecanique horloge");
}

/* --- 10. Geometrie des aiguilles (source unique, partagee avec ASSETS.clock) --- */
{
  const a12 = clockAngles(12, 0);
  check(a12.hourAngle === 0 && a12.minuteAngle === 0, "12:00 -> aiguilles a 0 degre");
  check(clockAngles(3, 0).hourAngle === 90, "3:00 -> aiguille des heures a 90 degres");
  const a630 = clockAngles(6, 30);
  check(a630.hourAngle === 195, "6:30 -> aiguille des heures a mi-chemin (195 degres)");
  check(a630.minuteAngle === 180, "6:30 -> aiguille des minutes en bas (180 degres)");
  const a915 = clockAngles(9, 15);
  check(a915.hourAngle === 277.5 && a915.minuteAngle === 90, "9:15 -> heures 277.5, minutes 90");
}

/* --- 11. Format canonique de la reponse (aligne avec le backend H:MM) --- */
{
  check(formatHeure(5, 0) === "5:00", "5h00 -> '5:00'");
  check(formatHeure(7, 30) === "7:30", "7h30 -> '7:30'");
  check(formatHeure(12, 5) === "12:05", "minutes toujours sur 2 chiffres -> '12:05'");
}

console.log(`\n${total - failures}/${total} cas passent`);
process.exit(failures === 0 ? 0 : 1);
