const API_BASE_URL = "http://127.0.0.1:8000";
const SCENE_WIDTH = 2200;
const SCENE_PADDING_X = 300;
const SCENE_PADDING_Y = 420;
const START_X = SCENE_PADDING_X + 250;
const START_Y = SCENE_PADDING_Y + 38;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 220;
const CAMERA_WIDTH = 520;
const CAMERA_HEIGHT = 360;
const OBSTACLE_GAP_Y = 190;
const FIRST_OBSTACLE_Y = SCENE_PADDING_Y + 220;
const BARRIER_OFFSET_Y = 46;
const INTERACTION_DISTANCE = 118;
const LANE_XS = [550, 1560, 660, 1480, 600, 1600];
const OBSTACLE_TYPES = ["castle_gate", "blocked_road", "broken_bridge", "crossroads"];

const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const startStatus = document.getElementById("start-status");
const sessionTitle = document.getElementById("session-title");
const currentLevelBadge = document.getElementById("current-level-badge");
const restartButton = document.getElementById("restart-button");
const mapElement = document.getElementById("map");
const mapStatus = document.getElementById("map-status");
const exerciseTitle = document.getElementById("exercise-title");
const presentationBadge = document.getElementById("presentation-badge");
const progressCopy = document.getElementById("progress-copy");
const exerciseCard = document.getElementById("exercise-card");
const feedback = document.getElementById("feedback");
const debugPanel = document.getElementById("debug-panel");
const debugLog = document.getElementById("debug-log");

const state = {
  sessionId: null,
  session: null,
  currentExercise: null,
  panelOpen: false,
  playerPosition: { x: START_X, y: START_Y },
  keysPressed: new Set(),
  nearObstacle: false,
  scene: null,
  justUnlockedIndex: null,
  justUnlockedUntil: 0,
  lastUnlockedType: null,
  camera: { x: CAMERA_WIDTH / 2, y: CAMERA_HEIGHT / 2 },
};

let animationFrameId = null;
let lastTick = 0;

function logDebug(entry) {
  if (debugLog) {
    debugLog.textContent += `${entry}\n`;
  }
}

function setFeedback(message, tone = "info") {
  feedback.textContent = message;
  feedback.className = `feedback ${tone}`;
}

function clearFeedback() {
  feedback.textContent = "";
  feedback.className = "feedback hidden";
}

function currentConceptIndex() {
  return state.session ? state.session.concept_index : -1;
}

function conceptLabel(patternName) {
  return patternName ? patternName.replaceAll("_", " ") : "Parcours termine";
}

