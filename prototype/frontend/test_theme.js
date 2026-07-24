/* Tests du choix d'univers narratif (theme.js).
   Lancer avec : node test_theme.js
   localStorage est simule ; theme.js se charge sans navigateur. */

const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const theme = require("./theme.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* Identifiants attendus cote backend (generation/narrative.py). Ce test est
   le garde-fou du contrat : un renommage d'un cote doit casser ici. */
const ATTENDUS = ["foot", "dinosaures", "princesses", "espace", "animaux", "neutre"];

/* --- 1. Catalogue --- */
{
  check(theme.THEMES.length === 6, `${theme.THEMES.length} univers proposes`);
  check(
    ATTENDUS.every((id) => theme.estThemeConnu(id)),
    "les identifiants attendus par le backend existent tous",
  );
  check(
    theme.THEMES.every((item) => item.nom && item.icone && item.couleur),
    "chaque univers a un nom, une icone et une couleur",
  );
  check(
    new Set(theme.THEMES.map((item) => item.id)).size === theme.THEMES.length,
    "aucun identifiant en double",
  );
  check(theme.THEME_NEUTRE === "neutre", "le theme neutre s'appelle 'neutre'");
  check(theme.estThemeConnu(theme.THEME_NEUTRE), "le neutre fait partie du catalogue");
}

/* --- 2. Normalisation : un theme inconnu retombe sur le neutre --- */
{
  check(theme.normaliser("foot") === "foot", "un theme connu est conserve");
  check(theme.normaliser("licornes") === "neutre", "un theme inconnu -> neutre");
  check(theme.normaliser(null) === "neutre", "theme absent -> neutre");
  check(theme.normaliser(undefined) === "neutre", "theme indefini -> neutre");
  check(theme.normaliser("") === "neutre", "chaine vide -> neutre");
  check(!theme.estThemeConnu("Foot"), "la casse compte (contrat exact avec le backend)");
}

/* --- 3. Premier lancement : aucun choix memorise --- */
{
  localStorage.clear();
  check(!theme.aChoisi(), "premier lancement : aucun univers choisi");
  check(theme.getTheme() === "neutre", "en attendant, le theme effectif est neutre");
}

/* --- 4. Persistance du choix --- */
{
  localStorage.clear();
  check(theme.setTheme("dinosaures") === "dinosaures", "setTheme retourne le theme applique");
  check(theme.aChoisi(), "le choix est memorise");
  check(theme.getTheme() === "dinosaures", "relecture : dinosaures");
  check(
    localStorage.getItem(theme.STORAGE_KEY) === "dinosaures",
    "ecrit sous la cle theme_v1",
  );

  /* Changement ulterieur depuis le menu. */
  theme.setTheme("foot");
  check(theme.getTheme() === "foot", "le theme peut etre change plus tard");
  check(theme.aChoisi(), "il reste marque comme choisi");

  /* "Pas de preference" EST un choix : l'ecran ne doit pas revenir. */
  theme.setTheme("neutre");
  check(theme.getTheme() === "neutre", "le neutre peut etre choisi explicitement");
  check(theme.aChoisi(), "'Pas de preference' compte comme un choix");
}

/* --- 5. Stockage abime ou indisponible --- */
{
  localStorage.clear();
  localStorage.setItem(theme.STORAGE_KEY, "licornes");
  check(theme.getTheme() === "neutre", "valeur inconnue en stockage -> neutre");
  check(!theme.aChoisi(), "valeur inconnue : on redemande le choix");

  theme.setTheme("licornes");
  check(theme.getTheme() === "neutre", "impossible d'enregistrer un theme inconnu");

  /* Mode prive : localStorage jette. Le jeu doit continuer. */
  const vrai = global.localStorage;
  global.localStorage = {
    getItem: () => {
      throw new Error("stockage indisponible");
    },
    setItem: () => {
      throw new Error("stockage indisponible");
    },
  };
  check(theme.getTheme() === "neutre", "stockage illisible : neutre, aucune exception");
  check(theme.aChoisi() === false, "stockage illisible : aucun choix memorise");
  check(theme.setTheme("foot") === "foot", "stockage en ecriture KO : aucune exception");
  global.localStorage = vrai;
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
