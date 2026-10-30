/* Aide de test : transforme un exercice COMPLET (avec reponse_attendue.valeur,
   comme le serveur le genere) en sa vue client, en appelant le vrai
   backend/exercice_client.py (bibliotheque standard Python seulement).
   Les tests des mecaniques verifient ainsi toute la chaine : indices calcules
   par le serveur -> choix et montage de la mecanique en JS. */
const { execFileSync } = require("child_process");
const path = require("path");

const BACKEND = path.resolve(__dirname, "..", "backend");
const SCRIPT = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "from exercice_client import pour_client, mecaniques_possibles",
  "exercices = json.load(sys.stdin)",
  "mode, hors_ligne = sys.argv[2], sys.argv[3] == '1'",
  "if mode == 'possibles':",
  "    print(json.dumps([mecaniques_possibles(e) for e in exercices]))",
  "else:",
  "    meca = None if mode == 'toutes' else mode",
  "    print(json.dumps([pour_client(e, hors_ligne=hors_ligne, mecanique=meca) for e in exercices]))",
].join("\n");

const cache = new Map();

function appeler(mode, exercise, horsLigne) {
  const cle = `${mode}|${horsLigne}|${JSON.stringify(exercise)}`;
  if (!cache.has(cle)) {
    const complet = { id: "test", niveau_scolaire: "CE2", variables: {}, presentations: {}, ...exercise };
    const sortie = execFileSync("python3", ["-c", SCRIPT, BACKEND, mode, horsLigne ? "1" : "0"], {
      input: JSON.stringify([complet]),
    });
    cache.set(cle, JSON.parse(sortie.toString())[0]);
  }
  return cache.get(cle);
}

/* Vue client d'un exercice complet. Par defaut avec les indices de TOUTES les
   mecaniques (pour tester chaque montage) ; mecanique: "auto" donne la vue
   reellement envoyee (mecanique choisie et ses seuls indices). */
function versClient(exercise, { horsLigne = false, mecanique = "toutes" } = {}) {
  if (!exercise || exercise.mecanique || !exercise.reponse_attendue || !("valeur" in exercise.reponse_attendue)) {
    return exercise;
  }
  return appeler(mecanique, exercise, horsLigne);
}

/* Mecaniques possibles selon la regle d'assignation du serveur. */
function possibles(exercise) {
  return appeler("possibles", exercise, false);
}

/* Enveloppe les fonctions d'un module qui prennent un exercice en 1er argument. */
function avecVueClient(module, noms) {
  const copie = { ...module };
  for (const nom of noms) {
    copie[nom] = (exercise, ...reste) => module[nom](versClient(exercise), ...reste);
  }
  return copie;
}

module.exports = { versClient, avecVueClient, possibles };
