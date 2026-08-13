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
  creerPlacementOrdre,
  melangerOrdre,
  genererSectionsRoue,
  sectionSousRepere,
  rotationDepuisForce,
  creerRoue,
  creerBalance,
  angleBascule,
  poidsDisponibles,
  basketFieldCount,
  BASKET_MAX_COUNT,
  plankCandidates,
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
  /* La ligne garde son role ; la nouvelle mecanique "ordre" s'y ajoute en
     option, sans remplacer les autres familles. */
  check(compatibleMechanics(suite).includes("ordre"), "une suite peut aussi aller sur la mecanique d'ordre");
  const calcul = {
    id: "CE1-addition-000001",
    pattern: { pattern_name: "addition_simple", pattern_family: "calcul_direct" },
    reponse_attendue: { valeur: 30, format: "nombre_entier" },
  };
  check(!compatibleMechanics(calcul).includes("ordre"), "un calcul direct n'utilise jamais l'ordre (assignation intacte)");
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

/* --- 12. Glisser-deposer en ordre : placement et detection du bon ordre --- */
function placementSuite(ordreAttendu) {
  /* Elements donnes deja dans l'ordre attendu (ids stables) : les tests
     pilotent le placement, le melange visuel est teste a part. */
  const elements = ordreAttendu.map((valeur, id) => ({ id, valeur }));
  return { placement: creerPlacementOrdre({ elements, ordreAttendu }), elements };
}

{
  const ordre = [10, 20, 30, 40];
  const { placement } = placementSuite(ordre);
  check(!placement.estComplet(), "depart : aucun emplacement rempli");
  check(placement.valeur() === "", "valeur vide tant que c'est incomplet (rien a valider)");
  check(placement.enPool().length === 4, "les 4 etiquettes sont dans la zone de depart");

  /* Place les 4 etiquettes dans le BON ordre (element i -> emplacement i). */
  check(placement.placer(0, 0) === true, "place la 1re etiquette sur l'emplacement 0");
  check(placement.placer(1, 1) === true && placement.placer(2, 2) === true, "place les etiquettes suivantes");
  check(!placement.estCorrect(), "ordre incomplet : pas encore correct");
  check(placement.placer(3, 3) === true, "place la derniere etiquette");
  check(placement.estComplet(), "tous les emplacements sont remplis");
  check(placement.estCorrect(), "bon ordre : detecte comme correct");
  check(placement.valeur() === "10, 20, 30, 40", "valeur soumise = suite reconstituee (format ligne)");
}

/* --- 13. Un mauvais ordre est detecte et n'est pas valide --- */
{
  const ordre = [10, 20, 30];
  const { placement } = placementSuite(ordre);
  placement.placer(0, 0); /* 10 -> pos 0 (ok) */
  placement.placer(2, 1); /* 30 -> pos 1 (faux) */
  placement.placer(1, 2); /* 20 -> pos 2 (faux) */
  check(placement.estComplet(), "les trois emplacements sont remplis");
  check(!placement.estCorrect(), "mauvais ordre : detecte comme incorrect");
  check(placement.valeur() === "10, 30, 20", "la valeur soumise reflete l'ordre (faux) choisi par l'eleve");
}

/* --- 14. Emplacement occupe, retrait, deplacement --- */
{
  const ordre = [1, 2, 3];
  const { placement } = placementSuite(ordre);
  check(placement.placer(0, 0) === true, "place l'etiquette 0 sur l'emplacement 0");
  check(placement.placer(1, 0) === false, "on ne pose pas sur un emplacement deja occupe");
  check(placement.retirer(0) === 0, "retirer libere l'emplacement et rend l'etiquette");
  check(placement.retirer(0) === null, "retirer un emplacement vide : rien");
  check(placement.enPool().length === 3, "apres retrait, l'etiquette revient dans la zone de depart");

  /* Deplacer une etiquette deja posee vers un autre emplacement. */
  placement.placer(2, 0);
  check(placement.placer(2, 2) === true, "une etiquette posee peut etre deplacee vers un emplacement libre");
  check(placement.slots()[0] === null, "son ancien emplacement est libere");
  check(placement.slots()[2] === 2, "elle occupe le nouvel emplacement");
}

