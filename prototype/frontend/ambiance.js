/* ============================================================
   AMBIANCE : deux ajouts purement decoratifs, sans aucune
   incidence sur la logique de jeu (progression, evaluation,
   session). Ce module ne porte QUE de la logique pure, testable
   en Node (test_ambiance.js) ; le rendu et le cablage vivent
   dans map.js.
   1. Teinte jour/heure (overlay de couleur calcule une seule fois).
   2. Evenements ramassables aleatoires le long de la route.
   ============================================================ */
(function () {
  /* ---------- 1. Teinte jour / heure ----------
     Un simple overlay de couleur a faible opacite, calcule une fois selon
     l'heure locale : chaud/orange le matin et en fin de journee, bleute la
     nuit, neutre (invisible) en pleine journee. */
  function tintePourHeure(heure) {
    if (heure >= 6 && heure < 9) {
      return { couleur: "#ffb257", opacite: 0.14, moment: "matin" };
    }
    if (heure >= 17 && heure < 20) {
      return { couleur: "#ff8a3d", opacite: 0.16, moment: "soir" };
    }
    if (heure >= 20 || heure < 6) {
      return { couleur: "#2f3d78", opacite: 0.16, moment: "nuit" };
    }
    return { couleur: "#ffffff", opacite: 0, moment: "jour" };
  }

  function tinteMaintenant(date) {
    const d = date || new Date();
    return tintePourHeure(d.getHours());
  }

  /* ---------- 2. Evenements ramassables aleatoires ----------
     Pour chaque segment de route (entre deux points du trace), PROBA_PAR_SEGMENT
     de chance de deposer un ramassable a une fraction centrale du segment
     (loin des obstacles, aux extremites). Ramasse au contact simple ; petit
     bonus de score ; sans limite de session (regenere a chaque nouvelle carte). */
  const PROBA_PAR_SEGMENT = 0.15;
  const BONUS = 5;
  const RAYON_RAMASSAGE = 34;
  const TYPES = ["piece", "fleur"];

  function semerCollectibles(segments, rng) {
    const alea = typeof rng === "function" ? rng : Math.random;
    const items = [];
    segments.forEach((segment, index) => {
      if (alea() >= PROBA_PAR_SEGMENT) {
        return;
      }
      const fraction = 0.32 + alea() * 0.36; /* zone centrale du segment */
      const type = alea() < 0.5 ? TYPES[0] : TYPES[1];
      items.push({
        index,
        type,
        x: segment.a.x + (segment.b.x - segment.a.x) * fraction,
        y: segment.a.y + (segment.b.y - segment.a.y) * fraction,
        cle: `col-${index}`,
      });
    });
    return items;
  }

  /* Segments consecutifs d'une liste de points de trace. */
  function segmentsDepuisTrace(points) {
    const segments = [];
    for (let i = 1; i < points.length; i += 1) {
      segments.push({ a: points[i - 1], b: points[i] });
    }
    return segments;
  }

  function estRamassable(distance) {
    return distance <= RAYON_RAMASSAGE;
  }

  const api = {
    /* teinte */
    tintePourHeure,
    tinteMaintenant,
    /* ramassables */
    semerCollectibles,
    segmentsDepuisTrace,
    estRamassable,
    PROBA_PAR_SEGMENT,
    BONUS,
    RAYON_RAMASSAGE,
  };

  if (typeof window !== "undefined") {
    window.ParcoursAmbiance = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
