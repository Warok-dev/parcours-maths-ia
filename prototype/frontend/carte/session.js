/* carte/session.js — Session de jeu, mode hors-ligne, reprise au chargement.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

/* ============================================================
   SESSION
   ============================================================ */
function applySessionSnapshot(snapshot, exercise = null) {
  state.session = snapshot;
  state.currentExercise = exercise || snapshot.exercice_courant || state.currentExercise;
  state.selectedLevel = snapshot.niveau_scolaire;
  state.selectedLesson = snapshot.lecon_id
    ? { lecon_id: snapshot.lecon_id, nom: snapshot.lecon_nom }
    : state.selectedLesson;

  sessionTitle.textContent = snapshot.terminee
    ? "Parcours terminé !"
    : snapshot.lecon_nom || `Aventure ${snapshot.niveau_scolaire}`;
  currentLevelBadge.textContent = snapshot.niveau_scolaire;

  renderScene();
  if (state.panelOpen) {
    renderExerciseModal();
  }
  if (snapshot.terminee) {
    clearSessionRef();
  } else {
    saveSessionRef();
  }
  window.dispatchEvent(new CustomEvent("session-updated", { detail: snapshot }));
}

/* ============================================================
   MODE HORS-LIGNE PARTIEL (essai libre uniquement)
   Pré-chargement d'un tampon d'exercices procéduraux, détection de
   perte/retour de connexion et jeu depuis le tampon quand le backend
   est injoignable. La logique pure (tampon, évaluation, bascule) vit
   dans offline.js (ParcoursOffline) ; ici on branche le jeu, l'UI et
   le réseau. RIEN de tout cela ne s'active pour un élève CONNECTÉ :
   sa vraie progression serveur ne doit jamais risquer une
   désynchronisation. Voir [[portee-donnees-compte-vs-invite]].
   ============================================================ */

/* Essai libre = pas de compte élève connecté. Seul ce mode a droit au
   hors-ligne ; un élève connecté verra une erreur de connexion classique. */
function estInvite() {
  return !window.ParcoursCompte?.estEleve?.();
}

function afficherBandeauHorsLigne(visible) {
  offlineBanner?.classList.toggle("hidden", !visible);
}

/* ---------- Pré-chargement du tampon (tant qu'on est en ligne) ---------- */

/* Complète le tampon avec des exercices procéduraux du niveau/leçon en cours.
   La source est l'endpoint GET /exercices/{niveau}?pattern=… qui NE touche pas
   la session (aucune progression avancée) ; les patterns narratifs y répondent
   404 et sont naturellement écartés par ParcoursOffline.remplir. */
async function prefetchHorsLigne() {
  if (!window.ParcoursOffline || !estInvite() || window.ParcoursOffline.estHorsLigne()) {
    return;
  }
  if (!state.session || state.session.terminee) {
    return;
  }
  const niveau = state.selectedLevel || state.session.niveau_scolaire;
  const patterns = state.session.concepts || [];
  if (!niveau || !patterns.length) {
    return;
  }
  try {
    await window.ParcoursOffline.remplir({
      niveau,
      patterns,
      fetchExercice: (pattern) =>
        request(`/exercices/${niveau}?pattern=${encodeURIComponent(pattern)}`, { method: "GET" }),
    });
  } catch (_error) {
    /* Un échec de pré-chargement n'est pas fatal : le jeu reste en ligne, la
       détection de perte de connexion se fait sur les appels de jeu (/evaluer). */
  }
}

function demarrerPrefetch() {
  arreterPrefetch();
  if (!estInvite()) {
    return;
  }
  prefetchHorsLigne();
  prefetchTimer = window.setInterval(prefetchHorsLigne, PREFETCH_INTERVAL_MS);
}

function arreterPrefetch() {
  if (prefetchTimer) {
    window.clearInterval(prefetchTimer);
    prefetchTimer = null;
  }
}

/* ---------- Sondage de reconnexion (tant qu'on est hors-ligne) ---------- */
function demarrerReconnexion() {
  arreterReconnexion();
  reconnectTimer = window.setInterval(tenterReconnexion, RECONNECT_INTERVAL_MS);
}

