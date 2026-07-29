/* ============================================================
   MINI-JEUX : pause detente optionnelle entre deux concepts
   ------------------------------------------------------------
   Apres qu'un concept vient d'etre debloque (correct_concept_debloque),
   on PROPOSE parfois une pause ludique -- jamais imposee, sans aucun
   enjeu pedagogique. Ce module ne connait rien aux maths : il ne lit
   ni la maitrise, ni la progression, ni le score de reussite. Il ne
   fait qu'orchestrer un aparte detente et revenir exactement d'ou l'on
   vient.

   Trois coeurs testables sans navigateur (horloge/hasard injectes),
   puis une fine couche navigateur -- meme decoupage que proactive.js :

   - declencheur : DECIDE si l'on propose (probabilite + espacement) ;
   - registre    : la liste des mini-jeux disponibles, interface commune ;
   - orchestrateur : la machine a etats repos -> proposition -> enJeu -> repos,
                     pilotant un "adapter" (DOM/carte) injecte.

   Un mini-jeu expose une interface minimale :
     { id, nom, monter(zone, { terminer }) -> demonter? }
   `monter` affiche le jeu dans `zone` ; il appelle `terminer(bonus)`
   quand c'est fini (ou quitte), et peut retourner une fonction de
   nettoyage. Le `bonus` (optionnel) n'alimente QUE le score cosmetique
   (etoiles de garde-robe), comme le tresor du raccourci -- jamais la
   maitrise ni la progression.
   ============================================================ */