/* --- 15. Le melange ne laisse jamais la suite deja triee --- */
{
  for (let seed = 0; seed < 40; seed += 1) {
    const melange = melangerOrdre([10, 20, 30, 40], seed);
    check(
      melange.slice().sort((a, b) => a - b).join(",") === "10,20,30,40" && melange.join(",") !== "10,20,30,40",
      `graine ${seed} : memes valeurs, jamais deja triees`,
    );
  }
  /* Cas degenere (une seule valeur) : rien a melanger. */
  check(melangerOrdre([7], 3).join(",") === "7", "une seule valeur : inchangee");
}

/* --- 16. Routage : un QCM numerique va aussi a la roue, pas un symbolique --- */
function qcmExercise(options, valeur) {
  return {
    id: "N2-identifier_multiple_de_10-000042",
    pattern: { pattern_name: "identifier_multiple_de_10", pattern_family: "exercice_a_trous_serie" },
    variables: { options },
    reponse_attendue: { valeur, format: "choix_multiple" },
  };
}
{
  const num = qcmExercise([45, 40, 54], 40);
  check(compatibleMechanics(num).includes("roue"), "un QCM numerique peut aller a la roue");
  check(compatibleMechanics(num).includes("planches"), "la roue s'ajoute sans retirer les planches");

  const symbole = qcmExercise(["<", ">", "="], "<");
  check(!compatibleMechanics(symbole).includes("roue"), "un QCM symbolique (< > =) reste aux planches");
  check(compatibleMechanics(symbole).includes("planches"), "le QCM symbolique garde les planches");

  const sansOptions = { ...qcmExercise(undefined, 40) };
  check(!compatibleMechanics(sansOptions).includes("roue"), "sans options exploitables : pas de roue (fallback intact)");
}

/* --- 17. Sections : la bonne reponse est toujours presente, 4-6 sections --- */
{
  const sections = genererSectionsRoue({ options: [45, 40, 54], bonneReponse: 40, seed: 7 });
  check(sections.length >= 4 && sections.length <= 6, `4 a 6 sections (obtenu ${sections.length})`);
  check(sections.filter((s) => s.correcte).length === 1, "exactement une section correcte");
  check(sections.find((s) => s.correcte).valeur === "40", "la section correcte porte la bonne reponse");
  check(sections.some((s) => s.valeur === "45") && sections.some((s) => s.valeur === "54"), "les vrais distracteurs du QCM sont conserves");
  const valeurs = sections.map((s) => s.valeur);
  check(new Set(valeurs).size === valeurs.length, "aucune section en double");
}

/* --- 18. Sans options : distracteurs credibles PROCHES de la bonne reponse --- */
{
  const sections = genererSectionsRoue({ options: undefined, bonneReponse: 40, seed: 3 });
  check(sections.length >= 4, "des distracteurs sont fabriques quand aucune option n'est fournie");
  check(sections.some((s) => s.valeur === "40"), "la bonne reponse figure parmi les sections generees");
  check(
    sections.every((s) => Math.abs(Number(s.valeur) - 40) <= 30 && Number(s.valeur) >= 0),
    "les distracteurs restent proches (<= 30) et jamais negatifs",
  );
}

/* --- 19. Generation deterministe par graine --- */
{
  const a = genererSectionsRoue({ options: [45, 40, 54], bonneReponse: 40, seed: 11 }).map((s) => s.valeur).join(",");
  const b = genererSectionsRoue({ options: [45, 40, 54], bonneReponse: 40, seed: 11 }).map((s) => s.valeur).join(",");
  check(a === b, "meme graine -> memes sections (reproductible)");
}

/* --- 20. Geometrie du repere : quelle section sous le repere fixe --- */
{
  /* 4 sections (secteur = 90 deg). Au repos (rotation 0) : section 0 en haut. */
  check(sectionSousRepere(0, 4) === 0, "rotation 0 : section 0 sous le repere");
  /* Rotation horaire de 90 deg : la section 0 descend a droite, la section 3
     (centree a 270 = -90) remonte sous le repere. */
  check(sectionSousRepere(90, 4) === 3, "90 deg horaire : section 3 sous le repere");
  check(sectionSousRepere(180, 4) === 2, "180 deg : section opposee (2) sous le repere");
  check(sectionSousRepere(-90, 4) === 1, "-90 deg : section 1 sous le repere");
  /* Robustesse : angles hors bornes et arrondi au centre le plus proche. */
  check(sectionSousRepere(360 + 90, 4) === 3, "les tours complets n'changent rien (450 = 90)");
  check(sectionSousRepere(88, 4) === 3, "un angle presque cale tombe sur le bon centre");
  check(sectionSousRepere(0, 0) === 0, "aucune section : indice 0 par defaut, sans planter");
}

