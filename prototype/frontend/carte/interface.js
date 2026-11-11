/* carte/interface.js — Bandeau de retour, sauvegarde de session, score, thèmes d'obstacles, apartés de confiance.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

/* ============================================================
   FEEDBACK : bandeau overlay temporaire (2-3 s puis disparition)
   ============================================================ */
let modalFeedbackEnAttente = null;

function setFeedback(message, tone = "info") {
  window.clearTimeout(feedbackTimer);
  window.clearTimeout(feedbackLeaveTimer);
  /* Popup d'exercice ouverte : le message s'affiche DANS la popup, juste
     au-dessus de "Valider" (le bandeau du haut recouvrait le titre). */
  const dansPopup = state.panelOpen ? document.getElementById("modal-feedback") : null;
  if (state.panelOpen && !dansPopup && exerciseModal.classList.contains("is-preparing")) {
    /* Popup en cours de montage : le message attend son emplacement. */
    modalFeedbackEnAttente = { message, tone };
    feedback.className = "feedback-banner hidden";
    return;
  }
  if (dansPopup) {
    feedback.className = "feedback-banner hidden";
    dansPopup.textContent = message;
    dansPopup.className = `modal-feedback ${tone}`;
    /* Relance l'animation d'apparition a chaque nouveau message. */
    void dansPopup.offsetWidth;
    dansPopup.classList.add("visible");
    return;
  }
  feedback.textContent = message;
  feedback.className = `feedback-banner ${tone}`;
  const visibleFor = tone === "warning" || tone === "wait" ? 3200 : 2600;
  feedbackTimer = window.setTimeout(() => {
    feedback.classList.add("leaving");
    feedbackLeaveTimer = window.setTimeout(() => clearFeedback(), 380);
  }, visibleFor);
}

function clearFeedback() {
  window.clearTimeout(feedbackTimer);
  window.clearTimeout(feedbackLeaveTimer);
  feedback.textContent = "";
  feedback.className = "feedback-banner hidden";
}

function currentConceptIndex() {
  return state.session ? state.session.concept_index : -1;
}

/* ============================================================
   SAUVEGARDE DE SESSION (localStorage)
   ============================================================ */
function saveSessionRef() {
  if (!state.sessionId || !state.session || state.session.terminee) {
    return;
  }
  try {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId: state.sessionId,
        mapSeed: state.mapSeed,
        playerPosition: { x: state.playerPosition.x, y: state.playerPosition.y },
        score: state.score,
        treasures: [...state.treasuresCollected],
      }),
    );
  } catch (_error) {
    /* stockage indisponible : pas de reprise possible, le jeu continue */
  }
}

function loadSessionRef() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch (_error) {
    return null;
  }
}

function clearSessionRef() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (_error) {
    /* rien a faire */
  }
}

/* ============================================================
   SCORE : compteur de session (remis a zero a chaque nouvelle
   session), bonus selon la maitrise detectee par le backend.
   ============================================================ */
function refreshScoreDisplay() {
  scoreValue.textContent = String(state.score);
}

function addScore(points) {
  if (!points) {
    return;
  }
  state.score += points;
  refreshScoreDisplay();
  scoreChip.classList.remove("bump");
  void scoreChip.offsetWidth; /* relance l'animation */
  scoreChip.classList.add("bump");

  /* Les memes etoiles alimentent le total cumule qui debloque les tenues.
     Un deblocage est annonce tout de suite : c'est la recompense du moment,
     elle n'a pas a attendre l'ouverture du menu. */
  const debloques = window.ParcoursPersonnage?.ajouterEtoiles?.(points) || [];
  if (debloques.length) {
    const noms = debloques.map((item) => item.nom).join(", ");
    setFeedback(`Nouveau dans ta garde-robe : ${noms} ! (menu > Mon personnage)`, "success");
  }
}

/* Redessine le jeton du joueur sans reconstruire toute la scene : appele
   quand l'eleve change d'accessoire depuis l'ecran de personnalisation. */
function refreshPlayerToken() {
  const token = document.getElementById("player-token");
  if (token) {
    token.innerHTML = ASSETS.player();
  }
}

function resetScore() {
  state.score = 0;
  refreshScoreDisplay();
}

function levelLabel() {
  return state.session?.niveau_scolaire || state.selectedLevel || "";
}

