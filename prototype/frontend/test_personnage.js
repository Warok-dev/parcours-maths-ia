/* Tests de la personnalisation du personnage (personnage.js).
   Lancer avec : node test_personnage.js
   localStorage est simule ; personnage.js se charge sans navigateur. */

const store = new Map();
global.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const perso = require("./personnage.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

const COULEUR_40 = "vert";
const COULEUR_320 = "framboise";
const ACC_60 = "chapeau";
const ACC_420 = "badge";

/* --- 1. Catalogue : couts croissants et defauts gratuits --- */
{
  check(perso.COULEURS.length >= 4, `${perso.COULEURS.length} couleurs au catalogue`);
  check(perso.ACCESSOIRES.length >= 4, `${perso.ACCESSOIRES.length} accessoires au catalogue`);
  check(perso.trouver("couleur", "bleu").cout === 0, "la couleur par defaut est gratuite");
  check(perso.trouver("accessoire", "aucun").cout === 0, "ne rien porter est gratuit");

  const couts = perso.COULEURS.map((c) => c.cout);
  check(
    couts.every((cout, i) => i === 0 || cout > couts[i - 1]),
    `couts des couleurs strictement croissants (${couts.join(", ")})`,
  );
  const coutsAcc = perso.ACCESSOIRES.map((a) => a.cout);
  check(
    coutsAcc.every((cout, i) => i === 0 || cout > coutsAcc[i - 1]),
    `couts des accessoires strictement croissants (${coutsAcc.join(", ")})`,
  );
  check(
    perso.ACCESSOIRES.every((a) => a.id === "aucun" || (a.avant || a.arriere)),
    "chaque accessoire payant a un dessin SVG",
  );
}

/* --- 2. Seuils de deblocage --- */
{
  const vert = perso.trouver("couleur", COULEUR_40);
  check(!perso.estDebloque(vert, vert.cout - 1), `verrouille a ${vert.cout - 1} etoiles`);
  check(perso.estDebloque(vert, vert.cout), `debloque pile a ${vert.cout} etoiles`);
  check(perso.estDebloque(vert, vert.cout + 500), "reste debloque au-dela du seuil");
  check(perso.estDebloque(vert, 0) === false, "verrouille avec 0 etoile");

  check(perso.etoilesRestantes(vert, 0) === vert.cout, "restantes = cout quand on part de zero");
  check(perso.etoilesRestantes(vert, 15) === vert.cout - 15, "restantes decroissent avec le total");
  check(perso.etoilesRestantes(vert, 9999) === 0, "restantes = 0 une fois debloque");

  check(
    perso.elementsDebloques(0, "couleur").join(",") === "bleu",
    "a 0 etoile : seule la couleur par defaut",
  );
  check(
    perso.elementsDebloques(0, "accessoire").join(",") === "aucun",
    "a 0 etoile : aucun accessoire",
  );
  const a175 = perso.elementsDebloques(175, "couleur");
  check(a175.includes(COULEUR_40) && !a175.includes(COULEUR_320), "a 175 etoiles : vert oui, framboise non");
}

/* --- 3. Annonce des nouveaux deblocages --- */
{
  const vert = perso.trouver("couleur", COULEUR_40);
  const nouveaux = perso.nouveauxDeblocages(vert.cout - 5, vert.cout + 1);
  check(nouveaux.some((item) => item.id === COULEUR_40), "franchir le seuil annonce la couleur");
  check(
    perso.nouveauxDeblocages(vert.cout, vert.cout + 50).every((item) => item.id !== COULEUR_40),
    "un element deja debloque n'est pas re-annonce",
  );
  check(perso.nouveauxDeblocages(0, 0).length === 0, "aucun gain : aucune annonce");
  check(
    perso.nouveauxDeblocages(0, 9999).every((item) => item.cout > 0),
    "les elements gratuits ne sont jamais annonces",
  );
}

/* --- 4. Selection : impossible sur un element verrouille --- */
{
  const base = { etoiles_totales: 100, couleur: "bleu", accessoire: "aucun" };

  const okCouleur = perso.appliquerSelection(base, "couleur", COULEUR_40);
  check(okCouleur.couleur === COULEUR_40, "couleur debloquee : selection acceptee");

  const okAcc = perso.appliquerSelection(base, "accessoire", ACC_60);
  check(okAcc.accessoire === ACC_60, "accessoire debloque : selection acceptee");

  const refusCouleur = perso.appliquerSelection(base, "couleur", COULEUR_320);
  check(refusCouleur.couleur === "bleu", "couleur verrouillee : selection refusee");

  const refusAcc = perso.appliquerSelection(base, "accessoire", ACC_420);
  check(refusAcc.accessoire === "aucun", "accessoire verrouille : selection refusee");

  const inconnu = perso.appliquerSelection(base, "couleur", "arc-en-ciel");
  check(inconnu.couleur === "bleu", "element inexistant : selection refusee");

  check(base.couleur === "bleu", "appliquerSelection ne mute pas l'etat recu");
}

/* --- 5. Normalisation d'un etat abime ou trop ambitieux --- */
{
  const normal = perso.etatNormalise(null);
  check(
    normal.etoiles_totales === 0 && normal.couleur === "bleu" && normal.accessoire === "aucun",
    "etat absent : valeurs par defaut",
  );
  check(perso.etatNormalise({ etoiles_totales: -50 }).etoiles_totales === 0, "total negatif ramene a 0");
  check(
    perso.etatNormalise({ etoiles_totales: "beaucoup" }).etoiles_totales === 0,
    "total non numerique ramene a 0",
  );
  /* Stockage bricole a la main : une tenue non gagnee ne doit pas passer. */
  const triche = perso.etatNormalise({ etoiles_totales: 10, couleur: COULEUR_320, accessoire: ACC_420 });
  check(
    triche.couleur === "bleu" && triche.accessoire === "aucun",
    "selection non debloquee dans le stockage : retour au defaut",
  );
}

/* --- 6. Cumul des etoiles --- */
{
  let etat = perso.etatNormalise(null);
  etat = perso.ajouterEtoilesA(etat, 30);
  etat = perso.ajouterEtoilesA(etat, 45);
  check(etat.etoiles_totales === 75, "les etoiles s'additionnent d'un gain a l'autre");
  check(perso.ajouterEtoilesA(etat, -10).etoiles_totales === 75, "un gain negatif est ignore");
  check(perso.ajouterEtoilesA(etat, undefined).etoiles_totales === 75, "un gain absent est ignore");
  check(
    perso.appliquerSelection(etat, "couleur", COULEUR_40).etoiles_totales === 75,
    "choisir une tenue ne coute pas d'etoiles (deblocage, pas achat)",
  );
}

/* --- 7. Persistance reelle via localStorage --- */
{
  localStorage.clear();
  check(perso.charger().etoiles_totales === 0, "premier lancement : total a zero");

  perso.ajouterEtoiles(120);
  check(perso.getEtat().etoiles_totales === 120, "les etoiles gagnees sont comptees");
  const brut = localStorage.getItem(perso.STORAGE_KEY);
  check(typeof brut === "string" && JSON.parse(brut).etoiles_totales === 120, "total ecrit sous personnage_v1");

  const annonces = perso.ajouterEtoiles(100);
  check(
    annonces.some((item) => item.id === COULEUR_320) === false && annonces.length > 0,
    `passage a 220 etoiles : ${annonces.map((a) => a.id).join(", ")} annonces, pas framboise`,
  );

  perso.selectionner("couleur", COULEUR_40);
  perso.selectionner("accessoire", ACC_60);
  check(
    JSON.parse(localStorage.getItem(perso.STORAGE_KEY)).couleur === COULEUR_40,
    "le choix de couleur est persiste",
  );
  check(
    JSON.parse(localStorage.getItem(perso.STORAGE_KEY)).accessoire === ACC_60,
    "le choix d'accessoire est persiste",
  );

  perso.selectionner("accessoire", ACC_420);
  check(perso.getEtat().accessoire === ACC_60, "selection verrouillee ignoree, le choix precedent reste");

  /* Rechargement de la page : le choix revient tel quel. */
  const recharge = perso.charger();
  check(
    recharge.couleur === COULEUR_40 && recharge.accessoire === ACC_60 && recharge.etoiles_totales === 220,
    "apres rechargement : meme tenue, meme total",
  );

  localStorage.setItem(perso.STORAGE_KEY, "{pas du json");
  check(perso.charger().couleur === "bleu", "stockage corrompu : personnage par defaut, aucune exception");
}

/* --- 8. Markup injecte dans le dessin du personnage --- */
{
  localStorage.clear();
  perso.ajouterEtoiles(500);
  perso.selectionner("accessoire", ACC_60);
  check(perso.markupAccessoire("avant").includes("acc-chapeau"), "le chapeau se dessine devant");
  check(perso.markupAccessoire("arriere") === "", "le chapeau n'a rien derriere le corps");

  perso.selectionner("accessoire", "cape");
  check(perso.markupAccessoire("arriere").includes("acc-cape"), "la cape se dessine derriere le corps");

  perso.selectionner("accessoire", "aucun");
  check(
    perso.markupAccessoire("avant") === "" && perso.markupAccessoire("arriere") === "",
    "sans accessoire : aucun markup ajoute",
  );
}

/* --- 9. Halo renforce quand la tenue se confond avec le decor --- */
{
  check(perso.distanceTeinte("#6fbe53", "#6fbe53") === 0, "distance nulle entre deux teintes identiques");
  check(perso.distanceTeinte("#000000", "#ffffff") > 700, "noir et blanc : distance maximale");
  check(perso.distanceTeinte("#6fbe53", "pas une couleur") === Infinity, "teinte illisible : distance infinie");
  check(
    perso.distanceTeinte("#4a7bc4", "#6fbe53") === perso.distanceTeinte("#6fbe53", "#4a7bc4"),
    "la distance est symetrique",
  );

  /* Les distances mesurees sont verrouillees ici : c'est ce qui rend le
     seuil auditable plutot que decrete. */
  const mesures = perso.COULEURS.map((c) => ({
    id: c.id,
    distance: Math.round(perso.distanceAuDecor(c.teinte)),
    halo: perso.haloRenforce(c.id),
  }));
  console.log(`    distances au decor : ${mesures.map((m) => `${m.id}=${m.distance}`).join(", ")}`);

  check(perso.distanceAuDecor("#6fbe53") === 0, "le vert prairie EST la couleur de l'herbe (distance 0)");
  check(perso.distanceAuDecor("#e8703a") === 0, "l'orange soleil EST la couleur des routes (distance 0)");
  check(perso.distanceAuDecor("#4a7bc4") > perso.SEUIL_CONTRASTE_DECOR, "le bleu d'origine se detache du decor");

  check(perso.haloRenforce("vert"), "vert prairie : halo renforce");
  check(perso.haloRenforce("orange"), "orange soleil : halo renforce");
  check(perso.haloRenforce("jaune"), "jaune tresor : halo renforce (proche des routes claires)");
  check(!perso.haloRenforce("bleu"), "bleu du matin : halo normal");
  check(!perso.haloRenforce("framboise"), "rouge framboise : halo normal");
  check(!perso.haloRenforce("teinte_inconnue"), "couleur inconnue : pas de halo renforce");

  /* Le seuil doit rester entre les deux groupes, pas coller a une valeur. */
  const proches = mesures.filter((m) => m.halo).map((m) => m.distance);
  const lointaines = mesures.filter((m) => !m.halo).map((m) => m.distance);
  check(
    Math.max(...proches) < Math.min(...lointaines),
    `separation nette : proches <= ${Math.max(...proches)}, lointaines >= ${Math.min(...lointaines)}`,
  );
  check(
    perso.COULEURS.every((c) => /^#[0-9a-f]{6}$/i.test(c.teinte)),
    "chaque couleur declare une teinte exploitable",
  );
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
