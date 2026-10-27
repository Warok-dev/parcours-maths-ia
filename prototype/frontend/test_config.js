/* Tests de config.js (choix de l'adresse du backend).
   Lancer avec : node test_config.js */
const { choisirApi, API_LOCALE, API_PRODUCTION } = require("./config.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

function stockage() {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const loc = (hostname, search = "", protocol = "https:") => ({ hostname, search, protocol });

check(choisirApi(loc("localhost"), stockage()) === API_LOCALE, "localhost -> backend local");
check(choisirApi(loc("127.0.0.1"), stockage()) === API_LOCALE, "127.0.0.1 -> backend local");
check(choisirApi(loc("", "", "file:"), stockage()) === API_LOCALE, "fichier ouvert -> backend local");
check(choisirApi(loc("parcours-maths.onrender.com"), stockage()) === API_PRODUCTION, "site en ligne -> production");

const s = stockage();
check(
  choisirApi(loc("localhost", "?api=https://staging.exemple/"), s) === "https://staging.exemple",
  "?api= surcharge l'adresse (slash final retire)",
);
check(choisirApi(loc("localhost"), s) === "https://staging.exemple", "surcharge memorisee pour l'onglet");
check(
  choisirApi(loc("localhost", "?api=javascript:alert(1)"), stockage()) === API_LOCALE,
  "surcharge non http(s) ignoree",
);

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) process.exit(1);