function levelLabel() {
  return state.session ? state.session.niveau_scolaire : "";
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

function obstacleTheme(type) {
  switch (type) {
    case "castle_gate":
      return {
        title: "La porte du chateau est fermee !",
        intro:
          "Le gardien attend ton aide. Resol ce probleme pour ouvrir la grande porte du chateau.",
      };
    case "blocked_road":
      return {
        title: "La route est bloquee !",
        intro:
          "Aide ce villageois a degager le passage en resolvant cet exercice.",
      };
    case "broken_bridge":
      return {
        title: "Le pont est casse !",
        intro:
          "Aide a reparer le pont en trouvant la bonne reponse.",
      };
    case "crossroads":
      return {
        title: "Le chemin est cache !",
        intro:
          "Le guide connait la bonne direction. Aide-le pour reveler le passage.",
      };
    default:
      return {
        title: "Un obstacle t'attend !",
        intro: "Resol l'exercice pour continuer ton chemin.",
      };
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampCamera(cameraTarget) {
  if (!state.scene) {
    return cameraTarget;
  }

  return {
    x: clamp(cameraTarget.x, CAMERA_WIDTH / 2, state.scene.width - CAMERA_WIDTH / 2),
    y: clamp(cameraTarget.y, CAMERA_HEIGHT / 2, state.scene.height - CAMERA_HEIGHT / 2),
  };
}

function cameraViewBox() {
  const clamped = clampCamera(state.camera);
  return {
    x: clamped.x - CAMERA_WIDTH / 2,
    y: clamped.y - CAMERA_HEIGHT / 2,
    width: CAMERA_WIDTH,
    height: CAMERA_HEIGHT,
  };
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
      doorWidth: 116,
      doorHeight: 128,
    };
  });

  const exitY = obstacles.length
    ? obstacles[obstacles.length - 1].y + 190
    : FIRST_OBSTACLE_Y + 190;
  const height = Math.max(920, exitY + 90);

  const routePoints = [
    { x: START_X, y: START_Y },
    ...obstacles.map((obstacle) => ({ x: obstacle.x, y: obstacle.barrierY + 12 })),
    { x: obstacles.length ? obstacles[obstacles.length - 1].x : START_X, y: exitY },
  ];

  const signs = [];
  for (let index = 1; index < routePoints.length; index += 1) {
    const previous = routePoints[index - 1];
    const current = routePoints[index];
    signs.push({
      x: (previous.x + current.x) / 2,
      y: (previous.y + current.y) / 2 - 36,
      direction:
        current.x > previous.x ? "↘" : current.x < previous.x ? "↙" : "↓",
    });
  }

  const decor = {
    trees: [
      { x: SCENE_PADDING_X + 96, y: SCENE_PADDING_Y + 172 },
      { x: SCENE_PADDING_X + 1460, y: SCENE_PADDING_Y + 160 },
      { x: SCENE_PADDING_X + 120, y: SCENE_PADDING_Y + 422 },
      { x: SCENE_PADDING_X + 1450, y: SCENE_PADDING_Y + 458 },
      { x: SCENE_PADDING_X + 122, y: height - 210 },
      { x: SCENE_PADDING_X + 1470, y: height - 230 },
    ],
    bushes: [
      { x: SCENE_PADDING_X + 540, y: SCENE_PADDING_Y + 126 },
      { x: SCENE_PADDING_X + 1080, y: SCENE_PADDING_Y + 260 },
      { x: SCENE_PADDING_X + 420, y: SCENE_PADDING_Y + 510 },
      { x: SCENE_PADDING_X + 1140, y: SCENE_PADDING_Y + 650 },
      { x: SCENE_PADDING_X + 490, y: height - 150 },
      { x: SCENE_PADDING_X + 1040, y: height - 120 },
    ],
    rocks: [
      { x: SCENE_PADDING_X + 690, y: SCENE_PADDING_Y + 332 },
      { x: SCENE_PADDING_X + 890, y: SCENE_PADDING_Y + 560 },
      { x: SCENE_PADDING_X + 720, y: height - 210 },
    ],
    flowers: [
      { x: SCENE_PADDING_X + 300, y: SCENE_PADDING_Y + 138 },
      { x: SCENE_PADDING_X + 1320, y: SCENE_PADDING_Y + 350 },
      { x: SCENE_PADDING_X + 280, y: SCENE_PADDING_Y + 640 },
      { x: SCENE_PADDING_X + 1320, y: height - 140 },
    ],
  };

  return {
    width: SCENE_WIDTH,
    height,
    routePoints,
    obstacles,
    signs,
    decor,
  };
}

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

function playerMarkup() {
  return `
    <g id="player-token" class="player-token" transform="translate(${state.playerPosition.x}, ${state.playerPosition.y})">
      <circle cx="0" cy="0" r="38" fill="transparent"></circle>
      <g transform="translate(0, -11)">
        <ellipse cx="0" cy="42" rx="18" ry="7" class="player-shadow"></ellipse>
        <circle cx="0" cy="-16" r="14" class="player-head"></circle>
        <path d="M -18 20 Q 0 -10 18 20 L 12 40 L -12 40 Z" class="player-body"></path>
        <line x1="-10" y1="7" x2="-23" y2="20" class="player-limb"></line>
        <line x1="10" y1="7" x2="23" y2="20" class="player-limb"></line>
        <line x1="-8" y1="40" x2="-16" y2="60" class="player-limb"></line>
        <line x1="8" y1="40" x2="16" y2="60" class="player-limb"></line>
      </g>
    </g>
  `;
}

function treeMarkup(tree) {
  return `
    <g class="tree" transform="translate(${tree.x}, ${tree.y})">
      <rect x="-10" y="22" width="20" height="46" rx="6" class="tree-trunk"></rect>
      <circle cx="0" cy="-8" r="30" class="tree-leaf tree-leaf-back"></circle>
      <circle cx="-20" cy="12" r="24" class="tree-leaf"></circle>
      <circle cx="22" cy="10" r="22" class="tree-leaf"></circle>
      <circle cx="2" cy="20" r="26" class="tree-leaf tree-leaf-front"></circle>
    </g>
  `;
}

function bushMarkup(bush) {
  return `
    <g class="bush" transform="translate(${bush.x}, ${bush.y})">
      <circle cx="-20" cy="0" r="22" class="bush-leaf"></circle>
      <circle cx="0" cy="-8" r="26" class="bush-leaf"></circle>
      <circle cx="24" cy="4" r="20" class="bush-leaf"></circle>
    </g>
  `;
}