(function () {
  /* Probabilite de proposer apres un concept debloque : ni systematique
     (on ne ralentit pas un eleve presse), ni trop rare (l'effet de
     surprise doit exister). Parametrable. */
  const PROBABILITE_DEFAUT = 0.4;
  /* Espacement minimal : au moins ce nombre de concepts debloques entre
     deux propositions (meme esprit que le cooldown du tuteur proactif).
     Avec 2, une proposition faite au concept N interdit N+1 et N+2, et la
     suivante n'est possible qu'a partir de N+3 -- donc 2 concepts pleins
     entre les deux propositions. */
  const ESPACEMENT_MIN_CONCEPTS = 2;

  function tirage(random) {
    return typeof random === "function" ? random() : Math.random();
  }

  /* ---------- Declencheur : la regle de decision (testable) ---------- */
  function creerDeclencheur({ probabilite = PROBABILITE_DEFAUT, espacementMin = ESPACEMENT_MIN_CONCEPTS } = {}) {
    const state = {
      conceptsDepuisProposition: 0,
      propositionFaite: false,
    };
    return {
      /* Appele a CHAQUE concept debloque. Retourne true si l'on doit
         proposer une pause maintenant. */
      conceptDebloque(random) {
        state.conceptsDepuisProposition += 1;
        /* Espacement : tant que le quota de concepts depuis la derniere
           proposition n'est pas atteint, on ne propose pas -- meme si le
           tirage serait favorable. */
        if (state.propositionFaite && state.conceptsDepuisProposition <= espacementMin) {
          return false;
        }
        if (tirage(random) < probabilite) {
          state.propositionFaite = true;
          state.conceptsDepuisProposition = 0;
          return true;
        }
        return false;
      },
      getState: () => ({ ...state }),
    };
  }

  /* ---------- Registre : les mini-jeux disponibles (testable) ---------- */
  function creerRegistre() {
    const jeux = [];
    return {
      enregistrer(jeu) {
        /* Un mini-jeu valide a au moins un id, un nom et une fonction de
           montage : le reste de la mecanique ne suppose rien d'autre. */
        if (jeu && jeu.id && jeu.nom && typeof jeu.monter === "function") {
          jeux.push(jeu);
        }
      },
      liste: () => jeux.slice(),
      estVide: () => jeux.length === 0,
      /* Tire un mini-jeu au hasard parmi les disponibles. */
      choisir(random) {
        if (!jeux.length) {
          return null;
        }
        const index = Math.min(jeux.length - 1, Math.floor(tirage(random) * jeux.length));
        return jeux[index];
      },
    };
  }

  /* ---------- Orchestrateur : bascule et retour (testable) ----------
     Machine a etats pure, pilotant un `adapter` injecte. Aucun DOM ici :
     la couche navigateur fournit l'adapter reel, les tests un adapter
     factice. Garantit qu'on revient toujours a "repos" (donc a la carte,
     a la position exacte, la carte n'ayant jamais bouge pendant la pause). */
  function creerOrchestrateur({ declencheur, registre, adapter, random } = {}) {
    let phase = "repos"; /* repos | proposition | enJeu */
    let demonterActif = null;

    function auRepos() {
      phase = "repos";
      demonterActif = null;
    }

    function refuser() {
      if (phase !== "proposition") {
        return;
      }
      adapter.cacherProposition();
      adapter.reprendreCarte();
      auRepos();
    }

    function terminer(bonus) {
      if (phase !== "enJeu") {
        return;
      }
      if (typeof demonterActif === "function") {
        demonterActif();
      }
      adapter.cacherMinigame();
      /* Bonus purement cosmetique et optionnel, applique APRES coup pour
         qu'il ne puisse jamais se confondre avec le score pedagogique. */
      if (bonus && typeof adapter.ajouterBonus === "function") {
        adapter.ajouterBonus(bonus);
      }
      adapter.reprendreCarte();
      auRepos();
    }

    function accepter(minigame) {
      if (phase !== "proposition") {
        return;
      }
      phase = "enJeu";
      adapter.cacherProposition();
      /* La carte est deja en pause depuis l'affichage de la proposition ;
         on bascule simplement vers l'ecran du mini-jeu. */
      demonterActif = adapter.monterMinigame(minigame, { terminer }) || null;
    }

    return {
      /* Appele par la carte apres un concept debloque. Retourne true si une
         proposition a ete affichee. */
      conceptDebloque() {
        if (phase !== "repos" || registre.estVide()) {
          return false;
        }
        if (!declencheur.conceptDebloque(random)) {
          return false;
        }
        const minigame = registre.choisir(random);
        if (!minigame) {
          return false;
        }
        phase = "proposition";
        /* On met la carte en pause DES la proposition : l'eleve ne doit pas
           continuer a marcher derriere le voile pendant qu'il choisit. */
        adapter.pauseCarte();
        adapter.afficherProposition(minigame, {
          accepter: () => accepter(minigame),
          refuser,
        });
        return true;
      },
      refuser,
      terminer,
      getPhase: () => phase,
    };
  }

  /* ============================================================
     MINI-JEU DE TEST (placeholder)
     Valide toute la mecanique bascule/retour sans etre encore un vrai
     jeu : un ecran "Mini-jeu a venir !" et un bouton "Terminer".
     Les vrais mini-jeux s'ajouteront au registre sur ce meme modele.
     ============================================================ */
  const MINIGAME_A_VENIR = {
    id: "a-venir",
    nom: "Mini-jeu surprise",
    monter(zone, { terminer }) {
      zone.innerHTML = `
        <div class="minigame-placeholder">
          <div class="minigame-placeholder-emoji" aria-hidden="true">&#127918;</div>
          <h2 class="minigame-placeholder-title">Mini-jeu a venir !</h2>
          <p class="minigame-placeholder-text">
            Ici arrivera bientot un vrai petit jeu detente. Pour l'instant,
            c'est juste une pause : reviens quand tu veux a l'aventure.
          </p>
          <button id="minigame-a-venir-fin" class="btn-primary" type="button">Terminer</button>
        </div>
      `;
      const bouton = zone.querySelector("#minigame-a-venir-fin");
      /* Le placeholder ne rapporte aucun bonus : c'est un pur validateur de
         mecanique. Un vrai mini-jeu passerait un petit bonus cosmetique a
         terminer(). */
      const onFin = () => terminer(0);
      bouton?.addEventListener("click", onFin);
      bouton?.focus();
      /* Fonction de nettoyage : vide la zone et retire l'ecouteur. */
      return () => {
        bouton?.removeEventListener("click", onFin);
        zone.innerHTML = "";
      };
    },
  };

  /* ============================================================
     COUCHE NAVIGATEUR : adapter reel (DOM + carte via ParcoursApp)
     ============================================================ */
  function el(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function creerAdapterNavigateur() {
    return {
      pauseCarte() {
        window.ParcoursApp?.mettreEnPausePourMinigame?.();
      },
      reprendreCarte() {
        window.ParcoursApp?.reprendreApresMinigame?.();
      },
      afficherProposition(minigame, { accepter, refuser }) {
        const overlay = el("minigame-invite-overlay");
        const card = el("minigame-invite-card");
        if (!overlay || !card) {
          /* DOM absent : on annule proprement plutot que de bloquer la carte. */
          refuser();
          return;
        }
        card.innerHTML = `
          <p class="minigame-invite-eyebrow">Pause detente !</p>
          <div class="minigame-invite-emoji" aria-hidden="true">&#127881;</div>
          <h2 class="minigame-invite-title">Tu veux jouer a ${minigame.nom} ?</h2>
          <p class="minigame-invite-text">Juste pour s'amuser -- ta progression est mise de cote, elle t'attend.</p>
          <div class="minigame-invite-actions">
            <button id="minigame-invite-play" class="btn-primary" type="button">Jouer</button>
            <button id="minigame-invite-skip" class="ghost-button" type="button">Non merci, continuer</button>
          </div>
        `;
        card.querySelector("#minigame-invite-play")?.addEventListener("click", accepter);
        card.querySelector("#minigame-invite-skip")?.addEventListener("click", refuser);
        overlay.classList.remove("hidden");
        card.querySelector("#minigame-invite-play")?.focus();
        window.ParcoursApp?.refreshScenePaused?.();
      },
      cacherProposition() {
        const overlay = el("minigame-invite-overlay");
        const card = el("minigame-invite-card");
        overlay?.classList.add("hidden");
        if (card) {
          card.innerHTML = "";
        }
        window.ParcoursApp?.refreshScenePaused?.();
      },
      monterMinigame(minigame, { terminer }) {
        const overlay = el("minigame-overlay");
        const stage = el("minigame-stage");
        if (!overlay || !stage) {
          /* Pas d'ecran de jeu : on termine tout de suite pour revenir a la carte. */
          terminer(0);
          return null;
        }
        overlay.classList.remove("hidden");
        window.ParcoursApp?.refreshScenePaused?.();
        return minigame.monter(stage, { terminer });
      },
      cacherMinigame() {
        const overlay = el("minigame-overlay");
        const stage = el("minigame-stage");
        overlay?.classList.add("hidden");
        if (stage) {
          stage.innerHTML = "";
        }
        window.ParcoursApp?.refreshScenePaused?.();
      },
      ajouterBonus(points) {
        window.ParcoursApp?.ajouterBonusCosmetique?.(points);
      },
    };
  }

  /* Instance reelle : registre garni du placeholder, orchestrateur branche
     sur l'adapter navigateur. */
  const registreReel = creerRegistre();
  registreReel.enregistrer(MINIGAME_A_VENIR);
  const orchestrateurReel = creerOrchestrateur({
    declencheur: creerDeclencheur(),
    registre: registreReel,
    adapter: creerAdapterNavigateur(),
  });

  const api = {
    /* Appele par map.js apres un correct_concept_debloque. */
    conceptDebloque() {
      return orchestrateurReel.conceptDebloque();
    },
    /* Permet a d'autres modules (vrais mini-jeux) de s'enregistrer. */
    enregistrer(minigame) {
      registreReel.enregistrer(minigame);
    },
    liste() {
      return registreReel.liste();
    },
    /* Exposes pour les tests (coeurs sans navigateur). */
    creerDeclencheur,
    creerRegistre,
    creerOrchestrateur,
    MINIGAME_A_VENIR,
    PROBABILITE_DEFAUT,
    ESPACEMENT_MIN_CONCEPTS,
  };

  if (typeof window !== "undefined") {
    window.ParcoursMinigames = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
