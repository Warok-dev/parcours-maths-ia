/* Tests des controles tactiles (touch.js).
   Lancer avec : node test_touch.js
   Couvre : la detection d'appareil tactile (matchMedia injecte), les decisions
   de visibilite du pave/bouton, et le cablage du pave sur des faux noeuds. */
const touch = require("./touch.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* Faux matchMedia : renvoie matches selon une table {requete: bool}. */
function fakeMatchMedia(table) {
  return (query) => ({ matches: Boolean(table[query]) });
}

/* --- 1. Detection d'appareil tactile --- */
{
  const coarse = fakeMatchMedia({ "(pointer: coarse)": true, "(hover: none)": true });
  check(touch.estTactile(coarse) === true, "pointeur coarse + hover none : tactile");

  const fin = fakeMatchMedia({ "(pointer: coarse)": false, "(hover: none)": false });
  check(touch.estTactile(fin) === false, "pointeur fin + survol : non tactile (desktop)");

  /* Tablette detectee par l'un OU l'autre des deux signaux. */
  const coarseSeul = fakeMatchMedia({ "(pointer: coarse)": true, "(hover: none)": false });
  check(touch.estTactile(coarseSeul) === true, "coarse seul suffit");
  const hoverSeul = fakeMatchMedia({ "(pointer: coarse)": false, "(hover: none)": true });
  check(touch.estTactile(hoverSeul) === true, "hover:none seul suffit");

  check(touch.estTactile(null) === false, "matchMedia absent : non tactile (pas de crash)");
  check(touch.estTactile(undefined) === false, "matchMedia undefined : non tactile");
  const casse = () => {
    throw new Error("boom");
  };
  check(touch.estTactile(casse) === false, "matchMedia qui leve : non tactile (avale l'erreur)");
}

/* --- 2. Visibilite du pave directionnel --- */
{
  check(
    touch.dpadVisible({ actif: true, enJeu: true, panneauOuvert: false }) === true,
    "tactile + en jeu + pas de popup : pave visible",
  );
  check(
    touch.dpadVisible({ actif: false, enJeu: true, panneauOuvert: false }) === false,
    "non tactile : pave jamais visible (desktop garde le clavier)",
  );
  check(
    touch.dpadVisible({ actif: true, enJeu: false, panneauOuvert: false }) === false,
    "hors jeu (menu) : pave masque",
  );
  check(
    touch.dpadVisible({ actif: true, enJeu: true, panneauOuvert: true }) === false,
    "popup d'exercice ouverte : pave masque",
  );
}

/* --- 3. Visibilite du bouton d'action --- */
{
  check(
    touch.actionVisible({ actif: true, enJeu: true, panneauOuvert: false, presObstacle: true }) === true,
    "pres d'un obstacle : bouton d'action visible",
  );
  check(
    touch.actionVisible({ actif: true, enJeu: true, panneauOuvert: false, presObstacle: false }) === false,
    "loin de tout obstacle : bouton d'action masque",
  );
  check(
    touch.actionVisible({ actif: true, enJeu: true, panneauOuvert: true, presObstacle: true }) === false,
    "popup ouverte : bouton d'action masque meme pres d'un obstacle",
  );
  check(
    touch.actionVisible({ actif: false, enJeu: true, panneauOuvert: false, presObstacle: true }) === false,
    "non tactile : bouton d'action jamais visible",
  );
}

/* --- 4. Application de la visibilite (toggle "hidden" sur un noeud) --- */
{
  function fauxNoeud() {
    return {
      hidden: false,
      classList: {
        _set: new Set(),
        toggle(cls, force) {
          const veut = force === undefined ? !this._set.has(cls) : force;
          if (veut) this._set.add(cls);
          else this._set.delete(cls);
          return veut;
        },
        contains(cls) {
          return this._set.has(cls);
        },
      },
    };
  }
  const node = fauxNoeud();
  touch.appliquerVisibilite(node, true);
  check(node.classList.contains("hidden") === false, "visible : la classe hidden est retiree");
  touch.appliquerVisibilite(node, false);
  check(node.classList.contains("hidden") === true, "invisible : la classe hidden est ajoutee");
  /* Ne crashe pas sur un noeud absent. */
  let sansCrash = true;
  try {
    touch.appliquerVisibilite(null, true);
    touch.appliquerVisibilite(undefined, false);
  } catch (_e) {
    sansCrash = false;
  }
  check(sansCrash, "noeud absent : appliquerVisibilite ne crashe pas");
}

/* --- 5. Joystick analogique : direction libre, force selon l'inclinaison --- */
{
  const R = touch.JOYSTICK.RAYON;
  const haut = touch.vecteurJoystick(0, -R);
  check(haut.x === 0 && haut.y === -1 && haut.force === 1, "pousse a fond vers le haut : direction (0,-1), force 1");
  const diag = touch.vecteurJoystick(R, R);
  check(Math.abs(diag.x - Math.SQRT1_2) < 1e-9 && Math.abs(diag.y - Math.SQRT1_2) < 1e-9, "diagonale : direction libre (pas seulement 4 fleches)");
  const oblique = touch.vecteurJoystick(R * 0.9, -R * 0.3);
  check(oblique.x > 0 && oblique.y < 0 && Math.abs(Math.hypot(oblique.x, oblique.y) - 1) < 1e-9, "angle quelconque : direction unitaire conservee");
  const leger = touch.vecteurJoystick(R * 0.5, 0);
  check(leger.force > 0 && leger.force < 1, "petit geste : force intermediaire (marche lente)");
  const centre = touch.vecteurJoystick(R * 0.1, 0);
  check(centre.force === 0 && centre.x === 0, "zone morte au centre : le personnage ne tremble pas");
  const loin = touch.vecteurJoystick(R * 4, 0);
  check(loin.force === 1 && loin.boutonX === R, "doigt hors du joystick : force 1, bouton borne au bord");
  check(touch.vecteurJoystick(0, 0).force === 0, "aucun decalage : aucune force");
}

/* --- 6. Cablage du joystick (faux DOM) --- */
{
  function fauxNoeud() {
    const classes = new Set();
    return {
      style: {},
      listeners: {},
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      getBoundingClientRect: () => ({ left: 0, top: 100 }),
      emit(type, e) { this.listeners[type]?.({ preventDefault() {}, ...e }); },
    };
  }
  const zone = fauxNoeud();
  const base = fauxNoeud();
  const bouton = fauxNoeud();
  const vecteurs = [];
  let relaches = 0;
  const joy = touch.brancherJoystick({ zone, base, bouton }, {
    changer: (v) => vecteurs.push(v),
    relacher: () => { relaches += 1; },
  });
  zone.emit("pointerdown", { pointerId: 1, clientX: 100, clientY: 300 });
  check(base.classList.contains("actif") && base.style.left === "100px" && base.style.top === "200px", "appui : le joystick vient sous le pouce");
  zone.emit("pointermove", { pointerId: 1, clientX: 156, clientY: 300 });
  const dernier = vecteurs[vecteurs.length - 1];
  check(dernier.x === 1 && dernier.force === 1, "glisser a droite : le personnage va a droite a pleine vitesse");
  zone.emit("pointermove", { pointerId: 2, clientX: 0, clientY: 0 });
  check(vecteurs[vecteurs.length - 1] === dernier, "un second doigt n'interfere pas");
  zone.emit("pointerup", { pointerId: 1 });
  check(relaches === 1 && !base.classList.contains("actif") && base.style.left === "", "relacher : arret et retour a la place de repos");
  zone.emit("pointerdown", { pointerId: 3, clientX: 50, clientY: 250 });
  joy.reinitialiser();
  check(relaches === 2 && !joy.actif(), "reinitialiser (popup ouverte) : arret immediat");
  check(touch.brancherJoystick({}, {}).reinitialiser !== undefined, "sans DOM : branchement inoffensif");
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
