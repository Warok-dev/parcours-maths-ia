/* ============================================================
   TRESOR DE LA ROUTE COURTE
   Recompense discrete de l'excellence : un petit coffre pose sur
   le raccourci, celui qu'on n'emprunte QUE lorsque la maitrise 3
   est detectee. Les routes moyenne (maitrise 2) et longue
   (maitrise 1) n'en portent jamais.

   Ce module ne contient que la regle, sans DOM ni geometrie : le
   trace et le rendu restent a map.js, qui possede la scene. La
   table ROUTE_PAR_MAITRISE est la SEULE source de verite du lien
   maitrise -> route, utilisee aussi bien pour dessiner le chemin
   que pour decider du tresor : impossible que le test valide une
   route que le rendu n'emprunte pas.
   ============================================================ */
(function () {
  /* Miroir de reinforcementRouteD (map.js) et de REINFORCEMENT_BY_MASTERY
     cote backend : 3 = raccourci, 2 = route principale, 1 = grand detour. */
  const ROUTE_PAR_MAITRISE = { 1: "longue", 2: "moyenne", 3: "courte" };
  const ROUTE_PAR_DEFAUT = "moyenne";
  /* Une seule route porte un tresor, et c'est la plus courte. */
  const ROUTE_AVEC_TRESOR = "courte";
  const BONUS = 50;
  /* Position le long du trace : les haltes d'entrainement occupent 18 % et
     85 %, le tresor se pose entre les deux, bien en vue. */
  const FRACTION_SUR_ROUTE = 0.5;
  /* Ramassage au contact : plus court que INTERACTION_DISTANCE (118), qui
     sert a ouvrir un exercice. Un tresor se cueille en marchant dessus. */
  const DISTANCE_RAMASSAGE = 52;

  /* Le type est verifie, pas seulement la valeur : les cles d'objet etant
     des chaines en JS, un "3" venu d'ailleurs decrocherait sinon la route
     courte -- et son tresor -- par simple coercition. */
  function routePourMaitrise(maitrise) {
    if (typeof maitrise !== "number") {
      return ROUTE_PAR_DEFAUT;
    }
    return ROUTE_PAR_MAITRISE[maitrise] || ROUTE_PAR_DEFAUT;
  }

  function tresorSurRoute(maitrise) {
    return routePourMaitrise(maitrise) === ROUTE_AVEC_TRESOR;
  }

  /* Un tresor par troncon de concept : la cle suffit a empecher qu'un
     aller-retour sur la meme route le fasse reapparaitre. */
  function cleTresor(session) {
    if (!session || typeof session.concept_index !== "number") {
      return null;
    }
    return `concept-${session.concept_index}`;
  }

  function estRamasse(session, ramasses) {
    const cle = cleTresor(session);
    if (!cle || !ramasses) {
      return false;
    }
    return typeof ramasses.has === "function" ? ramasses.has(cle) : ramasses.includes(cle);
  }

  /* Y a-t-il un tresor a afficher maintenant ? */
  function tresorDisponible(session, ramasses) {
    if (!session || session.terminee) {
      return false;
    }
    if (session.phase !== "renforcement") {
      return false;
    }
    if (!tresorSurRoute(session.maitrise_actuelle)) {
      return false;
    }
    return !estRamasse(session, ramasses);
  }

  function estARamasser(distanceAuTresor) {
    return Number.isFinite(distanceAuTresor) && distanceAuTresor <= DISTANCE_RAMASSAGE;
  }

  const api = {
    ROUTE_PAR_MAITRISE,
    ROUTE_AVEC_TRESOR,
    BONUS,
    FRACTION_SUR_ROUTE,
    DISTANCE_RAMASSAGE,
    routePourMaitrise,
    tresorSurRoute,
    cleTresor,
    estRamasse,
    tresorDisponible,
    estARamasser,
  };

  if (typeof window !== "undefined") {
    window.ParcoursTresor = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
