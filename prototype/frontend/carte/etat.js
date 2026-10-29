/* carte/etat.js — Constantes, références DOM et état global du jeu.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

/* Adresse du backend : voir config.js (locale en dev, production sinon). */
const API_BASE_URL = (globalThis.PARCOURS_CONFIG?.API_BASE || "https://parcours-maths-ia.onrender.com");
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
const INTERACTION_DISTANCE = 118;
/* ------------------------------------------------------------
   P5 : couche carte composite (viewBox statique + translate3d).
   Le viewBox devient une SUPER-FENETRE (zone visible + marge) reecrite
   rarement ; le suivi camera image par image se fait par translate3d GPU
   (0 repaint). Voir le bloc CAMERA plus bas. Independant de P1 (budget
   d'ambiance reduit sur mobile), qui reste actif en parallele. */
const SUPER_MARGIN_TARGET_PX = 600; /* marge visee autour du viewport (px CSS) */
const MAX_LAYER_TEXTURE_PX = 4096;  /* borne conservatrice de texture GPU (px device) */
const RECENTER_PAD = 0.12;          /* fraction de marge gardee en securite */
/* Delai d'immobilite avant de figer les animations d'ambiance (Fix perf) :
   assez court pour endormir vite le compositeur au repos, assez long pour ne
   pas clignoter entre deux pas. */
const SCENE_IDLE_DELAY_MS = 700;
/* Positions/ordre des obstacles et tracé du chemin : desormais procéduraux,
   generes par world.js a partir de la graine de session (state.mapSeed). */
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
  multiplication_division: "÷",
  mesures_masse_duree: "kg",
  lecture_heure: "🕐",
  proportionnalite: "⚖",
  geometrie_figures: "△",
  cercle: "◯",
  triangles: "▲",
  angles: "∠",
  symetrie: "🦋",
  prismes: "📦",
  solides: "🧊",
  agrandissement: "🔍",
  echelle: "🗺",
  nombres_decimaux: "0,5",
  durees: "🕒",
  pourcentage: "%",
  vitesse: "🚗",
};

const startScreen = document.getElementById("start-screen");
const lessonScreen = document.getElementById("lesson-screen");
const gameScreen = document.getElementById("game-screen");
const startStatus = document.getElementById("start-status");
const lessonTitle = document.getElementById("lesson-title");
const lessonActions = document.getElementById("lesson-actions");
const revisionZone = document.getElementById("revision-zone");
const assignationZone = document.getElementById("assignation-zone");
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
const feedback = document.getElementById("feedback");
const offlineBanner = document.getElementById("offline-banner");
const exerciseOverlay = document.getElementById("exercise-overlay");
const exerciseModal = document.getElementById("exercise-modal");
const debugLog = document.getElementById("debug-log");
const touchDpad = document.getElementById("touch-dpad");
const touchActionButton = document.getElementById("touch-action");
/* Appareil tactile : le pave directionnel remplace le clavier (indisponible).
   Fige au chargement (le type de pointeur ne change pas en cours de session). */
const estAppareilTactile = Boolean(window.ParcoursTouch?.estTactile?.());

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
  assignations: [], /* travaux assignes en attente (eleve connecte) */
  reinforcement: null,
  /* Tresor du raccourci courant, et cles de ceux deja ramasses dans cette
     session (persistees avec la reference de session : un rechargement ne
     doit pas les faire repousser). */
  treasure: null,
  treasuresCollected: new Set(),
  pendingEvaluation: null,
  score: 0,
  /* Ambiance (purement decoratif, aucune incidence sur le jeu) :
     - ramassables aleatoires de la carte courante (regeneres a chaque
       nouvelle carte, reperee par sa signature) ;
     - teinte jour/heure calculee une seule fois. */
  collectibles: [],
  collectiblesSig: null,
  sceneTint: null,
  /* Graine du monde procédural : figée au démarrage d'une session, persistée
     avec la référence de session (la carte reste identique toute la partie et
     a la reprise), renouvelée seulement a une nouvelle aventure. */
  mapSeed: null,
  /* Mode hors-ligne (essai libre uniquement) : vrai quand le backend est
     injoignable et que l'élève s'entraîne sur le tampon local. Miroir pratique
     de ParcoursOffline.estHorsLigne() pour le rendu ; toute la logique de
     tampon/bascule vit dans offline.js. */
  offlineActif: false,
};

/* Graine 32 bits pour une nouvelle carte. crypto si dispo, sinon Math.random. */
function genererGraineMonde() {
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
    }
  } catch (_error) {
    /* environnement sans crypto : repli ci-dessous */
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/* Repli deterministe : derive une graine du sessionId (anciennes sauvegardes
   sans mapSeed, pour ne pas regenerer un monde different a la reprise). */
function graineDepuisSessionId(sessionId) {
  const texte = String(sessionId ?? "");
  let h = 2166136261;
  for (let i = 0; i < texte.length; i += 1) {
    h = Math.imul(h ^ texte.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

let animationFrameId = null;
let lastTick = 0;
let lastPositionSaveAt = 0;
let lastMoveAt = 0; /* horodatage du dernier deplacement (detection du repos) */
let feedbackTimer = null;
let feedbackLeaveTimer = null;
/* Minuteries du mode hors-ligne : renouvellement du tampon tant qu'on est en
   ligne, et sondage de reconnexion tant qu'on est hors-ligne. */
let prefetchTimer = null;
let reconnectTimer = null;
const PREFETCH_INTERVAL_MS = 9000;
const RECONNECT_INTERVAL_MS = 5000;

function logDebug(entry) {
  if (debugLog) {
    debugLog.textContent += `${entry}\n`;
  }
}
