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
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
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

// Protection hameconnage : surcharge limitee aux pages locales / backends locaux
const PROD = "parcours-maths.onrender.com";
const sp = stockage();
check(
  choisirApi(loc(PROD, "?api=https://serveur-pirate.exemple"), sp) === API_PRODUCTION,
  "production + ?api= externe -> ignore",
);
check(sp.getItem("parcours_api") === null, "production + ?api= externe -> rien memorise");
check(
  choisirApi(loc(PROD, "?api=http://localhost:8000"), stockage()) === "http://localhost:8000",
  "production + ?api=localhost -> accepte",
);
check(
  choisirApi(loc(PROD, "?api=http://127.0.0.1:8000"), stockage()) === "http://127.0.0.1:8000",
  "production + ?api=127.0.0.1 -> accepte",
);
check(
  choisirApi(loc(PROD, "?api=http://[::1]:8000"), stockage()) === "http://[::1]:8000",
  "production + ?api=[::1] -> accepte",
);
check(
  choisirApi(loc(PROD, "?api=https://localhost.pirate.exemple"), stockage()) === API_PRODUCTION,
  "production + ?api=faux localhost -> ignore",
);
check(
  choisirApi(loc(PROD, "?api=https://localhost@pirate.exemple"), stockage()) === API_PRODUCTION,
  "production + ?api= avec identifiants deguises -> ignore",
);
check(
  choisirApi(loc("localhost", "?api=https://serveur-externe.exemple"), stockage()) === "https://serveur-externe.exemple",
  "page locale + ?api= externe -> accepte",
);
const sm = stockage();
sm.setItem("parcours_api", "https://serveur-pirate.exemple");
check(choisirApi(loc(PROD), sm) === API_PRODUCTION, "valeur externe memorisee sur page de production -> ignoree");

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) process.exit(1);