function activeObstacle() {
  if (!state.scene || currentConceptIndex() < 0) {
    return null;
  }
  return state.scene.obstacles[currentConceptIndex()] || null;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* ============================================================
   THEMES D'OBSTACLES (textes + apparence, definis une fois)
   ============================================================ */
function obstacleTheme(type) {
  switch (type) {
    case "castle_gate":
      return {
        name: "Le château",
        modalClass: "theme-castle",
        title: "La porte du château est fermée !",
        intro: "Le gardien attend ton aide. Résous ce problème pour ouvrir la grande porte.",
      };
    case "blocked_road":
      return {
        name: "La cabane",
        modalClass: "theme-cabin",
        title: "La route est bloquée !",
        intro: "Aide ce villageois à dégager le passage en résolvant cet exercice.",
      };
    case "broken_bridge":
      return {
        name: "Le pont",
        modalClass: "theme-bridge",
        title: "Le pont est cassé !",
        intro: "Aide à réparer le pont en trouvant la bonne réponse.",
      };
    case "crossroads":
      return {
        name: "Le carrefour",
        modalClass: "theme-crossroads",
        title: "Le chemin est caché !",
        intro: "Le guide connaît la bonne direction. Aide-le pour révéler le passage.",
      };
    default:
      return {
        name: "L'obstacle",
        modalClass: "theme-castle",
        title: "Un obstacle t'attend !",
        intro: "Résous l'exercice pour continuer ton chemin.",
      };
  }
}

/* ============================================================
   EXERCICE DE CONFIANCE
   Aparte propose par le backend quand il detecte du decouragement
   sur PLUSIEURS exercices d'affilee (a distinguer du tuteur
   proactif, qui ne regarde qu'un exercice). Ce n'est pas un
   obstacle du parcours : il a sa propre scene, sans etoiles ni
   compteur d'entrainement, et le hibou y accompagne l'eleve.
   ============================================================ */
/* Le titre porte deja "Petite pause !" : l'intro enchaine sans le repeter. */
const CONFIANCE_INTRO = "Essayons celui-ci ensemble, tu vas y arriver.";
const CONFIANCE_REUSSITE = "Tu vois, tu es capable ! On continue.";
const CONFIANCE_RETRY = "Prends ton temps, je reste avec toi.";

function isConfidenceExercise() {
  return Boolean(state.session?.exercice_confiance_actif);
}

/* Le hibou tuteur, en version compacte pour l'entete de la scene. */
function confidenceOwlSvg() {
  return `
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path d="M20 46 Q14 34 22 26 L32 34 Z" fill="#8B5E3C"></path>
      <path d="M76 46 Q82 34 74 26 L64 34 Z" fill="#8B5E3C"></path>
      <ellipse cx="48" cy="52" rx="30" ry="34" fill="#8B5E3C"></ellipse>
      <ellipse cx="48" cy="60" rx="21" ry="24" fill="#FBF3E7"></ellipse>
      <path d="M27 40 Q48 24 69 40 Q66 22 48 20 Q30 22 27 40 Z" fill="#6E4A2E"></path>
      <circle cx="37" cy="44" r="11" fill="#FBF3E7" stroke="#6E4A2E" stroke-width="2"></circle>
      <circle cx="59" cy="44" r="11" fill="#FBF3E7" stroke="#6E4A2E" stroke-width="2"></circle>
      <circle cx="37" cy="45" r="5" fill="#203845"></circle>
      <circle cx="59" cy="45" r="5" fill="#203845"></circle>
      <circle cx="38.6" cy="43.4" r="1.6" fill="#ffffff"></circle>
      <circle cx="60.6" cy="43.4" r="1.6" fill="#ffffff"></circle>
      <path d="M48 50 L43 58 L53 58 Z" fill="#F0B84B"></path>
      <path d="M34 66 q4 5 9 0" fill="none" stroke="#8FC4DE" stroke-width="2.4" stroke-linecap="round"></path>
      <path d="M52 66 q4 5 9 0" fill="none" stroke="#8FC4DE" stroke-width="2.4" stroke-linecap="round"></path>
    </svg>
  `;
}

/* Theme des points d'arret d'entrainement le long des routes. */
function stopTheme() {
  return {
    name: "L'entraînement",
    modalClass: "theme-camp",
    title: "Halte d'entraînement !",
    intro: "Un exercice pour bien ancrer la méthode, puis reprends la route.",
  };
}