function rockMarkup(rock) {
  return `
    <g class="rock" transform="translate(${rock.x}, ${rock.y})">
      <ellipse cx="0" cy="12" rx="34" ry="18" class="rock-shape rock-back"></ellipse>
      <ellipse cx="-18" cy="0" rx="18" ry="14" class="rock-shape"></ellipse>
      <ellipse cx="14" cy="2" rx="20" ry="16" class="rock-shape rock-front"></ellipse>
    </g>
  `;
}

function flowerMarkup(flower) {
  return `
    <g class="flower" transform="translate(${flower.x}, ${flower.y})">
      <line x1="0" y1="0" x2="0" y2="26" class="flower-stem"></line>
      <circle cx="0" cy="0" r="5" class="flower-center"></circle>
      <circle cx="-8" cy="0" r="5" class="flower-petal"></circle>
      <circle cx="8" cy="0" r="5" class="flower-petal"></circle>
      <circle cx="0" cy="-8" r="5" class="flower-petal"></circle>
      <circle cx="0" cy="8" r="5" class="flower-petal"></circle>
    </g>
  `;
}

function directionSignMarkup(sign) {
  return `
    <g class="direction-sign" transform="translate(${sign.x}, ${sign.y}) rotate(-4)">
      <rect x="-38" y="-16" width="76" height="34" rx="10" class="sign-board"></rect>
      <line x1="-4" y1="18" x2="-4" y2="42" class="sign-pole"></line>
      <text x="0" y="6" text-anchor="middle" class="sign-arrow">${sign.direction}</text>
    </g>
  `;
}

function obstacleStatus(index) {
  const currentIndex = currentConceptIndex();
  if (!state.session || currentIndex < 0) {
    return "locked";
  }
  if (state.session.terminee || index < currentIndex) {
    return "done";
  }
  if (index === currentIndex) {
    return "current";
  }
  return "locked";
}

