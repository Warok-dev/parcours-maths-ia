/* Tests de la differenciation des messages d'erreur du tuteur (chat.js).
   Lancer avec : node test_chat.js
   chat.js se charge sans DOM : seule la partie pure est exercee ici. */
const { CAUSE, MESSAGES_ERREUR, causeDepuisStatut, messageErreurTuteur } = require("./chat.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* --- 1. Chaque statut backend tombe sur la bonne cause --- */
check(causeDepuisStatut(409) === CAUSE.SESSION, "409 (exercice courant invalide) -> session");
check(causeDepuisStatut(404) === CAUSE.SESSION, "404 (session introuvable) -> session");
check(causeDepuisStatut(503) === CAUSE.IA_INDISPONIBLE, "503 (tous les fournisseurs IA en echec) -> ia-indisponible");
check(causeDepuisStatut(400) === CAUSE.INCONNUE, "400 -> cause inconnue (message generique)");
check(causeDepuisStatut(500) === CAUSE.INCONNUE, "500 -> cause inconnue (message generique)");

/* --- 2. Les messages sont bien distincts d'une cause a l'autre --- */
{
  const causes = Object.values(CAUSE);
  const messages = causes.map(messageErreurTuteur);
  check(new Set(messages).size === causes.length, "un message different pour chacune des 5 causes");
  check(
    messageErreurTuteur(CAUSE.RESEAU) !== messageErreurTuteur(CAUSE.IA_INDISPONIBLE),
    "panne reseau et panne IA ne disent pas la meme chose",
  );
  check(messageErreurTuteur("cause-inexistante") === MESSAGES_ERREUR[CAUSE.INCONNUE], "cause inconnue -> repli generique");
}

/* --- 3. Chaque message indique a l'enfant quoi faire --- */
{
  const attendus = {
    [CAUSE.RESEAU]: /internet/i,
    [CAUSE.SESSION]: /recharge/i,
    [CAUSE.IA_INDISPONIBLE]: /attends/i,
    [CAUSE.SANS_EXERCICE]: /carte/i,
    [CAUSE.INCONNUE]: /reessaie/i,
  };
  for (const [cause, motif] of Object.entries(attendus)) {
    check(motif.test(messageErreurTuteur(cause)), `${cause} : le message donne l'action a faire (${motif})`);
  }
}

/* --- 4. Vocabulaire adapte : pas de jargon technique visible --- */
{
  const jargon = /(HTTP|fetch|500|503|409|404|session_id|API|serveur|CORS|JSON|timeout)/i;
  for (const cause of Object.values(CAUSE)) {
    check(!jargon.test(messageErreurTuteur(cause)), `${cause} : aucun jargon technique dans le message`);
  }
  /* Phrases courtes : un enfant de CE1 lit mal les phrases interminables. */
  for (const cause of Object.values(CAUSE)) {
    const phrases = messageErreurTuteur(cause).split(/[.!?]+/).filter((p) => p.trim());
    const maxMots = Math.max(...phrases.map((p) => p.trim().split(/\s+/).length));
    check(maxMots <= 18, `${cause} : phrases courtes (max ${maxMots} mots)`);
  }
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
