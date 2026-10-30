/* ============================================================
   CONTROLES TACTILES (tablette / mobile)
   ------------------------------------------------------------
   Detecte les appareils tactiles et cable un JOYSTICK analogique a
   l'ecran (direction libre, vitesse selon l'inclinaison). Le jeu
   (carte/boucle.js) lit state.joystick en plus du clavier. Le desktop
   garde le clavier comme controle principal : rien ne s'affiche.

   Le COEUR (detection, decisions de visibilite) est PUR et sans DOM,
   donc testable en Node (test_touch.js) avec un matchMedia injecte.
   ============================================================ */
(function () {
  /* Touches flechees reconnues : miroir de le jeu (carte/) (state.keysPressed). */
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

  /* ---------- Joystick analogique (coeur pur) ----------
     Remplace l'ancien pave de 4 fleches : la direction est libre (360 degres)
     et la vitesse suit l'inclinaison (petit geste = marche, grand geste =
     course), comme une manette. `dx, dy` : decalage du doigt par rapport au
     centre du joystick, en pixels. Renvoie la direction unitaire (x, y), la
     force (0..1, zone morte au centre pour ne pas trembler) et la position du
     bouton (borne au rayon) pour l'affichage. */
  const JOYSTICK = { RAYON: 56, ZONE_MORTE: 0.15 };

  function vecteurJoystick(dx, dy, rayon = JOYSTICK.RAYON, zoneMorte = JOYSTICK.ZONE_MORTE) {
    const distance = Math.hypot(Number(dx) || 0, Number(dy) || 0);
    if (!rayon || distance === 0) {
      return { x: 0, y: 0, force: 0, boutonX: 0, boutonY: 0 };
    }
    const borne = Math.min(distance, rayon);
    const ux = dx / distance;
    const uy = dy / distance;
    const brute = borne / rayon;
    const force = brute <= zoneMorte ? 0 : (brute - zoneMorte) / (1 - zoneMorte);
    return {
      x: force ? ux : 0,
      y: force ? uy : 0,
      force,
      boutonX: ux * borne,
      boutonY: uy * borne,
    };
  }

  /* ---------- Cablage DOM du joystick ----------
     `zone` : grande surface invisible (bas-gauche de l'ecran) ; `base` et
     `bouton` : le joystick dessine. Joystick FLOTTANT : au repos il est visible
     a sa place (l'enfant voit ou poser le doigt) ; un appui n'importe ou dans
     la zone l'amene sous le pouce, puis glisser oriente le personnage.
     Un seul doigt suivi (pointerId) : les autres touches (bouton d'action,
     menu) restent libres. Relacher, sortir de l'ecran ou une annulation du
     navigateur arretent toujours le personnage. */
  function brancherJoystick({ zone, base, bouton, rayon = JOYSTICK.RAYON } = {}, { changer, relacher } = {}) {
    if (!zone || !base || !bouton || typeof zone.addEventListener !== "function") {
      return { reinitialiser() {} };
    }
    let doigt = null;
    let centre = null;

    function placerBouton(x, y) {
      bouton.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }

    function reinitialiser() {
      doigt = null;
      centre = null;
      base.classList.remove("actif");
      base.style.left = "";
      base.style.top = "";
      placerBouton(0, 0);
      if (typeof relacher === "function") relacher();
    }

    function suivre(event) {
      const v = vecteurJoystick(event.clientX - centre.x, event.clientY - centre.y, rayon);
      placerBouton(v.boutonX, v.boutonY);
      if (typeof changer === "function") changer(v);
    }

    zone.addEventListener("pointerdown", (event) => {
      if (doigt !== null) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      doigt = event.pointerId;
      zone.setPointerCapture?.(event.pointerId);
      /* Le joystick vient sous le pouce (coordonnees relatives a la zone). */
      const cadre = zone.getBoundingClientRect ? zone.getBoundingClientRect() : { left: 0, top: 0 };
      centre = { x: event.clientX, y: event.clientY };
      base.style.left = `${event.clientX - cadre.left}px`;
      base.style.top = `${event.clientY - cadre.top}px`;
      base.classList.add("actif");
      suivre(event);
    });
    zone.addEventListener("pointermove", (event) => {
      if (event.pointerId !== doigt || !centre) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      suivre(event);
    });
    const fin = (event) => {
      if (event.pointerId !== doigt) return;
      reinitialiser();
    };
    zone.addEventListener("pointerup", fin);
    zone.addEventListener("pointercancel", fin);
    zone.addEventListener("lostpointercapture", fin);
    zone.addEventListener("contextmenu", (event) => event.preventDefault());

    return { reinitialiser, actif: () => doigt !== null };
  }

  const api = {
    DIRECTIONS,
    JOYSTICK,
    estTactile,
    dpadVisible,
    actionVisible,
    appliquerVisibilite,
    vecteurJoystick,
    brancherJoystick,
  };

  if (typeof window !== "undefined") {
    window.ParcoursTouch = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