/* --- 21. La roue vise : force -> rotation -> section sous le repere --- */
{
  const sections = genererSectionsRoue({ options: [45, 40, 54], bonneReponse: 40, seed: 5 });
  const roue = creerRoue({ sections, seed: 5 });
  const n = roue.nbSections;
  /* La rotation cible d'une force doit tomber pile sur le centre annonce. */
  for (const force of [0, 0.25, 0.5, 0.75, 1]) {
    const rot = rotationDepuisForce(force, n, 5);
    check(roue.viser(force) === rot, `viser(${force}) suit rotationDepuisForce (deterministe)`);
  }
  /* En dosant la force sur toute la plage, on doit pouvoir viser presque
     toutes les sections : c'est un controle, pas un hasard (la force balaie la
     roue une fois, donc 0 et 1 se rejoignent : au moins n-1 sections vues). */
  const viseesParForce = new Set();
  for (let f = 0; f <= 1.0001; f += 0.02) {
    viseesParForce.add(sectionSousRepere(rotationDepuisForce(f, n, 5), n));
  }
  check(viseesParForce.size >= n - 1, `doser la force couvre les sections (${viseesParForce.size}/${n} atteintes)`);
}

/* --- 22. Arret, valeur soumise et evaluation (correcte / incorrecte) --- */
{
  const sections = genererSectionsRoue({ options: [45, 40, 54], bonneReponse: 40, seed: 9 });
  const roue = creerRoue({ sections, seed: 9 });
  const n = roue.nbSections;

  check(roue.valeur() === "", "avant tout lancer : aucune valeur soumise");
  check(roue.section() === null && roue.estCorrecte() === false, "avant tout lancer : rien sous le repere ne compte");

  /* Vise intentionnellement la section correcte : on cherche la rotation qui
     la place sous le repere, puis on arrete la roue dessus. */
  const idxCorrect = sections.findIndex((s) => s.correcte);
  const secteur = 360 / n;
  const rotCorrecte = -idxCorrect * secteur; /* place le centre de idxCorrect en haut */
  check(sectionSousRepere(rotCorrecte, n) === idxCorrect, "rotation calculee : la bonne section est bien sous le repere");
  roue.arreter(rotCorrecte);
  check(roue.aLance() === true, "la roue est marquee comme lancee apres l'arret");
  check(roue.valeur() === "40", "arret sur la bonne section : valeur soumise = bonne reponse");
  check(roue.estCorrecte() === true, "arret sur la bonne section : evalue correct");

  /* Vise une section fausse : la valeur suit et l'evaluation devient fausse. */
  const idxFaux = sections.findIndex((s) => !s.correcte);
  roue.arreter(-idxFaux * secteur);
  check(roue.valeur() === sections[idxFaux].valeur, "arret sur une section fausse : valeur = ce choix (faux)");
  check(roue.estCorrecte() === false, "arret sur une section fausse : evalue incorrect");
}

/* --- 23. Routage : les patterns de decomposition additive vont a la balance --- */
function additionExercise(pattern_name, family, valeur, id = "X-000001") {
  return {
    id: `${pattern_name}-${id}`,
    pattern: { pattern_name, pattern_family: family },
    variables: {},
    reponse_attendue: { valeur, format: "nombre_entier" },
  };
}
{
  const add2 = additionExercise("addition_2chiffres_sans_retenue", "calcul_direct", 57);
  check(compatibleMechanics(add2).includes("balance"), "une addition 2 chiffres peut aller a la balance");
  check(compatibleMechanics(add2).includes("planches"), "la balance s'ajoute sans retirer les planches");

  const partieTout = additionExercise("partie_tout_addition_non_narratif", "exercice_a_trous_serie", 10);
  check(compatibleMechanics(partieTout).includes("balance"), "un partie-tout additif peut aller a la balance");

  /* Une multiplication (calcul_direct mais PAS additive) n'y va pas. */
  const mult = additionExercise("multiplication_par_10", "calcul_direct", 70);
  check(!compatibleMechanics(mult).includes("balance"), "une multiplication n'utilise pas la balance (pas une decomposition additive)");

  /* Cible hors plage (trop grande a batir) : pas de balance. */
  const enorme = additionExercise("addition_2chiffres_sans_retenue", "calcul_direct", 240);
  check(!compatibleMechanics(enorme).includes("balance"), "une cible > 100 n'est pas proposee a la balance");

  /* Cible non entiere / <= 0 : pas de balance. */
  const zero = additionExercise("addition_pas_a_pas_sans_retenue", "calcul_direct", 0);
  check(!compatibleMechanics(zero).includes("balance"), "une cible nulle n'est pas proposee a la balance");
}

