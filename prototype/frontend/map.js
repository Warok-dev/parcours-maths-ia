const API_BASE_URL = "http://127.0.0.1:8000";
/* Reference de session persistee : permet de reprendre l'aventure apres un
   rafraichissement de page (position et score inclus, le reste de l'etat
   vit cote backend et se recharge via GET /session/{id}). */
const SESSION_STORAGE_KEY = "parcours_session_v1";
const SCENE_WIDTH = 2200;
const SCENE_PADDING_X = 300;
const SCENE_PADDING_Y = 420;
const START_X = SCENE_PADDING_X + 250;
const START_Y = SCENE_PADDING_Y + 38;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 230;
const CAMERA_WIDTH = 560;
const CAMERA_HEIGHT = 390;
const CAMERA_EASE = 5.2;
const OBSTACLE_GAP_Y = 320;
const FIRST_OBSTACLE_Y = SCENE_PADDING_Y + 280;
const BARRIER_OFFSET_Y = 46;
const INTERACTION_DISTANCE = 118;
const LANE_XS = [550, 1560, 660, 1480, 600, 1600];
const OBSTACLE_TYPES = ["castle_gate", "blocked_road", "broken_bridge", "crossroads"];
const RIVER_HALF_HEIGHT = 62;
/* Miroir de REINFORCEMENT_BY_MASTERY cote backend : nombre total de points
   d'arret sur la route de renforcement selon la maitrise detectee. */
const REINFORCEMENT_TOTALS = { 1: 4, 2: 3, 3: 2 };

const LESSON_ICONS = {
  addition: "+",
  soustraction: "−",
  multiplication_par_10: "×10",
  multiplication_decomposee: "×",
  moitie_double: "½",
  suites_mesures: "…",
};

const startScreen = document.getElementById("start-screen");
const lessonScreen = document.getElementById("lesson-screen");
const gameScreen = document.getElementById("game-screen");
const startStatus = document.getElementById("start-status");
const lessonTitle = document.getElementById("lesson-title");
const lessonActions = document.getElementById("lesson-actions");
const lessonStatus = document.getElementById("lesson-status");
const sessionTitle = document.getElementById("session-title");
const currentLevelBadge = document.getElementById("current-level-badge");
const changeLessonButton = document.getElementById("change-lesson-button");
const backToLevelsButton = document.getElementById("back-to-levels-button");
const restartButton = document.getElementById("restart-button");
const menuButton = document.getElementById("menu-button");
const menuDropdown = document.getElementById("menu-dropdown");
const mapElement = document.getElementById("map");
const scoreChip = document.getElementById("score-chip");
const scoreValue = document.getElementById("score-value");
const minimapButton = document.getElementById("minimap");
const minimapSvg = document.getElementById("minimap-svg");
const feedback = document.getElementById("feedback");
const exerciseOverlay = document.getElementById("exercise-overlay");
const exerciseModal = document.getElementById("exercise-modal");
const debugLog = document.getElementById("debug-log");

const state = {
  sessionId: null,
  session: null,
  currentExercise: null,
  panelOpen: false,
  playerPosition: { x: START_X, y: START_Y },
  playerAngle: 0,
  playerMoving: false,
  keysPressed: new Set(),
  nearObstacle: false,
  scene: null,
  justUnlockedIndex: null,
  justUnlockedUntil: 0,
  lastUnlockedType: null,
  camera: { x: START_X, y: START_Y },
  selectedLevel: null,
  availableLessons: [],
  selectedLesson: null,
  reinforcement: null,
  pendingEvaluation: null,
  score: 0,
};

let animationFrameId = null;
let lastTick = 0;
let lastPositionSaveAt = 0;
let feedbackTimer = null;
let feedbackLeaveTimer = null;

function logDebug(entry) {
  if (debugLog) {
    debugLog.textContent += `${entry}\n`;
  }
}

/* ============================================================
   FEEDBACK : bandeau overlay temporaire (2-3 s puis disparition)
   ============================================================ */
function setFeedback(message, tone = "info") {
  window.clearTimeout(feedbackTimer);
  window.clearTimeout(feedbackLeaveTimer);
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
        playerPosition: { x: state.playerPosition.x, y: state.playerPosition.y },
        score: state.score,
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
        name: "Le chateau",
        modalClass: "theme-castle",
        title: "La porte du chateau est fermee !",
        intro: "Le gardien attend ton aide. Resous ce probleme pour ouvrir la grande porte.",
      };
    case "blocked_road":
      return {
        name: "La cabane",
        modalClass: "theme-cabin",
        title: "La route est bloquee !",
        intro: "Aide ce villageois a degager le passage en resolvant cet exercice.",
      };
    case "broken_bridge":
      return {
        name: "Le pont",
        modalClass: "theme-bridge",
        title: "Le pont est casse !",
        intro: "Aide a reparer le pont en trouvant la bonne reponse.",
      };
    case "crossroads":
      return {
        name: "Le carrefour",
        modalClass: "theme-crossroads",
        title: "Le chemin est cache !",
        intro: "Le guide connait la bonne direction. Aide-le pour reveler le passage.",
      };
    default:
      return {
        name: "L'obstacle",
        modalClass: "theme-castle",
        title: "Un obstacle t'attend !",
        intro: "Resous l'exercice pour continuer ton chemin.",
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
    name: "L'entrainement",
    modalClass: "theme-camp",
    title: "Halte d'entrainement !",
    intro: "Un exercice pour bien ancrer la methode, puis reprends la route.",
  };
}

/* ============================================================
   ASSETS SVG REUTILISABLES
   Chaque asset est defini UNE fois ici et utilise partout
   (scene ET icones des popups) sans jamais etre redessine.
   Tous sont dessines centres sur (0,0), vue du dessus.
   ============================================================ */
