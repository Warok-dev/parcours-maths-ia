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
  const propose = orch.conceptDebloque();
  check(propose === true, "concept debloque : proposition affichee");
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

  orch.conceptDebloque();
  /* Deuxieme concept pendant une proposition : pas de double proposition. */
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

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
