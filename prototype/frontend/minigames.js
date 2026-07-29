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
     MINI-JEU : LA CHASSE AUX NOMBRES
     ------------------------------------------------------------
     Plusieurs nombres flottent et rebondissent sur les bords pendant
     ~16 s. Un nombre "cible" (tire parmi ceux affiches) est annonce en
     haut ; l'eleve clique les nombres qui lui correspondent. Bon clic =
     le nombre disparait et le compteur avance. Mauvais clic = rien (pas
     d'echec possible, esprit detente). A la fin : message positif +
     bonus cosmetique, puis retour a la carte via demonter().

     La LOGIQUE PURE (generation, physique, detection de clic, decompte du
     temps, fin de partie) est isolee du rendu SVG : genererConfig() et
     creerChasseNombres() n'utilisent aucun DOM et sont testables en Node.
     ============================================================ */
  const CHASSE = {
    DUREE_MS: 16000, /* dans la fourchette 15-20 s */
    NB_NOMBRES: 9,
    VALEUR_MIN: 1,
    VALEUR_MAX: 12,
    CIBLES_MIN: 2, /* au moins 2 nombres corrects a l'ecran (rule 3) */
    CIBLES_MAX: 4,
    LARGEUR: 640,
    HAUTEUR: 420,
    RAYON: 34,
    VITESSE_MIN: 34, /* px/s : deplacement doux */
    VITESSE_MAX: 74,
    BONUS_BASE: 10, /* petit bonus de participation... */
    BONUS_PAR_TROUVE: 10, /* ...plus un bonus par nombre attrape */
  };

  /* Construit une partie initiale (nombres + cible) sans aucun DOM.
     La cible est TOUJOURS presente parmi les nombres affiches, en au moins
     CIBLES_MIN exemplaires. Hasard injecte pour des parties reproductibles. */
  function genererConfig(random = Math.random, options = {}) {
    const cfg = { ...CHASSE, ...options };
    const rnd = typeof random === "function" ? random : Math.random;
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const cible = ri(cfg.VALEUR_MIN, cfg.VALEUR_MAX);
    const nbCibles = Math.min(cfg.NB_NOMBRES, ri(cfg.CIBLES_MIN, cfg.CIBLES_MAX));
    const valeurs = [];
    for (let i = 0; i < nbCibles; i += 1) {
      valeurs.push(cible);
    }
    while (valeurs.length < cfg.NB_NOMBRES) {
      valeurs.push(ri(cfg.VALEUR_MIN, cfg.VALEUR_MAX));
    }
    /* Melange (Fisher-Yates) pour que les cibles ne soient pas groupees. */
    for (let i = valeurs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = valeurs[i];
      valeurs[i] = valeurs[j];
      valeurs[j] = tmp;
    }
    const marge = cfg.RAYON;
    const nombres = valeurs.map((valeur, id) => {
      const angle = rnd() * Math.PI * 2;
      const vitesse = cfg.VITESSE_MIN + rnd() * (cfg.VITESSE_MAX - cfg.VITESSE_MIN);
      return {
        id,
        valeur,
        x: marge + rnd() * (cfg.LARGEUR - 2 * marge),
        y: marge + rnd() * (cfg.HAUTEUR - 2 * marge),
        vx: Math.cos(angle) * vitesse,
        vy: Math.sin(angle) * vitesse,
      };
    });
    return {
      cible,
      dureeMs: cfg.DUREE_MS,
      largeur: cfg.LARGEUR,
      hauteur: cfg.HAUTEUR,
      rayon: cfg.RAYON,
      nombres,
    };
  }

  /* Coeur de jeu (sans DOM) : etat mutable + methodes. */
  function creerChasseNombres(config) {
    const rayon = config.rayon || CHASSE.RAYON;
    const largeur = config.largeur;
    const hauteur = config.hauteur;
    const state = {
      cible: config.cible,
      dureeMs: config.dureeMs,
      tempsRestantMs: config.dureeMs,
      nombres: config.nombres.map((n) => ({ ...n, trouve: false })),
      trouves: 0,
      termine: false,
    };
    /* Combien de bons nombres a trouver au total (denominateur du compteur). */
    const total = state.nombres.filter((n) => n.valeur === state.cible).length;

    /* Avance la physique et le chrono de dtMs millisecondes. */
    function avancer(dtMs) {
      if (state.termine) {
        return;
      }
      const dt = dtMs / 1000;
      for (const n of state.nombres) {
        if (n.trouve) {
          continue;
        }
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        /* Rebond sur les bords : on replace dans l'aire et on inverse la
           composante concernee (jamais coince hors-champ). */
        if (n.x < rayon) {
          n.x = rayon;
          n.vx = Math.abs(n.vx);
        } else if (n.x > largeur - rayon) {
          n.x = largeur - rayon;
          n.vx = -Math.abs(n.vx);
        }
        if (n.y < rayon) {
          n.y = rayon;
          n.vy = Math.abs(n.vy);
        } else if (n.y > hauteur - rayon) {
          n.y = hauteur - rayon;
          n.vy = -Math.abs(n.vy);
        }
      }
      state.tempsRestantMs = Math.max(0, state.tempsRestantMs - dtMs);
      if (state.tempsRestantMs <= 0) {
        state.termine = true;
      }
    }

    /* Detecte un bon clic. Aucun effet de bord penalisant sur un mauvais
       clic : on renvoie simplement { bon:false }. */
    function cliquer(id) {
      if (state.termine) {
        return { bon: false };
      }
      const n = state.nombres.find((x) => x.id === id);
      if (!n || n.trouve) {
        return { bon: false };
      }
      if (n.valeur === state.cible) {
        n.trouve = true;
        state.trouves += 1;
        /* Tout trouve avant la fin du temps : victoire anticipee. */
        if (state.trouves >= total) {
          state.termine = true;
        }
        return { bon: true };
      }
      return { bon: false };
    }

    return {
      avancer,
      cliquer,
      cible: () => state.cible,
      aTrouver: () => total,
      trouves: () => state.trouves,
      tempsRestantMs: () => state.tempsRestantMs,
      dureeMs: () => state.dureeMs,
      estTermine: () => state.termine,
      tousTrouves: () => state.trouves >= total,
      /* Copies defensives : le rendu lit les positions sans pouvoir alterer
         l'etat interne. */
      nombres: () => state.nombres.map((n) => ({ ...n })),
      nombresActifs: () => state.nombres.filter((n) => !n.trouve).map((n) => ({ ...n })),
      bonus: () => CHASSE.BONUS_BASE + state.trouves * CHASSE.BONUS_PAR_TROUVE,
    };
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  const MINIGAME_CHASSE = {
    id: "chasse-nombres",
    nom: "la chasse aux nombres",
    monter(zone, { terminer }) {
      const config = genererConfig(Math.random);
      const partie = creerChasseNombres(config);
      const W = config.largeur;
      const H = config.hauteur;
      const R = config.rayon;

      zone.innerHTML = `
        <div class="chasse">
          <div class="chasse-header">
            <div class="chasse-cible">
              <span class="chasse-cible-label">Attrape tous les</span>
              <span class="chasse-cible-valeur">${config.cible}</span>
            </div>
            <div class="chasse-compteur" id="chasse-compteur">0/${partie.aTrouver()} trouves</div>
          </div>
          <div class="chasse-timer"><div class="chasse-timer-bar" id="chasse-timer-bar"></div></div>
          <svg class="chasse-aire" id="chasse-aire" viewBox="0 0 ${W} ${H}"
               preserveAspectRatio="xMidYMid meet" aria-label="Aire de jeu : nombres flottants"></svg>
          <div class="chasse-fin hidden" id="chasse-fin"></div>
        </div>
      `;

      const svg = zone.querySelector("#chasse-aire");
      const compteur = zone.querySelector("#chasse-compteur");
      const timerBar = zone.querySelector("#chasse-timer-bar");
      const finBox = zone.querySelector("#chasse-fin");

      /* Un jeton = un groupe positionne (translate) contenant un groupe
         interieur (pop/wobble) : ainsi l'animation CSS de scale ne se bat
         pas avec l'attribut transform qui porte la position. */
      const tokens = new Map();
      for (const n of partie.nombres()) {
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("class", "chasse-nombre");
        g.setAttribute("transform", `translate(${n.x.toFixed(1)}, ${n.y.toFixed(1)})`);
        g.dataset.id = String(n.id);
        const inner = document.createElementNS(SVG_NS, "g");
        inner.setAttribute("class", "chasse-nombre-inner");
        const c = document.createElementNS(SVG_NS, "circle");
        c.setAttribute("r", String(R));
        c.setAttribute("class", "chasse-nombre-bulle");
        const t = document.createElementNS(SVG_NS, "text");
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dy", "0.34em");
        t.setAttribute("class", "chasse-nombre-texte");
        t.textContent = String(n.valeur);
        inner.appendChild(c);
        inner.appendChild(t);
        g.appendChild(inner);
        svg.appendChild(g);
        tokens.set(n.id, g);
      }

      let raf = null;
      let last = null;
      let finTimer = null;
      let fini = false;

      function majCompteur() {
        compteur.textContent = `${partie.trouves()}/${partie.aTrouver()} trouves`;
      }

      function onClick(event) {
        const g = event.target.closest(".chasse-nombre");
        if (!g) {
          return;
        }
        const id = Number(g.dataset.id);
        const res = partie.cliquer(id);
        if (res.bon) {
          g.classList.add("trouve");
          tokens.delete(id);
          window.setTimeout(() => g.remove(), 260);
          majCompteur();
          window.ParcoursAudio?.playCorrect?.();
          if (partie.estTermine()) {
            finir();
          }
        } else {
          /* Mauvais clic : petite secousse, aucune penalite. */
          g.classList.remove("rate");
          void g.offsetWidth;
          g.classList.add("rate");
        }
      }
      svg.addEventListener("click", onClick);

      function boucle(ts) {
        if (last === null) {
          last = ts;
        }
        let dt = ts - last;
        last = ts;
        if (dt > 50) {
          dt = 50; /* onglet en arriere-plan : pas de saut geant */
        }
        partie.avancer(dt);
        for (const n of partie.nombresActifs()) {
          const g = tokens.get(n.id);
          if (g) {
            g.setAttribute("transform", `translate(${n.x.toFixed(1)}, ${n.y.toFixed(1)})`);
          }
        }
        const frac = partie.dureeMs() ? Math.max(0, partie.tempsRestantMs() / partie.dureeMs()) : 0;
        timerBar.style.transform = `scaleX(${frac.toFixed(3)})`;
        if (partie.estTermine()) {
          finir();
          return;
        }
        raf = window.requestAnimationFrame(boucle);
      }
      raf = window.requestAnimationFrame(boucle);

      function finir() {
        if (fini) {
          return;
        }
        fini = true;
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = null;
        }
        svg.removeEventListener("click", onClick);
        const trouves = partie.trouves();
        const total = partie.aTrouver();
        const bonus = partie.bonus();
        const pluriel = trouves > 1 ? "s" : "";
        finBox.innerHTML = `
          <div class="chasse-fin-carte">
            <div class="chasse-fin-emoji" aria-hidden="true">&#127881;</div>
            <h2 class="chasse-fin-titre">Bien joue !</h2>
            <p class="chasse-fin-detail">Tu as attrape ${trouves} nombre${pluriel} sur ${total}.</p>
            <p class="chasse-fin-bonus">+${bonus} etoiles &#10024;</p>
            <button id="chasse-fin-btn" class="btn-primary" type="button">Revenir a l'aventure</button>
          </div>
        `;
        finBox.classList.remove("hidden");
        const btn = finBox.querySelector("#chasse-fin-btn");
        btn.addEventListener("click", () => terminer(bonus));
        btn.focus();
        /* Retour automatique apres une courte celebration, si l'eleve ne
           clique pas lui-meme (terminer est idempotent cote orchestrateur). */
        finTimer = window.setTimeout(() => terminer(bonus), 3200);
      }

      /* Nettoyage (demonter) : coupe la boucle, le minuteur et les ecouteurs. */
      return () => {
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = null;
        }
        if (finTimer) {
          window.clearTimeout(finTimer);
          finTimer = null;
        }
        svg.removeEventListener("click", onClick);
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

  /* Instance reelle : registre garni des vrais mini-jeux, orchestrateur
     branche sur l'adapter navigateur. Le placeholder MINIGAME_A_VENIR reste
     defini (reference et tests) mais n'est plus propose : la chasse aux
     nombres est le premier vrai mini-jeu. */
  const registreReel = creerRegistre();
  registreReel.enregistrer(MINIGAME_CHASSE);
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
    MINIGAME_CHASSE,
    genererConfig,
    creerChasseNombres,
    CHASSE,
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