const ASSETS = {
  player() {
    return `
      <ellipse cx="0" cy="6" rx="20" ry="14" class="player-shadow"></ellipse>
      <circle cx="-13" cy="14" r="6" class="player-foot left"></circle>
      <circle cx="13" cy="14" r="6" class="player-foot right"></circle>
      <ellipse cx="0" cy="2" rx="19" ry="15" class="player-body"></ellipse>
      <circle cx="-19" cy="2" r="6.5" class="player-hand left"></circle>
      <circle cx="19" cy="2" r="6.5" class="player-hand right"></circle>
      <circle cx="0" cy="-3" r="12.5" class="player-head"></circle>
      <path d="M -12 -6 a 12.5 12.5 0 0 1 24 0 q -6 -7 -12 -7 q -6 0 -12 7 Z" class="player-hair"></path>
    `;
  },

  npc() {
    return `
      <ellipse cx="0" cy="5" rx="15" ry="10" class="npc-shadow"></ellipse>
      <ellipse cx="0" cy="1" rx="14" ry="11" class="npc-body"></ellipse>
      <circle cx="-14" cy="1" r="4.5" class="npc-hand"></circle>
      <circle cx="14" cy="1" r="4.5" class="npc-hand"></circle>
      <circle cx="0" cy="-3" r="9.5" class="npc-head"></circle>
      <path d="M -9 -5 a 9.5 9.5 0 0 1 18 0 q -4.5 -5.5 -9 -5.5 q -4.5 0 -9 5.5 Z" class="npc-hair"></path>
    `;
  },

  tree() {
    return `
      <ellipse cx="6" cy="8" rx="34" ry="26" class="tree-shadow"></ellipse>
      <circle cx="0" cy="0" r="32" class="tree-canopy-back"></circle>
      <circle cx="-9" cy="-7" r="17" class="tree-canopy"></circle>
      <circle cx="11" cy="4" r="15" class="tree-canopy"></circle>
      <circle cx="-3" cy="9" r="13" class="tree-canopy"></circle>
      <circle cx="-11" cy="-9" r="8" class="tree-canopy-light"></circle>
    `;
  },

  bush() {
    return `
      <ellipse cx="3" cy="4" rx="22" ry="14" class="tree-shadow"></ellipse>
      <circle cx="-10" cy="0" r="12" class="bush-leaf"></circle>
      <circle cx="8" cy="-3" r="13" class="bush-leaf"></circle>
      <circle cx="2" cy="6" r="10" class="bush-leaf-light"></circle>
    `;
  },

  flower() {
    return `
      <circle cx="-6" cy="0" r="4.5" class="flower-petal"></circle>
      <circle cx="6" cy="0" r="4.5" class="flower-petal"></circle>
      <circle cx="0" cy="-6" r="4.5" class="flower-petal"></circle>
      <circle cx="0" cy="6" r="4.5" class="flower-petal"></circle>
      <circle cx="0" cy="0" r="3.5" class="flower-center"></circle>
    `;
  },

  flowerPink() {
    return `
      <circle cx="-6" cy="0" r="4.5" class="flower-petal pink"></circle>
      <circle cx="6" cy="0" r="4.5" class="flower-petal pink"></circle>
      <circle cx="0" cy="-6" r="4.5" class="flower-petal pink"></circle>
      <circle cx="0" cy="6" r="4.5" class="flower-petal pink"></circle>
      <circle cx="0" cy="0" r="3.5" class="flower-center"></circle>
    `;
  },

  rock() {
    return `
      <ellipse cx="4" cy="5" rx="24" ry="15" class="tree-shadow"></ellipse>
      <ellipse cx="0" cy="0" rx="21" ry="15" class="deco-rock"></ellipse>
      <ellipse cx="14" cy="10" rx="7" ry="5" class="deco-rock-small"></ellipse>
    `;
  },

  grassTuft() {
    return `
      <path d="M -4 3 q -1.5 -5 1.5 -8 M 0 3.5 q 0 -6.5 0 -9.5 M 4 3 q 1.5 -5 -1.5 -8" class="grass-tuft"></path>
    `;
  },

  /* Chateau : bande de muraille + 2 tours rondes + double porte en bois
     avec cadenas dore. La porte s'ouvre en pivotant (classes CSS). */
  castle(isOpen) {
    return `
      <g class="asset-castle">
        <rect x="-150" y="-30" width="102" height="60" rx="10" class="castle-wall"></rect>
        <rect x="48" y="-30" width="102" height="60" rx="10" class="castle-wall"></rect>
        <rect x="-138" y="-18" width="78" height="36" rx="8" class="castle-wall-inner"></rect>
        <rect x="60" y="-18" width="78" height="36" rx="8" class="castle-wall-inner"></rect>
        <circle cx="-118" cy="0" r="34" class="castle-tower"></circle>
        <circle cx="-118" cy="0" r="18" class="castle-tower-top"></circle>
        <circle cx="118" cy="0" r="34" class="castle-tower"></circle>
        <circle cx="118" cy="0" r="18" class="castle-tower-top"></circle>
        <path d="M -118 -34 l 22 -8 l -22 -8 Z" class="castle-banner"></path>
        <path d="M 118 -34 l 22 -8 l -22 -8 Z" class="castle-banner"></path>
        <g class="gate-left">
          <rect x="-48" y="-9" width="48" height="18" rx="5" class="door-panel"></rect>
          <line x1="-36" y1="-9" x2="-36" y2="9" class="door-plank"></line>
          <line x1="-20" y1="-9" x2="-20" y2="9" class="door-plank"></line>
        </g>
        <g class="gate-right">
          <rect x="0" y="-9" width="48" height="18" rx="5" class="door-panel"></rect>
          <line x1="36" y1="-9" x2="36" y2="9" class="door-plank"></line>
          <line x1="20" y1="-9" x2="20" y2="9" class="door-plank"></line>
        </g>
        ${
          isOpen
            ? ""
            : `
              <g class="door-lock">
                <path d="M -7 -6 a 7 7 0 0 1 14 0" class="door-lock-shackle"></path>
                <rect x="-10" y="-6" width="20" height="16" rx="5" class="door-lock-body"></rect>
              </g>
            `
        }
      </g>
    `;
  },

  /* Cabane vue du dessus : toit a deux pans + cheminee. */
  cabin() {
    return `
      <g class="asset-cabin">
        <ellipse cx="8" cy="10" rx="66" ry="46" class="tree-shadow"></ellipse>
        <rect x="-60" y="-45" width="120" height="90" rx="10" class="cabin-roof"></rect>
        <rect x="-52" y="-37" width="104" height="36" rx="6" class="cabin-roof-half"></rect>
        <rect x="-52" y="1" width="104" height="36" rx="6" class="cabin-roof-half"></rect>
        <line x1="-56" y1="0" x2="56" y2="0" class="cabin-ridge"></line>
        <rect x="26" y="-32" width="18" height="18" rx="4" class="cabin-chimney"></rect>
      </g>
    `;
  },

  /* Pont vue du dessus : tablier a planches horizontales au-dessus de l'eau.
     Casse = deux planches du milieu manquantes (pointilles). */
  bridge(isRepaired) {
    const midPlanks = isRepaired
      ? `
        <rect x="-40" y="-10" width="80" height="16" rx="4" class="bridge-plank"></rect>
        <rect x="-40" y="10" width="80" height="16" rx="4" class="bridge-plank"></rect>
      `
      : `
        <rect x="-40" y="-10" width="80" height="16" rx="4" class="bridge-plank ghost"></rect>
        <rect x="-40" y="10" width="80" height="16" rx="4" class="bridge-plank ghost"></rect>
      `;
    return `
      <g class="asset-bridge">
        <rect x="-52" y="-78" width="104" height="156" rx="12" class="bridge-deck"></rect>
        <rect x="-40" y="-70" width="80" height="16" rx="4" class="bridge-plank"></rect>
        <rect x="-40" y="-50" width="80" height="16" rx="4" class="bridge-plank"></rect>
        <rect x="-40" y="-30" width="80" height="16" rx="4" class="bridge-plank"></rect>
        ${midPlanks}
        <rect x="-40" y="30" width="80" height="16" rx="4" class="bridge-plank"></rect>
        <rect x="-40" y="50" width="80" height="16" rx="4" class="bridge-plank"></rect>
        <line x1="-52" y1="-76" x2="-52" y2="76" class="bridge-rail"></line>
        <line x1="52" y1="-76" x2="52" y2="76" class="bridge-rail"></line>
      </g>
    `;
  },

  /* Point d'arret d'entrainement : petit socle + fanion. */
  trainingStop(status) {
    if (status === "done") {
      return `
        <ellipse cx="2" cy="6" rx="18" ry="10" class="tree-shadow"></ellipse>
        <circle cx="0" cy="0" r="15" class="stop-pad done"></circle>
        <path d="M -6 0 l 4 5 l 8 -10" class="stop-check"></path>
      `;
    }
    return `
      <ellipse cx="2" cy="6" rx="18" ry="10" class="tree-shadow"></ellipse>
      <circle cx="0" cy="0" r="15" class="stop-pad"></circle>
      <circle cx="0" cy="0" r="15" class="stop-pulse-ring"></circle>
      <rect x="-2" y="-30" width="4" height="30" rx="2" class="stop-pole"></rect>
      <path d="M 2 -30 l 17 5.5 l -17 5.5 Z" class="stop-flag"></path>
    `;
  },

  /* Panneau du carrefour : poteau + deux fleches. */
  signpost(isRevealed) {
    return `
      <g class="asset-signpost">
        <ellipse cx="3" cy="34" rx="16" ry="7" class="tree-shadow"></ellipse>
        <rect x="-5" y="-38" width="10" height="72" rx="4" class="signpost-pole"></rect>
        <g transform="translate(0, -26)">
          <path d="M -44 -12 h 74 l 14 12 l -14 12 h -74 Z" class="signpost-board"></path>
          <text x="-8" y="8" text-anchor="middle" class="signpost-text">?</text>
        </g>
        <g transform="translate(0, 6) scale(-1, 1)">
          <path d="M -44 -12 h 74 l 14 12 l -14 12 h -74 Z" class="signpost-board"></path>
          <text x="-6" y="8" text-anchor="middle" transform="scale(-1,1)" class="signpost-text">${isRevealed ? "→" : "..."}</text>
        </g>
      </g>
    `;
  },
};

