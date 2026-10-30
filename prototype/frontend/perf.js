/* ============================================================
   ANIMATIONS : mode vivant / mode econome
   ------------------------------------------------------------
   Le monde est anime (personnages qui respirent et saluent, arbres
   dans le vent, fumee des cheminees, canards, oiseaux, nuages...).
   Sur une petite machine (vieille tablette d'ecole, telephone
   d'entree de gamme), ces animations peuvent saccader le jeu : le
   MODE ECONOME les coupe et allege la carte.

   Trois choix, gardes sur l'appareil (localStorage) :
   - « auto »    : vivant, sauf appareil modeste (peu de memoire, peu de
                   coeurs, economie de donnees, « reduire les animations »
                   du systeme) ; et si le jeu rame vraiment pendant qu'on
                   joue, on passe tout seul en econome ;
   - « vivant »  : toujours anime ;
   - « econome » : toujours allege.

   Le mode effectif est pose sur <body data-perf="vivant|econome"> : la
   CSS et le rendu de la carte (carte/rendu.js) s'y referent.

   Coeur PUR (profil d'appareil, moniteur d'images par seconde),
   testable en Node : test_perf.js.
   ============================================================ */
(function () {
  const CHOIX = ["auto", "vivant", "econome"];
  const CLE_STOCKAGE = "parcours-animations-v1";

  /* ---------- Profil d'appareil (pur) ----------
     `infos` = ce que le navigateur dit de la machine. Toute donnee absente
     est ignoree (Safari ne donne pas deviceMemory, par exemple). */
  function profilAppareil(infos = {}) {
    if (infos.reduireAnimations) return "econome";
    if (infos.economieDonnees) return "econome";
    if (Number.isFinite(infos.memoireGo) && infos.memoireGo <= 2) return "econome";
    if (Number.isFinite(infos.coeurs) && infos.coeurs <= 2) return "econome";
    return "vivant";
  }

  /* ---------- Moniteur d'images (pur) ----------
     On lui donne la duree de chaque image (ms) PENDANT LE JEU. Il repond
     true une seule fois si le jeu rame durablement : mediane d'une fenetre
     glissante au-dessus du seuil (24 ms = moins de ~40 images/s : une
     saccade nette sur un ecran a 60 Hz), sur 2 fenetres d'affilee (~3 s). Les trous (onglet cache, chargement) au
     dela de 250 ms sont ignores : ce n'est pas de la lenteur d'animation. */
  function creerMoniteur({ seuilMs = 24, taille = 60, fenetresLentes = 2 } = {}) {
    let images = [];
    let lentesDAffilee = 0;
    let declenche = false;
    return {
      noter(dureeMs) {
        if (declenche || !Number.isFinite(dureeMs) || dureeMs <= 0 || dureeMs > 250) {
          return false;
        }
        images.push(dureeMs);
        if (images.length < taille) {
          return false;
        }
        const triees = images.slice().sort((a, b) => a - b);
        const mediane = triees[Math.floor(triees.length / 2)];
        images = [];
        lentesDAffilee = mediane > seuilMs ? lentesDAffilee + 1 : 0;
        if (lentesDAffilee >= fenetresLentes) {
          declenche = true;
          return true;
        }
        return false;
      },
      reinitialiser() {
        images = [];
        lentesDAffilee = 0;
        declenche = false;
      },
      etat: () => ({ enAttente: images.length, lentesDAffilee, declenche }),
    };
  }

  /* Mode effectif selon le choix et ce qu'on sait de la machine. */
  function modeEffectif(choix, profil, ralentiDetecte) {
    if (choix === "vivant" || choix === "econome") return choix;
    if (ralentiDetecte) return "econome";
    return profil === "econome" ? "econome" : "vivant";
  }

  function libelleChoix(choix, effectif) {
    if (choix === "vivant") return "Animations : vivant";
    if (choix === "econome") return "Animations : économe";
    return `Animations : auto (${effectif === "econome" ? "économe" : "vivant"})`;
  }

  /* Choix suivant quand on touche le bouton du menu : auto -> vivant ->
     econome -> auto. */
  function choixSuivant(choix) {
    const i = CHOIX.indexOf(choix);
    return CHOIX[(i + 1) % CHOIX.length] || "auto";
  }

  /* ---------- Couche navigateur ---------- */
  function infosNavigateur() {
    if (typeof window === "undefined") return {};
    const media = (q) => {
      try {
        return Boolean(window.matchMedia && window.matchMedia(q).matches);
      } catch (_e) {
        return false;
      }
    };
    const nav = window.navigator || {};
    return {
      reduireAnimations: media("(prefers-reduced-motion: reduce)"),
      economieDonnees: Boolean(nav.connection && nav.connection.saveData),
      memoireGo: Number(nav.deviceMemory),
      coeurs: Number(nav.hardwareConcurrency),
    };
  }

  function lireChoix() {
    try {
      const v = window.localStorage.getItem(CLE_STOCKAGE);
      return CHOIX.includes(v) ? v : "auto";
    } catch (_e) {
      return "auto";
    }
  }

  const etat = {
    choix: "auto",
    profil: "vivant",
    ralenti: false,
    effectif: "vivant",
    abonnes: [],
    moniteur: creerMoniteur(),
  };

  function appliquer() {
    const avant = etat.effectif;
    etat.effectif = modeEffectif(etat.choix, etat.profil, etat.ralenti);
    if (typeof document !== "undefined" && document.body) {
      document.body.dataset.perf = etat.effectif;
    }
    if (avant !== etat.effectif) {
      for (const f of etat.abonnes) {
        try {
          f(etat.effectif);
        } catch (_e) {
          /* un abonne en echec ne bloque pas les autres */
        }
      }
    }
  }

  function initialiser() {
    etat.choix = lireChoix();
    etat.profil = profilAppareil(infosNavigateur());
    appliquer();
  }

  const api = {
    CHOIX,
    profilAppareil,
    creerMoniteur,
    modeEffectif,
    libelleChoix,
    choixSuivant,
    initialiser,
    choix: () => etat.choix,
    effectif: () => etat.effectif,
    estEconome: () => etat.effectif === "econome",
    libelle: () => libelleChoix(etat.choix, etat.effectif),
    definir(choix) {
      etat.choix = CHOIX.includes(choix) ? choix : "auto";
      etat.ralenti = false;
      etat.moniteur.reinitialiser();
      try {
        window.localStorage.setItem(CLE_STOCKAGE, etat.choix);
      } catch (_e) {
        /* stockage indisponible : le choix vaut pour la session */
      }
      appliquer();
    },
    /* Appele a chaque image de la boucle de jeu. En « auto », un jeu qui
       rame durablement bascule en econome ; renvoie true a ce moment-la. */
    noterImage(dureeMs) {
      if (etat.choix !== "auto" || etat.effectif === "econome") {
        return false;
      }
      if (etat.moniteur.noter(dureeMs)) {
        etat.ralenti = true;
        appliquer();
        return true;
      }
      return false;
    },
    surChangement(f) {
      if (typeof f === "function") etat.abonnes.push(f);
    },
  };

  if (typeof window !== "undefined") {
    window.ParcoursPerf = api;
    if (typeof document !== "undefined") {
      if (document.body) {
        initialiser();
      } else {
        document.addEventListener("DOMContentLoaded", initialiser);
      }
    }
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
