/* ============================================================
   TRESOR DE L'EXCELLENCE
   Recompense discrete de la chaine parfaite : quand la maitrise 3
   est detectee (guide, semi-guide et autonome reussis du premier
   coup), le renforcement se reduit a UN exercice bonus et un petit
   coffre est pose sur le chemin, juste avant ce fanion. Les
   maitrises 1 et 2 n'en ont jamais.

   Ce module ne contient que la regle, sans DOM ni geometrie : le
   trace et le rendu restent dans carte/monde.js, qui possede la
   scene.
   ============================================================ */
(function () {
  /* Seule la maitrise 3 (autonome du premier coup) gagne un tresor. */
  const MAITRISE_AVEC_TRESOR = 3;
  const BONUS = 50;
  /* Position le long du trace : l'unique fanion bonus est a 50 %, le
     tresor se pose avant, sur le passage de l'eleve. */
  const FRACTION_SUR_ROUTE = 0.3;
  /* Ramassage au contact : plus court que INTERACTION_DISTANCE (118), qui
     sert a ouvrir un exercice. Un tresor se cueille en marchant dessus. */
  const DISTANCE_RAMASSAGE = 52;

  /* Le type est verifie, pas seulement la valeur : un "3" venu d'ailleurs
     ne doit pas decrocher le tresor par simple coercition. */
  function tresorPourMaitrise(maitrise) {
    return typeof maitrise === "number" && maitrise === MAITRISE_AVEC_TRESOR;
  }

  /* Un tresor par troncon de concept : la cle suffit a empecher qu'un
     aller-retour sur le meme troncon le fasse reapparaitre. */
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
    if (!tresorPourMaitrise(session.maitrise_actuelle)) {
      return false;
    }
    return !estRamasse(session, ramasses);
  }

  function estARamasser(distanceAuTresor) {
    return Number.isFinite(distanceAuTresor) && distanceAuTresor <= DISTANCE_RAMASSAGE;
  }

  const api = {
    MAITRISE_AVEC_TRESOR,
    BONUS,
    FRACTION_SUR_ROUTE,
    DISTANCE_RAMASSAGE,
    tresorPourMaitrise,
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