/* Icone d'obstacle pour la popup : le MEME asset que sur la carte. */
function obstacleIconSvg(type, status) {
  const done = status === "done";
  switch (type) {
    case "castle_gate":
      return `<svg viewBox="-95 -48 190 96" aria-hidden="true">${ASSETS.castle(done)}</svg>`;
    case "blocked_road":
      return `<svg viewBox="-75 -60 150 120" aria-hidden="true">${ASSETS.cabin()}</svg>`;
    case "broken_bridge":
      return `<svg viewBox="-70 -90 140 180" aria-hidden="true">${ASSETS.bridge(done)}</svg>`;
    case "crossroads":
      return `<svg viewBox="-70 -60 140 110" aria-hidden="true">${ASSETS.signpost(done)}</svg>`;
    default:
      return "";
  }
}

/* ============================================================
   CAMERA
   ============================================================ */
function clampCamera(cameraTarget) {
  if (!state.scene) {
    return cameraTarget;
  }
  return {
    x: clamp(cameraTarget.x, CAMERA_WIDTH / 2, state.scene.width - CAMERA_WIDTH / 2),
    y: clamp(cameraTarget.y, CAMERA_HEIGHT / 2, state.scene.height - CAMERA_HEIGHT / 2),
  };
}

/* Reecrire le viewBox repeint TOUTE la scene SVG, meme quand la camera n'a
   pas bouge. On arrondit au dixieme d'unite et on n'ecrit que si la valeur
   change reellement : camera immobile => plus aucun repaint de la carte. */
let lastViewBox = "";

function applyCameraViewBox() {
  const clamped = clampCamera(state.camera);
  const viewBox = `${(clamped.x - CAMERA_WIDTH / 2).toFixed(1)} ${(clamped.y - CAMERA_HEIGHT / 2).toFixed(1)} ${CAMERA_WIDTH} ${CAMERA_HEIGHT}`;
  if (viewBox === lastViewBox) {
    return;
  }
  lastViewBox = viewBox;
  mapElement.setAttribute("viewBox", viewBox);
}

/* ============================================================
   MODELE DE SCENE
   ============================================================ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function distanceToRoute(point, routePoints) {
  let best = Infinity;
  for (let index = 1; index < routePoints.length; index += 1) {
    best = Math.min(best, pointSegmentDistance(point, routePoints[index - 1], routePoints[index]));
  }
  return best;
}

function createSceneModel(concepts) {
  const obstacles = concepts.map((concept, index) => {
    const type = OBSTACLE_TYPES[index % OBSTACLE_TYPES.length];
    const x = LANE_XS[index % LANE_XS.length];
    const y = FIRST_OBSTACLE_Y + index * OBSTACLE_GAP_Y;
    return {
      index,
      concept,
      type,
      x,
      y,
      barrierY: y - BARRIER_OFFSET_Y,
    };
  });

  const exitY = obstacles.length
    ? obstacles[obstacles.length - 1].y + 260
    : FIRST_OBSTACLE_Y + 260;
  const height = Math.max(1000, exitY + 120);

  const routePoints = [
    { x: START_X, y: START_Y },
    ...obstacles.map((obstacle) => ({ x: obstacle.x, y: obstacle.barrierY + 12 })),
    { x: obstacles.length ? obstacles[obstacles.length - 1].x : START_X, y: exitY },
  ];

  /* Decor procedural dense mais deterministe (meme graine => meme monde). */
  const rand = mulberry32(concepts.length * 7919 + height);
  const riverBands = obstacles
    .filter((obstacle) => obstacle.type === "broken_bridge")
    .map((obstacle) => obstacle.barrierY);

  function placeMany(count, minRouteDist, minMutualDist, existing) {
    const points = [];
    let guard = 0;
    while (points.length < count && guard < count * 40) {
      guard += 1;
      const candidate = {
        x: SCENE_PADDING_X * 0.3 + rand() * (SCENE_WIDTH - SCENE_PADDING_X * 0.6),
        y: 120 + rand() * (height - 240),
      };
      if (distanceToRoute(candidate, routePoints) < minRouteDist) continue;
      if (riverBands.some((bandY) => Math.abs(candidate.y - bandY) < RIVER_HALF_HEIGHT + 46)) continue;
      if (obstacles.some((obstacle) => distance(candidate, { x: obstacle.x, y: obstacle.barrierY }) < 210)) continue;
      if ([...existing, ...points].some((other) => distance(candidate, other) < minMutualDist)) continue;
      points.push(candidate);
    }
    return points;
  }

  const density = height / 300;
  const trees = placeMany(Math.round(density * 3.4), 110, 95, []);
  const bushes = placeMany(Math.round(density * 2.6), 82, 70, trees);
  const rocks = placeMany(Math.round(density * 1.4), 84, 120, [...trees, ...bushes]);
  const flowers = placeMany(Math.round(density * 3.2), 62, 60, rocks);
  const tufts = placeMany(Math.round(density * 4.2), 56, 46, []);
  const patches = Array.from({ length: Math.round(density * 2.2) }, () => ({
    x: rand() * SCENE_WIDTH,
    y: 120 + rand() * (height - 240),
    rx: 90 + rand() * 150,
    ry: 55 + rand() * 85,
    dark: rand() > 0.5,
  }));

  return {
    width: SCENE_WIDTH,
    height,
    routePoints,
    obstacles,
    decor: { trees, bushes, rocks, flowers, tufts, patches },
  };
}

/* ============================================================
   ROUTES : chemin principal + variantes courte / longue
   ============================================================ */
function buildRoadPath(points) {
  if (!points.length) {
    return "";
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midY = (previous.y + current.y) / 2;
    path += ` C ${previous.x} ${midY} ${current.x} ${midY} ${current.x} ${current.y}`;
  }
  return path;
}

/* Geometrie des trois routes qui partent de l'obstacle obstacleIndex vers le
   point suivant (obstacle suivant ou sortie) : courte (directe, doree),
   moyenne (la route principale), longue (tres sinueuse, brune). C'est la
   route de renforcement du concept obstacleIndex. */
function branchGeometry(scene, obstacleIndex) {
  const a = scene.routePoints[obstacleIndex + 1];
  const b = scene.routePoints[obstacleIndex + 2];
  if (!a || !b) {
    return null;
  }
  const next = scene.obstacles[obstacleIndex + 1] || null;
  /* Devant un pont, on s'arrete sur la berge nord, pas dans la riviere. */
  const endOffset = next && next.type === "broken_bridge" ? 116 : 72;
  const start = { x: a.x, y: a.y + 56 };
  const end = { x: b.x, y: b.y - endOffset };
  const dx = end.x - start.x;
  const side = dx >= 0 ? 1 : -1;
  const midY = (start.y + end.y) / 2;

  const short = `M ${start.x} ${start.y} Q ${(start.x + end.x) / 2 + side * 30} ${midY - 40} ${end.x} ${end.y}`;
  const medium = `M ${start.x} ${start.y} C ${start.x} ${midY} ${end.x} ${midY} ${end.x} ${end.y}`;
  const long = `M ${start.x} ${start.y}
    C ${start.x - side * 190} ${start.y + 60} ${start.x - side * 210} ${midY - 30} ${(start.x + end.x) / 2 - side * 60} ${midY}
    C ${end.x + side * 230} ${midY + 40} ${end.x + side * 190} ${end.y - 70} ${end.x} ${end.y}`;

  return { short, medium, long };
}

/* Chemin de renforcement effectif selon la maitrise : 3 = court, 2 = moyen
   (la route principale), 1 = long. Meme mapping que le rendu visuel. */
function reinforcementRouteD(geometry, mastery) {
  if (mastery === 3) {
    return geometry.short;
  }
  if (mastery === 1) {
    return geometry.long;
  }
  return geometry.medium;
}

function branchMarkup(scene) {
  /* Seule la route de renforcement ACTIVE est dessinee : le troncon du
     concept en cours, dans la variante correspondant a la maitrise detectee.
     Les autres troncons n'affichent que la route principale, pour ne jamais
     montrer de segments deconnectes du chemin reellement emprunte. */
  if (!state.session || state.session.phase !== "renforcement") {
    return "";
  }
  const geometry = branchGeometry(scene, state.session.concept_index);
  if (!geometry) {
    return "";
  }
  const mastery = state.session.maitrise_actuelle || 2;
  if (mastery === 3) {
    return `
      <g class="path-branch path-short active-path">
        <path d="${geometry.short}" class="path-short-edge"></path>
        <path d="${geometry.short}" class="path-short-surface"></path>
      </g>
    `;
  }
  if (mastery === 1) {
    return `
      <g class="path-branch path-long active-path">
        <path d="${geometry.long}" class="path-long-edge"></path>
        <path d="${geometry.long}" class="path-long-surface"></path>
      </g>
    `;
  }
  return ""; /* maitrise 2 : la route principale est le chemin de renforcement */
}