/* --- 24. Palette de poids : de quoi batir la cible, deterministe --- */
{
  check(poidsDisponibles(9).join(",") === "1,2,5,10", "petite cible : poids de base");
  check(poidsDisponibles(30).includes(20), "cible >= 20 : le poids 20 apparait");
  check(poidsDisponibles(80).includes(50), "cible >= 50 : le poids 50 apparait");
  check(poidsDisponibles(9).join(",") === poidsDisponibles(9).join(","), "palette deterministe");
}

/* --- 25. Somme des poids, ecart et detection de l'equilibre --- */
{
  const b = creerBalance({ cible: 12, poids: [1, 2, 5, 10] });
  check(b.somme() === 0 && b.valeur() === "", "depart : plateau vide, aucune valeur soumise");
  check(!b.estEquilibre(), "depart : pas equilibre (0 != 12)");

  b.placer(10);
  b.placer(1);
  check(b.somme() === 11, "somme des poids poses (10 + 1 = 11)");
  check(b.ecart() === -1, "ecart negatif : plateau trop leger");
  check(!b.estEquilibre() && b.valeur() === "11", "trop leger : pas equilibre, valeur = somme partielle");

  const idDeux = b.placer(2);
  check(b.somme() === 13 && b.ecart() === 1, "un poids de trop : ecart positif (13 - 12)");
  check(!b.estEquilibre(), "trop lourd : pas equilibre");

  check(b.retirer(idDeux) === true, "on retire le poids en trop");
  b.placer(1);
  check(b.somme() === 12 && b.estEquilibre(), "somme = cible : equilibre atteint");
  check(b.valeur() === "12", "a l'equilibre, la valeur soumise egale la cible");
}

/* --- 26. Poser plusieurs fois la meme valeur, retrait cible --- */
{
  const b = creerBalance({ cible: 3, poids: [1, 2, 5] });
  const a = b.placer(1);
  const c = b.placer(1);
  b.placer(1);
  check(b.somme() === 3 && b.estEquilibre(), "trois poids de 1 equilibrent une cible de 3");
  check(b.places().length === 3, "les instances identiques coexistent");
  check(b.retirer(c) === true && b.somme() === 2, "on retire une instance precise par son id");
  check(b.retirer(999) === false, "retirer un id inexistant ne change rien");
  check(b.places().some((p) => p.id === a), "les autres instances restent");
}

/* --- 27. Basculement : sens et saturation de l'angle (fonction pure) --- */
{
  check(angleBascule(0) === 0, "ecart nul : fleau horizontal (0 degre)");
  check(angleBascule(5) > 0, "plateau eleve plus lourd : bascule positive");
  check(angleBascule(-5) < 0, "plateau eleve plus leger : bascule negative");
  check(Math.abs(angleBascule(5) + angleBascule(-5)) < 1e-9, "bascule symetrique autour de 0");
  check(Math.abs(angleBascule(1000)) <= 16 + 1e-9, "angle sature (jamais au-dela du maximum)");
  check(angleBascule(50) > angleBascule(5), "plus l'ecart grandit, plus ca penche (monotone)");
}

