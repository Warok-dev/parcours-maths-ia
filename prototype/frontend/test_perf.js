/* Tests du mode vivant / econome (perf.js). Lancer avec : node test_perf.js */
const perf = require("./perf.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* --- 1. Profil d'appareil --- */
check(perf.profilAppareil({}) === "vivant", "machine inconnue : vivant (rien ne dit qu'elle est modeste)");
check(perf.profilAppareil({ memoireGo: 8, coeurs: 8 }) === "vivant", "ordinateur ou tablette recente : vivant");
check(perf.profilAppareil({ memoireGo: 2, coeurs: 8 }) === "econome", "2 Go de memoire : econome");
check(perf.profilAppareil({ memoireGo: 4, coeurs: 2 }) === "econome", "2 coeurs : econome");
check(perf.profilAppareil({ memoireGo: 4, coeurs: 4 }) === "vivant", "4 Go et 4 coeurs : vivant");
check(perf.profilAppareil({ reduireAnimations: true, memoireGo: 16 }) === "econome", "« reduire les animations » du systeme : econome");
check(perf.profilAppareil({ economieDonnees: true }) === "econome", "economie de donnees : econome");
check(perf.profilAppareil({ memoireGo: NaN, coeurs: NaN }) === "vivant", "infos absentes (Safari) : ignorees");

/* --- 2. Mode effectif --- */
check(perf.modeEffectif("vivant", "econome", true) === "vivant", "choix vivant : toujours vivant, meme sur machine modeste");
check(perf.modeEffectif("econome", "vivant", false) === "econome", "choix econome : toujours econome");
check(perf.modeEffectif("auto", "vivant", false) === "vivant", "auto + bonne machine : vivant");
check(perf.modeEffectif("auto", "econome", false) === "econome", "auto + machine modeste : econome");
check(perf.modeEffectif("auto", "vivant", true) === "econome", "auto + jeu qui rame : econome");

/* --- 3. Moniteur d'images --- */
{
  const m = perf.creerMoniteur({ seuilMs: 34, taille: 10, fenetresLentes: 3 });
  let bascule = false;
  for (let i = 0; i < 200; i += 1) bascule = m.noter(16.7) || bascule;
  check(!bascule, "60 images/s pendant 200 images : on reste vivant");

  const lent = perf.creerMoniteur({ seuilMs: 34, taille: 10, fenetresLentes: 3 });
  const resultats = [];
  for (let i = 0; i < 30; i += 1) resultats.push(lent.noter(50));
  check(resultats.filter(Boolean).length === 1 && resultats[29] === true, "20 images/s sur 3 fenetres : bascule une seule fois, a la 3e");
  check(lent.noter(50) === false, "apres la bascule : plus de signal");

  const aCoups = perf.creerMoniteur({ seuilMs: 34, taille: 10, fenetresLentes: 3 });
  let signal = false;
  for (let f = 0; f < 6; f += 1) {
    for (let i = 0; i < 10; i += 1) signal = aCoups.noter(f % 2 ? 16 : 60) || signal;
  }
  check(!signal, "fenetres lentes NON consecutives : pas de bascule");

  const pics = perf.creerMoniteur({ seuilMs: 34, taille: 10, fenetresLentes: 3 });
  let picSignal = false;
  for (let f = 0; f < 5; f += 1) {
    for (let i = 0; i < 10; i += 1) picSignal = pics.noter(i < 3 ? 80 : 16) || picSignal;
  }
  check(!picSignal, "quelques images lentes (mediane rapide) : pas de bascule");

  const trous = perf.creerMoniteur({ seuilMs: 34, taille: 10, fenetresLentes: 1 });
  let trouSignal = false;
  for (let i = 0; i < 30; i += 1) trouSignal = trous.noter(1000) || trouSignal;
  check(!trouSignal, "onglet en arriere-plan (images > 250 ms) : ignore");
  check(trous.noter(-5) === false && trous.noter(NaN) === false, "valeurs absurdes ignorees");
}

/* --- 4. Menu --- */
check(perf.choixSuivant("auto") === "vivant", "auto -> vivant");
check(perf.choixSuivant("vivant") === "econome", "vivant -> econome");
check(perf.choixSuivant("econome") === "auto", "econome -> auto");
check(perf.choixSuivant("??") === "auto", "valeur inconnue -> auto");
check(perf.libelleChoix("auto", "econome") === "Animations : auto (économe)", "libelle auto indique le mode reel");
check(perf.libelleChoix("vivant", "vivant") === "Animations : vivant", "libelle vivant");

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) process.exit(1);