/* ============================================================
   POINTS D'ARRET DE RENFORCEMENT
   N marqueurs le long de la route active ; le joueur doit marcher
   jusqu'a chacun et resoudre un exercice pour continuer.
   ============================================================ */
function computeReinforcementStops() {
  if (!state.scene || !state.session || state.session.phase !== "renforcement") {
    return null;
  }
  const conceptIndex = state.session.concept_index;
  const mastery = state.session.maitrise_actuelle || 2;
  const total = REINFORCEMENT_TOTALS[mastery] || state.session.exercices_renforcement_restants;
  const remaining = state.session.exercices_renforcement_restants;
  const geometry = branchGeometry(state.scene, conceptIndex);
  if (!geometry || total <= 0) {
    return null;
  }

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", reinforcementRouteD(geometry, mastery));
  const length = path.getTotalLength();
  if (!length) {
    return null;
  }
  const stops = [];
  for (let index = 0; index < total; index += 1) {
    /* Etale les haltes de 18% a 85% de la route pour qu'elles epousent les
       virages (les fractions centrales tombent sur la partie droite). */
    const fraction = total === 1 ? 0.5 : 0.18 + (0.67 * index) / (total - 1);
    const point = path.getPointAtLength(fraction * length);
    stops.push({ x: point.x, y: point.y });
  }
  return { conceptIndex, mastery, total, remaining, stops, nextStopIndex: total - remaining };
}

function stopsMarkup() {
  if (!state.reinforcement) {
    return "";
  }
  const { stops, nextStopIndex } = state.reinforcement;
  return stops
    .map((stop, index) => {
      const status = index < nextStopIndex ? "done" : index === nextStopIndex ? "current" : "locked";
      return `
        <g class="reinforcement-stop stop-${status}" transform="translate(${stop.x}, ${stop.y})">
          ${ASSETS.trainingStop(status)}
        </g>
      `;
    })
    .join("");
}

function stopIconSvg() {
  return `<svg viewBox="-26 -38 52 56" aria-hidden="true">${ASSETS.trainingStop("current")}</svg>`;
}

/* ============================================================
   OBSTACLES SUR LA CARTE
   ============================================================ */
function obstacleStatus(index) {
  const currentIndex = currentConceptIndex();
  if (!state.session || currentIndex < 0) {
    return "locked";
  }
  if (state.session.terminee || index < currentIndex) {
    return "done";
  }
  if (index === currentIndex) {
    /* Detection reussie : l'obstacle s'ouvre et le joueur part s'entrainer
       sur la route ; les points d'arret prennent le relais. */
    return state.session.phase === "renforcement" ? "done" : "current";
  }
  return "locked";
}

function fenceMarkup(fromX, toX, y) {
  if (toX - fromX < 40) {
    return "";
  }
  const posts = [];
  for (let x = fromX + 20; x <= toX - 10; x += 64) {
    posts.push(`<circle cx="${x}" cy="${y}" r="7" class="fence-post"></circle>`);
  }
  return `
    <line x1="${fromX}" y1="${y}" x2="${toX}" y2="${y}" class="fence-rail"></line>
    ${posts.join("")}
  `;
}

const PLATE_OFFSETS = {
  castle_gate: -260,
  blocked_road: 250,
  broken_bridge: -240,
  crossroads: -290,
};

function obstaclePlateMarkup(obstacle, status, theme) {
  const plateY = obstacle.barrierY - 108;
  const plateX = obstacle.x + (PLATE_OFFSETS[obstacle.type] || -260);
  const done = status === "done";
  return `
    <g class="obstacle-plate-group" transform="translate(${plateX}, ${plateY})">
      <rect x="-92" y="-22" width="184" height="42" rx="18" class="obstacle-plate"></rect>
      <text x="${done ? -8 : 0}" y="7" text-anchor="middle" class="obstacle-plate-text">${theme.name}</text>
      ${
        done
          ? `<g transform="translate(66, 0)">
              <circle cx="0" cy="0" r="13" class="obstacle-done-check"></circle>
              <path d="M -6 0 l 4 5 l 8 -10" fill="none" stroke="#FBF3E7" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"></path>
            </g>`
          : ""
      }
    </g>
  `;
}

function obstacleMarkerMarkup(obstacle, status) {
  if (status !== "current") {
    return "";
  }
  return `
    <g transform="translate(${obstacle.x}, ${obstacle.barrierY - 152})">
      <g class="obstacle-marker">
        <path d="M 0 22 L -14 -4 A 17 17 0 1 1 14 -4 Z" class="marker-pin"></path>
        <text x="0" y="0" text-anchor="middle" class="marker-glyph">!</text>
      </g>
    </g>
  `;
}

function obstacleSceneryMarkup(obstacle, status) {
  const done = status === "done";
  const y = obstacle.barrierY;
  switch (obstacle.type) {
    case "castle_gate":
      return `
        ${fenceMarkup(Math.max(40, obstacle.x - 560), obstacle.x - 165, y)}
        ${fenceMarkup(obstacle.x + 165, Math.min(SCENE_WIDTH - 40, obstacle.x + 560), y)}
        <g transform="translate(${obstacle.x}, ${y})">${ASSETS.castle(done)}</g>
        <g transform="translate(${obstacle.x + 150}, ${y + 52})">${ASSETS.npc()}</g>
      `;
    case "blocked_road":
      return `
        ${fenceMarkup(Math.max(40, obstacle.x - 520), obstacle.x - 120, y)}
        ${fenceMarkup(obstacle.x + 120, Math.min(SCENE_WIDTH - 40, obstacle.x + 520), y)}
        <g transform="translate(${obstacle.x - 190}, ${y - 60})">${ASSETS.cabin()}</g>
        ${
          done
            ? `
              <g class="log-cleared" transform="translate(${obstacle.x - 130}, ${y + 66}) rotate(18)">
                <rect x="-46" y="-12" width="92" height="24" rx="12" class="log-shape"></rect>
                <circle cx="46" cy="0" r="12" class="log-end"></circle>
              </g>
            `
            : `
              <g class="log-block" transform="translate(${obstacle.x}, ${y}) rotate(-7)">
                <rect x="-84" y="-14" width="168" height="28" rx="14" class="log-shape"></rect>
                <circle cx="-84" cy="0" r="14" class="log-end"></circle>
                <circle cx="84" cy="0" r="14" class="log-end"></circle>
                <ellipse cx="30" cy="-26" rx="20" ry="14" class="block-rock"></ellipse>
                <ellipse cx="58" cy="22" rx="15" ry="11" class="block-rock"></ellipse>
              </g>
            `
        }
        <g transform="translate(${obstacle.x + 108}, ${y + 46})">${ASSETS.npc()}</g>
      `;
    case "broken_bridge":
      return `
        <g class="river-group">
          <rect x="0" y="${y - RIVER_HALF_HEIGHT - 7}" width="${SCENE_WIDTH}" height="${RIVER_HALF_HEIGHT * 2 + 14}" class="river-bank"></rect>
          <rect x="0" y="${y - RIVER_HALF_HEIGHT}" width="${SCENE_WIDTH}" height="${RIVER_HALF_HEIGHT * 2}" class="river"></rect>
          <path d="M 30 ${y - 24} q 60 -14 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0" class="river-wave"></path>
          <path d="M 90 ${y + 26} q 60 -14 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0" class="river-wave"></path>
        </g>
        <g transform="translate(${obstacle.x}, ${y})">${ASSETS.bridge(done)}</g>
        <g transform="translate(${obstacle.x + 118}, ${y + 108})">${ASSETS.npc()}</g>
      `;
    case "crossroads":
      return `
        <line x1="${Math.max(40, obstacle.x - 520)}" y1="${y}" x2="${obstacle.x - 120}" y2="${y}" class="hedge-line"></line>
        <line x1="${obstacle.x + 120}" y1="${y}" x2="${Math.min(SCENE_WIDTH - 40, obstacle.x + 520)}" y2="${y}" class="hedge-line"></line>
        <path d="M ${obstacle.x + 30} ${y + 6} C ${obstacle.x + 130} ${y - 10} ${obstacle.x + 200} ${y - 70} ${obstacle.x + 250} ${y - 150}" class="hidden-path-edge"></path>
        <path d="M ${obstacle.x + 30} ${y + 6} C ${obstacle.x + 130} ${y - 10} ${obstacle.x + 200} ${y - 70} ${obstacle.x + 250} ${y - 150}" class="hidden-path"></path>
        <g transform="translate(${obstacle.x - 110}, ${y - 30})">${ASSETS.signpost(done)}</g>
        <g class="mist-cloud">
          <ellipse cx="${obstacle.x + 190}" cy="${y - 74}" rx="72" ry="30" class="mist"></ellipse>
          <ellipse cx="${obstacle.x + 240}" cy="${y - 120}" rx="56" ry="24" class="mist"></ellipse>
        </g>
        <g transform="translate(${obstacle.x + 116}, ${y + 46})">${ASSETS.npc()}</g>
      `;
    default:
      return "";
  }
}