/* --- 28. Bornes par age : rang du niveau et helpers purs (P3) --- */
const {
  niveauRang,
  maxElementsOrdre,
  bornesBalance,
  poidsMinimum,
} = require("./mechanics.js");
{
  check(niveauRang("CE1") === 1 && niveauRang("CE6") === 6, "niveauRang lit le chiffre du niveau");
  check(niveauRang(undefined) === 0 && niveauRang("") === 0, "niveau inconnu : rang 0 (permissif)");

  check(maxElementsOrdre("CE1") === 4, "CE1 : au plus 4 elements a ranger sur la mecanique d'ordre");
  check(maxElementsOrdre("CE2") === Infinity, "CE2+ : pas de plafond sur l'ordre");
  check(maxElementsOrdre(undefined) === Infinity, "niveau inconnu : pas de plafond sur l'ordre");

  check(bornesBalance("CE1").cibleMax === 20 && bornesBalance("CE1").poidsMax === 3, "CE1 : balance cible <= 20 et 3 poids max");
  check(bornesBalance("CE3").poidsMax === Infinity, "CE3+ : balance sans plafond de poids");

  check(poidsMinimum(20, poidsDisponibles(20)) === 1, "poidsMinimum(20) = 1 (un poids de 20)");
  check(poidsMinimum(8, poidsDisponibles(8)) === 3, "poidsMinimum(8) = 3 (5+2+1)");
  check(poidsMinimum(18, poidsDisponibles(18)) === 4, "poidsMinimum(18) = 4 (10+5+2+1)");
}

/* --- 29. Ordre borne au CE1, intact au-dessus (P3) --- */
function suiteNiveau(valeurs, niveau) {
  return {
    id: `${niveau}-suite-000001`,
    niveau_scolaire: niveau,
    pattern: { pattern_name: "completer_ligne_graduee", pattern_family: "exercice_a_trous_serie" },
    variables: {},
    reponse_attendue: { valeur: valeurs, format: "liste_ordonnee" },
  };
}
{
  const longue = [55, 60, 65, 70, 75, 80]; /* 6 elements, typique ligne graduee CE1 */
  const courte = [10, 20, 30]; /* 3 elements */

  const ce1Long = compatibleMechanics(suiteNiveau(longue, "CE1"));
  check(ce1Long.includes("ligne"), "CE1, suite longue : la ligne reste disponible");
  check(!ce1Long.includes("ordre"), "CE1, suite de 6 : PAS d'ordre (trop lourd a ranger)");

  const ce1Court = compatibleMechanics(suiteNiveau(courte, "CE1"));
  check(ce1Court.includes("ordre"), "CE1, suite de 3 : l'ordre reste possible (court)");

  const ce2Long = compatibleMechanics(suiteNiveau(longue, "CE2"));
  check(ce2Long.includes("ordre"), "CE2, suite de 6 : l'ordre reste propose (plus permissif)");
}

/* --- 30. Balance bornee au CE1, intacte au-dessus (P3) --- */
function additionNiveau(valeur, niveau) {
  return {
    id: `${niveau}-add-000001`,
    niveau_scolaire: niveau,
    pattern: { pattern_name: "addition_pas_a_pas_sans_retenue", pattern_family: "calcul_direct" },
    reponse_attendue: { valeur, format: "nombre_entier" },
  };
}
{
  /* CE1 : une petite cible facile (10 = un seul poids) passe. */
  check(compatibleMechanics(additionNiveau(10, "CE1")).includes("balance"), "CE1 : cible 10 (1 poids) va a la balance");
  /* CE1 : cible 37 (34+3) exclue -- au-dela de 20. */
  check(!compatibleMechanics(additionNiveau(37, "CE1")).includes("balance"), "CE1 : cible 37 > 20 exclue de la balance");
  /* CE1 : cible 18 <= 20 mais 4 poids (10+5+2+1) -> exclue (max 3 poids). */
  check(!compatibleMechanics(additionNiveau(18, "CE1")).includes("balance"), "CE1 : cible 18 (4 poids) exclue (motricite)");
  /* CE1 : cible 15 = 10+5 (2 poids) -> acceptee. */
  check(compatibleMechanics(additionNiveau(15, "CE1")).includes("balance"), "CE1 : cible 15 (2 poids) acceptee");
  /* CE2+ : la meme cible 37 reste proposee a la balance (borne d'origine). */
  check(compatibleMechanics(additionNiveau(37, "CE2")).includes("balance"), "CE2 : cible 37 reste jouable a la balance");
}

