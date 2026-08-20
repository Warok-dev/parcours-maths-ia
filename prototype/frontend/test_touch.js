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

/* --- 5. Cablage du pave : maintien = presser, relachement = relacher --- */
{
  /* Faux bouton avec data-dir et un mini systeme d'evenements. */
  function fauxBouton(dir) {
    return {
      dataset: { dir },
      listeners: {},
      classes: new Set(),
      classList: {
        add(c) {
          /* mappe sur l'ensemble du bouton parent */
        },
      },
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      dispatch(type, event) {
        this.listeners[type]?.(event || { preventDefault() {} });
      },
    };
  }
  /* classList reel simule (add/remove/contains) pour verifier l'etat "actif". */
  function boutonAvecClasses(dir) {
    const set = new Set();
    return {
      dataset: { dir },
      listeners: {},
      classList: {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
      },
      addEventListener(type, fn) {
        this.listeners[type] = fn;
      },
      dispatch(type) {
        this.listeners[type]?.({ preventDefault() {} });
      },
    };
  }

  const btnUp = boutonAvecClasses("ArrowUp");
  const btnBad = boutonAvecClasses("KeyZ"); /* direction inconnue : ignoree */
  const container = {
    querySelectorAll: () => [btnUp, btnBad],
  };
  const presses = [];
  const relaches = [];
  touch.brancherDpad(container, {
    presser: (d) => presses.push(d),
    relacher: (d) => relaches.push(d),
  });

  btnUp.dispatch("pointerdown");
  check(presses.length === 1 && presses[0] === "ArrowUp", "pointerdown : presser('ArrowUp')");
  check(btnUp.classList.contains("actif"), "bouton marque 'actif' pendant l'appui");
  btnUp.dispatch("pointerup");
  check(relaches.length === 1 && relaches[0] === "ArrowUp", "pointerup : relacher('ArrowUp')");
  check(!btnUp.classList.contains("actif"), "bouton n'est plus 'actif' apres relachement");

  /* pointerleave relache aussi (doigt qui glisse hors du bouton). */
  btnUp.dispatch("pointerdown");
  btnUp.dispatch("pointerleave");
  check(relaches.length === 2, "pointerleave relache aussi (jamais coince en appui)");

  /* Un relachement sans appui prealable ne declenche rien (garde 'actif'). */
  const avant = relaches.length;
  btnUp.dispatch("pointerup");
  check(relaches.length === avant, "relachement sans appui : ignore");

  /* La direction inconnue n'a recu aucun ecouteur. */
  check(Object.keys(btnBad.listeners).length === 0, "bouton a direction inconnue : non cable");
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