function obstacleMarkup(obstacle) {
  const status = obstacleStatus(obstacle.index);
  const recentlyUnlocked =
    state.justUnlockedIndex === obstacle.index && Date.now() < state.justUnlockedUntil;
  const theme = obstacleTheme(obstacle.type);
  const classes = [
    "obstacle",
    `obstacle-${status}`,
    `obstacle-${obstacle.type}`,
    recentlyUnlocked ? "obstacle-unlocking" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <g class="${classes}" data-obstacle-index="${obstacle.index}">
      ${obstacleSceneryMarkup(obstacle, status)}
      ${obstaclePlateMarkup(obstacle, status, theme)}
      ${obstacleMarkerMarkup(obstacle, status)}
    </g>
  `;
}

/* ============================================================
   RENDU DE LA SCENE
   ============================================================ */
function decorMarkup(scene) {
  const { decor } = scene;
  return `
    ${decor.patches
      .map(
        (patch) =>
          `<ellipse cx="${patch.x}" cy="${patch.y}" rx="${patch.rx}" ry="${patch.ry}" class="ground-patch ${patch.dark ? "dark" : ""}" opacity="0.4"></ellipse>`,
      )
      .join("")}
  `;
}

function propsMarkup(scene) {
  const { decor } = scene;
  return `
    ${decor.tufts.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.grassTuft()}</g>`).join("")}
    ${decor.flowers
      .map((p, index) => `<g transform="translate(${p.x}, ${p.y})">${index % 3 === 0 ? ASSETS.flowerPink() : ASSETS.flower()}</g>`)
      .join("")}
    ${decor.rocks.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.rock()}</g>`).join("")}
    ${decor.bushes.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.bush()}</g>`).join("")}
    ${decor.trees.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.tree()}</g>`).join("")}
  `;
}

function sceneMarkup(scene) {
  const roadPath = buildRoadPath(scene.routePoints);
  return `
    <rect x="0" y="0" width="${scene.width}" height="${scene.height}" class="ground"></rect>
    <g class="patch-layer">${decorMarkup(scene)}</g>
    <g class="branch-layer">${branchMarkup(scene)}</g>
    <g class="road-layer">
      <path d="${roadPath}" class="road-edge"></path>
      <path d="${roadPath}" class="road-surface"></path>
      <path d="${roadPath}" class="road-paving"></path>
      <path d="${roadPath}" class="road-paving offset" transform="translate(14, 10)"></path>
      <path d="${roadPath}" class="road-paving offset" transform="translate(-14, -8)"></path>
    </g>
    <g class="props-layer">${propsMarkup(scene)}</g>
    <g class="stops-layer">${stopsMarkup()}</g>
    <g class="obstacle-layer">
      ${scene.obstacles.map(obstacleMarkup).join("")}
    </g>
    <g id="interaction-hint" class="interaction-hint">
      <rect x="-118" y="-30" width="236" height="46" rx="20" class="hint-bubble"></rect>
      <rect x="-104" y="-21" width="64" height="28" rx="8" class="hint-key"></rect>
      <text x="-72" y="0" text-anchor="middle" class="hint-text">Entree</text>
      <text x="30" y="0" text-anchor="middle" class="hint-text" id="hint-action-text">pour aider !</text>
    </g>
    <g id="fx-layer"></g>
    <g id="player-token" class="player-token">${ASSETS.player()}</g>
  `;
}

/* ============================================================
   MINI-MAP : structure simplifiee du parcours en coin d'ecran.
   Vert = traverse, orange = courant, gris = a venir.
   ============================================================ */
function minimapStatus(index) {
  const currentIndex = currentConceptIndex();
  if (!state.session || currentIndex < 0) {
    return "locked";
  }
  if (state.session.terminee || index < currentIndex) {
    return "done";
  }
  return index === currentIndex ? "current" : "locked";
}

function renderMinimap() {
  if (!minimapSvg) {
    return;
  }
  if (!state.scene) {
    minimapSvg.innerHTML = "";
    return;
  }
  const scene = state.scene;
  minimapSvg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
  minimapSvg.innerHTML = `
    <path d="${buildRoadPath(scene.routePoints)}" class="mini-road"></path>
    ${
      state.reinforcement
        ? state.reinforcement.stops
            .map(
              (stop, i) =>
                `<circle cx="${stop.x}" cy="${stop.y}" r="34" class="mini-stop ${i < state.reinforcement.nextStopIndex ? "done" : ""}"></circle>`,
            )
            .join("")
        : ""
    }
    ${scene.obstacles
      .map(
        (obstacle) =>
          `<circle cx="${obstacle.x}" cy="${obstacle.barrierY}" r="64" class="mini-obstacle mini-${minimapStatus(obstacle.index)}"></circle>`,
      )
      .join("")}
    <circle id="minimap-player" r="46" class="mini-player"></circle>
  `;
  updateMinimapPlayer();
}

/* Dernieres valeurs ecrites dans le DOM par la boucle de jeu : evite de
   reecrire des attributs identiques a chaque frame (chaque setAttribute
   invalide le rendu du SVG). Invalide apres chaque re-rendu de la scene. */
const dynamicsCache = {
  playerTransform: null,
  playerWalking: null,
  hintTransform: null,
  hintVisible: null,
  hintText: null,
  minimapTransform: null,
};

function invalidateDynamicsCache() {
  for (const key of Object.keys(dynamicsCache)) {
    dynamicsCache[key] = null;
  }
}

/* Derriere un panneau plein ecran, la carte n'est plus qu'un decor masque
   par le voile de l'overlay. Ses animations infinies (marqueur de
   l'obstacle, anneau des fanions d'entrainement) continueraient pourtant de
   la repeindre en boucle sans que personne ne les voie : on les met en
   pause tant qu'un panneau est ouvert. */
function refreshScenePaused() {
  const overlays = [
    exerciseOverlay,
    document.getElementById("carnet-overlay"),
    document.getElementById("bilan-overlay"),
  ];
  const overlayOpen = overlays.some((node) => node && !node.classList.contains("hidden"));
  mapElement.classList.toggle("scene-paused", overlayOpen);
}

function updateMinimapPlayer() {
  const node = document.getElementById("minimap-player");
  if (node) {
    const transform = `translate(${state.playerPosition.x.toFixed(1)}, ${state.playerPosition.y.toFixed(1)})`;
    if (transform !== dynamicsCache.minimapTransform) {
      dynamicsCache.minimapTransform = transform;
      node.setAttribute("transform", transform);
    }
  }
}

function renderScene() {
  if (!state.session) {
    mapElement.innerHTML = "";
    renderMinimap();
    return;
  }
  state.scene = createSceneModel(state.session.concepts || []);
  state.reinforcement = computeReinforcementStops();
  mapElement.innerHTML = sceneMarkup(state.scene);
  invalidateDynamicsCache();
  renderMinimap();
  updateSceneDynamics();
  applyCameraViewBox();
}

/* ============================================================
   NAVIGATION ENTRE ECRANS
   ============================================================ */
function showStartScreen() {
  startScreen.classList.remove("hidden");
  lessonScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
}

function showLessonScreen() {
  startScreen.classList.add("hidden");
  lessonScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
}

function showGameScreen() {
  startScreen.classList.add("hidden");
  lessonScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
}

/* ============================================================
   MOUVEMENT + COLLISIONS (logique inchangee)
   ============================================================ */
function clampToBounds(position) {
  return {
    x: clamp(position.x, 40, state.scene.width - 40),
    y: clamp(position.y, 54, state.scene.height - 50),
  };
}

/* La prochaine cible d'interaction : le point d'arret de renforcement en
   attente, sinon l'obstacle courant a debloquer. */
function interactionTarget() {
  if (!state.session || state.session.terminee) {
    return null;
  }
  if (state.reinforcement) {
    const stop = state.reinforcement.stops[state.reinforcement.nextStopIndex];
    if (stop) {
      return { kind: "stop", x: stop.x, y: stop.y };
    }
  }
  const obstacle = activeObstacle();
  if (obstacle && obstacleStatus(obstacle.index) === "current") {
    return { kind: "obstacle", x: obstacle.x, y: obstacle.barrierY };
  }
  return null;
}

function applyCurrentBarrier(nextPosition, previousPosition) {
  if (state.panelOpen || !state.session || state.session.terminee) {
    return nextPosition;
  }
  const target = interactionTarget();
  if (!target) {
    return nextPosition;
  }
  const barrierY = target.y - PLAYER_RADIUS;
  if (previousPosition.y <= barrierY && nextPosition.y > barrierY) {
    return { ...nextPosition, y: barrierY };
  }
  return nextPosition;
}

function updateNearObstacle() {
  const target = interactionTarget();
  state.nearObstacle =
    Boolean(target) && distance(state.playerPosition, target) <= INTERACTION_DISTANCE;
}

function updateSceneDynamics() {
  if (!state.scene) {
    return;
  }

  const playerNode = document.getElementById("player-token");
  if (playerNode) {
    const playerTransform = `translate(${state.playerPosition.x.toFixed(1)}, ${state.playerPosition.y.toFixed(1)}) rotate(${state.playerAngle.toFixed(1)})`;
    if (playerTransform !== dynamicsCache.playerTransform) {
      dynamicsCache.playerTransform = playerTransform;
      playerNode.setAttribute("transform", playerTransform);
    }
    if (state.playerMoving !== dynamicsCache.playerWalking) {
      dynamicsCache.playerWalking = state.playerMoving;
      playerNode.classList.toggle("player-walking", state.playerMoving);
    }
  }

  const hintNode = document.getElementById("interaction-hint");
  const target = interactionTarget();
  const hintVisible = state.nearObstacle && !state.panelOpen;
  if (hintNode && target) {
    const hintY = target.kind === "stop" ? target.y - 84 : target.y - 152;
    const hintTransform = `translate(${target.x.toFixed(1)}, ${hintY.toFixed(1)})`;
    if (hintTransform !== dynamicsCache.hintTransform) {
      dynamicsCache.hintTransform = hintTransform;
      hintNode.setAttribute("transform", hintTransform);
    }
    const actionText = document.getElementById("hint-action-text");
    const hintText = target.kind === "stop" ? "s'entrainer !" : "pour aider !";
    if (actionText && hintText !== dynamicsCache.hintText) {
      dynamicsCache.hintText = hintText;
      actionText.textContent = hintText;
    }
  }
  /* La bulle remplace le marqueur "!" quand le joueur est assez proche. */
  if (hintVisible !== dynamicsCache.hintVisible) {
    dynamicsCache.hintVisible = hintVisible;
    hintNode?.classList.toggle("visible", hintVisible);
    mapElement.classList.toggle("hint-visible", hintVisible);
  }
  updateMinimapPlayer();
}

/* ============================================================
   PARTICULES DE REUSSITE
   ============================================================ */
function starPathMarkup(radius) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const r = index % 2 === 0 ? radius : radius * 0.45;
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    points.push(`${Math.cos(angle) * r},${Math.sin(angle) * r}`);
  }
  return points.join(" ");
}

function spawnUnlockFx(x, y) {
  const fxLayer = document.getElementById("fx-layer");
  if (!fxLayer) {
    return;
  }
  const pieces = [];
  for (let index = 0; index < 16; index += 1) {
    const angle = (Math.PI * 2 * index) / 16 + Math.random() * 0.5;
    const range = 90 + Math.random() * 110;
    const tx = Math.cos(angle) * range;
    const ty = Math.sin(angle) * range - 40;
    const isStar = index % 2 === 0;
    const shape = isStar
      ? `<polygon points="${starPathMarkup(12)}" class="fx-star"></polygon>`
      : `<circle r="6" class="fx-dot"></circle>`;
    pieces.push({ tx, ty, shape });
  }
  fxLayer.innerHTML = pieces
    .map(
      (piece) =>
        `<g transform="translate(${x}, ${y})"><g class="fx-particle" style="--tx: ${piece.tx}px; --ty: ${piece.ty}px;">${piece.shape}</g></g>`,
    )
    .join("");
  window.setTimeout(() => {
    const layer = document.getElementById("fx-layer");
    if (layer) {
      layer.innerHTML = "";
    }
  }, 1300);
}

/* ============================================================
   POPUP D'EXERCICE THEMATIQUE
   ============================================================ */
function starsMarkup(level) {
  const stars = [1, 2, 3]
    .map((step) => `<span class="star ${step <= level ? "filled" : ""}">★</span>`)
    .join("");
  return `<span class="stars" role="img" aria-label="Niveau ${level} sur 3">${stars}</span>`;
}

function openExercisePanel() {
  if (!state.currentExercise || !state.nearObstacle || state.panelOpen) {
    return;
  }
  state.panelOpen = true;
  state.keysPressed.clear();
  state.playerMoving = false;
  renderExerciseModal();
  updateSceneDynamics();
  refreshScenePaused();
}

function closeExercisePanel() {
  /* Si une correction attendait le bouton "Continuer", on applique quand
     meme la progression : le backend a deja avance. */
  finalizePendingEvaluation();
  window.ParcoursProactive?.panelClosed();
  state.panelOpen = false;
  exerciseOverlay.classList.add("hidden");
  exerciseModal.innerHTML = "";
  updateNearObstacle();
  updateSceneDynamics();
  refreshScenePaused();
}

function renderExerciseModal() {
  if (!state.panelOpen || !state.currentExercise || !state.session) {
    return;
  }

  const exercise = state.currentExercise;
  const confidence = isConfidenceExercise();
  const obstacle = activeObstacle();
  const atStop = Boolean(state.reinforcement);
  const theme = confidence
    ? { modalClass: "theme-confiance", title: "Petite pause !", intro: CONFIANCE_INTRO }
    : atStop
      ? stopTheme()
      : obstacleTheme(obstacle?.type);
  const mechanic = window.ParcoursMechanics
    ? window.ParcoursMechanics.choose(exercise, state.session.concept_index || 0)
    : "clavier";
  const resolutionKey = state.session.presentation_courante;
  const details = exercise.presentations?.[resolutionKey] || {};
  const steps = (details.etapes_methode || []).map((step) => `<li>${step}</li>`).join("");
  const level = state.session.niveau_resolution_courant || 1;
  const phaseChip =
    state.session.phase === "renforcement"
      ? `Entrainement : encore ${state.session.exercices_renforcement_restants}`
      : "A toi de jouer !";

  exerciseModal.className = `exercise-modal ${theme.modalClass}`;
  exerciseModal.innerHTML = `
    <button id="close-exercise" class="modal-close" type="button" aria-label="Fermer">&#10005;</button>
    <div class="modal-head">
      <span class="modal-icon">${
        confidence ? confidenceOwlSvg() : atStop ? stopIconSvg() : obstacleIconSvg(obstacle?.type, "current")
      }</span>
      <div>
        <h2 class="modal-title">${theme.title}</h2>
        <p class="modal-intro">${theme.intro}</p>
      </div>
    </div>
    <div class="modal-paper">
      ${
        /* L'aparte ne compte pas dans la progression : ni etoiles de niveau,
           ni compteur d'entrainement, juste un mot rassurant du hibou. */
        confidence
          ? `<p class="confiance-chip">Cet exercice ne compte pas dans ton parcours.</p>`
          : `<div class="modal-meta">
              ${starsMarkup(level)}
              <span class="phase-chip">${phaseChip}</span>
            </div>`
      }
      <p class="exercise-statement">${exercise.enonce}</p>
      ${
        steps && details.aide_affichee
          ? `<div class="method-block">
              <p class="method-title">La methode :</p>
              <ol>${steps}</ol>
            </div>`
          : ""
      }
      <form id="exercise-form" class="exercise-form" data-mechanic="${mechanic}">
        ${
          mechanic === "clavier"
            ? `<label for="answer-input">Ta reponse</label>
               <div class="answer-row">
                 <input id="answer-input" name="answer" type="text" autocomplete="off" inputmode="numeric" />
                 <button id="mic-button" class="mic-button" type="button" aria-label="Repondre a la voix" title="Reponds a la voix">
                   <svg viewBox="0 0 32 32" aria-hidden="true">
                     <rect x="12" y="4" width="8" height="15" rx="4" fill="currentColor"></rect>
                     <path d="M8 15 a 8 8 0 0 0 16 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></path>
                     <line x1="16" y1="23" x2="16" y2="27" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></line>
                     <line x1="11" y1="27" x2="21" y2="27" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></line>
                   </svg>
                   <span class="mic-pulse" aria-hidden="true"></span>
                 </button>
               </div>
               <p id="mic-status" class="mic-status"></p>`
            : `<input id="answer-input" name="answer" type="hidden" />
               <div id="mechanic-area" class="mechanic-area"></div>`
        }
        <div class="exercise-actions">
          <button type="submit" class="btn-primary">Valider</button>
          <button id="help-button" type="button" class="btn-help">&#129417; Aide</button>
        </div>
      </form>
    </div>
  `;
  exerciseOverlay.classList.remove("hidden");

  const form = document.getElementById("exercise-form");
  form.addEventListener("submit", handleSubmitAnswer);
  document.getElementById("help-button").addEventListener("click", () => {
    window.ParcoursChat?.open();
    document.getElementById("chat-input")?.focus();
  });
  document.getElementById("close-exercise").addEventListener("click", closeExercisePanel);
  /* Tuteur proactif : suit l'exercice affiche et le niveau de guidage
     (seuils plus prudents au niveau 3 autonome). */
  window.ParcoursProactive?.exerciseShown(exercise.id, level);
  if (mechanic === "clavier") {
    /* Reponse a la voix en COMPLEMENT du clavier (retire le bouton si
       l'API Web Speech est absente ou si le micro a ete refuse). */
    window.ParcoursVoice?.attach();
    document.getElementById("answer-input")?.focus();
  } else {
    window.ParcoursMechanics.mount(document.getElementById("mechanic-area"), mechanic, exercise, {
      setValue: (value) => {
        document.getElementById("answer-input").value = value;
      },
      submit: () => form.requestSubmit(),
    });
  }
}

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
    ? "Parcours termine !"
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

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
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
  lessonTitle.textContent = state.selectedLevel
    ? `Choisis une lecon de ${state.selectedLevel}`
    : "Choisis ta lecon";

  lessonActions.innerHTML = state.availableLessons
    .map(
      (lesson) => `
        <button class="lesson-card" type="button" data-lesson-id="${lesson.lecon_id}">
          <span class="lesson-card-icon">${LESSON_ICONS[lesson.lecon_id] || "★"}</span>
          <span>
            <span class="lesson-card-title">${lesson.nom}</span><br />
            <span class="lesson-card-copy">${lesson.pattern_count} defi(s) a relever</span>
          </span>
        </button>
      `,
    )
    .join("");

  lessonActions.querySelectorAll(".lesson-card").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await startSession(state.selectedLevel, button.dataset.lessonId);
      } catch (error) {
        lessonStatus.textContent = `Impossible de demarrer la session : ${error.message}`;
      }
    });
  });
}

async function loadLessons(level) {
  state.selectedLevel = level;
  lessonStatus.textContent = "Chargement des lecons...";
  const payload = await request(`/lecons/${level}`, { method: "GET" });
  state.availableLessons = payload.lecons || [];
  if (!state.availableLessons.length) {
    throw new Error("Aucune lecon disponible pour ce niveau.");
  }
  renderLessonChoices();
  lessonStatus.textContent = "Choisis une lecon pour commencer.";
  showLessonScreen();
}

async function startSession(level, lessonId) {
  lessonStatus.textContent = "Creation de la session...";
  const payload = await request("/session/demarrer", {
    method: "POST",
    body: JSON.stringify({ niveau_scolaire: level, lecon_id: lessonId }),
  });

  state.sessionId = payload.session_id;
  state.playerPosition = { x: START_X, y: START_Y };
  state.playerAngle = 0;
  state.panelOpen = false;
  state.justUnlockedIndex = null;
  state.justUnlockedUntil = 0;
  state.camera = { x: START_X, y: START_Y };
  state.reinforcement = null;
  state.pendingEvaluation = null;
  resetScore();
  state.selectedLesson =
    state.availableLessons.find((lesson) => lesson.lecon_id === lessonId) || {
      lecon_id: lessonId,
      nom: lessonId,
    };
  applySessionSnapshot(payload.progression, payload.exercice);
  showGameScreen();
  clearFeedback();
  window.ParcoursAudio?.setMusicActive(true);
}

function openingMessage(obstacleType) {
  switch (obstacleType) {
    case "castle_gate":
      return "Bravo ! La porte du chateau s'ouvre !";
    case "blocked_road":
      return "Bravo ! La route est degagee !";
    case "broken_bridge":
      return "Bravo ! Le pont est repare !";
    case "crossroads":
      return "Bravo ! Le chemin cache apparait !";
    default:
      return "Bravo ! Tu peux continuer !";
  }
}

function feedbackFromStatus(status, context) {
  switch (status) {
    case "correct_niveau_suivant":
      return {
        message: "Bravo ! Tu gagnes une etoile, continue !",
        tone: "success",
      };
    case "correct_nouveau_renforcement":
      if (context.previousPhase === "detection_maitrise") {
        return {
          message: `${openingMessage(context.previousObstacle?.type)} Suis la route jusqu'au premier fanion d'entrainement.`,
          tone: "success",
        };
      }
      return {
        message: "Bravo ! Continue jusqu'au prochain fanion !",
        tone: "success",
      };
    case "correct_concept_debloque":
      return {
        message: "Bravo ! Entrainement termine, un nouveau defi t'attend plus loin !",
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
      return {
        message: "Felicitations, tout le parcours est termine !",
        tone: "success",
      };
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
  const exercise = context.answeredExercise;
  const guideSteps = exercise.presentations?.["1_guide"]?.etapes_methode || [];
  const explanation = guideSteps.length ? guideSteps[guideSteps.length - 1] : "";
  const expected = exercise.reponse_attendue?.valeur;
  const expectedText = Array.isArray(expected) ? expected.join(", ") : String(expected);

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
    <p class="correction-verdict">${payload.correct ? "C'est juste, bravo !" : "Pas tout a fait..."}</p>
    <p class="correction-answer">La bonne reponse : <strong>${expectedText}</strong></p>
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
        ? "Choisis ta reponse avant de valider."
        : "Entre une reponse avant de valider.",
      "warning",
    );
    return;
  }

  /* Toute soumission (juste ou fausse) compte comme une interaction pour
     le detecteur d'inactivite du tuteur proactif. */
  window.ParcoursProactive?.activity();

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
    /* 503 = generation du prochain exercice indisponible : la session n'a pas
       bouge cote backend, l'eleve peut simplement revalider la meme reponse. */
    if (error.status === 503) {
      setFeedback("Un instant, je prepare la suite... reessaie dans quelques secondes !", "wait");
    } else {
      setFeedback(error.message, "warning");
    }
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
  state.pendingEvaluation = null;
  resetScore();
  window.ParcoursAudio?.setMusicActive(false);
  mapElement.innerHTML = "";
  if (minimapSvg) {
    minimapSvg.innerHTML = "";
  }
  exerciseOverlay.classList.add("hidden");
  exerciseModal.innerHTML = "";
  clearFeedback();
  window.ParcoursChat?.reset();
  window.ParcoursProactive?.panelClosed();
  refreshScenePaused();
}

function resetToStart() {
  resetSharedState();
  state.selectedLevel = null;
  state.availableLessons = [];
  state.selectedLesson = null;
  showStartScreen();
  startStatus.textContent = "Choisis un niveau pour demarrer une nouvelle session.";
  lessonStatus.textContent = "";
  lessonActions.innerHTML = "";
}

function returnToLessonChoice() {
  resetSharedState();
  renderLessonChoices();
  lessonStatus.textContent = "Choisis une lecon pour commencer.";
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
    state.score = Number.isFinite(saved.score) ? saved.score : 0;
    refreshScoreDisplay();
    const position = saved.playerPosition;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      state.playerPosition = { x: position.x, y: position.y };
      state.camera = { x: position.x, y: position.y };
    }
    applySessionSnapshot(snapshot);
    showGameScreen();
    window.ParcoursAudio?.setMusicActive(true);
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

/* ============================================================
   CLAVIER
   ============================================================ */
function handleKeyDown(event) {
  if (!state.session) {
    return;
  }

  const tagName = document.activeElement?.tagName?.toLowerCase();
  const isTyping = tagName === "input" || tagName === "textarea";

  if ((event.key === "Enter" || event.key === " ") && !state.panelOpen && state.nearObstacle && !isTyping) {
    event.preventDefault();
    openExercisePanel();
    return;
  }

  if (event.key === "Escape" && state.panelOpen) {
    closeExercisePanel();
    return;
  }

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && !isTyping && !state.panelOpen) {
    event.preventDefault();
    state.keysPressed.add(event.key);
  }
}

function handleKeyUp(event) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    state.keysPressed.delete(event.key);
  }
}

function movementVector() {
  let dx = 0;
  let dy = 0;
  if (state.keysPressed.has("ArrowLeft")) dx -= 1;
  if (state.keysPressed.has("ArrowRight")) dx += 1;
  if (state.keysPressed.has("ArrowUp")) dy -= 1;
  if (state.keysPressed.has("ArrowDown")) dy += 1;

  if (dx === 0 && dy === 0) {
    return null;
  }

  const length = Math.hypot(dx, dy);
  return { dx: dx / length, dy: dy / length };
}

/* Rotation la plus courte vers l'angle cible (le perso regarde ou il va). */
function easeAngle(current, target, factor) {
  let delta = ((target - current + 540) % 360) - 180;
  return current + delta * factor;
}

/* ============================================================
   BOUCLE DE JEU : mouvement, marche, camera avec easing
   ============================================================ */
function tick(timestamp) {
  if (!lastTick) {
    lastTick = timestamp;
  }
  const deltaSeconds = Math.min((timestamp - lastTick) / 1000, 0.05);
  lastTick = timestamp;

  if (state.scene && state.session && !state.panelOpen && !state.session.terminee) {
    const vector = movementVector();
    state.playerMoving = Boolean(vector);
    if (vector) {
      const proposed = {
        x: state.playerPosition.x + vector.dx * PLAYER_SPEED * deltaSeconds,
        y: state.playerPosition.y + vector.dy * PLAYER_SPEED * deltaSeconds,
      };
      const bounded = clampToBounds(proposed);
      state.playerPosition = applyCurrentBarrier(bounded, state.playerPosition);

      /* Le personnage est dessine face au sud : on oriente vers la direction. */
      const targetAngle = (Math.atan2(vector.dy, vector.dx) * 180) / Math.PI - 90;
      state.playerAngle = easeAngle(state.playerAngle, targetAngle, Math.min(1, deltaSeconds * 14));
      window.ParcoursAudio?.footstep(performance.now());
    }
    updateNearObstacle();
    updateSceneDynamics();
  } else {
    state.playerMoving = false;
  }

  /* Suivi de camera avec easing doux (jamais de recentrage brutal). Sous un
     dixieme de pixel, la camera s'aimante sur la cible : l'easing s'arrete
     vraiment et applyCameraViewBox cesse d'ecrire (donc de repeindre). */
  if (state.scene) {
    const target = clampCamera({ x: state.playerPosition.x, y: state.playerPosition.y });
    const factor = 1 - Math.exp(-CAMERA_EASE * deltaSeconds);
    state.camera.x += (target.x - state.camera.x) * factor;
    state.camera.y += (target.y - state.camera.y) * factor;
    if (Math.abs(target.x - state.camera.x) < 0.1) state.camera.x = target.x;
    if (Math.abs(target.y - state.camera.y) < 0.1) state.camera.y = target.y;
    applyCameraViewBox();
  }

  /* Position sauvegardee regulierement (le beforeunload couvre le reste). */
  if (state.sessionId && timestamp - lastPositionSaveAt > 2000) {
    lastPositionSaveAt = timestamp;
    saveSessionRef();
  }

  animationFrameId = window.requestAnimationFrame(tick);
}

/* ============================================================
   MENU DU HUD
   ============================================================ */
function closeMenuDropdown() {
  menuDropdown.classList.add("hidden");
  menuButton.setAttribute("aria-expanded", "false");
}

const muteButton = document.getElementById("mute-button");
if (window.ParcoursAudio?.isMuted()) {
  muteButton.classList.add("muted");
  muteButton.setAttribute("aria-pressed", "true");
}
muteButton.addEventListener("click", () => {
  const muted = window.ParcoursAudio?.toggleMute() ?? false;
  muteButton.classList.toggle("muted", muted);
  muteButton.setAttribute("aria-pressed", String(muted));
});

minimapButton.addEventListener("click", () => {
  const expanded = minimapButton.classList.toggle("expanded");
  minimapButton.setAttribute("aria-expanded", String(expanded));
});

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const isHidden = menuDropdown.classList.toggle("hidden");
  menuButton.setAttribute("aria-expanded", String(!isHidden));
});

document.addEventListener("click", (event) => {
  if (!menuDropdown.classList.contains("hidden") && !menuDropdown.contains(event.target)) {
    closeMenuDropdown();
  }
});

/* ============================================================
   BRANCHEMENTS UI
   ============================================================ */
document.querySelectorAll(".level-button").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await loadLessons(button.dataset.level);
    } catch (error) {
      startStatus.textContent = `Impossible de demarrer la session : ${error.message}`;
    }
  });
});

restartButton.addEventListener("click", () => {
  closeMenuDropdown();
  resetToStart();
});

document.getElementById("new-adventure-button").addEventListener("click", () => {
  closeMenuDropdown();
  /* resetToStart efface aussi la reference de session en localStorage. */
  resetToStart();
});

window.addEventListener("beforeunload", saveSessionRef);

changeLessonButton.addEventListener("click", () => {
  closeMenuDropdown();
  returnToLessonChoice();
});

backToLevelsButton.addEventListener("click", resetToStart);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

window.ParcoursApp = {
  getSessionId: () => state.sessionId,
  getCurrentExercise: () => state.currentExercise,
  getSessionLevel: () => levelLabel(),
  getSessionSnapshot: () => state.session,
  syncSession,
  setFeedback,
  isPanelOpen: () => state.panelOpen,
  isNearObstacle: () => state.nearObstacle,
  getPlayerPosition: () => ({ ...state.playerPosition }),
  getActiveObstacle: () => {
    const obstacle = activeObstacle();
    return obstacle ? { x: obstacle.x, y: obstacle.barrierY, type: obstacle.type } : null;
  },
  getReinforcement: () => state.reinforcement,
  getInteractionTarget: () => interactionTarget(),
  openExercisePanel,
  refreshScenePaused,
};

if (!animationFrameId) {
  animationFrameId = window.requestAnimationFrame(tick);
}

/* Au chargement : tentative de reprise de la session sauvegardee. */
tryResumeSession();
