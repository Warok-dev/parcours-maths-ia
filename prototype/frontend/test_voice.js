/* Tests de la conversion nombre-parle -> chiffres (voice.js).
   Lancer avec : node test_voice.js
   Accent mis sur les dizaines irregulieres du francais (70/80/90),
   les plus susceptibles de mal se convertir. */
const { convertirTranscription } = require("./voice.js");

const CASES = [
  /* dizaines irregulieres */
  ["soixante-dix", 70],
  ["soixante et onze", 71],
  ["soixante-quinze", 75],
  ["soixante-dix-neuf", 79],
  ["quatre-vingt", 80],
  ["quatre-vingts", 80],
  ["quatre-vingt-un", 81],
  ["quatre-vingt-onze", 91],
  ["quatre-vingt-dix", 90],
  ["quatre-vingt-dix-sept", 97],
  ["Quatre-Vingt-Douze", 92],
  /* base 0-69 */
  ["zéro", 0],
  ["douze", 12],
  ["seize", 16],
  ["dix-sept", 17],
  ["vingt et un", 21],
  ["trente-cinq", 35],
  ["soixante-six", 66],
  /* centaines */
  ["cent", 100],
  ["cent quatre-vingt", 180],
  ["deux cents", 200],
  ["deux cent quarante-trois", 243],
  ["neuf cent quatre-vingt-dix-neuf", 999],
  /* chiffres deja ecrits et phrases autour du nombre */
  ["12", 12],
  ["la réponse est 42", 42],
  ["je crois que c'est quarante-deux", 42],
  ["euh quatre-vingt-dix je pense", 90],
  /* aucun nombre exploitable */
  ["je ne sais pas", null],
  ["", null],
];

let failures = 0;
for (const [texte, attendu] of CASES) {
  const obtenu = convertirTranscription(texte);
  const ok = obtenu === attendu;
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "ok " : "KO "} "${texte}" -> ${obtenu} (attendu ${attendu})`);
}

console.log(`\n${CASES.length - failures}/${CASES.length} cas passent`);
if (failures > 0) {
  process.exit(1);
}
