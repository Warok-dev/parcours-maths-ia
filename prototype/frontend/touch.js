/* ============================================================
   CONTROLES TACTILES (tablette / mobile)
   ------------------------------------------------------------
   Detecte les appareils tactiles et cable un pave directionnel a
   l'ecran sur les MEMES entrees que le clavier (map.js lit
   state.keysPressed ; ici on ne fait qu'ajouter/retirer les memes
   chaines "ArrowUp"/... au pointerdown/up). Le desktop garde le
   clavier comme controle principal : rien ne s'affiche.

   Le COEUR (detection, decisions de visibilite) est PUR et sans DOM,
   donc testable en Node (test_touch.js) avec un matchMedia injecte.
   ============================================================ */
(function () {
  /* Touches flechees reconnues : miroir de map.js (state.keysPressed). */
  const DIRECTIONS = { ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true };

  /* ---------- Detection (pure, matchMedia injectable) ----------
     Tactile si le pointeur principal est "coarse" (doigt) OU s'il n'y a pas
     de survol possible (hover: none) : couvre les tablettes/telephones sans
     souris. Un desktop avec ecran tactile (coarse=false, hover=hover) reste
     en mode clavier, ce qui est le comportement voulu. */
  function estTactile(matchMediaFn) {
    const fn =
      typeof matchMediaFn === "function"
        ? matchMediaFn
        : typeof window !== "undefined" && typeof window.matchMedia === "function"
          ? window.matchMedia.bind(window)
          : null;
    if (!fn) {
      return false;
    }
    try {
      const coarse = fn("(pointer: coarse)");
      const noHover = fn("(hover: none)");
      return Boolean((coarse && coarse.matches) || (noHover && noHover.matches));
    } catch (_error) {
      return false;
    }
  }

  /* ---------- Decisions de visibilite (pures) ----------
     Le pave n'apparait que sur appareil tactile, en jeu, hors popup d'exercice
     (sinon il flotterait par-dessus la modale). Le bouton d'action s'ajoute a
     ces conditions la presence d'un obstacle/fanion a portee. */
  function dpadVisible({ actif, enJeu, panneauOuvert } = {}) {
    return Boolean(actif) && Boolean(enJeu) && !panneauOuvert;
  }
  function actionVisible({ actif, enJeu, panneauOuvert, presObstacle } = {}) {
    return dpadVisible({ actif, enJeu, panneauOuvert }) && Boolean(presObstacle);
  }

  /* Applique la visibilite a un noeud via la classe "hidden" (toggle testable
     avec un faux noeud { classList: { toggle } }). */
  function appliquerVisibilite(node, visible) {
    if (node && node.classList && typeof node.classList.toggle === "function") {
      node.classList.toggle("hidden", !visible);
    }
  }

  /* ---------- Cablage DOM du pave directionnel ----------
     Pour chaque bouton [data-dir], maintien = presser(dir), relachement =
     relacher(dir). On utilise les Pointer Events (touch + souris unifies) et on
     previent le comportement par defaut (scroll, double-tap zoom, menu
     contextuel du maintien). pointerleave/cancel relachent aussi : un doigt qui
     glisse hors du bouton ne reste jamais "coince" en appui. */
  function brancherDpad(container, { presser, relacher } = {}) {
    if (!container || typeof container.querySelectorAll !== "function") {
      return;
    }
    const boutons = Array.prototype.slice.call(container.querySelectorAll("[data-dir]"));
    boutons.forEach((btn) => {
      const dir = btn.dataset ? btn.dataset.dir : btn.getAttribute && btn.getAttribute("data-dir");
      if (!DIRECTIONS[dir]) {
        return;
      }
      const presse = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        btn.classList.add("actif");
        if (typeof presser === "function") presser(dir);
      };
      const relache = (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (!btn.classList.contains("actif")) return;
        btn.classList.remove("actif");
        if (typeof relacher === "function") relacher(dir);
      };
      btn.addEventListener("pointerdown", presse);
      btn.addEventListener("pointerup", relache);
      btn.addEventListener("pointercancel", relache);
      btn.addEventListener("pointerleave", relache);
      btn.addEventListener("contextmenu", (event) => event.preventDefault());
    });
  }

  const api = {
    DIRECTIONS,
    estTactile,
    dpadVisible,
    actionVisible,
    appliquerVisibilite,
    brancherDpad,
  };

  if (typeof window !== "undefined") {
    window.ParcoursTouch = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