function obstacleMarkup(obstacle) {
  const status = obstacleStatus(obstacle.index);
  const recentlyUnlocked = state.justUnlockedIndex === obstacle.index && Date.now() < state.justUnlockedUntil;
  const theme = obstacleTheme(obstacle.type);
  const obstacleClasses = [
    "obstacle",
    `obstacle-${status}`,
    `obstacle-${obstacle.type}`,
    recentlyUnlocked ? "obstacle-unlocking" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const doorX = obstacle.x - obstacle.doorWidth / 2;
  const doorY = obstacle.barrierY - obstacle.doorHeight / 2;
  const remaining =
    status === "current" && state.session?.phase === "renforcement"
      ? state.session.exercices_renforcement_restants
      : null;
  const levelCopy =
    status === "current"
      ? `Niveau ${state.session.niveau_resolution_courant}`
      : status === "done"
        ? "Aide terminee"
        : "A venir";
  const scenery = obstacleSceneryMarkup(obstacle, status, theme, { doorX, doorY });
  const helper = obstacleHelperMarkup(obstacle);
  const unlockHint = obstacleUnlockHintMarkup(obstacle, status);

  return `
    <g class="${obstacleClasses}" data-obstacle-index="${obstacle.index}">
      ${scenery}
      ${helper}
      <g class="obstacle-label" transform="translate(${obstacle.x}, ${doorY - 44})">
        <rect x="-118" y="-26" width="236" height="32" rx="12" class="obstacle-chip"></rect>
        <text x="0" y="-4" text-anchor="middle" class="obstacle-chip-text">${conceptLabel(obstacle.concept)}</text>
      </g>
      <g class="obstacle-status" transform="translate(${obstacle.x}, ${doorY + obstacle.doorHeight + 34})">
        <rect x="-64" y="-20" width="128" height="28" rx="12" class="status-chip"></rect>
        <text x="0" y="-1" text-anchor="middle" class="status-chip-text">${levelCopy}</text>
        ${
          remaining !== null
            ? `<text x="0" y="24" text-anchor="middle" class="status-chip-subtext">Renfo restants : ${remaining}</text>`
            : ""
        }
      </g>
      ${unlockHint}
    </g>
  `;
}

function obstacleHelperMarkup(obstacle) {
  const npcX =
    obstacle.type === "crossroads" ? obstacle.x + 140 : obstacle.x + 118;
  const npcY = obstacle.type === "broken_bridge" ? obstacle.barrierY - 6 : obstacle.barrierY + 4;
  return `
    <g class="npc" transform="translate(${npcX}, ${npcY})">
      <circle cx="0" cy="-18" r="11" class="npc-head"></circle>
      <rect x="-12" y="-2" width="24" height="32" rx="9" class="npc-body"></rect>
      <line x1="-8" y1="30" x2="-14" y2="48" class="npc-limb"></line>
      <line x1="8" y1="30" x2="14" y2="48" class="npc-limb"></line>
      <line x1="-10" y1="8" x2="-20" y2="20" class="npc-limb"></line>
      <line x1="10" y1="8" x2="20" y2="20" class="npc-limb"></line>
    </g>
  `;
}

function obstacleUnlockHintMarkup(obstacle, status) {
  if (obstacle.type !== "crossroads") {
    return "";
  }
  return `
    <g class="crossroad-secret ${status === "done" ? "visible" : ""}">
      <path d="M ${obstacle.x + 34} ${obstacle.barrierY + 12} C ${obstacle.x + 100} ${obstacle.barrierY + 34} ${obstacle.x + 150} ${obstacle.barrierY + 88} ${obstacle.x + 184} ${obstacle.barrierY + 126}" class="secret-path"></path>
      <path d="M ${obstacle.x + 168} ${obstacle.barrierY + 114} l 20 12 l -24 2 z" class="secret-arrow"></path>
    </g>
  `;
}

function obstacleSceneryMarkup(obstacle, status, theme, positions) {
  const { doorX, doorY } = positions;
  switch (obstacle.type) {
    case "castle_gate":
      return `
        <line x1="44" y1="${obstacle.barrierY}" x2="${doorX - 10}" y2="${obstacle.barrierY}" class="fence-line"></line>
        <line x1="${doorX + obstacle.doorWidth + 10}" y1="${obstacle.barrierY}" x2="${SCENE_WIDTH - 44}" y2="${obstacle.barrierY}" class="fence-line"></line>
        <g class="castle" transform="translate(${obstacle.x}, ${doorY - 24})">
          <rect x="-148" y="34" width="296" height="118" rx="14" class="castle-wall"></rect>
          <rect x="-176" y="8" width="52" height="152" rx="14" class="castle-tower"></rect>
          <rect x="124" y="8" width="52" height="152" rx="14" class="castle-tower"></rect>
          <path d="M -176 8 l 26 -22 l 26 22 z" class="castle-roof"></path>
          <path d="M 124 8 l 26 -22 l 26 22 z" class="castle-roof"></path>
          <g class="door-frame-group">
            <rect x="-68" y="24" width="136" height="138" rx="18" class="door-arch"></rect>
            ${
              status === "done"
                ? `
                  <g class="door-panels open castle-open">
                    <rect x="-82" y="34" width="58" height="128" class="door-panel left-open"></rect>
                    <rect x="26" y="34" width="58" height="128" class="door-panel right-open"></rect>
                  </g>
                `
                : `
                  <g class="door-panels">
                    <rect x="-58" y="34" width="58" height="128" class="door-panel left"></rect>
                    <rect x="0" y="34" width="58" height="128" class="door-panel right"></rect>
                    <circle cx="16" cy="98" r="4" class="door-handle"></circle>
                    <rect x="-14" y="68" width="28" height="34" rx="6" class="door-lock"></rect>
                    <path d="M -8 68 a 8 8 0 0 1 16 0" class="door-lock-shackle"></path>
                  </g>
                `
            }
          </g>
        </g>
      `;
    case "blocked_road":
      return `
        <g class="cabin" transform="translate(${obstacle.x - 170}, ${doorY + 14})">
          <rect x="-50" y="34" width="100" height="88" rx="10" class="cabin-wall"></rect>
          <path d="M -62 34 L 0 -18 L 62 34 Z" class="cabin-roof"></path>
          <rect x="-14" y="64" width="28" height="58" rx="8" class="cabin-door"></rect>
          <rect x="-38" y="56" width="18" height="18" rx="4" class="cabin-window"></rect>
          <rect x="20" y="56" width="18" height="18" rx="4" class="cabin-window"></rect>
        </g>
        <g class="blocked-road-barrier">
          <line x1="52" y1="${obstacle.barrierY}" x2="${obstacle.x - 94}" y2="${obstacle.barrierY}" class="fence-line"></line>
          <line x1="${obstacle.x + 94}" y1="${obstacle.barrierY}" x2="${SCENE_WIDTH - 52}" y2="${obstacle.barrierY}" class="fence-line"></line>
          ${
            status === "done"
              ? `
                <g class="log-cleared">
                  <ellipse cx="${obstacle.x - 128}" cy="${obstacle.barrierY + 84}" rx="46" ry="16" class="log-shape"></ellipse>
                  <circle cx="${obstacle.x - 164}" cy="${obstacle.barrierY + 84}" r="15" class="log-end"></circle>
                </g>
              `
              : `
                <g class="log-block" transform="translate(${obstacle.x}, ${obstacle.barrierY}) rotate(-6)">
                  <ellipse cx="0" cy="0" rx="88" ry="18" class="log-shape"></ellipse>
                  <circle cx="-74" cy="0" r="17" class="log-end"></circle>
                  <circle cx="74" cy="0" r="17" class="log-end"></circle>
                </g>
              `
          }
          <g class="rock-pile ${status === "done" ? "scattered" : ""}">
            <circle cx="${obstacle.x + 84}" cy="${obstacle.barrierY - 8}" r="18" class="block-rock"></circle>
            <circle cx="${obstacle.x + 108}" cy="${obstacle.barrierY + 8}" r="16" class="block-rock"></circle>
          </g>
        </g>
      `;
    case "broken_bridge":
      return `
        <rect x="0" y="${obstacle.barrierY - 54}" width="${SCENE_WIDTH}" height="108" class="river-band"></rect>
        <g class="bridge" transform="translate(${obstacle.x}, ${obstacle.barrierY})">
          <line x1="-130" y1="-40" x2="-130" y2="48" class="bridge-post"></line>
          <line x1="130" y1="-40" x2="130" y2="48" class="bridge-post"></line>
          <line x1="-130" y1="-36" x2="130" y2="-36" class="bridge-rail"></line>
          <line x1="-130" y1="42" x2="130" y2="42" class="bridge-rail"></line>
          <g class="bridge-planks ${status === "done" ? "repaired" : "broken"}">
            <rect x="-118" y="-10" width="56" height="20" class="bridge-plank"></rect>
            <rect x="-54" y="-10" width="56" height="20" class="bridge-plank"></rect>
            ${status === "done" ? '<rect x="10" y="-10" width="56" height="20" class="bridge-plank missing-fixed"></rect>' : ""}
            <rect x="74" y="-10" width="44" height="20" class="bridge-plank"></rect>
          </g>
        </g>
      `;
    case "crossroads":
      return `
        <g class="crossroad">
          <path d="M ${obstacle.x - 170} ${obstacle.barrierY} C ${obstacle.x - 64} ${obstacle.barrierY - 18} ${obstacle.x + 36} ${obstacle.barrierY - 44} ${obstacle.x + 136} ${obstacle.barrierY - 12}" class="cross-path-main"></path>
          <path d="M ${obstacle.x + 16} ${obstacle.barrierY - 4} C ${obstacle.x + 90} ${obstacle.barrierY - 16} ${obstacle.x + 154} ${obstacle.barrierY - 70} ${obstacle.x + 226} ${obstacle.barrierY - 126}" class="cross-path-hidden ${status === "done" ? "revealed" : ""}"></path>
          <g class="direction-signpost" transform="translate(${obstacle.x - 126}, ${doorY + 28})">
            <line x1="0" y1="-12" x2="0" y2="68" class="sign-pole"></line>
            <rect x="-44" y="-22" width="88" height="22" rx="9" class="sign-board"></rect>
            <text x="0" y="-6" text-anchor="middle" class="sign-arrow">?</text>
            <rect x="-38" y="12" width="76" height="22" rx="9" class="sign-board lower"></rect>
            <text x="0" y="28" text-anchor="middle" class="sign-arrow">${status === "done" ? "→" : "..."}</text>
          </g>
          <g class="mist-cloud ${status === "done" ? "cleared" : ""}">
            <ellipse cx="${obstacle.x + 120}" cy="${obstacle.barrierY - 80}" rx="68" ry="28" class="mist puff-a"></ellipse>
            <ellipse cx="${obstacle.x + 168}" cy="${obstacle.barrierY - 112}" rx="56" ry="22" class="mist puff-b"></ellipse>
          </g>
        </g>
      `;
    default:
      return "";
  }
}

function sceneMarkup(scene) {
  const roadPath = buildRoadPath(scene.routePoints);
  const hintObstacle = activeObstacle();
  const hintText =
    state.nearObstacle && hintObstacle && !state.panelOpen
      ? "Appuie sur Entree ou Espace pour aider"
      : "";

  return `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d9eef8"></stop>
        <stop offset="100%" stop-color="#eef8df"></stop>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${scene.width}" height="${scene.height}" class="scene-sky"></rect>
    <rect x="0" y="${scene.height - 130}" width="${scene.width}" height="130" class="scene-grass"></rect>
    <g class="decor-layer">
      ${scene.decor.trees.map(treeMarkup).join("")}
      ${scene.decor.bushes.map(bushMarkup).join("")}
      ${scene.decor.rocks.map(rockMarkup).join("")}
      ${scene.decor.flowers.map(flowerMarkup).join("")}
    </g>
    <g class="road-layer">
      <path d="${roadPath}" class="road-outline"></path>
      <path d="${roadPath}" class="road-surface"></path>
      <path d="${roadPath}" class="road-center-line"></path>
    </g>
    <g class="sign-layer">
      ${scene.signs.map(directionSignMarkup).join("")}
    </g>
    <g class="obstacle-layer">
      ${scene.obstacles.map(obstacleMarkup).join("")}
    </g>
    <g id="interaction-hint" class="interaction-hint ${hintText ? "visible" : ""}" transform="translate(${hintObstacle ? hintObstacle.x : 0}, ${hintObstacle ? hintObstacle.barrierY - 94 : 0})">
      <rect x="-132" y="-28" width="264" height="40" rx="14" class="hint-bubble"></rect>
      <text x="0" y="-2" text-anchor="middle" class="hint-text">${hintText}</text>
    </g>
    ${playerMarkup()}
  `;
}

function renderScene() {
  if (!state.session) {
    mapElement.innerHTML = "";
    mapStatus.textContent = "Aucune session active.";
    return;
  }

  state.scene = createSceneModel(state.session.concepts || []);
  mapElement.setAttribute("viewBox", `0 0 ${state.scene.width} ${state.scene.height}`);
  mapElement.innerHTML = sceneMarkup(state.scene);
  mapStatus.textContent = state.session.terminee
    ? "Toutes les portes sont ouvertes. Le parcours est termine."
    : `Deplace-toi jusqu'a l'obstacle ${currentConceptIndex() + 1} / ${state.session.concepts.length} avec les fleches, puis appuie sur Entree ou Espace.`;
  updateSceneDynamics();
}

function clampToBounds(position) {
  return {
    x: clamp(position.x, 40, state.scene.width - 40),
    y: clamp(position.y, 54, state.scene.height - 50),
  };
}

function applyCurrentBarrier(nextPosition, previousPosition) {
  const obstacle = activeObstacle();
  if (!obstacle || state.panelOpen || state.session.terminee) {
    return nextPosition;
  }

  const unresolved = obstacleStatus(obstacle.index) === "current";
  if (!unresolved) {
    return nextPosition;
  }

  const barrierY = obstacle.barrierY - PLAYER_RADIUS;
  if (previousPosition.y <= barrierY && nextPosition.y > barrierY) {
    return { ...nextPosition, y: barrierY };
  }
  return nextPosition;
}

function updateNearObstacle() {
  const obstacle = activeObstacle();
  state.nearObstacle =
    Boolean(obstacle) &&
    distance(state.playerPosition, { x: obstacle.x, y: obstacle.barrierY }) <= INTERACTION_DISTANCE &&
    !state.session.terminee;
}

function updateSceneDynamics() {
  if (!state.scene) {
    return;
  }

  const playerNode = document.getElementById("player-token");
  if (playerNode) {
    playerNode.setAttribute("transform", `translate(${state.playerPosition.x}, ${state.playerPosition.y})`);
  }

  const hintNode = document.getElementById("interaction-hint");
  const obstacle = activeObstacle();
  if (hintNode && obstacle) {
    hintNode.setAttribute("transform", `translate(${obstacle.x}, ${obstacle.barrierY - 94})`);
    hintNode.classList.toggle("visible", state.nearObstacle && !state.panelOpen);
    const hintTextNode = hintNode.querySelector(".hint-text");
    if (hintTextNode) {
      hintTextNode.textContent =
        state.nearObstacle && !state.panelOpen
          ? "Appuie sur Entree ou Espace pour aider"
          : "";
    }
  }

  state.camera = clampCamera({ x: state.playerPosition.x, y: state.playerPosition.y });
  const view = cameraViewBox();
  mapElement.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
}

function openExercisePanel() {
  if (!state.currentExercise || !state.nearObstacle || state.panelOpen) {
    return;
  }
  state.panelOpen = true;
  renderExerciseCard();
}

function closeExercisePanel() {
  state.panelOpen = false;
  renderExerciseCard();
}

function renderExerciseCard() {
  if (!state.currentExercise || !state.panelOpen) {
    exerciseTitle.textContent = state.session?.terminee
      ? "Parcours termine"
      : `Obstacle courant : ${conceptLabel(state.session?.concept_courant)}`;
    presentationBadge.textContent = state.session?.presentation_courante || "1_guide";
    exerciseCard.className = "exercise-card empty-state";
    exerciseCard.innerHTML = "<p>Approche-toi du premier obstacle et appuie sur Entree ou Espace.</p>";
    progressCopy.textContent =
      state.session?.phase === "renforcement"
        ? `Renforcement en cours : ${state.session.exercices_renforcement_restants} exercice(s) restant(s) sur cet obstacle.`
        : "Avance avec les fleches jusqu'a la porte active, puis appuie sur Entree ou Espace.";
    updateNearObstacle();
    updateSceneDynamics();
    return;
  }

  const exercise = state.currentExercise;
  const resolutionKey = state.session.presentation_courante;
  const details = exercise.presentations[resolutionKey] || {};
  const steps = (details.etapes_methode || [])
    .map((step) => `<li>${step}</li>`)
    .join("");
  const theme = obstacleTheme(activeObstacle()?.type);

  exerciseTitle.textContent = `Obstacle : ${conceptLabel(state.session.concept_courant)}`;
  presentationBadge.textContent = resolutionKey;
  progressCopy.textContent =
    state.session.phase === "renforcement"
      ? `Renforcement en cours : ${state.session.exercices_renforcement_restants} exercice(s) restant(s) apres celui-ci.`
      : `Detection de maitrise en cours. Niveau actuel : ${state.session.niveau_resolution_courant}.`;

  exerciseCard.className = "exercise-card";
  exerciseCard.innerHTML = `
    <div class="exercise-panel-top">
      <p class="exercise-meta">Pattern : <strong>${exercise.pattern.pattern_name}</strong></p>
      <button id="close-exercise" type="button" class="ghost-button">Fermer</button>
    </div>
    <div class="story-block">
      <p class="story-title">${theme.title}</p>
      <p class="story-text">${theme.intro}</p>
    </div>
    <p class="exercise-statement">${exercise.enonce}</p>
    ${
      steps
        ? `<div class="method-block">
            <p>Methode affichee :</p>
            <ol>${steps}</ol>
          </div>`
        : ""
    }
    <form id="exercise-form" class="exercise-form">
      <label for="answer-input">Ta reponse</label>
      <input id="answer-input" name="answer" type="text" autocomplete="off" required />
      <div class="exercise-actions">
        <button type="submit">Valider</button>
        <button id="help-button" type="button" class="ghost-button">Besoin d'aide ?</button>
      </div>
    </form>
  `;

  document.getElementById("exercise-form").addEventListener("submit", handleSubmitAnswer);
  document.getElementById("help-button").addEventListener("click", () => {
    window.ParcoursChat?.open();
    document.getElementById("chat-input")?.focus();
  });
  document.getElementById("close-exercise").addEventListener("click", closeExercisePanel);
  updateNearObstacle();
  updateSceneDynamics();
}

function applySessionSnapshot(snapshot, exercise = null) {
  state.session = snapshot;
  state.currentExercise = exercise || snapshot.exercice_courant || state.currentExercise;
  sessionTitle.textContent = snapshot.terminee
    ? "Parcours termine"
    : `Carte ${snapshot.niveau_scolaire} : ${conceptLabel(snapshot.concept_courant)}`;
  currentLevelBadge.textContent = snapshot.niveau_scolaire;
  presentationBadge.textContent = snapshot.presentation_courante;
  renderScene();
  renderExerciseCard();
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
    throw new Error(message);
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

async function startSession(level) {
  startStatus.textContent = "Creation de la session...";
  const payload = await request("/session/demarrer", {
    method: "POST",
    body: JSON.stringify({ niveau_scolaire: level }),
  });

  state.sessionId = payload.session_id;
  state.playerPosition = { x: START_X, y: START_Y };
  state.panelOpen = false;
  state.justUnlockedIndex = null;
  state.justUnlockedUntil = 0;
  state.camera = { x: START_X, y: START_Y };
  applySessionSnapshot(payload.progression, payload.exercice);
  startScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  clearFeedback();
}

function feedbackFromStatus(status) {
  switch (status) {
    case "correct_niveau_suivant":
      return {
        message: "Bravo ! Tu aides encore ce personnage au niveau suivant.",
        tone: "success",
      };
    case "correct_nouveau_renforcement":
      return {
        message: "Bravo ! Un nouvel exercice du meme obstacle commence.",
        tone: "success",
      };
    case "correct_concept_debloque":
      switch (state.lastUnlockedType) {
        case "castle_gate":
          return {
            message: "Bravo ! La porte du chateau s'ouvre !",
            tone: "success",
          };
        case "blocked_road":
          return {
            message: "Bravo ! Le passage est degage, la route est libre !",
            tone: "success",
          };
        case "broken_bridge":
          return {
            message: "Bravo ! Le pont est repare, tu peux traverser !",
            tone: "success",
          };
        case "crossroads":
          return {
            message: "Bravo ! Le bon chemin est maintenant visible !",
            tone: "success",
          };
        default:
          return {
            message: "Bravo ! L'obstacle est debloque, tu peux continuer !",
            tone: "success",
          };
      }
    case "incorrect":
      return {
        message: "Essaie encore, la porte reste fermee pour le moment.",
        tone: "warning",
      };
    case "carte_terminee":
      return {
        message: "Felicitations, tout le parcours est termine !",
        tone: "success",
      };
    default:
      return {
        message: status,
        tone: "info",
      };
  }
}

async function handleSubmitAnswer(event) {
  event.preventDefault();
  if (!state.currentExercise || !state.sessionId) {
    return;
  }

  const answerInput = event.currentTarget.querySelector("#answer-input");
  const reponse = answerInput.value.trim();
  if (!reponse) {
    setFeedback("Entre une reponse avant de valider.", "warning");
    return;
  }

  try {
    const previousConceptIndex = currentConceptIndex();
    const previousObstacleType = activeObstacle()?.type || null;
    const payload = await request("/evaluer", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        exercice_id: state.currentExercise.id,
        reponse_donnee: reponse,
      }),
    });

    if (payload.statut === "correct_concept_debloque") {
      state.justUnlockedIndex = previousConceptIndex;
      state.justUnlockedUntil = Date.now() + 1200;
      state.lastUnlockedType = previousObstacleType;
      state.panelOpen = false;
    }

    if (payload.statut === "carte_terminee") {
      state.panelOpen = false;
    }

    const nextExercise = payload.exercice_suivant || state.currentExercise;
    applySessionSnapshot(payload.progression, nextExercise);
    state.currentExercise = nextExercise;
    const meta = feedbackFromStatus(payload.statut);
    setFeedback(meta.message, meta.tone);
    answerInput.value = "";

    if (payload.statut === "carte_terminee") {
      exerciseCard.className = "exercise-card empty-state";
      exerciseCard.innerHTML = "<p>Le parcours est termine. Tu peux changer de niveau pour rejouer.</p>";
    }
  } catch (error) {
    setFeedback(error.message, "warning");
  }
}

