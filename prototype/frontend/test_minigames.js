/* Tests des mini-jeux (minigames.js).
   Lancer avec : node test_minigames.js
   Couvre : la logique de declenchement (probabilite, espacement) et le
   cycle bascule/retour de l'orchestrateur, avec un adapter factice. */
const minigames = require("./minigames.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* Petit generateur deterministe : renvoie a tour de role les valeurs
   fournies (puis boucle), pour piloter les tirages de probabilite. */
function randomFrom(valeurs) {
  let i = 0;
  return () => {
    const v = valeurs[i % valeurs.length];
    i += 1;
    return v;
  };
}

/* --- 1. Declencheur : probabilite --- */
{
  /* Tirage toujours sous le seuil (0 < 0.4) : premiere occasion => propose. */
  const oui = minigames.creerDeclencheur({ probabilite: 0.4 });
  check(oui.conceptDebloque(() => 0) === true, "tirage 0 < 0.4 : propose");

  /* Tirage toujours au-dessus du seuil : ne propose jamais. */
  const non = minigames.creerDeclencheur({ probabilite: 0.4 });
  let propositions = 0;
  for (let i = 0; i < 10; i += 1) {
    if (non.conceptDebloque(() => 0.9)) propositions += 1;
  }
  check(propositions === 0, "tirage 0.9 >= 0.4 : ne propose jamais (0/10)");

  /* Au seuil exact : 0.4 n'est pas < 0.4 => ne propose pas (borne stricte). */
  const borne = minigames.creerDeclencheur({ probabilite: 0.4 });
  check(borne.conceptDebloque(() => 0.4) === false, "tirage == seuil : ne propose pas (borne stricte)");

  /* Probabilite 0 : jamais. Probabilite 1 (avec espacement) : des que permis. */
  const jamais = minigames.creerDeclencheur({ probabilite: 0 });
  check(jamais.conceptDebloque(() => 0) === false, "probabilite 0 : jamais, meme tirage 0");
}

/* --- 2. Declencheur : espacement entre deux propositions --- */
{
  /* Probabilite 1 pour isoler l'effet de l'espacement (le tirage passe
     toujours). espacementMin = 2 : apres une proposition, les 2 concepts
     suivants sont interdits, le 3e redevient possible. */
  const d = minigames.creerDeclencheur({ probabilite: 1, espacementMin: 2 });
  check(d.conceptDebloque(() => 0) === true, "1er concept : propose");
  check(d.conceptDebloque(() => 0) === false, "concept +1 : bloque par l'espacement");
  check(d.conceptDebloque(() => 0) === false, "concept +2 : encore bloque");
  check(d.conceptDebloque(() => 0) === true, "concept +3 : de nouveau possible (2 concepts entre les deux)");
  /* Et le cycle recommence a l'identique apres la 2e proposition. */
  check(d.conceptDebloque(() => 0) === false, "apres 2e proposition : concept +1 bloque");
  check(d.conceptDebloque(() => 0) === false, "apres 2e proposition : concept +2 bloque");
  check(d.conceptDebloque(() => 0) === true, "apres 2e proposition : concept +3 possible");

  /* Jamais deux propositions consecutives, quelle que soit la chance. */
  const serre = minigames.creerDeclencheur({ probabilite: 1, espacementMin: 2 });
  const suite = [];
  for (let i = 0; i < 8; i += 1) suite.push(serre.conceptDebloque(() => 0));
  check(
    !suite.some((v, i) => v && suite[i + 1]),
    "aucune paire de propositions consecutives sur 8 concepts",
  );

  /* espacementMin parametrable : avec 1, un seul concept d'ecart suffit. */
  const large = minigames.creerDeclencheur({ probabilite: 1, espacementMin: 1 });
  check(large.conceptDebloque(() => 0) === true, "espacementMin 1 : 1er concept propose");
  check(large.conceptDebloque(() => 0) === false, "espacementMin 1 : concept +1 bloque");
  check(large.conceptDebloque(() => 0) === true, "espacementMin 1 : concept +2 possible");
}

/* --- 3. Espacement ET probabilite ensemble : un refus de tirage ne
       consomme pas l'espacement (le compteur ne repart qu'a une vraie
       proposition). --- */
{
  const d = minigames.creerDeclencheur({ probabilite: 0.4, espacementMin: 2 });
  /* concept 1 : tirage rate (0.9) -> pas de proposition, espacement intact. */
  check(d.conceptDebloque(() => 0.9) === false, "tirage rate : pas de proposition");
  /* concept 2 : tirage reussi -> propose (l'espacement n'avait pas ete
     entame par le rate precedent). */
  check(d.conceptDebloque(() => 0.1) === true, "tirage suivant reussi : propose (rate non penalisant)");
  /* concept 3 : bloque par l'espacement malgre un tirage reussi. */
  check(d.conceptDebloque(() => 0.1) === false, "juste apres : bloque par l'espacement");
}

/* --- 4. Registre : interface commune et selection --- */
{
  const reg = minigames.creerRegistre();
  check(reg.estVide(), "registre neuf : vide");
  check(reg.choisir(() => 0) === null, "registre vide : choisir renvoie null");

  const jeuA = { id: "a", nom: "Jeu A", monter() {} };
  const jeuB = { id: "b", nom: "Jeu B", monter() {} };
  reg.enregistrer(jeuA);
  reg.enregistrer(jeuB);
  check(reg.liste().length === 2, "deux mini-jeux enregistres");
  check(!reg.estVide(), "registre garni : non vide");

  /* Selection deterministe via le tirage. */
  check(reg.choisir(() => 0).id === "a", "tirage 0 : premier mini-jeu");
  check(reg.choisir(() => 0.99).id === "b", "tirage 0.99 : dernier mini-jeu (pas de debordement)");

  /* Entrees invalides ignorees : interface commune obligatoire. */
  reg.enregistrer(null);
  reg.enregistrer({ id: "x" }); /* pas de nom ni de monter */
  reg.enregistrer({ nom: "Sans id", monter() {} });
  check(reg.liste().length === 2, "entrees invalides ignorees (id + nom + monter requis)");
}

/* --- 5. Orchestrateur : cycle bascule/retour --- */
/* Adapter factice : enregistre chaque appel et capture les callbacks. */
function fakeAdapter() {
  const calls = [];
  const a = {
    calls,
    accepter: null,
    refuser: null,
    terminer: null,
    demonte: false,
    pauseCarte() {
      calls.push("pauseCarte");
    },
    reprendreCarte() {
      calls.push("reprendreCarte");
    },
    afficherProposition(_minigame, cbs) {
      calls.push("afficherProposition");
      a.accepter = cbs.accepter;
      a.refuser = cbs.refuser;
    },
    cacherProposition() {
      calls.push("cacherProposition");
    },
    monterMinigame(_minigame, cbs) {
      calls.push("monterMinigame");
      a.terminer = cbs.terminer;
      return () => {
        a.demonte = true;
        calls.push("demonter");
      };
    },
    cacherMinigame() {
      calls.push("cacherMinigame");
    },
    ajouterBonus(points) {
      calls.push(`ajouterBonus:${points}`);
    },
  };
  return a;
}

function orchestrateurAvec(adapter, { probabilite = 1, espacementMin = 0 } = {}) {
  const registre = minigames.creerRegistre();
  registre.enregistrer(minigames.MINIGAME_A_VENIR);
  return minigames.creerOrchestrateur({
    declencheur: minigames.creerDeclencheur({ probabilite, espacementMin }),
    registre,
    adapter,
    random: () => 0,
  });
}

/* 5a. Chemin nominal : proposer -> accepter -> terminer -> retour. */
{
  const adapter = fakeAdapter();
  const orch = orchestrateurAvec(adapter);

  check(orch.getPhase() === "repos", "depart : phase repos");
  check(orch.conceptDebloque() === false, "1er concept du parcours : jamais de pause");
  const propose = orch.conceptDebloque();
  check(propose === true, "2e concept debloque : proposition affichee");
  check(orch.getPhase() === "proposition", "phase = proposition");
  check(
    adapter.calls.includes("pauseCarte") && adapter.calls.includes("afficherProposition"),
    "la carte est mise en pause et la proposition affichee",
  );

  adapter.accepter();
  check(orch.getPhase() === "enJeu", "apres accepter : phase enJeu");
  check(
    adapter.calls.includes("cacherProposition") && adapter.calls.includes("monterMinigame"),
    "accepter : proposition cachee, mini-jeu monte",
  );
  /* On ne reprend PAS la carte en acceptant : elle reste en pause. */
  check(
    adapter.calls.filter((c) => c === "reprendreCarte").length === 0,
    "accepter : la carte reste en pause (pas de reprise prematuree)",
  );

  adapter.terminer(0);
  check(orch.getPhase() === "repos", "apres terminer : retour au repos");
  check(adapter.demonte === true, "terminer : le mini-jeu est demonte (nettoyage)");
  check(
    adapter.calls.includes("cacherMinigame") && adapter.calls.includes("reprendreCarte"),
    "terminer : ecran cache et carte reprise",
  );
  /* Ordre : la carte ne reprend qu'apres le nettoyage du mini-jeu. */
  check(
    adapter.calls.indexOf("demonter") < adapter.calls.indexOf("reprendreCarte"),
    "terminer : nettoyage avant reprise de la carte",
  );
}

/* 5b. Refus : proposer -> refuser -> retour, sans lancer le mini-jeu. */
{
  const adapter = fakeAdapter();
  const orch = orchestrateurAvec(adapter);

  orch.conceptDebloque(); /* 1er concept : warm-up, pas de pause */
  orch.conceptDebloque();
  adapter.refuser();
  check(orch.getPhase() === "repos", "refuser : retour au repos");
  check(
    adapter.calls.includes("cacherProposition") && adapter.calls.includes("reprendreCarte"),
    "refuser : proposition cachee, carte reprise",
  );
  check(
    !adapter.calls.includes("monterMinigame"),
    "refuser : aucun mini-jeu n'est monte",
  );
}

/* 5c. Bonus cosmetique optionnel : transmis a l'adapter APRES coup. */
{
  const adapter = fakeAdapter();
  const orch = orchestrateurAvec(adapter);
  orch.conceptDebloque(); /* 1er concept : warm-up, pas de pause */
  orch.conceptDebloque();
  adapter.accepter();
  adapter.terminer(25);
  check(adapter.calls.includes("ajouterBonus:25"), "terminer avec bonus : bonus cosmetique transmis");
  /* Le bonus arrive apres le nettoyage, jamais avant la fin du jeu. */
  check(
    adapter.calls.indexOf("demonter") < adapter.calls.indexOf("ajouterBonus:25"),
    "le bonus n'est applique qu'apres la fin du mini-jeu",
  );
  const adapter0 = fakeAdapter();
  const orch0 = orchestrateurAvec(adapter0);
  orch0.conceptDebloque(); /* 1er concept : warm-up, pas de pause */
  orch0.conceptDebloque();
  adapter0.accepter();
  adapter0.terminer(0);
  check(
    !adapter0.calls.some((c) => c.startsWith("ajouterBonus")),
    "bonus 0 : aucun appel de bonus (aparte pur)",
  );
}

/* 5d. Robustesse de la machine a etats : appels hors phase ignores. */
{
  const adapter = fakeAdapter();
  const orch = orchestrateurAvec(adapter);

  /* terminer/refuser au repos : sans effet. */
  orch.terminer(99);
  orch.refuser();
  check(orch.getPhase() === "repos" && adapter.calls.length === 0, "appels hors phase au repos : ignores");

  orch.conceptDebloque(); /* 1er concept : warm-up, pas de pause */
  orch.conceptDebloque();
  /* Nouveau concept pendant une proposition : pas de double proposition. */
  const rep = orch.conceptDebloque();
  check(rep === false, "pas de proposition tant qu'une pause est en cours");
  check(
    adapter.calls.filter((c) => c === "afficherProposition").length === 1,
    "une seule proposition affichee, pas de superposition",
  );

  /* terminer alors qu'on est encore en proposition (pas en jeu) : ignore. */
  orch.terminer(0);
  check(orch.getPhase() === "proposition", "terminer hors du jeu : ignore");
}

/* 5e. Registre vide : jamais de proposition (pas de pause sans jeu). */
{
  const adapter = fakeAdapter();
  const orch = minigames.creerOrchestrateur({
    declencheur: minigames.creerDeclencheur({ probabilite: 1, espacementMin: 0 }),
    registre: minigames.creerRegistre(),
    adapter,
    random: () => 0,
  });
  check(orch.conceptDebloque() === false, "registre vide : aucune proposition");
  check(adapter.calls.length === 0, "registre vide : la carte n'est jamais touchee");
}

/* 5f. Jamais de pause sur le 1er concept d'un parcours, et reset a la nouvelle
   aventure (le declencheur etant un singleton reporte entre parcours). */
{
  const adapter = fakeAdapter();
  const orch = orchestrateurAvec(adapter); /* probabilite 1, espacementMin 0 */
  check(orch.conceptDebloque() === false, "1er concept d'un parcours : jamais de pause");
  check(orch.conceptDebloque() === true, "2e concept : proposition possible");
  adapter.refuser(); /* retour au repos */

  orch.reinitialiser(); /* nouvelle aventure */
  check(orch.conceptDebloque() === false, "apres reinitialiser : 1er concept du nouveau parcours sans pause");
  check(orch.conceptDebloque() === true, "apres reinitialiser : 2e concept propose de nouveau");
}

/* --- 6. Le placeholder respecte l'interface commune --- */
{
  const jeu = minigames.MINIGAME_A_VENIR;
  check(Boolean(jeu.id && jeu.nom && typeof jeu.monter === "function"), "placeholder : interface commune complete");

  /* Montage/demontage simules avec une fausse zone DOM minimale. */
  let terminePar = null;
  const zone = {
    innerHTML: "",
    _handlers: {},
    querySelector() {
      return {
        addEventListener: (_evt, fn) => {
          zone._click = fn;
        },
        removeEventListener: () => {},
        focus: () => {},
      };
    },
  };
  const demonter = jeu.monter(zone, { terminer: (b) => (terminePar = b) });
  check(zone.innerHTML.includes("Terminer"), "placeholder : bouton Terminer affiche");
  zone._click(); /* clic sur Terminer */
  check(terminePar === 0, "placeholder : Terminer appelle terminer(0) (aucun bonus)");
  check(typeof demonter === "function", "placeholder : monter renvoie une fonction de nettoyage");
  demonter();
  check(zone.innerHTML === "", "placeholder : le nettoyage vide la zone");
}

/* ============================================================
   7. MINI-JEU : LA CHASSE AUX NOMBRES (logique pure)
   ============================================================ */

/* Petit hasard deterministe : consomme une liste de valeurs (puis boucle). */
function randomSeq(valeurs) {
  let i = 0;
  return () => {
    const v = valeurs[i % valeurs.length];
    i += 1;
    return v;
  };
}

/* --- 7a. Generation de partie : cible presente, contraintes respectees --- */
{
  const cfg = minigames.genererConfig(Math.random);
  check(cfg.nombres.length === minigames.CHASSE.NB_NOMBRES, "genererConfig : bon nombre de nombres");

  const matches = cfg.nombres.filter((n) => n.valeur === cfg.cible).length;
  check(matches >= minigames.CHASSE.CIBLES_MIN, "la cible est presente en au moins CIBLES_MIN exemplaires");
  check(
    cfg.nombres.some((n) => n.valeur === cfg.cible),
    "la cible est TOUJOURS tiree parmi les nombres affiches",
  );

  const ids = cfg.nombres.map((n) => n.id);
  check(new Set(ids).size === ids.length, "les identifiants des nombres sont uniques");

  const R = cfg.rayon;
  const dansLAire = cfg.nombres.every(
    (n) => n.x >= R && n.x <= cfg.largeur - R && n.y >= R && n.y <= cfg.hauteur - R,
  );
  check(dansLAire, "tous les nombres demarrent a l'interieur de l'aire");

  const bougent = cfg.nombres.every((n) => Math.abs(n.vx) + Math.abs(n.vy) > 0);
  check(bougent, "chaque nombre a une vitesse non nulle (il flotte)");

  /* Reproductible : meme hasard -> meme partie. */
  const seed = () => randomSeq([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  const a = minigames.genererConfig(seed());
  const b = minigames.genererConfig(seed());
  check(JSON.stringify(a) === JSON.stringify(b), "genererConfig est deterministe a hasard egal");
}

/* --- 7b. Detection de bon clic (aucune penalite sur un mauvais) --- */
{
  const config = {
    cible: 7,
    dureeMs: 10000,
    largeur: 640,
    hauteur: 420,
    rayon: 34,
    nombres: [
      { id: 0, valeur: 7, x: 100, y: 100, vx: 10, vy: 0 },
      { id: 1, valeur: 7, x: 200, y: 200, vx: 0, vy: 10 },
      { id: 2, valeur: 3, x: 300, y: 300, vx: -10, vy: 0 },
    ],
  };
  const jeu = minigames.creerChasseNombres(config);
  check(jeu.aTrouver() === 2, "aTrouver = nombre de cibles a l'ecran (2)");
  check(jeu.trouves() === 0, "au depart : 0 trouve");

  const bon = jeu.cliquer(0);
  check(bon.bon === true && jeu.trouves() === 1, "clic sur une cible : bon, compteur +1");

  const reclic = jeu.cliquer(0);
  check(reclic.bon === false && jeu.trouves() === 1, "reclic sur un nombre deja trouve : sans effet");

  const mauvais = jeu.cliquer(2);
  check(mauvais.bon === false, "clic sur un mauvais nombre : bon=false");
  check(jeu.trouves() === 1, "mauvais clic : AUCUNE penalite (compteur inchange)");
  check(!jeu.estTermine(), "mauvais clic : la partie continue (pas d'echec possible)");

  const inconnu = jeu.cliquer(999);
  check(inconnu.bon === false, "clic sur un id inexistant : ignore proprement");

  /* Le nombre trouve n'apparait plus parmi les nombres actifs. */
  check(!jeu.nombresActifs().some((n) => n.id === 0), "un nombre trouve quitte les nombres actifs");
  check(jeu.nombresActifs().length === 2, "il reste 2 nombres actifs apres 1 trouve");
}

/* --- 7c. Fin par decompte du temps --- */
{
  const config = {
    cible: 5,
    dureeMs: 1000,
    largeur: 640,
    hauteur: 420,
    rayon: 34,
    nombres: [{ id: 0, valeur: 5, x: 100, y: 100, vx: 0, vy: 0 }],
  };
  const jeu = minigames.creerChasseNombres(config);
  jeu.avancer(400);
  check(jeu.tempsRestantMs() === 600 && !jeu.estTermine(), "le temps decompte (1000 -> 600), partie en cours");
  jeu.avancer(600);
  check(jeu.tempsRestantMs() === 0 && jeu.estTermine(), "temps ecoule : partie terminee");
  jeu.avancer(500);
  check(jeu.tempsRestantMs() === 0, "le temps ne devient jamais negatif");

  const apres = jeu.cliquer(0);
  check(apres.bon === false && jeu.trouves() === 0, "apres la fin, plus aucun clic ne compte");
}

/* --- 7d. Fin anticipee : tout trouve avant la fin du temps --- */
{
  const config = {
    cible: 4,
    dureeMs: 20000,
    largeur: 640,
    hauteur: 420,
    rayon: 34,
    nombres: [
      { id: 0, valeur: 4, x: 100, y: 100, vx: 0, vy: 0 },
      { id: 1, valeur: 4, x: 200, y: 200, vx: 0, vy: 0 },
      { id: 2, valeur: 9, x: 300, y: 300, vx: 0, vy: 0 },
    ],
  };
  const jeu = minigames.creerChasseNombres(config);
  jeu.cliquer(0);
  check(!jeu.estTermine(), "une seule cible trouvee sur deux : partie en cours");
  jeu.cliquer(1);
  check(jeu.estTermine() && jeu.tousTrouves(), "toutes les cibles trouvees : victoire anticipee");
}

/* --- 7e. Physique : rebond sur les bords, jamais hors-champ --- */
{
  const config = {
    cible: 1,
    dureeMs: 100000,
    largeur: 200,
    hauteur: 200,
    rayon: 20,
    nombres: [
      { id: 0, valeur: 1, x: 25, y: 100, vx: -100, vy: 0 }, /* fonce vers le bord gauche */
      { id: 1, valeur: 1, x: 175, y: 100, vx: 100, vy: 0 }, /* vers le bord droit */
    ],
  };
  const jeu = minigames.creerChasseNombres(config);
  let aRebondi = false; /* id 0 part vers la gauche (vx<0) : un rebond le rend positif */
  for (let i = 0; i < 200; i += 1) {
    jeu.avancer(16);
    if (jeu.nombres().find((n) => n.id === 0).vx > 0) {
      aRebondi = true;
    }
  }
  const dans = jeu
    .nombres()
    .every((n) => n.x >= config.rayon - 0.001 && n.x <= config.largeur - config.rayon + 0.001 && n.y >= config.rayon - 0.001 && n.y <= config.hauteur - config.rayon + 0.001);
  check(dans, "apres de nombreux pas, les nombres restent dans l'aire (rebonds)");
  check(aRebondi, "le nombre lance vers le bord gauche a rebondi (vx est repasse positif)");
}

/* --- 7f. Bonus cosmetique croissant avec le nombre de trouves --- */
{
  const mk = () => minigames.creerChasseNombres({
    cible: 2,
    dureeMs: 20000,
    largeur: 640,
    hauteur: 420,
    rayon: 34,
    nombres: [
      { id: 0, valeur: 2, x: 100, y: 100, vx: 0, vy: 0 },
      { id: 1, valeur: 2, x: 200, y: 200, vx: 0, vy: 0 },
      { id: 2, valeur: 8, x: 300, y: 300, vx: 0, vy: 0 },
    ],
  });
  const zero = mk();
  check(zero.bonus() === minigames.CHASSE.BONUS_BASE, "bonus avec 0 trouve = bonus de base (participation)");
  const un = mk();
  un.cliquer(0);
  check(
    un.bonus() === minigames.CHASSE.BONUS_BASE + minigames.CHASSE.BONUS_PAR_TROUVE,
    "bonus croit d'un cran par nombre trouve",
  );
  check(un.bonus() > zero.bonus(), "plus on attrape, plus le bonus cosmetique est grand");
  check(minigames.CHASSE.DUREE_MS >= 15000 && minigames.CHASSE.DUREE_MS <= 20000, "duree dans la fourchette 15-20 s");
}

/* --- 7g. Le mini-jeu est bien celui propose par le registre reel --- */
{
  const noms = minigames.liste().map((j) => j.id);
  check(noms.includes("chasse-nombres"), "la chasse aux nombres est enregistree dans le registre reel");
  const jeu = minigames.MINIGAME_CHASSE;
  check(
    Boolean(jeu.id && jeu.nom && typeof jeu.monter === "function"),
    "MINIGAME_CHASSE respecte l'interface commune {id, nom, monter}",
  );
}

/* ============================================================
   8. MINI-JEU : LE MEMORY DES TABLES (logique pure)
   ============================================================ */

/* --- 8a. Generation des paires : calculs corrects, resultats distincts --- */
{
  const cfg = minigames.genererPaires(Math.random);
  check(cfg.cartes.length === cfg.nbPaires * 2, "chaque paire donne exactement 2 cartes");
  check(
    cfg.nbPaires >= minigames.MEMORY.PAIRES_MIN && cfg.nbPaires <= minigames.MEMORY.PAIRES_MAX,
    "nombre de paires dans la fourchette 6-8",
  );

  /* Chaque paire : une carte calcul + une carte resultat, meme valeur. */
  const parPaire = {};
  for (const c of cfg.cartes) {
    (parPaire[c.paireId] = parPaire[c.paireId] || []).push(c);
  }
  const pairesBienFormees = Object.values(parPaire).every((cs) => {
    if (cs.length !== 2) return false;
    const calc = cs.find((c) => c.face === "calcul");
    const res = cs.find((c) => c.face === "resultat");
    if (!calc || !res) return false;
    /* Le texte du calcul "a × b" doit valoir la valeur commune. */
    const m = calc.texte.match(/(\d+)\s*[x×]\s*(\d+)/);
    return m && Number(m[1]) * Number(m[2]) === calc.valeur && res.valeur === calc.valeur;
  });
  check(pairesBienFormees, "chaque paire = 1 calcul + son resultat, valeurs coherentes (calcul_direct)");

  const resultats = cfg.cartes.filter((c) => c.face === "resultat").map((c) => c.valeur);
  check(new Set(resultats).size === resultats.length, "tous les resultats sont distincts (pas d'ambiguite)");

  const ids = cfg.cartes.map((c) => c.id);
  check(new Set(ids).size === ids.length, "identifiants de cartes uniques");

  /* Reproductible a hasard egal. */
  const seed = () => randomSeq([0.15, 0.35, 0.55, 0.75, 0.25, 0.45, 0.65, 0.85, 0.05, 0.95]);
  const a = minigames.genererPaires(seed());
  const b = minigames.genererPaires(seed());
  check(JSON.stringify(a) === JSON.stringify(b), "genererPaires est deterministe a hasard egal");

  /* Colonnes de la grille adaptees au nombre de cartes : la grille est
     toujours pleine (pas de "trou"), meme pour 14 cartes (7 paires). */
  check(minigames.colonnesMemory(12) === 4, "12 cartes -> 4 colonnes (4x3), grille pleine");
  check(minigames.colonnesMemory(14) === 7, "14 cartes -> 7 colonnes (7x2), plus de cellules vides");
  check(minigames.colonnesMemory(16) === 4, "16 cartes -> 4 colonnes (4x4), grille pleine");
  for (const n of [12, 14, 16]) {
    check(n % minigames.colonnesMemory(n) === 0, `${n} cartes : le nombre de colonnes divise ${n} (aucun trou)`);
  }
}

/* Petite fabrique de partie memory a cartes fixes pour les tests. */
function memoryFixe() {
  return minigames.creerMemory({
    nbPaires: 2,
    cartes: [
      { id: 0, paireId: 0, face: "calcul", texte: "2 × 3", valeur: 6 },
      { id: 1, paireId: 0, face: "resultat", texte: "6", valeur: 6 },
      { id: 2, paireId: 1, face: "calcul", texte: "4 × 5", valeur: 20 },
      { id: 3, paireId: 1, face: "resultat", texte: "20", valeur: 20 },
    ],
  });
}

/* --- 8b. Bonne paire : les cartes restent visibles et trouvees --- */
{
  const jeu = memoryFixe();
  check(jeu.pairesTrouvees() === 0 && !jeu.estTermine(), "depart : 0 paire, partie en cours");

  const r1 = jeu.retourner(0);
  check(r1.etat === "premiere" && jeu.carte(0).retournee, "1re carte retournee");

  const r2 = jeu.retourner(1);
  check(r2.etat === "paire", "calcul + bon resultat : paire detectee");
  check(jeu.carte(0).trouvee && jeu.carte(1).trouvee, "les deux cartes de la paire sont trouvees");
  check(jeu.pairesTrouvees() === 1, "compteur de paires +1");
  check(jeu.selection().length === 0, "la selection est videe apres une paire");
}

/* --- 8c. Mauvaise paire : aucune penalite, recachees via resoudre() --- */
{
  const jeu = memoryFixe();
  jeu.retourner(0); /* "2 × 3" */
  const r = jeu.retourner(3); /* "20" -> ne correspond pas */
  check(r.etat === "rate", "calcul + mauvais resultat : rate");
  check(jeu.carte(0).retournee && jeu.carte(3).retournee, "les deux restent visibles avant resolution");
  check(jeu.pairesTrouvees() === 0, "mauvaise paire : AUCUNE paire gagnee");
  check(!jeu.estTermine(), "mauvaise paire : la partie continue (pas d'echec)");
  check(jeu.enAttenteResolution(), "on est en attente de resolution");

  /* Un 3e clic est ignore tant que la mauvaise paire n'est pas resolue. */
  const bloque = jeu.retourner(2);
  check(bloque.etat === "ignore", "clic ignore tant que la mauvaise paire n'est pas recachee");

  const recachees = jeu.resoudre();
  check(recachees.length === 2, "resoudre() recache les deux cartes");
  check(!jeu.carte(0).retournee && !jeu.carte(3).retournee, "apres resolution : de nouveau cachees");
  check(!jeu.enAttenteResolution(), "plus d'attente apres resolution");

  /* On peut rejouer normalement ensuite. */
  const rejoue = jeu.retourner(2);
  check(rejoue.etat === "premiere", "on peut rejouer apres avoir recache");
}

/* --- 8d. Fin de partie : toutes les paires trouvees --- */
{
  const jeu = memoryFixe();
  jeu.retourner(0);
  jeu.retourner(1); /* paire 0 */
  check(!jeu.estTermine(), "une paire sur deux : pas encore fini");
  jeu.retourner(2);
  jeu.retourner(3); /* paire 1 */
  check(jeu.estTermine(), "toutes les paires trouvees : partie terminee");
  check(jeu.pairesTrouvees() === jeu.nbPaires(), "compteur = nombre total de paires");

  /* Apres la fin, plus aucun clic n'a d'effet. */
  const apres = jeu.retourner(0);
  check(apres.etat === "ignore", "apres la fin : clics ignores");
}

/* --- 8e. Robustesse : cartes deja vues, id inexistant --- */
{
  const jeu = memoryFixe();
  jeu.retourner(0);
  check(jeu.retourner(0).etat === "ignore", "recliquer la meme carte retournee : ignore");
  check(jeu.retourner(999).etat === "ignore", "id inexistant : ignore proprement");
}

/* --- 8f. Bonus cosmetique et interface --- */
{
  const jeu = memoryFixe();
  const base = minigames.MEMORY.BONUS_BASE;
  check(jeu.bonus() === base, "bonus initial = bonus de base");
  jeu.retourner(0);
  jeu.retourner(1);
  check(jeu.bonus() === base + minigames.MEMORY.BONUS_PAR_PAIRE, "bonus croit d'un cran par paire trouvee");

  const noms = minigames.liste().map((j) => j.id);
  check(noms.includes("memory-tables"), "le memory des tables est enregistre dans le registre reel");
  check(noms.includes("chasse-nombres"), "la chasse aux nombres reste enregistree (deux vrais mini-jeux)");
  const jeuDef = minigames.MINIGAME_MEMORY;
  check(
    Boolean(jeuDef.id && jeuDef.nom && typeof jeuDef.monter === "function"),
    "MINIGAME_MEMORY respecte l'interface commune {id, nom, monter}",
  );
}

/* ============================================================
   9. MINI-JEU : LE PUZZLE DE LA CARTE (logique pure + persistance)
   ============================================================ */

/* --- 9a. Deblocage : une piece de plus a chaque declenchement --- */
{
  let prog = minigames.progressionVierge({ rows: 3, cols: 3 });
  check(prog.total === 9 && prog.debloquees.length === 0, "progression vierge : 9 pieces, 0 debloquee");

  const d1 = minigames.debloquerPiece(prog, () => 0);
  check(d1.progression.debloquees.length === 1, "1er declenchement : 1 piece debloquee");
  check(prog.debloquees.length === 0, "debloquerPiece ne modifie pas l'entree (immuable)");
  check(typeof d1.piece === "number", "l'id de la piece debloquee est renvoye");

  /* Debloque toutes les pieces une par une : jamais de doublon. */
  let p = minigames.progressionVierge({ rows: 3, cols: 3 });
  const vues = new Set();
  for (let i = 0; i < 9; i += 1) {
    const d = minigames.debloquerPiece(p, Math.random);
    p = d.progression;
    check(!vues.has(d.piece), `piece ${d.piece} debloquee une seule fois (tour ${i + 1})`);
    vues.add(d.piece);
  }
  check(p.debloquees.length === 9, "apres 9 declenchements : toutes les pieces debloquees");
  const dExtra = minigames.debloquerPiece(p, Math.random);
  check(dExtra.piece === null && dExtra.progression.debloquees.length === 9, "tout debloque : plus rien a debloquer (piece=null)");
}

/* --- 9b. Placement : bon emplacement uniquement, sans penalite --- */
{
  /* Pieces 0 et 2 debloquees (pas la 1). */
  const jeu = minigames.creerPuzzle({ rows: 3, cols: 3, total: 9, debloquees: [0, 2], placees: [], complet: false });
  check(jeu.enBac().length === 2, "2 pieces debloquees non posees dans le bac");

  const bon = jeu.placer(0, 0);
  check(bon.ok === true && jeu.estPlacee(0), "piece 0 sur le slot 0 : bien placee");
  check(jeu.enBac().length === 1, "une piece de moins dans le bac apres placement");

  const mauvais = jeu.placer(2, 5);
  check(mauvais.ok === false && !jeu.estPlacee(2), "piece 2 sur un mauvais slot : refusee (revient au bac)");
  check(jeu.enBac().includes(2), "la piece mal placee reste disponible dans le bac (aucune penalite)");

  const verrou = jeu.placer(1, 1);
  check(verrou.ok === false, "on ne peut pas placer une piece non debloquee");

  const occupe = jeu.placer(2, 0);
  check(occupe.ok === false, "on ne peut pas poser sur un slot deja occupe");

  const rejoue = jeu.placer(0, 0);
  check(rejoue.ok === false, "une piece deja posee ne se repose pas");
}

/* --- 9c. Completion : toutes les pieces debloquees et placees --- */
{
  const jeu = minigames.creerPuzzle({
    rows: 3, cols: 3, total: 9,
    debloquees: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    placees: [0, 1, 2, 3, 4, 5, 6, 7],
    complet: false,
  });
  check(!jeu.estComplet(), "8 pieces sur 9 : pas encore complet");
  const fin = jeu.placer(8, 8);
  check(fin.ok === true && fin.complet === true && jeu.estComplet(), "derniere piece posee : puzzle complet");
  check(jeu.placer(0, 0).ok === false, "puzzle complet : plus aucun placement");
}

/* --- 9d. Persistance : la progression survit a une re-serialisation --- */
{
  /* Simule le cycle localStorage : on serialise l'etat, on le relit dans une
     nouvelle instance (comme au rechargement de page). */
  let prog = minigames.progressionVierge({ rows: 3, cols: 3 });
  prog = minigames.debloquerPiece(prog, () => 0).progression; /* debloque piece 0 */
  let jeu = minigames.creerPuzzle(prog);
  jeu.placer(0, 0);
  const sauvegarde = JSON.parse(JSON.stringify(jeu.progression())); /* == ce qu'on ecrit en localStorage */

  const jeuRecharge = minigames.creerPuzzle(sauvegarde);
  check(jeuRecharge.estPlacee(0), "apres rechargement : la piece placee est conservee");
  check(jeuRecharge.debloquees().length === 1, "apres rechargement : les pieces debloquees sont conservees");
  check(jeuRecharge.placeesSession() === 0, "le compteur de session repart a 0 a chaque instance");

  /* Le declenchement suivant debloque une piece de PLUS, sans perdre l'acquis. */
  const suite = minigames.debloquerPiece(sauvegarde, Math.random);
  check(suite.progression.debloquees.length === 2, "declenchement suivant : +1 piece, progression conservee");
  check(suite.progression.placees.length === 1, "la piece deja placee reste placee au declenchement suivant");
}

/* --- 9e. Bonus cosmetique et interface --- */
{
  const jeu = minigames.creerPuzzle({ rows: 3, cols: 3, total: 9, debloquees: [0, 1], placees: [], complet: false });
  check(jeu.bonus() === minigames.PUZZLE.BONUS_BASE, "bonus initial = base (aucune piece posee dans la session)");
  jeu.placer(0, 0);
  check(jeu.bonus() === minigames.PUZZLE.BONUS_BASE + minigames.PUZZLE.BONUS_PAR_PIECE, "bonus +1 cran par piece posee");

  const presqueFini = minigames.creerPuzzle({
    rows: 3, cols: 3, total: 9,
    debloquees: [0, 1, 2, 3, 4, 5, 6, 7, 8], placees: [0, 1, 2, 3, 4, 5, 6, 7], complet: false,
  });
  presqueFini.placer(8, 8);
  check(
    presqueFini.bonus() === minigames.PUZZLE.BONUS_BASE + minigames.PUZZLE.BONUS_PAR_PIECE + minigames.PUZZLE.BONUS_COMPLETION,
    "completer le puzzle ajoute la prime de completion",
  );

  const noms = minigames.liste().map((j) => j.id);
  check(noms.includes("puzzle-carte"), "le puzzle de la carte est enregistre dans le registre reel");
  check(noms.includes("chasse-nombres") && noms.includes("memory-tables"), "chasse et memory restent enregistres aux cotes du puzzle");
  const jeuDef = minigames.MINIGAME_PUZZLE;
  check(
    Boolean(jeuDef.id && jeuDef.nom && typeof jeuDef.monter === "function"),
    "MINIGAME_PUZZLE respecte l'interface commune {id, nom, monter}",
  );
}

/* ============================================================
   10. MINI-JEU : LA DECORATION / PETIT JARDIN (logique pure)
   ============================================================ */

/* --- 10a. Deblocage des objets selon le seuil d'etoiles cumulees --- */
{
  /* Meme regle que le personnage : total >= cout. */
  const fleurs = minigames.objetDeco("fleurs"); /* cout 10 */
  const fontaine = minigames.objetDeco("fontaine"); /* cout 100 */
  check(minigames.estDebloqueDeco(fleurs, 10) === true, "seuil atteint (10>=10) : objet debloque");
  check(minigames.estDebloqueDeco(fleurs, 9) === false, "sous le seuil (9<10) : objet verrouille");
  check(minigames.estDebloqueDeco(fontaine, 100) === true, "fontaine debloquee a 100 etoiles");
  check(minigames.estDebloqueDeco(fontaine, 99) === false, "fontaine verrouillee a 99 etoiles");

  check(minigames.etoilesRestantesDeco(fontaine, 60) === 40, "etoiles restantes = cout - total (40)");
  check(minigames.etoilesRestantesDeco(fleurs, 999) === 0, "objet deja debloque : 0 etoile restante");

  const debloques = minigames.objetsDebloquesDeco(30); /* fleurs(10), buisson(25) */
  check(debloques.includes("fleurs") && debloques.includes("buisson"), "a 30 etoiles : fleurs et buisson debloques");
  check(!debloques.includes("arbre") && !debloques.includes("fontaine"), "a 30 etoiles : arbre (50) et fontaine (100) verrouilles");
  check(minigames.objetsDebloquesDeco(0).length === 0, "a 0 etoile : aucun objet (le moins cher coute 10)");
  check(minigames.objetsDebloquesDeco(1000).length === minigames.DECO.CATALOGUE.length, "avec beaucoup d'etoiles : tout est debloque");
}

/* --- 10b. Placement d'un objet (uniquement si debloque, sur un slot valide) --- */
{
  const deco = minigames.creerDeco({});
  check(deco.estVide(), "jardin neuf : vide");

  check(deco.placer(0, "fleurs", 10) === true, "place fleurs (debloque) sur l'emplacement 0");
  check(deco.objetSur(0) === "fleurs", "l'emplacement 0 porte bien les fleurs");
  check(deco.nbPlaces() === 1, "un objet place");

  check(deco.placer(1, "fontaine", 30) === false, "refuse un objet verrouille (fontaine a 30 etoiles)");
  check(deco.objetSur(1) === null, "l'emplacement reste vide apres un refus");

  check(deco.placer(99, "fleurs", 999) === false, "refuse un emplacement hors grille");
  check(deco.placer(0, "inconnu", 999) === false, "refuse un objet inconnu");

  /* Reposer sur un emplacement occupe : remplace (amenagement libre). */
  check(deco.placer(0, "buisson", 30) === true, "remplace l'objet d'un emplacement occupe");
  check(deco.objetSur(0) === "buisson", "l'emplacement 0 porte maintenant le buisson");
  check(deco.nbPlaces() === 1, "toujours un seul objet sur cet emplacement");
}

/* --- 10c. Retrait d'un objet --- */
{
  const deco = minigames.creerDeco({ 0: "arbre", 2: "banc" });
  check(deco.nbPlaces() === 2, "disposition initiale : 2 objets");
  check(deco.retirer(0) === "arbre", "retirer renvoie l'objet enleve");
  check(deco.objetSur(0) === null, "l'emplacement est vide apres retrait");
  check(deco.nbPlaces() === 1, "un objet de moins");
  check(deco.retirer(5) === null, "retirer un emplacement vide : rien (null)");
}

/* --- 10d. Persistance de la disposition (round-trip serialisation) --- */
{
  const deco = minigames.creerDeco({});
  deco.placer(0, "fleurs", 200);
  deco.placer(4, "fontaine", 200);
  const sauvegarde = JSON.parse(JSON.stringify({ disposition: deco.disposition() })); /* == localStorage */

  const recharge = minigames.creerDeco(sauvegarde.disposition);
  check(recharge.objetSur(0) === "fleurs" && recharge.objetSur(4) === "fontaine", "apres rechargement : disposition conservee");
  check(recharge.nbPlaces() === 2, "apres rechargement : bon nombre d'objets");

  /* Une disposition bricolee (slot invalide, objet inconnu) est nettoyee. */
  const sale = minigames.creerDeco({ 0: "arbre", 99: "arbre", 2: "pas-un-objet" });
  check(sale.objetSur(0) === "arbre", "entree valide conservee");
  check(sale.nbPlaces() === 1, "emplacement hors grille et objet inconnu ignores au chargement");
}

/* --- 10e. Interface et enregistrement --- */
{
  const noms = minigames.liste().map((j) => j.id);
  check(noms.includes("deco-jardin"), "la decoration est enregistree dans le registre reel");
  check(minigames.liste().length === 4, "quatre vrais mini-jeux enregistres (chasse, memory, puzzle, deco)");
  const jeuDef = minigames.MINIGAME_DECO;
  check(
    Boolean(jeuDef.id && jeuDef.nom && typeof jeuDef.monter === "function"),
    "MINIGAME_DECO respecte l'interface commune {id, nom, monter}",
  );
}

/* --- 11. Eligibilite par niveau : choisir() ne tire que parmi les jeux
       eligibles pour le niveau (P1) --- */
{
  const reg = minigames.creerRegistre();
  /* petit : tous niveaux. grand : reserve aux CE3+ (rang >= 3). */
  const petit = { id: "petit", nom: "Petit", monter() {} };
  const grand = { id: "grand", nom: "Grand", monter() {}, estEligible: (n) => minigames.niveauRang(n) >= 3 };
  reg.enregistrer(petit);
  reg.enregistrer(grand);

  check(reg.eligibles("CE1").length === 1, "CE1 : un seul jeu eligible (le reserve est ecarte)");
  check(reg.eligibles("CE1")[0].id === "petit", "CE1 : c'est bien le jeu tous-niveaux");
  check(reg.eligibles("CE6").length === 2, "CE6 : les deux jeux sont eligibles");

  /* Au CE1, meme un tirage haut (0.99) ne peut pas donner le jeu reserve :
     le pool ne contient que les eligibles. */
  let vuGrandEnCE1 = false;
  for (const t of [0, 0.25, 0.5, 0.75, 0.99]) {
    if (reg.choisir(() => t, "CE1").id === "grand") vuGrandEnCE1 = true;
  }
  check(!vuGrandEnCE1, "CE1 : le jeu reserve aux grands ne sort jamais");
  check(reg.choisir(() => 0.99, "CE6").id === "grand", "CE6 : le jeu reserve peut sortir");

  /* Un jeu SANS estEligible passe toujours (compatibilite), y compris niveau
     inconnu ; un jeu AVEC estEligible tranche lui-meme (ici grand: rang>=3, donc
     ecarte pour undefined). C'est cette regle qui garde les 4 vrais mini-jeux
     (sans estEligible) proposables partout. */
  check(reg.eligibles(undefined).some((j) => j.id === "petit"), "niveau inconnu : le jeu sans estEligible passe toujours");
  check(!reg.eligibles(undefined).some((j) => j.id === "grand"), "niveau inconnu : le jeu a estEligible suit son propre verdict");
}

/* --- 12. Les 4 vrais mini-jeux restent eligibles a TOUS les niveaux : aucun
       n'est retire (le memory s'adapte au lieu d'etre exclu) --- */
{
  for (const niveau of ["CE1", "CE2", "CE3", "CE6"]) {
    check(
      minigames.liste().length === 4 && minigames.liste().every((j) => typeof j.estEligible !== "function" || j.estEligible(niveau)),
      `${niveau} : les 4 mini-jeux restent proposables`,
    );
  }
}

/* --- 13. Memory : contenu ADDITION pour CE1/CE2, MULTIPLICATION pour CE3+ --- */
{
  const seed = () => {
    let x = 42;
    return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  };

  const ce1 = minigames.genererPaires(seed(), minigames.reglagesMemory("CE1"));
  const calculsCE1 = ce1.cartes.filter((c) => c.face === "calcul").map((c) => c.texte);
  check(calculsCE1.every((t) => t.includes("+")), "CE1 : le memory n'utilise QUE des additions");
  check(calculsCE1.every((t) => !t.includes("×")), "CE1 : aucune multiplication au memory");
  /* CE1 sans retenue : toutes les sommes <= 10. */
  check(
    ce1.cartes.filter((c) => c.face === "resultat").every((c) => c.valeur <= 10),
    "CE1 : sommes bornees a 10 (sans retenue)",
  );

  const ce2 = minigames.genererPaires(seed(), minigames.reglagesMemory("CE2"));
  check(
    ce2.cartes.filter((c) => c.face === "calcul").every((t) => t.texte.includes("+")),
    "CE2 : le memory utilise des additions",
  );
  check(
    ce2.cartes.filter((c) => c.face === "resultat").every((c) => c.valeur <= 18),
    "CE2 : sommes bornees a 18",
  );

  const ce3 = minigames.genererPaires(seed(), minigames.reglagesMemory("CE3"));
  check(
    ce3.cartes.filter((c) => c.face === "calcul").every((t) => t.texte.includes("×")),
    "CE3 : le memory revient aux multiplications (tables au programme)",
  );

  /* Sans niveau : comportement d'origine (multiplication). */
  const defaut = minigames.genererPaires(seed());
  check(
    defaut.cartes.filter((c) => c.face === "calcul").every((t) => t.texte.includes("×")),
    "sans niveau : multiplication par defaut (compatibilite)",
  );
}

/* --- 14. Chasse : moins d'elements et plus de temps pour les petits (P4),
       plage de nombres coherente avec l'age (P1) --- */
{
  const ce1 = minigames.reglagesChasse("CE1");
  const ce2 = minigames.reglagesChasse("CE2");
  check(ce1.NB_NOMBRES < minigames.CHASSE.NB_NOMBRES, "CE1 : moins de nombres a surveiller que par defaut");
  check(ce1.DUREE_MS > minigames.CHASSE.DUREE_MS, "CE1 : plus de temps que par defaut");
  check(ce1.VALEUR_MAX <= 10, "CE1 : plage de nombres courte (<= 10)");
  check(ce2.VALEUR_MAX <= 20 && ce2.NB_NOMBRES < minigames.CHASSE.NB_NOMBRES, "CE2 : plage et nombre intermediaires");
  check(Object.keys(minigames.reglagesChasse("CE5")).length === 0, "CE5 : reglages d'origine (aucune surcharge)");

  /* La config reellement generee respecte la plage bornee au CE1. */
  const config = minigames.genererConfig(Math.random, minigames.reglagesChasse("CE1"));
  check(config.nombres.length === ce1.NB_NOMBRES, "CE1 : la config genere bien 6 nombres");
  check(config.nombres.every((n) => n.valeur >= 1 && n.valeur <= 10), "CE1 : toutes les valeurs generees sont dans 1..10");
  check(config.dureeMs === ce1.DUREE_MS, "CE1 : la duree suit le reglage (22 s)");
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