/* --- Panier a remplir : toujours jouable (BUG 2) --------------------- */
function narratifExercise(valeur, id = "CE1-narratif-000001") {
  return {
    id,
    niveau_scolaire: "CE1",
    pattern: { pattern_name: "probleme_ajout_simple", pattern_family: "probleme_narratif_simple" },
    reponse_attendue: { valeur, format: "nombre_entier" },
  };
}
{
  /* Le routage ne propose le panier que pour une cible <= BASKET_MAX_COUNT. */
  check(
    compatibleMechanics(narratifExercise(BASKET_MAX_COUNT)).includes("panier"),
    `panier propose pour une cible <= ${BASKET_MAX_COUNT}`,
  );
  check(
    !compatibleMechanics(narratifExercise(BASKET_MAX_COUNT + 1)).includes("panier"),
    `panier exclu au-dela de ${BASKET_MAX_COUNT} (sinon plateau ingerable)`,
  );
  check(
    !compatibleMechanics(narratifExercise(79)).includes("panier"),
    "panier jamais propose pour la grande cible 79 (cas du bug)",
  );
  /* Le plateau affiche TOUJOURS au moins la cible : jamais insoluble. */
  for (const cible of [1, 5, 12, 20, 79]) {
    const fc = basketFieldCount(narratifExercise(cible, `CE1-narratif-${cible}`));
    check(fc >= cible, `panier cible ${cible} : au moins ${cible} objets affiches (soluble), obtenu ${fc}`);
    check(fc > cible, `panier cible ${cible} : au moins un distracteur (pas "tout ramasser")`);
  }
  /* Dans la plage reellement routee (<= BASKET_MAX_COUNT), le plateau reste
     petit : pas plus de la cible + 5 distracteurs. */
  const fcMax = basketFieldCount(narratifExercise(BASKET_MAX_COUNT));
  check(fcMax <= BASKET_MAX_COUNT + 5, "panier : plateau borne (cible + 5 distracteurs max)");
}

/* --- Planches : unicite de la reserve de distracteurs (BUG 4) --------- */
function calculExercise(valeur, id) {
  return {
    id,
    niveau_scolaire: "CE2",
    pattern: { pattern_name: "addition_simple", pattern_family: "calcul_direct" },
    reponse_attendue: { valeur, format: "nombre_entier" },
  };
}
function occurrences(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  return m;
}
{
  /* Balaye de nombreux seeds (ids) pour attraper les collisions distracteur
     vs chiffre de la reponse. Reponses a 1, 2 et 3 chiffres. */
  let uneSeuleFois = true;
  let jamaisSurReponse = true;
  for (const valeur of [8, 3, 45, 70, 123, 909]) {
    const attendus = occurrences(String(valeur).split(""));
    for (let n = 0; n < 60; n += 1) {
      const { candidates } = plankCandidates(calculExercise(valeur, `CE2-add-${valeur}-${n}`));
      const counts = occurrences(candidates);
      for (const [chiffre, nb] of counts) {
        const attendu = attendus.get(chiffre) || 0;
        if (attendu > 0) {
          /* Un chiffre de la reponse ne doit pas etre gonfle par un distracteur. */
          if (nb !== attendu) jamaisSurReponse = false;
        } else {
          /* Un distracteur ne doit apparaitre qu'une seule fois. */
          if (nb !== 1) uneSeuleFois = false;
        }
      }
    }
  }
  check(uneSeuleFois, "planches : aucun distracteur n'est duplique dans la reserve");
  check(jamaisSurReponse, "planches : aucun distracteur ne coincide avec un chiffre de la reponse");
  /* Un QCM garde ses options telles quelles (unicite a la charge de la donnee). */
  const qcm = {
    id: "CE2-qcm-1",
    pattern: { pattern_name: "identifier_multiple_de_10", pattern_family: "choix_multiple" },
    variables: { options: ["30", "40", "50", "60"] },
    reponse_attendue: { valeur: 40, format: "choix_multiple" },
  };
  const { candidates: qcmCandidates, slotCount } = plankCandidates(qcm);
  check(slotCount === 1, "planches QCM : un seul emplacement a remplir");
  check(qcmCandidates.length === 4 && new Set(qcmCandidates).size === 4, "planches QCM : les 4 options restent distinctes");
}

console.log(`\n${total - failures}/${total} cas passent`);
process.exit(failures === 0 ? 0 : 1);