function resetToStart() {
  state.sessionId = null;
  state.session = null;
  state.currentExercise = null;
  state.panelOpen = false;
  state.keysPressed.clear();
  state.nearObstacle = false;
  state.scene = null;
  state.playerPosition = { x: START_X, y: START_Y };
  state.justUnlockedIndex = null;
  state.justUnlockedUntil = 0;
  state.camera = { x: START_X, y: START_Y };
  gameScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
  startStatus.textContent = "Choisis un niveau pour demarrer une nouvelle session.";
  mapElement.innerHTML = "";
  exerciseCard.className = "exercise-card empty-state";
  exerciseCard.innerHTML = "<p>Approche-toi du premier obstacle pour lancer l'exercice.</p>";
  clearFeedback();
  window.ParcoursChat?.reset();
}

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

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && !isTyping) {
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
  if (state.keysPressed.has("ArrowLeft")) {
    dx -= 1;
  }
  if (state.keysPressed.has("ArrowRight")) {
    dx += 1;
  }
  if (state.keysPressed.has("ArrowUp")) {
    dy -= 1;
  }
  if (state.keysPressed.has("ArrowDown")) {
    dy += 1;
  }

  if (dx === 0 && dy === 0) {
    return null;
  }

  const length = Math.hypot(dx, dy);
  return { dx: dx / length, dy: dy / length };
}

function tick(timestamp) {
  if (!lastTick) {
    lastTick = timestamp;
  }
  const deltaSeconds = (timestamp - lastTick) / 1000;
  lastTick = timestamp;

  if (state.scene && state.session && !state.panelOpen && !state.session.terminee) {
    const vector = movementVector();
    if (vector) {
      const proposed = {
        x: state.playerPosition.x + vector.dx * PLAYER_SPEED * deltaSeconds,
        y: state.playerPosition.y + vector.dy * PLAYER_SPEED * deltaSeconds,
      };
      const bounded = clampToBounds(proposed);
      state.playerPosition = applyCurrentBarrier(bounded, state.playerPosition);
    }
    updateNearObstacle();
    updateSceneDynamics();
  }

  animationFrameId = window.requestAnimationFrame(tick);
}

document.querySelectorAll(".level-button").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await startSession(button.dataset.level);
    } catch (error) {
      startStatus.textContent = `Impossible de demarrer la session : ${error.message}`;
    }
  });
});

restartButton.addEventListener("click", resetToStart);
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
  openExercisePanel,
};

if (!animationFrameId) {
  animationFrameId = window.requestAnimationFrame(tick);
}
