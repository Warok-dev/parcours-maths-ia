const API_BASE_URL = "https://parcours-maths-ia.onrender.com";
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
const minimapButton = document.getElementById("minimap");
const minimapSvg = document.getElementById("minimap-svg");
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

/* ============================================================
   ASSETS SVG REUTILISABLES
   Chaque asset est defini UNE fois ici et utilise partout
   (scene ET icones des popups) sans jamais etre redessine.
   Tous sont dessines centres sur (0,0), vue du dessus.
   ============================================================ */
const ASSETS = {
  /* Le personnage porte l'apparence choisie par l'eleve : la couleur passe
     par les variables CSS (--player-shirt), les accessoires s'inserent ici
     en deux couches, sous le corps puis par-dessus la tete. */
  player() {
    const accessoire = (couche) => window.ParcoursPersonnage?.markupAccessoire?.(couche) || "";
    return `
      <ellipse cx="0" cy="6" rx="20" ry="14" class="player-shadow"></ellipse>
      <circle cx="-13" cy="14" r="6" class="player-foot left"></circle>
      <circle cx="13" cy="14" r="6" class="player-foot right"></circle>
      ${accessoire("arriere")}
      <ellipse cx="0" cy="2" rx="19" ry="15" class="player-body"></ellipse>
      <circle cx="-19" cy="2" r="6.5" class="player-hand left"></circle>
      <circle cx="19" cy="2" r="6.5" class="player-hand right"></circle>
      <circle cx="0" cy="-3" r="12.5" class="player-head"></circle>
      <path d="M -12 -6 a 12.5 12.5 0 0 1 24 0 q -6 -7 -12 -7 q -6 0 -12 7 Z" class="player-hair"></path>
      ${accessoire("avant")}
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

  /* Papillon vu du dessus : corps + 2 ailes qui battent (classe CSS). Dessine
     centre sur (0,0) ; le battement est purement decoratif. */
  butterfly(variant) {
    const aile = variant === "bleu" ? "critter-wing bleu" : "critter-wing";
    return `
      <g class="critter-wings">
        <ellipse cx="-4.5" cy="-2.5" rx="4.5" ry="3.6" class="${aile}"></ellipse>
        <ellipse cx="-4" cy="3" rx="3.6" ry="3" class="${aile}"></ellipse>
        <ellipse cx="4.5" cy="-2.5" rx="4.5" ry="3.6" class="${aile} droite"></ellipse>
        <ellipse cx="4" cy="3" rx="3.6" ry="3" class="${aile} droite"></ellipse>
      </g>
      <ellipse cx="0" cy="0" rx="1.4" ry="5.5" class="critter-body"></ellipse>
      <path d="M -0.6 -5.5 q -2 -2.4 -3.2 -1 M 0.6 -5.5 q 2 -2.4 3.2 -1" class="critter-antenna"></path>
    `;
  },

  /* Chat vu du dessus : corps + tete + oreilles + queue qui remue (classe CSS).
     Dessine tete vers le HAUT (-y) ; le groupe exterieur l'oriente/deplace. */
  cat() {
    return `
      <ellipse cx="0" cy="7" rx="12" ry="7" class="tree-shadow"></ellipse>
      <path d="M 3 8 q 12 2 9 -8" class="cat-tail"></path>
      <ellipse cx="0" cy="2" rx="8" ry="11" class="cat-body"></ellipse>
      <path d="M -6 -8 l -1 -6 l 6 3 Z" class="cat-body"></path>
      <path d="M 6 -8 l 1 -6 l -6 3 Z" class="cat-body"></path>
      <circle cx="0" cy="-8" r="7" class="cat-head"></circle>
      <circle cx="-2.4" cy="-9" r="1.1" class="cat-eye"></circle>
      <circle cx="2.4" cy="-9" r="1.1" class="cat-eye"></circle>
      <path d="M -1.6 -6 q 1.6 1.4 3.2 0" class="cat-mouth"></path>
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

  /* Tresor du raccourci : petit coffre vu du dessus, cercle de lueur et
     eclats qui scintillent. Bois et or de la palette, comme les panneaux.
     Les elements animes en CSS sont toujours a l'origine de leur groupe :
     une transformation CSS ecrase l'attribut transform du SVG. */
  treasure() {
    return `
      <ellipse cx="2" cy="14" rx="20" ry="9" class="tree-shadow"></ellipse>
      <circle cx="0" cy="0" r="27" class="treasure-glow"></circle>
      <rect x="-18" y="-13" width="36" height="27" rx="6" class="treasure-body"></rect>
      <rect x="-18" y="-13" width="36" height="11" rx="5" class="treasure-lid"></rect>
      <rect x="-18" y="-4" width="36" height="4" class="treasure-band"></rect>
      <rect x="-4" y="-6" width="8" height="9" rx="2" class="treasure-lock"></rect>
      <g transform="translate(19, -17)">
        <polygon points="${starPathMarkup(7)}" class="treasure-sparkle"></polygon>
      </g>
      <g transform="translate(-19, -12)">
        <polygon points="${starPathMarkup(4.5)}" class="treasure-sparkle delayed"></polygon>
      </g>
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

  /* Horloge analogique parametree par (heure, minute). Definition UNIQUE de
     l'asset ; la geometrie des aiguilles vient de ParcoursMechanics.clockAngles
     (meme source que le mecanisme de reponse et les tests). Dessinee centree
     sur (0,0), vue de face. */
  clock(heure, minute) {
    const angles = window.ParcoursMechanics?.clockAngles?.(heure, minute) || {
      hourAngle: 0,
      minuteAngle: 0,
    };
    const point = (angleDeg, length) => {
      const rad = (angleDeg * Math.PI) / 180;
      return {
        x: (Math.sin(rad) * length).toFixed(1),
        y: (-Math.cos(rad) * length).toFixed(1),
      };
    };
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const rad = (i * 30 * Math.PI) / 180;
      const inner = i % 3 === 0 ? 37 : 42;
      const x1 = (Math.sin(rad) * inner).toFixed(1);
      const y1 = (-Math.cos(rad) * inner).toFixed(1);
      const x2 = (Math.sin(rad) * 47).toFixed(1);
      const y2 = (-Math.cos(rad) * 47).toFixed(1);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="clock-tick${i % 3 === 0 ? " major" : ""}"></line>`;
    }).join("");
    const hEnd = point(angles.hourAngle, 25);
    const mEnd = point(angles.minuteAngle, 39);
    return `
      <circle cx="0" cy="2" r="53" class="clock-shadow"></circle>
      <circle cx="0" cy="0" r="52" class="clock-rim"></circle>
      <circle cx="0" cy="0" r="48" class="clock-face"></circle>
      ${ticks}
      <line x1="0" y1="0" x2="${mEnd.x}" y2="${mEnd.y}" class="clock-hand minute"></line>
      <line x1="0" y1="0" x2="${hEnd.x}" y2="${hEnd.y}" class="clock-hand hour"></line>
      <circle cx="0" cy="0" r="4.5" class="clock-center"></circle>
    `;
  },

  /* Ramassable d'exploration : piece brillante OU fleur, volontairement
     distinct du coffre-tresor du raccourci (rond/dore ou fleur vive). */
  collectible(type) {
    if (type === "fleur") {
      return `
        <ellipse cx="0" cy="9" rx="10" ry="4" class="collectible-shadow"></ellipse>
        <rect x="-1.4" y="0" width="2.8" height="12" rx="1.4" class="collectible-stem"></rect>
        <circle cx="0" cy="-8" r="6" class="collectible-petal"></circle>
        <circle cx="7" cy="-2" r="6" class="collectible-petal"></circle>
        <circle cx="-7" cy="-2" r="6" class="collectible-petal"></circle>
        <circle cx="4.6" cy="6" r="6" class="collectible-petal"></circle>
        <circle cx="-4.6" cy="6" r="6" class="collectible-petal"></circle>
        <circle cx="0" cy="0" r="4.2" class="collectible-flower-heart"></circle>
      `;
    }
    return `
      <ellipse cx="0" cy="11" rx="11" ry="4.5" class="collectible-shadow"></ellipse>
      <circle cx="0" cy="0" r="13" class="collectible-glow"></circle>
      <circle cx="0" cy="0" r="11" class="collectible-coin"></circle>
      <circle cx="0" cy="0" r="7.5" class="collectible-coin-inner"></circle>
      <polygon points="${starPathMarkup(5)}" class="collectible-coin-star"></polygon>
      <circle cx="-4" cy="-4" r="2.2" class="collectible-coin-shine"></circle>
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
   ORIENTATION (direction dominante du parcours)
   La scene est generee/jouee en espace NATIF (progression vers +y) ; la
   direction tiree par la graine (world.js) est une rotation d'affichage
   d'un multiple de 90°. Ces helpers relaient la transformation de world.js
   au rendu, a la camera, a la mini-carte et au clavier. La logique de jeu
   (position joueur, obstacles, collisions) reste, elle, en natif.
   ============================================================ */
function orientTransform() {
  return state.scene?.orientTransform || "matrix(1,0,0,1,0,0)";
}

/* Angle a appliquer aux SEULS elements textuels (plaques, marqueurs, indice,
   bonus) pour les garder droits : ils sont dans le groupe pivote, on annule
   donc localement la rotation. "" quand il n'y a rien a corriger (down). */
function uprightSuffix() {
  const angle = state.scene?.orientAngle || 0;
  return angle ? ` rotate(${-angle})` : "";
}

/* Espace d'affichage (dimensions et projection d'un point natif). */
function displayWidth() {
  return state.scene?.displayWidth || state.scene?.width || 0;
}
function displayHeight() {
  return state.scene?.displayHeight || state.scene?.height || 0;
}
function toDisplay(point) {
  if (!state.scene) {
    return { x: point.x, y: point.y };
  }
  return window.ParcoursWorld.toDisplayPoint(
    point,
    state.scene.direction,
    state.scene.width,
    state.scene.height,
  );
}

/* ============================================================
   CAMERA
   La camera vit en espace d'AFFICHAGE (ce que voit l'ecran) : elle suit la
   projection de la position joueur et se borne aux dimensions d'affichage
   (echangees pour les rotations a 90°).
   ============================================================ */
function clampCamera(cameraTarget) {
  if (!state.scene) {
    return cameraTarget;
  }
  return {
    x: clamp(cameraTarget.x, CAMERA_WIDTH / 2, displayWidth() - CAMERA_WIDTH / 2),
    y: clamp(cameraTarget.y, CAMERA_HEIGHT / 2, displayHeight() - CAMERA_HEIGHT / 2),
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
   La geometrie procedurale (tracé serpentin, positions et ordre des
   obstacles, décor, branches de renforcement) vit dans world.js —
   module pur testable en Node (test_world.js, >= 200 graines). Ici on
   ne fait que deleguer, en passant la graine de la session courante
   (state.mapSeed) pour que la carte reste stable toute la partie et
   change a chaque nouvelle aventure.
   ============================================================ */
function createSceneModel(concepts, seed) {
  return window.ParcoursWorld.buildScene(concepts, Number.isFinite(seed) ? seed : state.mapSeed);
}

/* ============================================================
   ROUTES : un chemin principal continu (plus de variantes visuelles)
   (delegue a world.js — meme source de verite que la generation)
   ============================================================ */
function buildRoadPath(points) {
  return window.ParcoursWorld.buildRoadPath(points);
}

function branchGeometry(scene, obstacleIndex) {
  return window.ParcoursWorld.branchGeometry(scene, obstacleIndex);
}

/* Chemin de renforcement : UN SEUL trace continu, le troncon principal entre
   l'obstacle courant et le suivant, quelle que soit la maitrise. Il n'y a plus
   de variantes visuelles courte/moyenne/longue (elles semaient la confusion et
   causaient des bugs) : seul le NOMBRE de haltes varie selon la maitrise
   (REINFORCEMENT_TOTALS), pas le trace. Le mastery en 2e argument est ignore,
   conserve pour ne pas casser les appels existants. */
function reinforcementRouteD(geometry) {
  return geometry.medium;
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
      /* Le fanion est un MARQUEUR (mât + drapeau dessines debout), pas du decor
         de terrain : on le redresse comme le pin "!" et les plaques
         (uprightSuffix), sinon il apparait a l'envers sur une carte up (180°)
         ou couche sur une carte left/right (±90°). */
      return `
        <g class="reinforcement-stop stop-${status}" transform="translate(${stop.x}, ${stop.y})${uprightSuffix()}">
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
   TRESOR (recompense d'excellence)
   Accorde a la maitrise 3 uniquement (regle dans tresor.js) et pose
   sur l'unique chemin de renforcement -- il n'y a plus de "raccourci"
   visuel, mais l'excellence reste recompensee. Ici on ne fait que le
   placer sur le trace et le ramasser.
   ============================================================ */
function computeTreasure() {
  if (!state.scene || !window.ParcoursTresor?.tresorDisponible(state.session, state.treasuresCollected)) {
    return null;
  }
  const geometry = branchGeometry(state.scene, state.session.concept_index);
  if (!geometry) {
    return null;
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", reinforcementRouteD(geometry, state.session.maitrise_actuelle));
  const length = path.getTotalLength();
  if (!length) {
    return null;
  }
  const point = path.getPointAtLength(window.ParcoursTresor.FRACTION_SUR_ROUTE * length);
  return { cle: window.ParcoursTresor.cleTresor(state.session), x: point.x, y: point.y };
}

function treasureMarkup() {
  if (!state.treasure) {
    return "";
  }
  /* Position portee par le groupe exterieur, flottement par le groupe
     interieur : la transformation CSS de l'animation n'ecrase ainsi jamais
     les coordonnees sur la carte. Le coffre est un objet ORIENTE (couvercle en
     haut, ombre en bas) : on le redresse (uprightSuffix) comme les fanions et
     le texte de bonus, sinon il apparait a l'envers sur une carte pivotee. */
  return `
    <g id="treasure-token" transform="translate(${state.treasure.x}, ${state.treasure.y})${uprightSuffix()}">
      <g class="treasure-token">${ASSETS.treasure()}</g>
    </g>
  `;
}

/* ============================================================
   AMBIANCE : teinte jour/heure et ramassables aleatoires.
   Purement decoratif : aucune incidence sur progression/evaluation.
   ============================================================ */
function collectiblesMarkup() {
  return state.collectibles
    .map(
      (item) => `
        <g class="collectible-token collectible-${item.type}" data-collectible="${item.cle}" transform="translate(${item.x.toFixed(1)}, ${item.y.toFixed(1)})">
          <g class="collectible-float">${ASSETS.collectible(item.type)}</g>
        </g>
      `,
    )
    .join("");
}

function sceneTintMarkup() {
  const tint = state.sceneTint;
  if (!tint || tint.opacite <= 0 || !state.scene) {
    return "";
  }
  return `<rect class="scene-tint" x="0" y="0" width="${state.scene.width}" height="${state.scene.height}" fill="${tint.couleur}" opacity="${tint.opacite}" pointer-events="none"></rect>`;
}

/* Regenere les ramassables uniquement quand la CARTE change (signature du
   trace) : ils restent stables tant qu'on parcourt la meme carte, et
   reapparaissent a la carte suivante, sans limite de session. */
function refreshCollectibles() {
  if (!state.scene || !window.ParcoursAmbiance) {
    state.collectibles = [];
    return;
  }
  const signature = `${state.scene.width}x${state.scene.height}:${state.scene.routePoints.length}`;
  if (signature === state.collectiblesSig) {
    return;
  }
  state.collectiblesSig = signature;
  const segments = window.ParcoursAmbiance.segmentsDepuisTrace(state.scene.routePoints);
  state.collectibles = window.ParcoursAmbiance.semerCollectibles(segments);
}

/* Ramassage au contact (aucune touche), petit bonus, effet decoratif. */
function updateCollectiblePickup() {
  if (state.panelOpen || !state.collectibles.length || !window.ParcoursAmbiance) {
    return;
  }
  const encore = [];
  for (const item of state.collectibles) {
    if (window.ParcoursAmbiance.estRamassable(distance(state.playerPosition, item))) {
      collectCollectible(item);
    } else {
      encore.push(item);
    }
  }
  state.collectibles = encore;
}

function collectCollectible(item) {
  document.querySelector(`[data-collectible="${item.cle}"]`)?.remove();
  addScore(window.ParcoursAmbiance.BONUS);
  spawnTreasureFx(item.x, item.y, window.ParcoursAmbiance.BONUS);
  window.ParcoursAudio?.playCorrect?.();
}

/* Ramassage au contact : aucune touche a presser, contrairement aux haltes
   et aux obstacles. Le tresor est une trouvaille, pas une epreuve. */
function updateTreasurePickup() {
  if (!state.treasure || state.panelOpen) {
    return;
  }
  if (!window.ParcoursTresor.estARamasser(distance(state.playerPosition, state.treasure))) {
    return;
  }
  collectTreasure();
}

function collectTreasure() {
  const { cle, x, y } = state.treasure;
  /* Marque AVANT tout le reste : un second passage dans la meme frame ne
     doit pas pouvoir le ramasser deux fois. */
  state.treasuresCollected.add(cle);
  state.treasure = null;
  document.getElementById("treasure-token")?.remove();
  saveSessionRef();

  addScore(window.ParcoursTresor.BONUS);
  spawnTreasureFx(x, y, window.ParcoursTresor.BONUS);
  window.ParcoursAudio?.playUnlock();
  setFeedback(`Trésor du raccourci ! +${window.ParcoursTresor.BONUS} étoiles`, "success");
}

/* Scintillement + "+50" qui monte et s'efface. Le calque d'effets est
   partage : on ajoute notre groupe et on ne retire que lui. */
function spawnTreasureFx(x, y, bonus) {
  const fxLayer = document.getElementById("fx-layer");
  if (!fxLayer) {
    return;
  }
  const eclats = Array.from({ length: 10 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 10 + Math.random() * 0.4;
    const range = 60 + Math.random() * 70;
    return `<g class="fx-particle" style="--tx: ${(Math.cos(angle) * range).toFixed(1)}px; --ty: ${(Math.sin(angle) * range - 30).toFixed(1)}px;">
        <polygon points="${starPathMarkup(9)}" class="fx-star"></polygon>
      </g>`;
  }).join("");

  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  /* Le calque d'effets est dans le groupe pivote : on redresse le texte "+N". */
  group.setAttribute("transform", `translate(${x}, ${y})${uprightSuffix()}`);
  group.innerHTML = `
    ${eclats}
    <text x="0" y="-16" text-anchor="middle" class="treasure-bonus-text">+${bonus}</text>
  `;
  fxLayer.appendChild(group);
  window.setTimeout(() => group.remove(), 1400);
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

/* Demi-largeur de la plaque (rect de 184 -> 92) : sert a garder l'etiquette
   entierement dans la fenetre camera. */
const PLATE_HALF_WIDTH = 92;
/* Deport lateral maximal autorise pour la plaque : au-dela, son bord sortirait
   de la fenetre camera (demi-largeur CAMERA_WIDTH/2) quand celle-ci est centree
   sur l'obstacle, et le nom serait tronque au bord de l'ecran. On garde une
   petite marge. Les PLATE_OFFSETS d'origine (jusqu'a -290) depassaient cette
   borne : ils sont desormais ramenes dedans, quelle que soit la longueur du nom. */
const PLATE_MAX_OFFSET = CAMERA_WIDTH / 2 - PLATE_HALF_WIDTH - 20;

function obstaclePlateMarkup(obstacle, status, theme) {
  const plateY = obstacle.barrierY - 108;
  const offset = clamp(PLATE_OFFSETS[obstacle.type] || -260, -PLATE_MAX_OFFSET, PLATE_MAX_OFFSET);
  const plateX = obstacle.x + offset;
  const done = status === "done";
  return `
    <g class="obstacle-plate-group" transform="translate(${plateX}, ${plateY})${uprightSuffix()}">
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
    <g transform="translate(${obstacle.x}, ${obstacle.barrierY - 152})${uprightSuffix()}">
      <g class="obstacle-marker">
        <path d="M 0 22 L -14 -4 A 17 17 0 1 1 14 -4 Z" class="marker-pin"></path>
        <text x="0" y="0" text-anchor="middle" class="marker-glyph">!</text>
      </g>
    </g>
  `;
}

/* Angle (deg) dont il faut tourner le chateau pour que sa PORTE (ouverture le
   long de l'axe vertical local) s'aligne sur la tangente du chemin a cet
   endroit -- ainsi la route TRAVERSE toujours le portail, quelle que soit la
   direction de la carte. On mesure la tangente en espace d'AFFICHAGE (la ou le
   joueur la voit) via la corde entre le point de chemin avant et apres
   l'obstacle. Comme uprightSuffix() redresse deja le groupe (frame local =
   frame ecran pour les directions), il suffit d'ajouter cette rotation apres.
   Ramenee dans [-90, 90] : le chateau tourne pour faire face a la route sans
   jamais se renverser (il reste droit face au joueur). */
function castleGateAngle(obstacle) {
  const scene = state.scene;
  if (!scene || !Array.isArray(scene.routePoints)) {
    return 0;
  }
  const rp = scene.routePoints; /* [depart, obstacle0, obstacle1, ..., sortie] */
  const i = obstacle.index;
  const before = rp[i] || rp[0];
  const after = rp[i + 2] || rp[rp.length - 1];
  const a = toDisplay(before);
  const b = toDisplay(after);
  const tangente = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  /* La porte (axe vertical local) pointe ecran-bas = 90°. On l'aligne sur la
     tangente, puis on redresse dans [-90, 90] pour garder le chateau debout. */
  let angle = tangente - 90;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function obstacleSceneryMarkup(obstacle, status) {
  const done = status === "done";
  const y = obstacle.barrierY;
  switch (obstacle.type) {
    case "castle_gate": {
      /* Le chateau reste debout (uprightSuffix) MAIS pivote de castleGateAngle
         pour que sa porte s'ouvre dans l'axe du chemin : la route traverse le
         portail sur toutes les directions de carte. Les bannieres/tourelles
         suivent ce leger pivot (elles n'ont pas de haut/bas textuel) ; la
         plaque du nom et le PNJ, eux, gardent leur redressement propre. */
      const gateAngle = castleGateAngle(obstacle);
      return `
        ${fenceMarkup(Math.max(40, obstacle.x - 560), obstacle.x - 165, y)}
        ${fenceMarkup(obstacle.x + 165, Math.min(SCENE_WIDTH - 40, obstacle.x + 560), y)}
        <g transform="translate(${obstacle.x}, ${y})${uprightSuffix()} rotate(${gateAngle.toFixed(1)})">${ASSETS.castle(done)}</g>
        <g transform="translate(${obstacle.x + 150}, ${y + 52})${uprightSuffix()}">${ASSETS.npc()}</g>
      `;
    }
    case "blocked_road": {
      /* La cabane (décor) et le villageois se placent du cote de l'obstacle
         tourné vers le CENTRE du monde : sur une carte procédurale l'obstacle
         peut etre a gauche comme a droite, et un deport fixe (-190) faisait
         flotter la cabane pres du bord/depart, detachee de son etiquette. */
      const versCentre = obstacle.x < SCENE_WIDTH / 2 ? 1 : -1;
      return `
        ${fenceMarkup(Math.max(40, obstacle.x - 520), obstacle.x - 120, y)}
        ${fenceMarkup(obstacle.x + 120, Math.min(SCENE_WIDTH - 40, obstacle.x + 520), y)}
        <!-- La cabane a un toit/cheminee asymetriques : redressee comme le chateau. -->
        <g transform="translate(${obstacle.x + versCentre * 175}, ${y - 60})${uprightSuffix()}">${ASSETS.cabin()}</g>
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
        <g transform="translate(${obstacle.x - versCentre * 110}, ${y + 46})${uprightSuffix()}">${ASSETS.npc()}</g>
      `;
    }
    case "broken_bridge":
      return `
        <g class="river-group">
          <rect x="0" y="${y - RIVER_HALF_HEIGHT - 7}" width="${SCENE_WIDTH}" height="${RIVER_HALF_HEIGHT * 2 + 14}" class="river-bank"></rect>
          <rect x="0" y="${y - RIVER_HALF_HEIGHT}" width="${SCENE_WIDTH}" height="${RIVER_HALF_HEIGHT * 2}" class="river"></rect>
          <path d="M 30 ${y - 24} q 60 -14 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0" class="river-wave"></path>
          <path d="M 90 ${y + 26} q 60 -14 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0" class="river-wave"></path>
        </g>
        <g transform="translate(${obstacle.x}, ${y})">${ASSETS.bridge(done)}</g>
        <g transform="translate(${obstacle.x + 118}, ${y + 108})${uprightSuffix()}">${ASSETS.npc()}</g>
      `;
    case "crossroads":
      return `
        <line x1="${Math.max(40, obstacle.x - 520)}" y1="${y}" x2="${obstacle.x - 120}" y2="${y}" class="hedge-line"></line>
        <line x1="${obstacle.x + 120}" y1="${y}" x2="${Math.min(SCENE_WIDTH - 40, obstacle.x + 520)}" y2="${y}" class="hedge-line"></line>
        <path d="M ${obstacle.x + 30} ${y + 6} C ${obstacle.x + 130} ${y - 10} ${obstacle.x + 200} ${y - 70} ${obstacle.x + 250} ${y - 150}" class="hidden-path-edge"></path>
        <path d="M ${obstacle.x + 30} ${y + 6} C ${obstacle.x + 130} ${y - 10} ${obstacle.x + 200} ${y - 70} ${obstacle.x + 250} ${y - 150}" class="hidden-path"></path>
        <!-- Le panneau est une SIGNALETIQUE (poteau + boards + "?"), redressee
             comme les plaques (uprightSuffix) : sans ça le "?" s'affiche en "¿"
             sur une carte up (180°). Les haies, la brume et le PNJ restent, eux,
             du decor de terrain qui pivote avec la carte. -->
        <g transform="translate(${obstacle.x - 110}, ${y - 30})${uprightSuffix()}">${ASSETS.signpost(done)}</g>
        <g class="mist-cloud">
          <ellipse cx="${obstacle.x + 190}" cy="${y - 74}" rx="72" ry="30" class="mist"></ellipse>
          <ellipse cx="${obstacle.x + 240}" cy="${y - 120}" rx="56" ry="24" class="mist"></ellipse>
        </g>
        <g transform="translate(${obstacle.x + 116}, ${y + 46})${uprightSuffix()}">${ASSETS.npc()}</g>
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
    ${decor.rocks.map((p) => `<g transform="translate(${p.x}, ${p.y})${uprightSuffix()}">${ASSETS.rock()}</g>`).join("")}
    ${decor.bushes.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.bush()}</g>`).join("")}
    ${decor.trees.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.tree()}</g>`).join("")}
  `;
}

/* ============================================================
   DECOR VIVANT : 2 a 4 petits elements animes, non-interactifs, pour donner
   vie a la scene sans jamais gener le jeu. Positionnes sur des emplacements
   de decor deja valides (fleurs, buisson) donc jamais sur la route ; animes
   en CSS (transform composite, GPU) pour rester legers. Redresses comme le
   reste des marqueurs (uprightSuffix) : un chat ou un papillon ne bascule pas
   avec la carte. Motif "position dehors / animation dedans" comme le tresor,
   pour que la transform CSS n'ecrase jamais le placement natif.
   ============================================================ */
function livingDecorMarkup(scene) {
  const decor = scene.decor || {};
  const flowers = decor.flowers || [];
  const bushes = decor.bushes || [];
  const trees = decor.trees || [];
  const bits = [];

  /* Jusqu'a 2 papillons, poses au-dessus d'une fleur (ils les butinent). */
  flowers.slice(0, 2).forEach((f, i) => {
    bits.push(`
      <g class="living-decor" transform="translate(${f.x.toFixed(1)}, ${(f.y - 24).toFixed(1)})${uprightSuffix()}">
        <g class="critter-flutter" style="animation-delay: ${(i * -1.9).toFixed(1)}s">
          ${ASSETS.butterfly(i % 2 === 0 ? "orange" : "bleu")}
        </g>
      </g>
    `);
  });

  /* 1 chat qui flane pres d'un buisson (a defaut d'un arbre) : zone degagee. */
  const perchoir = bushes[0] || trees[0] || null;
  if (perchoir) {
    bits.push(`
      <g class="living-decor" transform="translate(${(perchoir.x + 34).toFixed(1)}, ${(perchoir.y + 20).toFixed(1)})${uprightSuffix()}">
        <g class="cat-stroll">${ASSETS.cat()}</g>
      </g>
    `);
  }
  return bits.join("");
}

function sceneMarkup(scene) {
  const roadPath = buildRoadPath(scene.routePoints);
  /* Tout le contenu de la scene est genere en coordonnees NATIVES puis pivote
     d'un bloc par le groupe #world-root : le decor pleine largeur (riviere,
     barrieres) reste ainsi correct par construction, quelle que soit la
     direction. Seuls les elements textuels sont redresses (uprightSuffix). */
  return `<g id="world-root" transform="${orientTransform()}">
    <rect x="0" y="0" width="${scene.width}" height="${scene.height}" class="ground"></rect>
    <g class="patch-layer">${decorMarkup(scene)}</g>
    <g class="road-layer">
      <path d="${roadPath}" class="road-edge"></path>
      <path d="${roadPath}" class="road-surface"></path>
      <path d="${roadPath}" class="road-paving"></path>
      <path d="${roadPath}" class="road-paving offset" transform="translate(14, 10)"></path>
      <path d="${roadPath}" class="road-paving offset" transform="translate(-14, -8)"></path>
    </g>
    <g class="props-layer">${propsMarkup(scene)}</g>
    <g class="living-decor-layer">${livingDecorMarkup(scene)}</g>
    <g class="treasure-layer">${treasureMarkup()}</g>
    <g class="collectible-layer">${collectiblesMarkup()}</g>
    <g class="stops-layer">${stopsMarkup()}</g>
    <g class="obstacle-layer">
      ${scene.obstacles.map(obstacleMarkup).join("")}
    </g>
    ${sceneTintMarkup()}
    <g id="interaction-hint" class="interaction-hint">
      <rect x="-118" y="-30" width="236" height="46" rx="20" class="hint-bubble"></rect>
      <rect x="-104" y="-21" width="64" height="28" rx="8" class="hint-key"></rect>
      <text x="-72" y="0" text-anchor="middle" class="hint-text">${estAppareilTactile ? "Touche" : "Entrée"}</text>
      <text x="30" y="0" text-anchor="middle" class="hint-text" id="hint-action-text">pour aider !</text>
    </g>
    <g id="fx-layer"></g>
    <g id="player-token" class="player-token">${ASSETS.player()}</g>
  </g>`;
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
  /* La mini-carte doit refleter la VRAIE direction de progression : on la
     cadre en dimensions d'affichage et on pivote son contenu (genere en
     natif) par la meme matrice que la carte principale. */
  minimapSvg.setAttribute("viewBox", `0 0 ${displayWidth()} ${displayHeight()}`);
  minimapSvg.innerHTML = `
    <g transform="${orientTransform()}">
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
    </g>
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
    document.getElementById("minigame-invite-overlay"),
    document.getElementById("minigame-overlay"),
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

/* ============================================================
   VARIANTE VISUELLE PAR NIVEAU (apparence uniquement)
   Les grands (CE5/CE6) recoivent une declinaison un peu plus sobre du meme
   univers : palette moins saturee et angles moins arrondis. C'est un simple
   selecteur applique au montage de la scene, exactement comme la teinte
   jour/heure -- aucune incidence sur la mecanique ni la logique de jeu.
   CE1 a CE4 gardent leur apparence d'origine, inchangee.
   ============================================================ */
const MATURE_LEVELS = new Set(["CE5", "CE6"]);
const MATURE_RADIUS_FACTOR = 0.5; /* angles deux fois moins arrondis */

function varianteMature() {
  return MATURE_LEVELS.has(levelLabel());
}

/* Pose (ou retire) l'attribut qui declenche la palette sobre en CSS. Porte par
   <body> pour que la declinaison couvre aussi les popups (exercices, menus),
   qui heritent des memes variables. */
function applyVisualVariant() {
  if (varianteMature()) {
    document.body.setAttribute("data-visual", "mature");
  } else {
    document.body.removeAttribute("data-visual");
  }
}

/* Reduit les rayons de courbure des seuls <rect> (coins arrondis), sans
   toucher aux <ellipse>/<circle> qui, eux, utilisent rx/ry comme rayons de
   forme (ombres, cailloux, tetes...). Ajustement des formes existantes, pas un
   nouveau design. Fonction pure. */
function durcirAnglesRects(markup) {
  return markup.replace(/<rect\b[^>]*>/g, (tag) =>
    tag.replace(/\b(rx|ry)="([\d.]+)"/g, (_match, cle, valeur) => {
      const reduit = parseFloat(valeur) * MATURE_RADIUS_FACTOR;
      return `${cle}="${Number.isInteger(reduit) ? reduit : reduit.toFixed(1)}"`;
    }),
  );
}

/* Equivalent DOM de durcirAnglesRects, pour un sous-arbre deja monte (scene
   d'un mini-jeu, ou popup d'exercice avec sa mecanique injectee apres coup).
   Ne fait rien hors variante mature. La palette, elle, suit deja par cascade
   (variables CSS sur <body>). */
function durcirAnglesRectsDom(element) {
  if (!element || typeof element.querySelectorAll !== "function" || !varianteMature()) {
    return;
  }
  element.querySelectorAll("rect").forEach((rect) => {
    for (const cle of ["rx", "ry"]) {
      const brut = rect.getAttribute(cle);
      if (brut === null || brut === "") {
        continue;
      }
      const reduit = parseFloat(brut) * MATURE_RADIUS_FACTOR;
      if (!Number.isNaN(reduit)) {
        rect.setAttribute(cle, Number.isInteger(reduit) ? String(reduit) : reduit.toFixed(1));
      }
    }
  });
}

function renderScene() {
  applyVisualVariant();
  if (!state.session) {
    mapElement.innerHTML = "";
    renderMinimap();
    return;
  }
  state.scene = createSceneModel(state.session.concepts || [], state.mapSeed);
  /* La camera vit en espace d'affichage : on la (re)pose sur la projection du
     joueur pour eviter un recentrage brutal au 1er tick (surtout apres une
     rotation de direction, ou les coordonnees d'affichage different du natif). */
  state.camera = clampCamera(toDisplay(state.playerPosition));
  state.reinforcement = computeReinforcementStops();
  /* Calcule apres la scene (il suit le trace de la route active) et avant le
     markup, qui le dessine. */
  state.treasure = computeTreasure();
  /* Ambiance : teinte figee une seule fois (chargement) ; ramassables
     regeneres seulement a la carte suivante. */
  if (!state.sceneTint && window.ParcoursAmbiance) {
    state.sceneTint = window.ParcoursAmbiance.tinteMaintenant();
  }
  refreshCollectibles();
  const markup = sceneMarkup(state.scene);
  mapElement.innerHTML = varianteMature() ? durcirAnglesRects(markup) : markup;
  invalidateDynamicsCache();
  renderMinimap();
  updateSceneDynamics();
  applyCameraViewBox();
}

/* ============================================================
   NAVIGATION ENTRE ECRANS
   ============================================================ */
function showStartScreen() {
  window.ParcoursTheme?.fermer?.();
  startScreen.classList.remove("hidden");
  lessonScreen.classList.add("hidden");
  gameScreen.classList.add("hidden");
}

function showLessonScreen() {
  window.ParcoursTheme?.fermer?.();
  startScreen.classList.add("hidden");
  lessonScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
}

function showGameScreen() {
  window.ParcoursTheme?.fermer?.();
  startScreen.classList.add("hidden");
  lessonScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  majControlesTactiles();
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
    const hintTransform = `translate(${target.x.toFixed(1)}, ${hintY.toFixed(1)})${uprightSuffix()}`;
    if (hintTransform !== dynamicsCache.hintTransform) {
      dynamicsCache.hintTransform = hintTransform;
      hintNode.setAttribute("transform", hintTransform);
    }
    const actionText = document.getElementById("hint-action-text");
    const hintText = target.kind === "stop" ? "s'entraîner !" : "pour aider !";
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
    /* Le bouton d'action tactile suit la meme proximite que la bulle "!". */
    majControlesTactiles();
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
  majControlesTactiles();
}

function closeExercisePanel() {
  /* Si une correction attendait le bouton "Continuer", on applique quand
     meme la progression : le backend a deja avance. */
  finalizePendingEvaluation();
  window.ParcoursProactive?.panelClosed();
  /* Le popup se ferme : on coupe une eventuelle lecture d'enonce en cours. */
  window.ParcoursSpeech?.cancel?.();
  state.panelOpen = false;
  exerciseOverlay.classList.add("hidden");
  exerciseModal.innerHTML = "";
  updateNearObstacle();
  updateSceneDynamics();
  refreshScenePaused();
  majControlesTactiles();
}

/* Bouton "ecouter" (haut-parleur) pour lire un texte du popup a voix haute.
   Rendu seulement si la synthese vocale est disponible : sinon rien, aucun
   bouton mort. La lecture est declenchee a la main par l'eleve, jamais
   automatiquement (il rouvre souvent le popup, on ne repete pas l'enonce). */
function listenButtonMarkup(id, label) {
  /* La synthèse vocale neurale passe par le backend : indisponible hors-ligne,
     on masque le bouton plutôt que d'exposer un appel voué à échouer. */
  if (state.offlineActif || !window.ParcoursSpeech?.isSupported?.()) {
    return "";
  }
  return `
    <button id="${id}" class="listen-button" type="button" aria-label="${label}" title="${label}">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 12 h5 l6 -5 v18 l-6 -5 h-5 Z" fill="currentColor"></path>
        <path d="M22 11 a 7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
        <path d="M25 8 a 12 12 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
      </svg>
    </button>
  `;
}

/* Tableau de proportionnalite : composant unique, rendu comme visuel dans
   l'enonce (la reponse est saisie via la mecanique standard, en dessous).
   Deux lignes etiquetees ; la case masquee affiche "?". */
function propTableMarkup(exercise) {
  const v = exercise.variables || {};
  const cell = (value) =>
    `<td class="${value === "?" ? "prop-hole" : ""}">${value}</td>`;
  const row = (label, cells) =>
    `<tr><th scope="row">${label}</th>${(cells || []).map(cell).join("")}</tr>`;
  return `
    <div class="prop-table-wrap">
      <table class="prop-table" aria-label="Tableau de proportionnalité à compléter">
        <tbody>
          ${row(v.label1, v.haut_affichee)}
          ${row(v.label2, v.bas_affichee)}
        </tbody>
      </table>
    </div>
  `;
}

/* Figure cotee simple : composant SVG unique, dimensions affichees en
   parametres (le dessin n'est pas a l'echelle, ce sont les cotes qui portent
   l'information). Formes basiques uniquement, jamais de trace complexe. */
function figureCoteeSvg(exercise) {
  const v = exercise.variables || {};
  const u = v.unite || "cm";
  const label = (x, y, text, anchor = "middle") =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" class="figure-label">${text}</text>`;

  if (v.forme === "rectangle") {
    const maxDim = Math.max(v.largeur, v.hauteur);
    const w = 34 + 56 * (v.largeur / maxDim);
    const h = 34 + 56 * (v.hauteur / maxDim);
    return `
      <rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" class="figure-shape"></rect>
      ${label(0, (-h / 2 - 9).toFixed(1), `${v.largeur} ${u}`)}
      ${label((w / 2 + 8).toFixed(1), 5, `${v.hauteur} ${u}`, "start")}
    `;
  }
  if (v.forme === "carre") {
    const s = 62;
    return `
      <rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="4" class="figure-shape"></rect>
      ${label(0, -s / 2 - 9, `${v.cote} ${u}`)}
    `;
  }
  if (v.forme === "triangle") {
    const [a, b, c] = v.cotes;
    const A = [0, -40];
    const B = [-48, 34];
    const C = [48, 34];
    const mid = (P, Q) => [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
    const mAB = mid(A, B);
    const mAC = mid(A, C);
    const mBC = mid(B, C);
    return `
      <polygon points="${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]}" class="figure-shape"></polygon>
      ${label(mAB[0] - 12, mAB[1], `${a} ${u}`, "end")}
      ${label(mAC[0] + 12, mAC[1], `${b} ${u}`, "start")}
      ${label(mBC[0], mBC[1] + 17, `${c} ${u}`)}
    `;
  }
  // polygone regulier
  const n = v.n_cotes;
  const R = 42;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const ang = ((-90 + (i * 360) / n) * Math.PI) / 180;
    pts.push([Math.cos(ang) * R, Math.sin(ang) * R]);
  }
  const poly = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const mx = (pts[0][0] + pts[1][0]) / 2;
  const my = (pts[0][1] + pts[1][1]) / 2;
  return `
    <polygon points="${poly}" class="figure-shape"></polygon>
    ${label((mx * 1.45).toFixed(1), (my * 1.45 + 4).toFixed(1), `${v.cote} ${u}`, "start")}
  `;
}

function renderExerciseModal() {
  if (!state.panelOpen || !state.currentExercise || !state.session) {
    return;
  }

  const exercise = state.currentExercise;
  const isClock = exercise.pattern?.pattern_name === "lecture_heure_analogique";
  const isTable = exercise.pattern?.pattern_name === "completer_tableau_proportionnalite";
  const isFigure = exercise.pattern?.pattern_name === "figure_cotee_simple";
  const confidence = isConfidenceExercise();
  const offline = state.offlineActif;
  const obstacle = activeObstacle();
  const atStop = Boolean(state.reinforcement);
  const theme = offline
    ? {
        modalClass: "theme-camp",
        title: "Entraînement hors ligne",
        intro: "Tu es hors ligne : tes réponses sont corrigées ici même, sans connexion.",
      }
    : confidence
      ? { modalClass: "theme-confiance", title: "Petite pause !", intro: CONFIANCE_INTRO }
      : atStop
        ? stopTheme()
        : obstacleTheme(obstacle?.type);
  const mechanic = window.ParcoursMechanics
    ? window.ParcoursMechanics.choose(exercise, state.session.concept_index || 0)
    : "clavier";
  /* Saisie clavier adaptee au format de reponse. Sur tablette, inputmode
     "numeric" empechait de taper la virgule (decimaux) ou x/= (expressions) :
     on ouvre le bon clavier tactile selon le format. */
  const answerFormat = exercise.reponse_attendue?.format || "nombre_entier";
  const answerInputMode =
    answerFormat === "decimal" ? "decimal" : answerFormat === "expression" ? "text" : "numeric";
  /* Le micro ne convertit que des nombres (entiers/decimaux) : on le masque
     pour les autres formats (expressions), qu'il ne saurait pas dicter. */
  const micUtile = answerFormat === "nombre_entier" || answerFormat === "decimal";
  const resolutionKey = state.session.presentation_courante;
  const details = exercise.presentations?.[resolutionKey] || {};
  const steps = (details.etapes_methode || []).map((step) => `<li>${step}</li>`).join("");
  const level = state.session.niveau_resolution_courant || 1;
  const phaseChip = offline
    ? "Entraînement hors ligne"
    : state.session.phase === "renforcement"
      ? `Entraînement : encore ${state.session.exercices_renforcement_restants}`
      : "À toi de jouer !";

  exerciseModal.className = `exercise-modal ${theme.modalClass}`;
  exerciseModal.innerHTML = `
    <button id="close-exercise" class="modal-close" type="button" aria-label="Fermer">&#10005;</button>
    <div class="modal-head">
      <span class="modal-icon">${
        offline
          ? stopIconSvg()
          : confidence
            ? confidenceOwlSvg()
            : atStop
              ? stopIconSvg()
              : obstacleIconSvg(obstacle?.type, "current")
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
      <div class="statement-row">
        <p class="exercise-statement">${exercise.enonce}</p>
        ${listenButtonMarkup("listen-enonce", "Écouter l'énoncé")}
      </div>
      ${
        isClock
          ? `<div class="clock-figure">
               <svg viewBox="-58 -58 116 116" role="img" aria-label="Horloge à lire">${ASSETS.clock(exercise.variables.heure, exercise.variables.minute)}</svg>
             </div>`
          : ""
      }
      ${isTable ? propTableMarkup(exercise) : ""}
      ${
        isFigure
          ? `<div class="figure-figure">
               <svg viewBox="-64 -72 128 130" role="img" aria-label="Figure géométrique cotée">${figureCoteeSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        steps && details.aide_affichee
          ? `<div class="method-block">
              <p class="method-title">
                <span>La méthode :</span>
                ${listenButtonMarkup("listen-methode", "Écouter la méthode")}
              </p>
              <ol>${steps}</ol>
            </div>`
          : ""
      }
      <form id="exercise-form" class="exercise-form" data-mechanic="${mechanic}">
        ${
          mechanic === "clavier"
            ? `<label for="answer-input">Ta réponse</label>
               <div class="answer-row">
                 <input id="answer-input" name="answer" type="text" autocomplete="off" inputmode="${answerInputMode}" />
                 ${
                   micUtile
                     ? `<button id="mic-button" class="mic-button" type="button" aria-label="Répondre à la voix" title="Réponds à la voix">
                   <svg viewBox="0 0 32 32" aria-hidden="true">
                     <rect x="12" y="4" width="8" height="15" rx="4" fill="currentColor"></rect>
                     <path d="M8 15 a 8 8 0 0 0 16 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></path>
                     <line x1="16" y1="23" x2="16" y2="27" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></line>
                     <line x1="11" y1="27" x2="21" y2="27" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></line>
                   </svg>
                   <span class="mic-pulse" aria-hidden="true"></span>
                 </button>`
                     : ""
                 }
               </div>
               ${micUtile ? `<p id="mic-status" class="mic-status"></p>` : ""}`
            : `<input id="answer-input" name="answer" type="hidden" />
               <div id="mechanic-area" class="mechanic-area"></div>`
        }
        <div class="exercise-actions">
          <button type="submit" class="btn-primary">Valider</button>
          ${
            /* Le tuteur IA exige un vrai appel réseau : masqué proprement
               hors-ligne (pas d'erreur brute, juste indisponible). */
            offline ? "" : `<button id="help-button" type="button" class="btn-help">&#129417; Aide</button>`
          }
        </div>
      </form>
    </div>
  `;
  exerciseOverlay.classList.remove("hidden");

  const form = document.getElementById("exercise-form");
  form.addEventListener("submit", handleSubmitAnswer);
  document.getElementById("help-button")?.addEventListener("click", () => {
    window.ParcoursChat?.open();
    document.getElementById("chat-input")?.focus();
  });
  document.getElementById("close-exercise").addEventListener("click", closeExercisePanel);
  /* Ecoute de l'enonce (et de la methode guidee si affichee) : lecture forcee
     car declenchee explicitement par l'eleve, meme si le tuteur est en sourdine.
     Chaque clic interrompt la lecture precedente (pas de chevauchement). */
  document.getElementById("listen-enonce")?.addEventListener("click", () => {
    window.ParcoursSpeech?.speak(exercise.enonce, { force: true, source: "enonce" });
  });
  const listenMethode = document.getElementById("listen-methode");
  if (listenMethode) {
    const methodeTexte = ["La méthode.", ...(details.etapes_methode || [])].join(" ");
    listenMethode.addEventListener("click", () => {
      window.ParcoursSpeech?.speak(methodeTexte, { force: true, source: "enonce" });
    });
  }
  /* Tuteur proactif : suit l'exercice affiche et le niveau de guidage
     (seuils plus prudents au niveau 3 autonome). Désactivé hors-ligne : son
     intervention repose sur un appel IA impossible sans backend. */
  if (!offline) {
    window.ParcoursProactive?.exerciseShown(exercise.id, level);
  }
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
  /* Variante mature (CE5/CE6) : la popup d'exercice est l'ecran le plus vu ;
     ses <rect> (figures cotees, horloge, mecaniques SVG) suivent le meme
     durcissement d'angles que la carte et les mini-jeux. La palette suit deja
     par cascade. Fait apres le montage de la mecanique pour couvrir son SVG. */
  durcirAnglesRectsDom(exerciseModal);
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

/* Évalue localement la réponse à l'exercice courant (mis en cache, donc
   porteur de reponse_attendue.valeur) puis enchaîne sur l'exercice suivant du
   tampon. Aucune progression pédagogique persistante : entraînement local. */
function evaluerReponseHorsLigne(reponse) {
  const exercice = state.currentExercise;
  if (!exercice || !window.ParcoursOffline) {
    return;
  }
  if (window.ParcoursOffline.evaluer(exercice, reponse)) {
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

function chargerProchainExerciceHorsLigne() {
  const suivant = window.ParcoursOffline?.consommer();
  if (suivant) {
    state.currentExercise = suivant;
    setFeedback("Bravo ! Continue ton entraînement.", "success");
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
      try {
        await startSession(state.selectedLevel, button.dataset.lessonId);
      } catch (error) {
        lessonStatus.textContent = `Impossible de démarrer la session : ${error.message}`;
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
      return {
        message: "Félicitations, tout le parcours est terminé !",
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

  /* Pause detente : apres un concept debloque ET en fin de carte
     (carte_terminee, qui est la seule "occasion" des cartes a 1 concept et la
     2e des cartes a 2 concepts), on PROPOSE parfois un mini-jeu (jamais impose,
     sans aucun enjeu pedagogique). On transmet le nombre total de concepts pour
     que le module assouplisse sa garde sur les cartes courtes. Le module decide
     seul de la frequence et de l'espacement, gere sa propre bascule/retour ; la
     progression sur la carte n'est jamais touchee. Le bilan de fin de carte
     (carnet.js) attend la fin de la pause avant de s'afficher. */
  if (unlocked || finished) {
    window.ParcoursMinigames?.conceptDebloque?.(levelLabel(), state.session?.concepts?.length);
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
    <p class="correction-verdict">${payload.correct ? "C'est juste, bravo !" : "Pas tout à fait..."}</p>
    <p class="correction-answer">La bonne réponse : <strong>${expectedText}</strong></p>
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
  if (minimapSvg) {
    minimapSvg.innerHTML = "";
  }
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
    const input = movementVector();
    state.playerMoving = Boolean(input);
    if (input) {
      /* L'intention clavier est en espace d'AFFICHAGE (fleche du bas = vers le
         bas de l'ecran) : on la ramene en natif pour bouger le joueur dans son
         espace de jeu. Le jeton, lui, est dans le groupe pivote, donc son angle
         natif s'affiche deja dans le bon sens a l'ecran. */
      const vector = window.ParcoursWorld.toNativeVector(input, state.scene.direction);
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
    updateTreasurePickup();
    updateCollectiblePickup();
    updateSceneDynamics();
  } else {
    state.playerMoving = false;
  }

  /* Suivi de camera avec easing doux (jamais de recentrage brutal). Sous un
     dixieme de pixel, la camera s'aimante sur la cible : l'easing s'arrete
     vraiment et applyCameraViewBox cesse d'ecrire (donc de repeindre). */
  if (state.scene) {
    /* La camera vit en espace d'affichage : on suit la PROJECTION de la
       position joueur (natif -> affichage). */
    const target = clampCamera(toDisplay(state.playerPosition));
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

/* Changer de joueur : on oublie le compte courant et on recharge, ce qui
   ramene a l'ecran de connexion (rejoindre une classe ou essai libre). */
document.getElementById("compte-button").addEventListener("click", () => {
  closeMenuDropdown();
  window.ParcoursCompte?.deconnecter?.();
  window.location.reload();
});

window.addEventListener("beforeunload", saveSessionRef);

changeLessonButton.addEventListener("click", () => {
  closeMenuDropdown();
  returnToLessonChoice();
});

backToLevelsButton.addEventListener("click", resetToStart);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

/* ============================================================
   CONTROLES TACTILES : pave directionnel + bouton d'action
   Sur appareil tactile uniquement (pas de clavier). Les fleches ecrivent dans
   le MEME state.keysPressed que le clavier, donc movementVector()/tick() sont
   inchanges : maintien = deplacement continu, relachement = arret. Le bouton
   d'action ouvre l'exercice quand on est pres d'un obstacle/fanion (equivalent
   tactile de la touche Entree). Voir touch.js (coeur teste).
   ============================================================ */
if (estAppareilTactile) {
  document.body.classList.add("touch-active");
  window.ParcoursTouch.brancherDpad(touchDpad, {
    presser: (dir) => {
      if (!state.panelOpen) {
        state.keysPressed.add(dir);
      }
    },
    relacher: (dir) => state.keysPressed.delete(dir),
  });
  /* pointerup plutot que click : reponse immediate au doigt, sans le delai ni
     le risque de double-declenchement du click synthetique. */
  touchActionButton?.addEventListener("pointerup", (event) => {
    event.preventDefault();
    if (state.nearObstacle && !state.panelOpen) {
      openExercisePanel();
    }
  });
  touchActionButton?.addEventListener("contextmenu", (event) => event.preventDefault());
}

/* Affiche/masque le pave et le bouton d'action selon l'etat courant (en jeu,
   popup ouverte, proximite d'un obstacle). Appelee aux transitions d'etat :
   entree en jeu, ouverture/fermeture d'exercice, changement de proximite. */
function majControlesTactiles() {
  if (!estAppareilTactile || !window.ParcoursTouch) {
    return;
  }
  const enJeu = Boolean(state.session) && !gameScreen.classList.contains("hidden");
  const contexte = { actif: true, enJeu, panneauOuvert: state.panelOpen };
  window.ParcoursTouch.appliquerVisibilite(touchDpad, window.ParcoursTouch.dpadVisible(contexte));
  window.ParcoursTouch.appliquerVisibilite(
    touchActionButton,
    window.ParcoursTouch.actionVisible({ ...contexte, presObstacle: state.nearObstacle }),
  );
  /* Une fleche relachee par le masquage ne doit pas rester "enfoncee". */
  if (!enJeu || state.panelOpen) {
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].forEach((k) => state.keysPressed.delete(k));
  }
}

/* Fresque du monde : une scene fixe (ciel, herbe, route, chateau, arbres)
   composee a partir des memes briques SVG que la carte (ASSETS.castle,
   tree, bush, flower, rock) et des couleurs du jeu. Sert d'image de base au
   mini-jeu puzzle, qui la decoupe en pieces. ViewBox de reference : 300x240. */
function worldFresqueMarkup() {
  return `
    <rect x="0" y="0" width="300" height="240" fill="#bfe6f5"></rect>
    <circle cx="250" cy="44" r="24" fill="#ffd66b"></circle>
    <circle cx="250" cy="44" r="24" fill="none" stroke="#ffc23e" stroke-width="4" opacity="0.55"></circle>
    <ellipse cx="70" cy="152" rx="120" ry="58" fill="#85d066"></ellipse>
    <ellipse cx="252" cy="156" rx="128" ry="52" fill="#7ac95e"></ellipse>
    <rect x="0" y="150" width="300" height="90" fill="#6fbe53"></rect>
    <path d="M 128 240 L 172 240 L 158 152 L 142 152 Z" fill="#e8703a"></path>
    <path d="M 142 152 L 158 152 L 156 166 L 144 166 Z" fill="#f5905c" opacity="0.7"></path>
    <g transform="translate(150,120) scale(0.5)">${ASSETS.castle(true)}</g>
    <g transform="translate(38,168) scale(0.7)">${ASSETS.tree()}</g>
    <g transform="translate(266,172) scale(0.62)">${ASSETS.tree()}</g>
    <g transform="translate(95,204) scale(0.6)">${ASSETS.bush()}</g>
    <g transform="translate(208,208) scale(0.58)">${ASSETS.bush()}</g>
    <g transform="translate(58,220) scale(1)">${ASSETS.flower()}</g>
    <g transform="translate(238,206) scale(1)">${ASSETS.flowerPink()}</g>
    <g transform="translate(20,142) scale(0.7)">${ASSETS.rock()}</g>
  `;
}

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
  /* Pause mini-jeu : on reutilise panelOpen (qui fige deja le mouvement et
     les interactions dans la boucle de jeu) pour immobiliser la carte le
     temps de l'aparte detente. La position et la camera ne bougent pas :
     le retour se fait donc exactement la ou l'on etait. */
  mettreEnPausePourMinigame: () => {
    state.panelOpen = true;
    refreshScenePaused();
    majControlesTactiles();
  },
  reprendreApresMinigame: () => {
    state.panelOpen = false;
    refreshScenePaused();
    majControlesTactiles();
  },
  /* Bonus purement cosmetique d'un mini-jeu : alimente les memes etoiles
     que le tresor du raccourci (garde-robe), jamais la maitrise ni la
     progression pedagogique. */
  ajouterBonusCosmetique: (points) => addScore(points),
  /* Personnalisation : le dessin du personnage et son rafraichissement sur
     la carte restent proprietes de map.js, qui possede la scene. */
  playerMarkup: () => ASSETS.player(),
  refreshPlayerToken,
  /* Fresque du monde (chateau, route, decor) pour le mini-jeu puzzle :
     composee des memes briques SVG que la carte. */
  fresqueMondeMarkup: () => worldFresqueMarkup(),
  /* Variante mature (CE5/CE6) appliquee au sous-arbre d'un mini-jeu monte. */
  appliquerVarianteMinijeu: (element) => durcirAnglesRectsDom(element),
  varianteMature: () => varianteMature(),
};

if (!animationFrameId) {
  animationFrameId = window.requestAnimationFrame(tick);
}

/* Changement d'univers en cours de partie : on revient exactement d'ou l'on
   vient (la carte si une partie tourne, sinon l'ecran ou l'on etait). Le
   theme s'appliquera aux prochains problemes narratifs generes. */
if (window.ParcoursTheme) {
  window.ParcoursTheme.demanderChangement = () => {
    const enJeu = Boolean(state.sessionId);
    window.ParcoursTheme.ouvrir({
      titre: "Changer d'univers",
      retour: true,
      apresChoix: () => {
        if (enJeu) {
          showGameScreen();
          setFeedback(
            "Nouvel univers choisi ! Il habillera tes prochaines histoires.",
            "success",
          );
        } else if (state.selectedLevel) {
          showLessonScreen();
        } else {
          showStartScreen();
        }
      },
    });
  };
}

/* Au chargement : l'univers se choisit AVANT tout le reste, et une seule
   fois. Ensuite seulement on tente de reprendre la session sauvegardee. */
function demarrerApplication() {
  if (window.ParcoursTheme && !window.ParcoursTheme.aChoisi()) {
    window.ParcoursTheme.ouvrir({ apresChoix: demarrerApplication });
    return;
  }
  /* Espace enseignant : entree separee via l'ancre #enseignant (lien discret
     sur l'ecran de connexion). Il prend la main sur tout le flux eleve. */
  if (window.ParcoursEnseignant && window.ParcoursEnseignant.demandeParURL()) {
    window.ParcoursEnseignant.ouvrir();
    return;
  }
  /* Espace parent : entree separee via l'ancre #parent (lien discret sur
     l'ecran d'accueil). Lecture seule du suivi d'un enfant. */
  if (window.ParcoursParent && window.ParcoursParent.demandeParURL()) {
    window.ParcoursParent.ouvrir();
    return;
  }
  /* Connexion ensuite : rejoindre sa classe (compte eleve) ou essai libre.
     Tant que le choix n'est pas fait, l'ecran de connexion reste devant. */
  if (window.ParcoursCompte && !window.ParcoursCompte.aDecide()) {
    window.ParcoursCompte.demarrerConnexion(demarrerApplication);
    return;
  }
  /* Eleve connecte a une classe : on saute le choix du niveau scolaire. Son
     niveau est celui de sa classe (fige en base), on va droit aux lecons. Le
     mode essai libre, lui, garde le libre choix du niveau (branche ci-dessous). */
  const niveauEleve = niveauImposeEleve();
  if (niveauEleve) {
    demarrerFluxEleve(niveauEleve);
    return;
  }
  /* Ecran de depart d'abord : la reprise est asynchrone et peut echouer, il
     ne doit jamais rester une page vide derriere l'ecran de theme ferme. */
  showStartScreen();
  tryResumeSession();
}

/* Niveau impose a un eleve connecte (celui de sa classe), ou null en essai
   libre / non connecte : la seule source de verite pour "sauter le choix". */
function niveauImposeEleve() {
  return (window.ParcoursCompte?.estEleve?.() && window.ParcoursCompte.getNiveau()) || null;
}

/* Entree dans le jeu pour un eleve : on reprend une partie en cours si elle
   existe, sinon on ouvre directement les lecons de son niveau (jamais l'ecran
   de choix CE1-CE6). On affiche l'ecran des lecons pendant le chargement pour
   ne pas laisser apparaitre, meme une fraction de seconde, le choix de niveau. */
async function demarrerFluxEleve(niveau) {
  showLessonScreen();
  lessonStatus.textContent = "Chargement de tes leçons...";
  /* Garde-robe liee au compte : chargee une fois a la connexion (base), avant
     tout jeu, pour ne jamais montrer celle d'un autre eleve du meme appareil. */
  await window.ParcoursPersonnage?.rechargerPourCompte?.();
  if (await tryResumeSession()) {
    return;
  }
  await rafraichirAssignations();
  try {
    await loadLessons(niveau);
  } catch (error) {
    lessonStatus.textContent = `Impossible de charger les leçons : ${error.message}`;
  }
}

/* Recharge les donnees de compte de l'eleve connecte (travaux assignes ET
   faiblesses reelles pour la revision ciblee) ; vide/inactif en essai libre.
   Best-effort : ne bloque jamais le flux. */
async function rafraichirAssignations() {
  if (niveauImposeEleve()) {
    state.assignations = (await window.ParcoursCompte?.chargerAssignations?.()) || [];
    await window.ParcoursFaiblesses?.rechargerPourEleve?.();
  } else {
    state.assignations = [];
  }
}

demarrerApplication();
