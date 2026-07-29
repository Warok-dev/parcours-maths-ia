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
     MINI-JEU : LE MEMORY DES TABLES
     ------------------------------------------------------------
     Une grille de cartes face cachee : chaque paire associe un calcul
     direct (une multiplication, comme la famille calcul_direct du jeu) a
     son resultat -- "6 x 7" avec "42". L'eleve retourne deux cartes ; si
     elles se correspondent elles restent visibles, sinon elles se
     recachent apres un court delai. Aucune limite de temps, aucune
     penalite (esprit detente). Toutes les paires trouvees : message
     positif + bonus cosmetique, retour a la carte via demonter().

     La LOGIQUE PURE (generation des paires, detection de correspondance,
     etat retournee/trouvee des cartes) est isolee du rendu : genererPaires()
     et creerMemory() n'utilisent aucun DOM et sont testables en Node.
     ============================================================ */
  const MEMORY = {
    PAIRES_MIN: 6, /* 6 a 8 paires -> 12 a 16 cartes */
    PAIRES_MAX: 8,
    FACTEUR_MIN: 2, /* tables simples : facteurs de 2 a 9 */
    FACTEUR_MAX: 9,
    DELAI_RESOLUTION_MS: 900, /* delai avant de recacher une mauvaise paire */
    BONUS_BASE: 10,
    BONUS_PAR_PAIRE: 8,
  };

  /* Construit la liste des cartes (calcul + resultat, melangees) sans DOM.
     Les resultats sont TOUS distincts : une carte resultat ne correspond
     qu'a un seul calcul, pas d'ambiguite. Hasard injecte -> reproductible. */
  function genererPaires(random = Math.random, options = {}) {
    const cfg = { ...MEMORY, ...options };
    const rnd = typeof random === "function" ? random : Math.random;
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const nbPairesVoulu = options.nbPaires || ri(cfg.PAIRES_MIN, cfg.PAIRES_MAX);

    const resultatsUtilises = new Set();
    const paires = [];
    let garde = 0;
    while (paires.length < nbPairesVoulu && garde < 1000) {
      garde += 1;
      const a = ri(cfg.FACTEUR_MIN, cfg.FACTEUR_MAX);
      const b = ri(cfg.FACTEUR_MIN, cfg.FACTEUR_MAX);
      const valeur = a * b;
      if (resultatsUtilises.has(valeur)) {
        continue; /* resultat deja pris : on retente pour garder l'unicite */
      }
      resultatsUtilises.add(valeur);
      paires.push({ paireId: paires.length, calcul: `${a} × ${b}`, valeur });
    }

    const cartes = [];
    for (const pr of paires) {
      cartes.push({ id: cartes.length, paireId: pr.paireId, face: "calcul", texte: pr.calcul, valeur: pr.valeur });
      cartes.push({ id: cartes.length, paireId: pr.paireId, face: "resultat", texte: String(pr.valeur), valeur: pr.valeur });
    }
    /* Melange des positions (Fisher-Yates). Les id restent stables : ils
       identifient la carte, seule sa place dans la grille est brassee. */
    for (let i = cartes.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = cartes[i];
      cartes[i] = cartes[j];
      cartes[j] = tmp;
    }
    return { nbPaires: paires.length, cartes };
  }

  /* Coeur de jeu (sans DOM) : etat mutable des cartes + methodes. */
  function creerMemory(config) {
    const state = {
      cartes: config.cartes.map((c) => ({ ...c, retournee: false, trouvee: false })),
      selection: [], /* ids des cartes retournees en attente d'evaluation */
      pairesTrouvees: 0,
      nbPaires: config.nbPaires,
      coups: 0,
      termine: false,
    };
    const parId = (id) => state.cartes.find((c) => c.id === id);

    /* Retourne une carte. Renvoie l'etat resultant :
       - 'ignore'   : clic sans effet (carte deja vue, ou 2 deja retournees) ;
       - 'premiere' : premiere carte d'une tentative ;
       - 'paire'    : deux cartes qui correspondent (restent visibles) ;
       - 'rate'     : deux cartes differentes (a recacher via resoudre()). */
    function retourner(id) {
      if (state.termine || state.selection.length >= 2) {
        return { etat: "ignore" };
      }
      const c = parId(id);
      if (!c || c.trouvee || c.retournee) {
        return { etat: "ignore" };
      }
      c.retournee = true;
      state.selection.push(id);
      if (state.selection.length < 2) {
        return { etat: "premiere", carte: id };
      }
      const [ida, idb] = state.selection;
      const ca = parId(ida);
      const cb = parId(idb);
      state.coups += 1;
      /* Correspondance = meme paire (donc un calcul + son bon resultat). */
      const correspond = ca.paireId === cb.paireId && ca.id !== cb.id;
      if (correspond) {
        ca.trouvee = true;
        cb.trouvee = true;
        state.selection = [];
        state.pairesTrouvees += 1;
        if (state.pairesTrouvees >= state.nbPaires) {
          state.termine = true;
        }
        return { etat: "paire", cartes: [ida, idb] };
      }
      /* Mauvaise paire : aucune penalite, on laisse voir puis on recache. */
      return { etat: "rate", cartes: [ida, idb] };
    }

    /* Recache les cartes en attente (appele apres le delai d'une mauvaise
       paire). Sans effet si une paire venait d'etre validee. */
    function resoudre() {
      if (state.selection.length < 2) {
        return [];
      }
      const ids = state.selection.slice();
      for (const id of ids) {
        const c = parId(id);
        if (c && !c.trouvee) {
          c.retournee = false;
        }
      }
      state.selection = [];
      return ids;
    }

    return {
      retourner,
      resoudre,
      cartes: () => state.cartes.map((c) => ({ ...c })),
      carte: (id) => {
        const c = parId(id);
        return c ? { ...c } : null;
      },
      selection: () => state.selection.slice(),
      enAttenteResolution: () => state.selection.length >= 2,
      pairesTrouvees: () => state.pairesTrouvees,
      nbPaires: () => state.nbPaires,
      coups: () => state.coups,
      estTermine: () => state.termine,
      bonus: () => MEMORY.BONUS_BASE + state.pairesTrouvees * MEMORY.BONUS_PAR_PAIRE,
    };
  }

  const MINIGAME_MEMORY = {
    id: "memory-tables",
    nom: "le memory des tables",
    monter(zone, { terminer }) {
      const config = genererPaires(Math.random);
      const jeu = creerMemory(config);

      const cartesMarkup = jeu
        .cartes()
        .map(
          (c) => `
            <button class="memory-carte" type="button" data-id="${c.id}" aria-label="Carte a retourner">
              <span class="memory-carte-dos" aria-hidden="true">?</span>
              <span class="memory-carte-face">${c.texte}</span>
            </button>`,
        )
        .join("");

      zone.innerHTML = `
        <div class="memory">
          <div class="memory-header">
            <div class="memory-consigne">Associe chaque calcul a son resultat</div>
            <div class="memory-compteur" id="memory-compteur">0/${jeu.nbPaires()} paires</div>
          </div>
          <div class="memory-grille" id="memory-grille">${cartesMarkup}</div>
          <div class="memory-fin hidden" id="memory-fin"></div>
        </div>
      `;

      const grille = zone.querySelector("#memory-grille");
      const compteur = zone.querySelector("#memory-compteur");
      const finBox = zone.querySelector("#memory-fin");

      let attenteTimer = null;
      let finTimer = null;
      let fini = false;

      function syncCarte(id) {
        const c = jeu.carte(id);
        const btn = grille.querySelector(`.memory-carte[data-id="${id}"]`);
        if (!c || !btn) {
          return;
        }
        btn.classList.toggle("retournee", c.retournee && !c.trouvee);
        btn.classList.toggle("trouvee", c.trouvee);
        btn.disabled = c.trouvee;
      }

      function majCompteur() {
        compteur.textContent = `${jeu.pairesTrouvees()}/${jeu.nbPaires()} paires`;
      }

      function onClick(event) {
        const btn = event.target.closest(".memory-carte");
        if (!btn || attenteTimer) {
          return; /* on ignore les clics pendant qu'une mauvaise paire se recache */
        }
        const id = Number(btn.dataset.id);
        const res = jeu.retourner(id);
        if (res.etat === "ignore") {
          return;
        }
        syncCarte(id);
        if (res.etat === "paire") {
          res.cartes.forEach(syncCarte);
          majCompteur();
          window.ParcoursAudio?.playCorrect?.();
          if (jeu.estTermine()) {
            finir();
          }
        } else if (res.etat === "rate") {
          attenteTimer = window.setTimeout(() => {
            jeu.resoudre().forEach(syncCarte);
            attenteTimer = null;
          }, MEMORY.DELAI_RESOLUTION_MS);
        }
      }
      grille.addEventListener("click", onClick);

      function finir() {
        if (fini) {
          return;
        }
        fini = true;
        grille.removeEventListener("click", onClick);
        const bonus = jeu.bonus();
        finBox.innerHTML = `
          <div class="memory-fin-carte">
            <div class="memory-fin-emoji" aria-hidden="true">&#127882;</div>
            <h2 class="memory-fin-titre">Bravo, tout retrouve !</h2>
            <p class="memory-fin-detail">Tu as reforme les ${jeu.nbPaires()} paires.</p>
            <p class="memory-fin-bonus">+${bonus} etoiles &#10024;</p>
            <button id="memory-fin-btn" class="btn-primary" type="button">Revenir a l'aventure</button>
          </div>
        `;
        finBox.classList.remove("hidden");
        const btn = finBox.querySelector("#memory-fin-btn");
        btn.addEventListener("click", () => terminer(bonus));
        btn.focus();
        finTimer = window.setTimeout(() => terminer(bonus), 3200);
      }

      return () => {
        if (attenteTimer) {
          window.clearTimeout(attenteTimer);
          attenteTimer = null;
        }
        if (finTimer) {
          window.clearTimeout(finTimer);
          finTimer = null;
        }
        grille.removeEventListener("click", onClick);
        zone.innerHTML = "";
      };
    },
  };

  /* ============================================================
     MINI-JEU : LE PUZZLE DE LA CARTE
     ------------------------------------------------------------
     Une fresque du monde (chateau, route, decor -- reutilisee de map.js via
     ParcoursApp.fresqueMondeMarkup) decoupee en grille 3x3. PARTICULARITE :
     la progression est PERSISTANTE d'une session a l'autre (localStorage,
     comme le carnet). A chaque declenchement on debloque UNE piece de plus ;
     l'eleve la place (clic piece puis clic emplacement) parmi celles deja
     debloquees. Une piece bien placee s'enclenche, une mal placee revient au
     bac sans penalite. Puzzle complet -> celebration ; au declenchement
     suivant, un nouveau puzzle repart a zero.

     La LOGIQUE PURE (deblocage d'une piece, detection de bon placement, etat
     debloquee/placee, serialisation de la progression) est isolee du rendu
     et de localStorage : progressionVierge(), debloquerPiece() et
     creerPuzzle() n'utilisent aucun DOM ni stockage, et sont testables.
     ============================================================ */
  const PUZZLE = {
    ROWS: 3,
    COLS: 3,
    FRESQUE_W: 300,
    FRESQUE_H: 240,
    STORAGE_KEY: "parcours-puzzle-v1",
    BONUS_BASE: 8,
    BONUS_PAR_PIECE: 6, /* par piece placee dans la session courante */
    BONUS_COMPLETION: 30, /* prime quand le puzzle entier est reconstitue */
  };

  /* Progression neuve : aucune piece debloquee ni placee. */
  function progressionVierge(options = {}) {
    const rows = options.rows || PUZZLE.ROWS;
    const cols = options.cols || PUZZLE.COLS;
    return { rows, cols, total: rows * cols, debloquees: [], placees: [], complet: false };
  }

  /* Debloque UNE piece supplementaire (au hasard parmi les verrouillees).
     Ne modifie pas l'objet d'entree : renvoie une nouvelle progression et
     l'id de la piece debloquee (ou null si tout etait deja debloque). */
  function debloquerPiece(progression, random = Math.random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const total = progression.total || progression.rows * progression.cols;
    const dejaLa = progression.debloquees || [];
    const verrouillees = [];
    for (let i = 0; i < total; i += 1) {
      if (!dejaLa.includes(i)) {
        verrouillees.push(i);
      }
    }
    if (!verrouillees.length) {
      return { progression: { ...progression, debloquees: dejaLa.slice() }, piece: null };
    }
    const piece = verrouillees[Math.floor(rnd() * verrouillees.length)];
    return { progression: { ...progression, debloquees: [...dejaLa, piece] }, piece };
  }

  /* Coeur de jeu (sans DOM ni stockage). Une piece i a pour bon emplacement
     le slot i : le placement est correct ssi slotId === pieceId. */
  function creerPuzzle(progression) {
    const rows = progression.rows;
    const cols = progression.cols;
    const total = progression.total || rows * cols;
    const state = {
      debloquees: (progression.debloquees || []).slice(),
      placees: (progression.placees || []).slice(),
      complet: Boolean(progression.complet),
      placeesSession: 0,
    };
    const estDebloquee = (id) => state.debloquees.includes(id);
    const estPlacee = (id) => state.placees.includes(id);

    function placer(pieceId, slotId) {
      if (state.complet) {
        return { ok: false };
      }
      if (!estDebloquee(pieceId) || estPlacee(pieceId)) {
        return { ok: false }; /* piece non debloquee ou deja posee */
      }
      if (estPlacee(slotId)) {
        return { ok: false }; /* emplacement deja occupe */
      }
      if (slotId !== pieceId) {
        return { ok: false }; /* mauvais emplacement : la piece revient au bac */
      }
      state.placees.push(pieceId);
      state.placeesSession += 1;
      if (state.placees.length >= total) {
        state.complet = true;
      }
      return { ok: true, complet: state.complet };
    }

    return {
      rows: () => rows,
      cols: () => cols,
      total: () => total,
      placer,
      estDebloquee,
      estPlacee,
      debloquees: () => state.debloquees.slice(),
      placees: () => state.placees.slice(),
      /* Pieces debloquees mais pas encore posees (le contenu du bac). */
      enBac: () => state.debloquees.filter((id) => !state.placees.includes(id)),
      estComplet: () => state.complet,
      placeesSession: () => state.placeesSession,
      /* Snapshot serialisable : ce que la couche navigateur persiste. */
      progression: () => ({
        rows,
        cols,
        total,
        debloquees: state.debloquees.slice(),
        placees: state.placees.slice(),
        complet: state.complet,
      }),
      bonus: () =>
        PUZZLE.BONUS_BASE +
        state.placeesSession * PUZZLE.BONUS_PAR_PIECE +
        (state.complet ? PUZZLE.BONUS_COMPLETION : 0),
    };
  }

  /* --- Persistance (couche navigateur, tres fine) --- */
  function chargerProgressionPuzzle() {
    if (typeof localStorage === "undefined") {
      return null;
    }
    try {
      const raw = JSON.parse(localStorage.getItem(PUZZLE.STORAGE_KEY) || "null");
      if (!raw || !Array.isArray(raw.debloquees) || !Array.isArray(raw.placees)) {
        return null;
      }
      return raw;
    } catch (_error) {
      return null;
    }
  }

  function sauvegarderProgressionPuzzle(progression) {
    if (typeof localStorage === "undefined") {
      return;
    }
    try {
      localStorage.setItem(PUZZLE.STORAGE_KEY, JSON.stringify(progression));
    } catch (_error) {
      /* stockage indisponible : la partie continue, sans persistance */
    }
  }

  const MINIGAME_PUZZLE = {
    id: "puzzle-carte",
    nom: "le puzzle de la carte",
    monter(zone, { terminer }) {
      /* Reprise de la progression ; si le puzzle precedent etait complet, on
         repart sur un puzzle vierge. Puis on debloque UNE piece. */
      let progression = chargerProgressionPuzzle();
      if (!progression || progression.complet) {
        progression = progressionVierge();
      }
      const deblocage = debloquerPiece(progression, Math.random);
      progression = deblocage.progression;
      const nouvellePiece = deblocage.piece;
      sauvegarderProgressionPuzzle(progression);

      const jeu = creerPuzzle(progression);
      const rows = jeu.rows();
      const cols = jeu.cols();
      const total = jeu.total();
      const cellW = PUZZLE.FRESQUE_W / cols;
      const cellH = PUZZLE.FRESQUE_H / rows;
      const fresque = window.ParcoursApp?.fresqueMondeMarkup?.() || "";

      /* Image d'une piece = la fresque entiere, cadree (viewBox) sur la
         cellule de cette piece. Une fois posee, elle s'aligne avec ses
         voisines pour reformer l'image. */
      const pieceImg = (id) => {
        const r = Math.floor(id / cols);
        const c = id % cols;
        return `<svg class="puzzle-img" viewBox="${(c * cellW).toFixed(2)} ${(r * cellH).toFixed(2)} ${cellW.toFixed(2)} ${cellH.toFixed(2)}" preserveAspectRatio="none" aria-hidden="true">${fresque}</svg>`;
      };

      let slotsHtml = "";
      for (let i = 0; i < total; i += 1) {
        const placee = jeu.estPlacee(i);
        slotsHtml += `<div class="puzzle-slot${placee ? " placee" : ""}" data-slot="${i}">${placee ? pieceImg(i) : ""}</div>`;
      }

      /* Bac : pieces debloquees non posees, dans un ordre melange. */
      const bac = jeu.enBac();
      for (let i = bac.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = bac[i];
        bac[i] = bac[j];
        bac[j] = tmp;
      }
      const bacHtml = bac.length
        ? bac
            .map(
              (id) => `<button class="puzzle-piece${id === nouvellePiece ? " nouvelle" : ""}" type="button" data-id="${id}" aria-label="Piece de puzzle a placer">${pieceImg(id)}</button>`,
            )
            .join("")
        : `<p class="puzzle-bac-vide">Tout est place ! Reviens debloquer la piece suivante.</p>`;

      zone.innerHTML = `
        <div class="puzzle">
          <div class="puzzle-header">
            <div class="puzzle-consigne">Reforme la carte du monde, piece par piece</div>
            <div class="puzzle-compteur" id="puzzle-compteur">${jeu.placees().length}/${total} pieces</div>
          </div>
          <div class="puzzle-plateau">
            <div class="puzzle-cadre" id="puzzle-cadre" style="--rows:${rows}; --cols:${cols}; aspect-ratio:${PUZZLE.FRESQUE_W}/${PUZZLE.FRESQUE_H};">${slotsHtml}</div>
            <div class="puzzle-bac" id="puzzle-bac">${bacHtml}</div>
          </div>
          <div class="puzzle-actions">
            <button id="puzzle-retour" class="puzzle-retour" type="button">Revenir a l'aventure</button>
          </div>
          <div class="puzzle-fin hidden" id="puzzle-fin"></div>
        </div>
      `;

      const cadre = zone.querySelector("#puzzle-cadre");
      const bacNode = zone.querySelector("#puzzle-bac");
      const compteur = zone.querySelector("#puzzle-compteur");
      const finBox = zone.querySelector("#puzzle-fin");
      const retour = zone.querySelector("#puzzle-retour");

      let selection = null; /* id de la piece choisie dans le bac */
      let finTimer = null;
      let fini = false;

      function deselectionner() {
        selection = null;
        bacNode.querySelectorAll(".puzzle-piece.selectionnee").forEach((b) => b.classList.remove("selectionnee"));
      }

      function onBacClick(event) {
        const b = event.target.closest(".puzzle-piece");
        if (!b) {
          return;
        }
        selection = Number(b.dataset.id);
        bacNode.querySelectorAll(".puzzle-piece").forEach((btn) => {
          btn.classList.toggle("selectionnee", Number(btn.dataset.id) === selection);
        });
      }

      function onCadreClick(event) {
        const slot = event.target.closest(".puzzle-slot");
        if (!slot || selection === null) {
          return;
        }
        const slotId = Number(slot.dataset.slot);
        const pieceId = selection;
        const res = jeu.placer(pieceId, slotId);
        if (res.ok) {
          slot.innerHTML = pieceImg(pieceId);
          slot.classList.add("placee", "vient-de-placer");
          window.setTimeout(() => slot.classList.remove("vient-de-placer"), 500);
          bacNode.querySelector(`.puzzle-piece[data-id="${pieceId}"]`)?.remove();
          deselectionner();
          compteur.textContent = `${jeu.placees().length}/${total} pieces`;
          sauvegarderProgressionPuzzle(jeu.progression());
          window.ParcoursAudio?.playCorrect?.();
          if (!bacNode.querySelector(".puzzle-piece")) {
            bacNode.innerHTML = `<p class="puzzle-bac-vide">Tout est place ! Reviens debloquer la piece suivante.</p>`;
          }
          if (res.complet) {
            finir();
          }
        } else {
          /* Mauvais emplacement : la piece reste au bac, petite secousse. */
          const b = bacNode.querySelector(`.puzzle-piece[data-id="${pieceId}"]`);
          if (b) {
            b.classList.remove("rate");
            void b.offsetWidth;
            b.classList.add("rate");
          }
          deselectionner();
        }
      }

      bacNode.addEventListener("click", onBacClick);
      cadre.addEventListener("click", onCadreClick);
      retour.addEventListener("click", () => terminer(jeu.bonus()));

      function finir() {
        if (fini) {
          return;
        }
        fini = true;
        sauvegarderProgressionPuzzle(jeu.progression()); /* complet=true persiste */
        const bonus = jeu.bonus();
        finBox.innerHTML = `
          <div class="puzzle-fin-carte">
            <div class="puzzle-fin-image">
              <svg viewBox="0 0 ${PUZZLE.FRESQUE_W} ${PUZZLE.FRESQUE_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${fresque}</svg>
            </div>
            <h2 class="puzzle-fin-titre">Carte du monde reconstituee !</h2>
            <p class="puzzle-fin-detail">Tu as replace toutes les pieces. Un nouveau puzzle t'attend la prochaine fois.</p>
            <p class="puzzle-fin-bonus">+${bonus} etoiles &#10024;</p>
            <button id="puzzle-fin-btn" class="btn-primary" type="button">Revenir a l'aventure</button>
          </div>
        `;
        finBox.classList.remove("hidden");
        const btn = finBox.querySelector("#puzzle-fin-btn");
        btn.addEventListener("click", () => terminer(bonus));
        btn.focus();
        finTimer = window.setTimeout(() => terminer(bonus), 3600);
      }

      return () => {
        if (finTimer) {
          window.clearTimeout(finTimer);
          finTimer = null;
        }
        bacNode.removeEventListener("click", onBacClick);
        cadre.removeEventListener("click", onCadreClick);
        zone.innerHTML = "";
      };
    },
  };

  /* ============================================================
     MINI-JEU : LA DECORATION (le petit jardin)
     ------------------------------------------------------------
     Pas un jeu a objectif : un espace de personnalisation libre. L'eleve
     amenage un petit jardin avec des objets debloques par ses etoiles
     CUMULEES -- exactement la meme monnaie et la meme regle de seuil que la
     personnalisation du personnage (personnage.js) : un objet est debloque
     ssi etoiles_totales >= cout (miroir de ParcoursPersonnage.estDebloque).
     Le personnage personnalise (couleur/accessoires deja choisis) apparait
     dans le jardin pour la coherence visuelle. La disposition persiste en
     localStorage. Aucune fin : un bouton "Retour a l'aventure" toujours la.

     La LOGIQUE PURE (deblocage selon le seuil, placement/retrait, etat de la
     disposition) est isolee du rendu et du stockage, donc testable.
     ============================================================ */
  const DECO = {
    STORAGE_KEY: "parcours-deco-v1",
    NB_SPOTS: 6,
    /* Memes paliers d'esprit que le personnage (10, 25, 50, 100...). Le cout
       est un SEUIL d'etoiles cumulees, jamais une depense : gagner ne retire
       rien, exactement comme pour les couleurs et accessoires. */
    CATALOGUE: [
      { id: "fleurs", nom: "Parterre de fleurs", cout: 10 },
      { id: "buisson", nom: "Buisson rond", cout: 25 },
      { id: "arbre", nom: "Petit arbre", cout: 50 },
      { id: "banc", nom: "Banc en bois", cout: 75 },
      { id: "fontaine", nom: "Fontaine", cout: 100 },
      { id: "lanterne", nom: "Lanterne doree", cout: 150 },
    ],
  };

  /* Dessins vus du dessus, centres sur (0,0), palette du jeu. Rendu seul :
     la logique pure n'en depend pas. */
  const DECO_SVG = {
    fleurs: `
      <ellipse cx="0" cy="5" rx="25" ry="16" fill="#8a6d4b" opacity="0.35"></ellipse>
      <g><circle cx="-9" cy="-2" r="5.5" fill="#ff9db0"></circle><circle cx="-9" cy="-2" r="2.2" fill="#ffd66b"></circle></g>
      <g><circle cx="8" cy="-6" r="5.5" fill="#ffd66b"></circle><circle cx="8" cy="-6" r="2.2" fill="#e8703a"></circle></g>
      <g><circle cx="4" cy="8" r="5.5" fill="#b98bd6"></circle><circle cx="4" cy="8" r="2.2" fill="#fffdf6"></circle></g>
      <g><circle cx="-10" cy="10" r="4.5" fill="#ff9db0"></circle><circle cx="-10" cy="10" r="1.8" fill="#ffd66b"></circle></g>
    `,
    buisson: `
      <ellipse cx="2" cy="8" rx="20" ry="10" fill="#3f7a2e" opacity="0.3"></ellipse>
      <circle cx="-9" cy="0" r="12" fill="#55a53d"></circle>
      <circle cx="8" cy="-3" r="13" fill="#6fbe53"></circle>
      <circle cx="2" cy="6" r="10" fill="#85d066"></circle>
    `,
    arbre: `
      <ellipse cx="4" cy="9" rx="22" ry="11" fill="#3f7a2e" opacity="0.3"></ellipse>
      <circle cx="0" cy="0" r="22" fill="#55a53d"></circle>
      <circle cx="-7" cy="-5" r="12" fill="#6fbe53"></circle>
      <circle cx="8" cy="3" r="10" fill="#6fbe53"></circle>
      <circle cx="-8" cy="-7" r="6" fill="#85d066"></circle>
    `,
    banc: `
      <ellipse cx="0" cy="10" rx="24" ry="7" fill="#3f2c1a" opacity="0.25"></ellipse>
      <rect x="-22" y="-9" width="44" height="18" rx="4" fill="#8b5834"></rect>
      <line x1="-22" y1="-3" x2="22" y2="-3" stroke="#6e4a2e" stroke-width="1.8"></line>
      <line x1="-22" y1="3" x2="22" y2="3" stroke="#6e4a2e" stroke-width="1.8"></line>
      <rect x="-20" y="-11" width="5" height="22" rx="2" fill="#6e4a2e"></rect>
      <rect x="15" y="-11" width="5" height="22" rx="2" fill="#6e4a2e"></rect>
    `,
    fontaine: `
      <ellipse cx="0" cy="10" rx="24" ry="8" fill="#333" opacity="0.2"></ellipse>
      <circle cx="0" cy="0" r="23" fill="#9aa0a6"></circle>
      <circle cx="0" cy="0" r="18" fill="#8fc4de"></circle>
      <circle cx="0" cy="0" r="10" fill="#bfe6f5"></circle>
      <circle cx="0" cy="0" r="4.5" fill="#eaf6fb"></circle>
    `,
    lanterne: `
      <ellipse cx="0" cy="9" rx="14" ry="6" fill="#333" opacity="0.2"></ellipse>
      <circle cx="0" cy="0" r="13" fill="#ffe08a" opacity="0.55"></circle>
      <circle cx="0" cy="0" r="8" fill="#ffc23e"></circle>
      <rect x="-4" y="-4" width="8" height="8" rx="2" fill="#8b5834"></rect>
      <circle cx="0" cy="0" r="2.4" fill="#fff3c4"></circle>
    `,
  };

  function objetDeco(id) {
    return DECO.CATALOGUE.find((o) => o.id === id) || null;
  }

  /* Miroir EXACT de ParcoursPersonnage.estDebloque : total cumule >= seuil. */
  function estDebloqueDeco(objet, etoilesTotales) {
    return Boolean(objet) && (etoilesTotales || 0) >= objet.cout;
  }

  function etoilesRestantesDeco(objet, etoilesTotales) {
    return Math.max(0, objet.cout - (etoilesTotales || 0));
  }

  function objetsDebloquesDeco(etoilesTotales) {
    return DECO.CATALOGUE.filter((o) => estDebloqueDeco(o, etoilesTotales)).map((o) => o.id);
  }

  /* Etat de la disposition (sans DOM ni stockage). Une disposition associe un
     emplacement (0..NB_SPOTS-1) a l'id d'un objet. */
  function creerDeco(dispositionBrute) {
    const disposition = {};
    const src = dispositionBrute && typeof dispositionBrute === "object" ? dispositionBrute : {};
    for (const cle of Object.keys(src)) {
      const spot = Number(cle);
      if (Number.isInteger(spot) && spot >= 0 && spot < DECO.NB_SPOTS && objetDeco(src[cle])) {
        disposition[spot] = src[cle];
      }
    }

    function placer(spotId, objetId, etoilesTotales) {
      if (!Number.isInteger(spotId) || spotId < 0 || spotId >= DECO.NB_SPOTS) {
        return false;
      }
      const objet = objetDeco(objetId);
      if (!objet || !estDebloqueDeco(objet, etoilesTotales)) {
        return false; /* objet inconnu ou encore verrouille */
      }
      disposition[spotId] = objetId;
      return true;
    }

    function retirer(spotId) {
      if (disposition[spotId] === undefined) {
        return null;
      }
      const id = disposition[spotId];
      delete disposition[spotId];
      return id;
    }

    return {
      placer,
      retirer,
      objetSur: (spotId) => disposition[spotId] || null,
      disposition: () => ({ ...disposition }),
      nbPlaces: () => Object.keys(disposition).length,
      estVide: () => Object.keys(disposition).length === 0,
    };
  }

  /* --- Persistance (couche navigateur, tres fine) --- */
  function chargerDispositionDeco() {
    if (typeof localStorage === "undefined") {
      return {};
    }
    try {
      const raw = JSON.parse(localStorage.getItem(DECO.STORAGE_KEY) || "null");
      return raw && typeof raw === "object" && raw.disposition ? raw.disposition : {};
    } catch (_error) {
      return {};
    }
  }

  function sauvegarderDispositionDeco(disposition) {
    if (typeof localStorage === "undefined") {
      return;
    }
    try {
      localStorage.setItem(DECO.STORAGE_KEY, JSON.stringify({ disposition }));
    } catch (_error) {
      /* stockage indisponible : l'amenagement ne sera pas conserve */
    }
  }

  const MINIGAME_DECO = {
    id: "deco-jardin",
    nom: "ton petit jardin",
    monter(zone, { terminer }) {
      /* Meme monnaie que la personnalisation : les etoiles CUMULEES. */
      const total = window.ParcoursPersonnage?.getEtat?.().etoiles_totales || 0;
      const deco = creerDeco(chargerDispositionDeco());
      const perso = window.ParcoursApp?.playerMarkup?.() || "";

      const objetSvg = (id) => `<svg viewBox="-30 -30 60 60" class="deco-objet-svg" aria-hidden="true">${DECO_SVG[id] || ""}</svg>`;

      let spotsHtml = "";
      for (let i = 0; i < DECO.NB_SPOTS; i += 1) {
        const objId = deco.objetSur(i);
        spotsHtml += `<button class="deco-spot${objId ? " occupe" : ""}" type="button" data-spot="${i}" aria-label="Emplacement ${i + 1}">${objId ? objetSvg(objId) : ""}</button>`;
      }

      const paletteHtml = DECO.CATALOGUE.map((objet) => {
        const debloque = estDebloqueDeco(objet, total);
        const restantes = etoilesRestantesDeco(objet, total);
        const statut = debloque
          ? `<span class="deco-objet-nom">${objet.nom}</span>`
          : `<span class="deco-objet-verrou">&#128274; ${restantes} &#9733;</span>`;
        return `
          <button class="deco-objet${debloque ? "" : " verrouille"}" type="button" data-objet="${objet.id}" ${debloque ? "" : "disabled aria-disabled=\"true\""}>
            ${objetSvg(objet.id)}
            ${statut}
          </button>`;
      }).join("");

      zone.innerHTML = `
        <div class="deco">
          <div class="deco-header">
            <div class="deco-consigne">Amenage ton petit jardin</div>
            <div class="deco-etoiles">&#9733; ${total} etoiles</div>
          </div>
          <div class="deco-scene">
            <div class="deco-grille" id="deco-grille">${spotsHtml}</div>
            <div class="deco-perso"><svg viewBox="-26 -26 52 52" class="deco-perso-svg" aria-label="Ton personnage"><g class="player-token">${perso}</g></svg></div>
          </div>
          <p class="deco-hint" id="deco-hint">Choisis un objet, puis clique un emplacement. (Gomme pour retirer.)</p>
          <div class="deco-palette" id="deco-palette">
            ${paletteHtml}
            <button class="deco-objet deco-gomme" type="button" data-outil="retirer" aria-label="Retirer">
              <span class="deco-gomme-icone" aria-hidden="true">&#9003;</span>
              <span class="deco-objet-nom">Gomme</span>
            </button>
          </div>
          <div class="deco-actions">
            <button id="deco-retour" class="puzzle-retour" type="button">Retour a l'aventure</button>
          </div>
        </div>
      `;

      const grille = zone.querySelector("#deco-grille");
      const palette = zone.querySelector("#deco-palette");
      const hint = zone.querySelector("#deco-hint");
      const retour = zone.querySelector("#deco-retour");

      let outil = null; /* id d'objet, ou "retirer", ou null */

      function majSelection() {
        palette.querySelectorAll(".deco-objet").forEach((b) => {
          const sel = (b.dataset.objet && b.dataset.objet === outil) || (b.dataset.outil && b.dataset.outil === outil);
          b.classList.toggle("selectionne", Boolean(sel));
        });
      }

      function onPaletteClick(event) {
        const b = event.target.closest(".deco-objet");
        if (!b || b.disabled) {
          return;
        }
        outil = b.dataset.outil ? b.dataset.outil : b.dataset.objet;
        majSelection();
        hint.textContent = outil === "retirer"
          ? "Clique un objet du jardin pour le retirer."
          : "Clique un emplacement pour y poser l'objet.";
      }

      function onGrilleClick(event) {
        const spot = event.target.closest(".deco-spot");
        if (!spot) {
          return;
        }
        const spotId = Number(spot.dataset.spot);
        if (outil === null) {
          hint.textContent = "Choisis d'abord un objet dans la reserve.";
          return;
        }
        if (outil === "retirer") {
          if (deco.retirer(spotId) !== null) {
            spot.innerHTML = "";
            spot.classList.remove("occupe");
            sauvegarderDispositionDeco(deco.disposition());
          }
          return;
        }
        if (deco.placer(spotId, outil, total)) {
          spot.innerHTML = objetSvg(outil);
          spot.classList.add("occupe", "vient-de-poser");
          window.setTimeout(() => spot.classList.remove("vient-de-poser"), 400);
          sauvegarderDispositionDeco(deco.disposition());
          window.ParcoursAudio?.playCorrect?.();
        }
      }

      palette.addEventListener("click", onPaletteClick);
      grille.addEventListener("click", onGrilleClick);
      retour.addEventListener("click", () => terminer(0)); /* espace libre : pas de bonus */

      return () => {
        palette.removeEventListener("click", onPaletteClick);
        grille.removeEventListener("click", onGrilleClick);
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
  registreReel.enregistrer(MINIGAME_MEMORY);
  registreReel.enregistrer(MINIGAME_PUZZLE);
  registreReel.enregistrer(MINIGAME_DECO);
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
    MINIGAME_MEMORY,
    genererPaires,
    creerMemory,
    MEMORY,
    MINIGAME_PUZZLE,
    progressionVierge,
    debloquerPiece,
    creerPuzzle,
    PUZZLE,
    MINIGAME_DECO,
    creerDeco,
    objetDeco,
    estDebloqueDeco,
    etoilesRestantesDeco,
    objetsDebloquesDeco,
    DECO,
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
