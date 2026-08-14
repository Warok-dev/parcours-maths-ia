/* Tests du coeur pur de l'espace enseignant (enseignant.js).
   Lancer avec : node test_enseignant.js
   En Node, enseignant.js n'exporte que la logique testable (validation de
   formulaire, libelles d'erreur) : pas de DOM, pas de fetch. */

const enseignant = require("./enseignant.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* --- 1. Validation d'inscription (miroir des contraintes backend) --- */
{
  check(
    enseignant.validerInscription({ nom: "Mme Dupont", identifiant: "dupont", mot_de_passe: "secret1" }) ===
      null,
    "formulaire complet et valide -> aucune erreur",
  );
  check(
    typeof enseignant.validerInscription({ nom: "", identifiant: "dupont", mot_de_passe: "secret1" }) ===
      "string",
    "nom vide -> message d'erreur",
  );
  check(
    typeof enseignant.validerInscription({ nom: "X", identifiant: "ab", mot_de_passe: "secret1" }) ===
      "string",
    "identifiant trop court (<3) -> message d'erreur",
  );
  check(
    typeof enseignant.validerInscription({ nom: "X", identifiant: "dupont", mot_de_passe: "12345" }) ===
      "string",
    "mot de passe trop court (<6) -> message d'erreur",
  );
  check(
    enseignant.validerInscription({ nom: "  ", identifiant: "dupont", mot_de_passe: "secret1" }) !== null,
    "nom fait uniquement d'espaces -> refuse",
  );
  check(enseignant.validerInscription() !== null, "objet manquant -> refuse sans planter");
}

/* --- 2. Libelles d'erreur --- */
{
  check(
    enseignant.libelleErreur(409) === "Cet identifiant est déjà pris.",
    "409 -> identifiant deja pris",
  );
  check(
    enseignant.libelleErreur(401) === "Identifiant ou mot de passe incorrect.",
    "401 -> identifiants incorrects",
  );
  check(
    enseignant.libelleErreur(400) === "Niveau scolaire invalide.",
    "400 -> niveau invalide",
  );
  check(typeof enseignant.libelleErreur(500) === "string", "statut inconnu -> message generique");
  check(
    enseignant.libelleErreur(409, "Message precis du backend") === "Message precis du backend",
    "le detail renvoye par le backend prime sur le libelle par defaut",
  );
}

/* --- 3. Niveaux proposes --- */
{
  check(
    JSON.stringify(enseignant.NIVEAUX) === JSON.stringify(["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"]),
    "les six niveaux CE1-CE6 sont proposes",
  );
}

/* --- 4. Tri des eleves : le plus en difficulte d'abord --- */
{
  const eleves = [
    { prenom: "Sofia", nb_a_retravailler: 0 },
    { prenom: "Adam", nb_a_retravailler: 3 },
    { prenom: "Lina", nb_a_retravailler: 1 },
  ];
  const tries = enseignant.trierElevesParDifficulte(eleves);
  check(
    tries.map((e) => e.prenom).join(",") === "Adam,Lina,Sofia",
    "eleves tries par nombre de concepts a retravailler decroissant",
  );
  check(eleves[0].prenom === "Sofia", "la fonction ne mute pas la liste d'origine");

  const exaequo = enseignant.trierElevesParDifficulte([
    { prenom: "Zoe", nb_a_retravailler: 2 },
    { prenom: "Amir", nb_a_retravailler: 2 },
  ]);
  check(
    exaequo.map((e) => e.prenom).join(",") === "Amir,Zoe",
    "a egalite de difficulte, ordre alphabetique des prenoms",
  );
}

/* --- 5. Concepts les plus difficiles de la classe --- */
{
  const concepts = [
    { pattern_name: "a", nb_eleves_en_difficulte: 1 },
    { pattern_name: "b", nb_eleves_en_difficulte: 4 },
    { pattern_name: "c", nb_eleves_en_difficulte: 2 },
    { pattern_name: "d", nb_eleves_en_difficulte: 0 },
  ];
  const top = enseignant.conceptsLesPlusDifficiles(concepts, 2);
  check(
    top.map((c) => c.pattern_name).join(",") === "b,c",
    "les 2 concepts qui bloquent le plus d'eleves, dans l'ordre",
  );
  check(
    enseignant.conceptsLesPlusDifficiles(concepts, 5).every((c) => c.nb_eleves_en_difficulte > 0),
    "un concept que personne ne rate n'est pas liste",
  );
  check(enseignant.conceptsLesPlusDifficiles([], 3).length === 0, "aucun concept -> liste vide");
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