function arreterReconnexion() {
  if (reconnectTimer) {
    window.clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

async function tenterReconnexion() {
  try {
    await request("/health", { method: "GET" });
    sortirModeHorsLigne();
  } catch (_error) {
    /* toujours hors-ligne : on retentera au prochain tick */
  }
}

/* ---------- Bascule ---------- */
function entrerModeHorsLigne() {
  if (!window.ParcoursOffline || !window.ParcoursOffline.basculerHorsLigne()) {
    return; /* déjà hors-ligne, ou module absent */
  }
  state.offlineActif = true;
  arreterPrefetch();
  /* Coupe le tuteur proactif : son intervalle d'inactivité ferait des appels
     réseau (aide IA) voués à échouer. */
  window.ParcoursProactive?.panelClosed?.();
  afficherBandeauHorsLigne(true);
  setFeedback("Hors ligne — mode entraînement limité.", "warning");
  /* Si un exercice est ouvert, on le re-rend tout de suite pour retirer le
     tuteur/la synthèse vocale et afficher l'habillage "hors ligne". */
  if (state.panelOpen) {
    renderExerciseModal();
  }
  demarrerReconnexion();
}

function sortirModeHorsLigne() {
  if (!window.ParcoursOffline || !window.ParcoursOffline.basculerEnLigne()) {
    return; /* déjà en ligne */
  }
  state.offlineActif = false;
  arreterReconnexion();
  afficherBandeauHorsLigne(false);
  /* On quitte l'entraînement local : on ferme un éventuel panneau hors-ligne et
     on resynchronise la VRAIE session pour reprendre le parcours serveur là où
     il en était (il n'a pas bougé pendant la coupure). */
  if (state.panelOpen) {
    closeExercisePanel();
  }
  setFeedback("De retour en ligne ! Reprends ton aventure.", "success");
  syncSession().catch(() => {
    /* si la resynchro échoue, on est peut-être de nouveau hors-ligne : le
       prochain /evaluer le détectera */
  });
  demarrerPrefetch();
}

/* ---------- Jeu depuis le tampon ---------- */

/* Évalue localement la réponse à l'exercice courant puis enchaîne sur
   l'exercice suivant du tampon. Les exercices du tampon portent des
   empreintes de leurs réponses (jamais la réponse elle-même). Un exercice
   commencé EN LIGNE n'en a pas : on ne peut pas le corriger sans serveur, on
   passe donc directement à la réserve. Aucune progression pédagogique
   persistante : entraînement local. */
async function evaluerReponseHorsLigne(reponse) {
  const exercice = state.currentExercise;
  if (!exercice || !window.ParcoursOffline) {
    return;
  }
  const correct = await window.ParcoursOffline.evaluer(exercice, reponse);
  if (correct === null) {
    setFeedback("Connexion perdue : on continue avec les exercices en réserve.", "info");
    chargerProchainExerciceHorsLigne({ message: null });
    return;
  }
  if (correct) {
    window.ParcoursAudio?.playCorrect?.();
    /* Étoiles locales : elles alimentent la garde-robe (déjà en localStorage),
       jamais une progression serveur. */
    addScore(5);
    chargerProchainExerciceHorsLigne();
  } else {
    window.ParcoursAudio?.playWrong?.();
    setFeedback("Presque ! Essaie encore une fois.", "warning");
    const input = document.getElementById("answer-input");
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

function chargerProchainExerciceHorsLigne({ message = "Bravo ! Continue ton entraînement." } = {}) {
  const suivant = window.ParcoursOffline?.consommer();
  if (suivant) {
    state.currentExercise = suivant;
    if (message) {
      setFeedback(message, "success");
    }
    if (state.panelOpen) {
      renderExerciseModal();
    }
    /* Renouvellement impossible hors-ligne : quand le tampon fond, on prévient
       dès qu'il est vide (ci-dessous), pas de blocage silencieux. */
  } else {
    setFeedback("Plus d'exercices en réserve, reconnecte-toi pour continuer.", "warning");
  }
}

async function request(path, options = {}) {
  /* Eleve connecte : on joint son jeton a tous les appels. Le backend ne
     s'en sert que la ou c'est utile (/session/demarrer lie alors la
     session au compte) ; en essai libre il n'y a pas de jeton, donc
     aucun en-tete et un comportement strictement identique a avant. */
  const authHeader = window.ParcoursCompte?.getToken?.()
    ? { Authorization: `Bearer ${window.ParcoursCompte.getToken()}` }
    : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = "Erreur reseau.";
    try {
      const errorPayload = await response.json();
      message = errorPayload.detail || message;
    } catch (_error) {
      message = `${response.status} ${response.statusText}`;
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function syncSession() {
  if (!state.sessionId) {
    return;
  }
  const snapshot = await request(`/session/${state.sessionId}`, { method: "GET" });
  applySessionSnapshot(snapshot);
}

function renderLessonChoices() {
  /* Etat "chargement" laisse par un demarrage de session precedent : quand on
     clique une carte, on ajoute is-loading (grise + pointer-events:none) et on
     ne le retire QUE sur erreur (au succes, la carte de jeu prend le relais).
     Au retour ici (fin de parcours, "Changer de lecon"), il faut donc le
     nettoyer, sinon TOUTES les cartes restent non cliquables. */
  lessonActions.classList.remove("is-loading");

  lessonTitle.textContent = state.selectedLevel
    ? `Choisis une leçon de ${state.selectedLevel}`
    : "Choisis ta leçon";

  /* Un eleve reste sur le niveau de sa classe : "Changer de niveau" n'a pas de
     sens pour lui (il ne verra jamais l'ecran de choix CE1-CE6). En essai libre
     le bouton reste, pour repartir vers un autre niveau. */
  backToLevelsButton.classList.toggle("hidden", Boolean(niveauImposeEleve()));

  renderAssignationBanner();

  lessonActions.innerHTML = state.availableLessons
    .map(
      (lesson) => `
        <button class="lesson-card" type="button" data-lesson-id="${lesson.lecon_id}">
          <span class="lesson-card-icon">${LESSON_ICONS[lesson.lecon_id] || "★"}</span>
          <span>
            <span class="lesson-card-title">${lesson.nom}</span><br />
            <span class="lesson-card-copy">${lesson.pattern_count} défi${lesson.pattern_count > 1 ? "s" : ""} à relever</span>
          </span>
        </button>
      `,
    )
    .join("");

  lessonActions.querySelectorAll(".lesson-card").forEach((button) => {
    button.addEventListener("click", async () => {
      /* P3 : demarrer une session appelle le backend (/session/demarrer) ; on
         rend l'attente visible (surtout un cold start de plusieurs secondes)
         plutot que de laisser l'ecran fige. On grise les cartes et on annonce
         le chargement ; on restaure en cas d'echec (sinon la carte de jeu prend
         le relais). */
      button.classList.add("is-loading");
      lessonActions.classList.add("is-loading");
      lessonStatus.textContent = "Démarrage de l'aventure...";
      try {
        await startSession(state.selectedLevel, button.dataset.lessonId);
      } catch (error) {
        lessonStatus.textContent = `Impossible de démarrer la session : ${error.message}`;
        button.classList.remove("is-loading");
        lessonActions.classList.remove("is-loading");
      }
    });
  });

  renderRevisionChoice();
}

/* Bouton de revision ciblee : affiche uniquement si des faiblesses sont
   memorisees pour le niveau choisi (rien a revoir = rien a montrer). */
function renderRevisionChoice() {
  const patterns = window.ParcoursFaiblesses?.patternsPourNiveau?.(state.selectedLevel) || [];
  if (!patterns.length) {
    revisionZone.classList.add("hidden");
    revisionZone.innerHTML = "";
    return;
  }

  const nombre = patterns.length;
  revisionZone.innerHTML = `
    <button id="revision-button" class="revision-card" type="button">
      <span class="revision-card-icon" aria-hidden="true">&#127919;</span>
      <span>
        <span class="lesson-card-title">Revoir mes points faibles</span><br />
        <span class="lesson-card-copy">${nombre} concept${nombre > 1 ? "s" : ""} à retravailler</span>
      </span>
    </button>
  `;
  revisionZone.classList.remove("hidden");
  revisionZone.querySelector("#revision-button").addEventListener("click", async () => {
    try {
      await startRevisionSession(state.selectedLevel, patterns);
    } catch (error) {
      lessonStatus.textContent = `Impossible de démarrer la révision : ${error.message}`;
    }
  });
}

/* Banniere "travail assigne par l'enseignant" : mise en avant AVANT le choix
   libre des lecons. Le bouton demarre directement le travail (lecon ou revision
   ciblee). N'apparait que pour un eleve connecte ayant une assignation en attente. */
function renderAssignationBanner() {
  if (!assignationZone) {
    return;
  }
  const assignations = state.assignations || [];
  if (!assignations.length) {
    assignationZone.classList.add("hidden");
    assignationZone.innerHTML = "";
    return;
  }
  const a = assignations[0];
  const conceptLabel = (p) =>
    window.ParcoursCarnet?.conceptLabel?.(p) || String(p || "").replace(/_/g, " ");
  const label =
    a.type === "revision"
      ? `Révision : ${(a.patterns || []).map(conceptLabel).join(", ")}`
      : (state.availableLessons.find((l) => l.lecon_id === a.lecon_id) || {}).nom ||
        a.lecon_id ||
        "un exercice";
  const autres =
    assignations.length > 1
      ? `<span class="assignation-plus">+${assignations.length - 1} autre(s) à suivre</span>`
      : "";

  assignationZone.innerHTML = `
    <div class="assignation-banner">
      <span class="assignation-icon" aria-hidden="true">&#127891;</span>
      <div class="assignation-texte">
        <span class="assignation-titre">Ton enseignant t'a préparé un exercice !</span>
        <span class="assignation-travail">${label}</span>
        ${autres}
      </div>
      <button id="assignation-demarrer" class="btn-primary assignation-btn" type="button">Démarrer</button>
    </div>
  `;
  assignationZone.classList.remove("hidden");
  assignationZone.querySelector("#assignation-demarrer").addEventListener("click", async () => {
    try {
      if (a.type === "revision") {
        await startRevisionSession(state.selectedLevel, a.patterns || []);
      } else {
        await startSession(state.selectedLevel, a.lecon_id);
      }
    } catch (error) {
      lessonStatus.textContent = `Impossible de démarrer le travail : ${error.message}`;
    }
  });
}

async function loadLessons(level) {
  state.selectedLevel = level;
  lessonStatus.textContent = "Chargement des leçons...";
  const payload = await request(`/lecons/${level}`, { method: "GET" });
  state.availableLessons = payload.lecons || [];
  if (!state.availableLessons.length) {
    throw new Error("Aucune leçon disponible pour ce niveau.");
  }
  renderLessonChoices();
  lessonStatus.textContent = "Choisis une leçon pour commencer.";
  showLessonScreen();
}

/* Entree dans le jeu, commune a une lecon et a une revision ciblee : la
   session est deja creee cote backend, il reste a repartir d'une carte
   neuve. */
function enterSession(payload, lesson) {
  state.sessionId = payload.session_id;
  /* Nouvelle aventure => nouveau monde procédural. */
  state.mapSeed = genererGraineMonde();
  state.playerPosition = { x: START_X, y: START_Y };
  state.playerAngle = 0;
  state.panelOpen = false;
  state.justUnlockedIndex = null;
  state.justUnlockedUntil = 0;
  state.camera = { x: START_X, y: START_Y };
  state.reinforcement = null;
  state.treasure = null;
  state.treasuresCollected = new Set(); /* nouvelle session, nouveaux tresors */
  state.pendingEvaluation = null;
  /* Ambiance : nouvelle carte -> ramassables regeneres (la teinte, elle,
     reste calculee une seule fois). */
  state.collectiblesSig = null;
  state.collectibles = [];
  resetScore();
  /* Nouveau parcours : on remet a zero l'espacement des propositions de
     mini-jeu (le declencheur est un singleton de module) pour ne pas heriter
     du compteur du parcours precedent -- sinon une pause pouvait etre proposee
     des le premier concept. */
  window.ParcoursMinigames?.reinitialiserParcours?.();
  state.selectedLesson = lesson;
  applySessionSnapshot(payload.progression, payload.exercice);
  showGameScreen();
  clearFeedback();
  window.ParcoursAudio?.setMusicActive(true);
  /* Essai libre : on commence à pré-charger le tampon hors-ligne en arrière-plan
     dès l'entrée en jeu, et on le renouvelle tant que la connexion est bonne. */
  demarrerPrefetch();
}

async function startSession(level, lessonId) {
  lessonStatus.textContent = "Creation de la session...";
  const payload = await request("/session/demarrer", {
    method: "POST",
    body: JSON.stringify({
      niveau_scolaire: level,
      lecon_id: lessonId,
      /* L'univers choisi habille les problemes narratifs generes par l'IA
         tout au long de la session (les exercices suivants sont produits
         cote backend, qui a donc besoin du theme des le depart). */
      theme: window.ParcoursTheme?.getTheme?.(),
    }),
  });

  const lesson = state.availableLessons.find((item) => item.lecon_id === lessonId) || {
    lecon_id: lessonId,
    nom: lessonId,
  };
  enterSession(payload, lesson);
}

/* Revision ciblee : meme jeu, mais la carte n'est faite que des concepts
   restes sous la maitrise 3. */
async function startRevisionSession(level, patterns) {
  lessonStatus.textContent = "Préparation de ta révision...";
  const payload = await request("/session/demarrer_revision", {
    method: "POST",
    body: JSON.stringify({
      niveau_scolaire: level,
      patterns_cibles: patterns,
      theme: window.ParcoursTheme?.getTheme?.(),
    }),
  });

  enterSession(payload, {
    lecon_id: payload.progression.lecon_id,
    nom: payload.progression.lecon_nom,
  });
}

function openingMessage(obstacleType) {
  switch (obstacleType) {
    case "castle_gate":
      return "Bravo ! La porte du château s'ouvre !";
    case "blocked_road":
      return "Bravo ! La route est dégagée !";
    case "broken_bridge":
      return "Bravo ! Le pont est réparé !";
    case "crossroads":
      return "Bravo ! Le chemin caché apparaît !";
    default:
      return "Bravo ! Tu peux continuer !";
  }
}

function feedbackFromStatus(status, context) {
  switch (status) {
    case "correct_niveau_suivant":
      return {
        message: "Bravo ! Tu gagnes une étoile, continue !",
        tone: "success",
      };
    case "correct_nouveau_renforcement":
      if (context.previousPhase === "detection_maitrise") {
        return {
          message: `${openingMessage(context.previousObstacle?.type)} Suis la route jusqu'au premier fanion d'entraînement.`,
          tone: "success",
        };
      }
      return {
        message: "Bravo ! Continue jusqu'au prochain fanion !",
        tone: "success",
      };
    case "correct_concept_debloque":
      return {
        message: "Bravo ! Entraînement terminé, un nouveau défi t'attend plus loin !",
        tone: "success",
      };
    case "incorrect":
      if (context.confidenceOpening) {
        /* L'aparte s'ouvre : sa scene porte deja le message du hibou, un
           bandeau "Presque !" par-dessus brouillerait l'intention. */
        return null;
      }
      return {
        message: context.confidenceBefore ? CONFIANCE_RETRY : "Presque ! Essaie encore une fois.",
        tone: context.confidenceBefore ? "info" : "warning",
      };
    case "confiance_reussie":
      return { message: CONFIANCE_REUSSITE, tone: "success" };
    case "carte_terminee":
      /* Pas de bandeau ici : l'ecran de fin de parcours (bilan, carnet.js)
         porte desormais seul la celebration. Deux messages "termine !" en
         meme temps feraient doublon. */
      return null;
    default:
      return { message: status, tone: "info" };
  }
}

/* Applique le resultat d'une evaluation : fermeture eventuelle de la popup,
   snapshot de session, effets et feedback. Appele directement, ou apres le
   bouton "Continuer" de la correction (niveau 2). */
function applyEvaluationResult(payload, context) {
  const statut = payload.statut;
  const opensObstacle =
    statut === "correct_nouveau_renforcement" && context.previousPhase === "detection_maitrise";
  const stopCompleted =
    statut === "correct_nouveau_renforcement" && context.previousPhase === "renforcement";
  const unlocked = statut === "correct_concept_debloque";
  const finished = statut === "carte_terminee";
  /* Aparte de confiance : etat avant/apres, pour distinguer son ouverture
     (le backend vient de l'inserer) d'un reessai a l'interieur. */
  context.confidenceBefore = isConfidenceExercise();
  context.confidenceOpening =
    !context.confidenceBefore && Boolean(payload.progression?.exercice_confiance_actif);

  if (opensObstacle || stopCompleted || unlocked || finished) {
    state.panelOpen = false;
    exerciseOverlay.classList.add("hidden");
    exerciseModal.innerHTML = "";
    /* Fermeture directe (sans closeExercisePanel) : previent aussi le tuteur
       proactif, sinon son intervalle d'inactivite continue de tourner et le
       hibou peut proposer de l'aide alors qu'aucun exercice n'est ouvert. */
    window.ParcoursProactive?.panelClosed();
    refreshScenePaused();
  }
  if (opensObstacle) {
    state.justUnlockedIndex = context.previousConceptIndex;
    state.justUnlockedUntil = Date.now() + 1400;
    state.lastUnlockedType = context.previousObstacle?.type || null;
  }

  if (statut === "incorrect") {
    window.ParcoursAudio?.playWrong();
    window.ParcoursProactive?.wrongAnswer();
  } else if (opensObstacle || unlocked || finished) {
    window.ParcoursAudio?.playUnlock();
  } else {
    window.ParcoursAudio?.playCorrect();
  }

  /* Score : 10 points par bonne reponse sur une chaine sans erreur ni tuteur
     (5 sinon), bonus de detection proportionnel a la maitrise calculee par le
     backend (x10), bonus de deblocage de concept (+20). L'aparte de confiance
     ne rapporte rien : il est hors comptabilite du parcours, comme la
     maitrise et la progression sur la carte. */
  if (statut !== "incorrect" && statut !== "confiance_reussie") {
    let points = context.chainClean ? 10 : 5;
    if (opensObstacle) {
      points += (payload.progression?.maitrise_actuelle || 1) * 10;
    }
    if (unlocked || finished) {
      points += 20;
    }
    addScore(points);
  }

  const nextExercise = payload.exercice_suivant || state.currentExercise;
  applySessionSnapshot(payload.progression, nextExercise);
  state.currentExercise = nextExercise;

  if (opensObstacle && context.previousObstacle) {
    spawnUnlockFx(context.previousObstacle.x, context.previousObstacle.barrierY);
  } else if ((stopCompleted || unlocked || finished) && context.previousStop) {
    spawnUnlockFx(context.previousStop.x, context.previousStop.y);
  }

  const meta = feedbackFromStatus(statut, context);
  if (meta) {
    setFeedback(meta.message, meta.tone);
  } else {
    clearFeedback();
  }

  /* Recompense de fin de lecon : la carte terminee, on PROPOSE toujours un
     mini-jeu (facultatif, sans enjeu pedagogique) qui parle de la lecon
     qui vient de finir. Le module choisit le jeu par rotation et gere sa
     propre bascule/retour ; le bilan de fin de carte (carnet.js) attend la
     fin de la pause avant de s'afficher. */
  if (finished) {
    window.ParcoursMinigames?.finLecon?.({
      niveau: levelLabel(),
      concepts: state.session?.concepts || [],
      leconNom: state.session?.lecon_nom || "",
    });
  }

  if (state.panelOpen) {
    /* Seule la saisie clavier se vide manuellement : les autres mecaniques
       viennent d'etre remontees par le re-rendu de la popup et gerent
       elles-memes leur valeur initiale. */
    const form = document.getElementById("exercise-form");
    if (form?.dataset.mechanic === "clavier") {
      const refreshedInput = document.getElementById("answer-input");
      if (refreshedInput) {
        refreshedInput.value = "";
        refreshedInput.focus();
      }
    }
  }
}

function finalizePendingEvaluation() {
  const pending = state.pendingEvaluation;
  if (!pending) {
    return;
  }
  state.pendingEvaluation = null;
  applyEvaluationResult(pending.payload, pending.context);
}

/* Niveau 2 (semi-guide) : correction explicite apres validation, juste ou
   faux, avant de continuer. Pilote par correction_apres_coup du schema. */
function renderCorrectionView(payload, context) {
  /* La bonne reponse et l'explication arrivent avec le resultat de la
     correction (payload.correction), APRES la tentative : l'exercice envoye
     au navigateur ne les contient plus. */
  const correction = payload.correction || {};
  const explanation = correction.explication || "";
  const expectedText = correction.reponse ?? "";

  const paper = exerciseModal.querySelector(".modal-paper");
  const form = document.getElementById("exercise-form");
  if (!paper || !form) {
    finalizePendingEvaluation();
    return;
  }
  form.classList.add("hidden");
  const block = document.createElement("div");
  block.className = `correction-block ${payload.correct ? "correct" : "wrong"}`;
  block.innerHTML = `
    <p class="correction-verdict">${payload.correct ? "C'est juste, bravo !" : "Pas tout à fait..."}</p>
    ${expectedText !== "" ? `<p class="correction-answer">La bonne réponse : <strong>${expectedText}</strong></p>` : ""}
    ${explanation ? `<p class="correction-explain">${explanation}</p>` : ""}
    <button id="correction-continue" class="btn-primary" type="button">Continuer</button>
  `;
  paper.appendChild(block);
  const continueButton = document.getElementById("correction-continue");
  continueButton.addEventListener("click", finalizePendingEvaluation);
  continueButton.focus();
}

async function handleSubmitAnswer(event) {
  event.preventDefault();
  if (!state.currentExercise || !state.sessionId) {
    return;
  }

  const answerInput = event.currentTarget.querySelector("#answer-input");
  const reponse = answerInput.value.trim();
  if (!reponse) {
    const mechanicName = event.currentTarget.dataset.mechanic;
    setFeedback(
      mechanicName && mechanicName !== "clavier"
        ? "Choisis ta réponse avant de valider."
        : "Entre une réponse avant de valider.",
      "warning",
    );
    return;
  }

  /* Déjà hors-ligne : on évalue localement contre l'exercice mis en cache,
     sans aucun appel réseau, et on enchaîne sur le tampon. */
  if (state.offlineActif) {
    evaluerReponseHorsLigne(reponse);
    return;
  }

  /* Toute soumission (juste ou fausse) compte comme une interaction pour
     le detecteur d'inactivite du tuteur proactif. */
  window.ParcoursProactive?.activity();

  /* P3 : indicateur de chargement pendant l'appel reseau /evaluer. Sans lui,
     le temps de reponse (jusqu'a un cold start de plusieurs secondes) ressemble
     a un gel silencieux : on desactive le bouton et on affiche un spinner
     dessus. Restaure via finally (branches d'erreur ou le popup reste ouvert) ;
     sur succes le popup est remplace, restaurer un bouton detache est sans effet. */
  const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
  const setPending = (on) => {
    if (!submitBtn) {
      return;
    }
    submitBtn.disabled = on;
    submitBtn.classList.toggle("is-loading", on);
    submitBtn.setAttribute("aria-busy", on ? "true" : "false");
  };
  setPending(true);

  const context = {
    previousConceptIndex: currentConceptIndex(),
    previousObstacle: activeObstacle(),
    previousPhase: state.session.phase,
    chainClean: !state.session.erreurs_sur_chaine_actuelle,
    previousStop: state.reinforcement
      ? state.reinforcement.stops[state.reinforcement.nextStopIndex] || null
      : null,
    answeredExercise: state.currentExercise,
    answeredPresentation: state.session.presentation_courante,
  };

  try {
    const payload = await request("/evaluer", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        exercice_id: state.currentExercise.id,
        reponse_donnee: reponse,
      }),
    });

    const answeredDetail = context.answeredExercise.presentations?.[context.answeredPresentation];
    if (answeredDetail?.correction_apres_coup) {
      state.pendingEvaluation = { payload, context };
      renderCorrectionView(payload, context);
      return;
    }
    applyEvaluationResult(payload, context);
  } catch (error) {
    /* Panne réseau (fetch rejeté, timeout) EN ESSAI LIBRE : le backend est
       injoignable. On bascule en mode hors-ligne et on évalue cette réponse
       localement contre l'exercice courant (déjà en cache), puis on enchaîne
       sur le tampon. Un élève CONNECTÉ, lui, ne bascule pas : il verra
       l'erreur de connexion classique ci-dessous, pour ne jamais risquer une
       désynchronisation de sa vraie progression serveur. */
    if (estInvite() && window.ParcoursOffline?.estErreurReseau(error)) {
      entrerModeHorsLigne();
      evaluerReponseHorsLigne(reponse);
      return;
    }
    /* 503 = generation du prochain exercice indisponible : la session n'a pas
       bouge cote backend, l'eleve peut simplement revalider la meme reponse.
       429 = trop de validations tres rapprochees (limite de debit) : message
       rassurant et transitoire venu du serveur, l'eleve reessaie dans un
       instant. */
    if (error.status === 503) {
      setFeedback("Un instant, je prépare la suite... réessaie dans quelques secondes !", "wait");
    } else if (error.status === 429) {
      setFeedback(error.message || "Tu vas un peu trop vite ! Attends un instant et réessaie.", "wait");
    } else {
      setFeedback(error.message, "warning");
    }
  } finally {
    setPending(false);
  }
}

function resetSharedState() {
  clearSessionRef();
  state.sessionId = null;
  state.session = null;
  state.currentExercise = null;
  state.panelOpen = false;
  state.keysPressed.clear();
  state.nearObstacle = false;
  state.scene = null;
  state.playerPosition = { x: START_X, y: START_Y };
  state.playerAngle = 0;
  state.playerMoving = false;
  state.justUnlockedIndex = null;
  state.justUnlockedUntil = 0;
  state.camera = { x: START_X, y: START_Y };
  state.reinforcement = null;
  state.treasure = null;
  state.treasuresCollected = new Set();
  state.pendingEvaluation = null;
  resetScore();
  window.ParcoursAudio?.setMusicActive(false);
  mapElement.innerHTML = "";
  exerciseOverlay.classList.add("hidden");
  exerciseModal.innerHTML = "";
  clearFeedback();
  window.ParcoursChat?.reset();
  window.ParcoursProactive?.panelClosed();
  refreshScenePaused();
  /* Fin de partie : on arrête les minuteries hors-ligne et on repart d'un état
     "en ligne" propre (ces chemins de reset passent tous par le réseau). */
  arreterPrefetch();
  arreterReconnexion();
  afficherBandeauHorsLigne(false);
  state.offlineActif = false;
  window.ParcoursOffline?.basculerEnLigne();
}

function resetToStart() {
  resetSharedState();
  state.availableLessons = [];
  state.selectedLesson = null;
  /* Eleve : pas de retour au choix de niveau (il est fige par sa classe) ; on
     revient directement a ses lecons. Essai libre : ecran de niveau habituel. */
  const niveauEleve = niveauImposeEleve();
  if (niveauEleve) {
    loadLessons(niveauEleve).catch((error) => {
      lessonStatus.textContent = `Impossible de charger les leçons : ${error.message}`;
    });
    return;
  }
  state.selectedLevel = null;
  showStartScreen();
  startStatus.textContent = "Choisis un niveau pour demarrer une nouvelle session.";
  lessonStatus.textContent = "";
  lessonActions.innerHTML = "";
  revisionZone.innerHTML = "";
  revisionZone.classList.add("hidden");
}

async function returnToLessonChoice() {
  resetSharedState();
  /* Rafraichit les travaux assignes : celui qu'on vient de terminer disparait. */
  await rafraichirAssignations();
  renderLessonChoices();
  lessonStatus.textContent = "Choisis une leçon pour commencer.";
  showLessonScreen();
}

/* ============================================================
   REPRISE DE SESSION AU CHARGEMENT
   Si un session_id est memorise, on tente de recharger l'etat
   aupres du backend et de reprendre la partie la ou elle etait
   (meme carte, meme position, meme exercice). Sinon, ecran de
   choix habituel.
   ============================================================ */
async function tryResumeSession() {
  const saved = loadSessionRef();
  if (!saved || !saved.sessionId) {
    return false;
  }
  startStatus.textContent = "Reprise de ton aventure en cours...";
  try {
    const snapshot = await request(`/session/${saved.sessionId}`, { method: "GET" });
    if (snapshot.terminee) {
      clearSessionRef();
      startStatus.textContent = "Choisis un niveau pour demarrer une nouvelle session.";
      return false;
    }
    state.sessionId = saved.sessionId;
    /* Meme carte qu'avant le rechargement : graine sauvegardee, ou dérivée du
       sessionId pour les anciennes sauvegardes qui n'en avaient pas. */
    state.mapSeed = Number.isFinite(saved.mapSeed)
      ? saved.mapSeed >>> 0
      : graineDepuisSessionId(saved.sessionId);
    state.score = Number.isFinite(saved.score) ? saved.score : 0;
    /* Tresors deja ramasses : sans eux, un rechargement de page les ferait
       repousser sur la meme route. */
    state.treasuresCollected = new Set(Array.isArray(saved.treasures) ? saved.treasures : []);
    refreshScoreDisplay();
    const position = saved.playerPosition;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      state.playerPosition = { x: position.x, y: position.y };
      state.camera = { x: position.x, y: position.y };
    }
    applySessionSnapshot(snapshot);
    showGameScreen();
    window.ParcoursAudio?.setMusicActive(true);
    /* Reprise en essai libre : on (re)lance le pré-chargement du tampon
       hors-ligne pour cette session comme à une entrée normale. */
    demarrerPrefetch();
    /* Liste des lecons du niveau rechargee en arriere-plan pour que
       "Changer de lecon" fonctionne aussi apres une reprise. */
    request(`/lecons/${snapshot.niveau_scolaire}`, { method: "GET" })
      .then((payload) => {
        state.availableLessons = payload.lecons || [];
      })
      .catch(() => {});
    return true;
  } catch (error) {
    if (error.status === 404) {
      /* Session expiree ou supprimee : on repart proprement. */
      clearSessionRef();
      startStatus.textContent = "Choisis un niveau pour demarrer une nouvelle session.";
    } else {
      /* Backend injoignable : on garde la sauvegarde pour un prochain essai. */
      startStatus.textContent = `Impossible de reprendre l'aventure : ${error.message}`;
    }
    return false;
  }
}
