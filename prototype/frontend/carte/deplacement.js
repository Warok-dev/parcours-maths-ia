/* carte/deplacement.js — Navigation entre écrans, mouvement et collisions, particules.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

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
  /* L'ecran est desormais visible : la couche carte peut mesurer le viewport
     et poser sa geometrie (taille px + super-fenetre + 1er pan). */
  setupMapLayer();
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

/* Pose/retire #map.scene-idle selon l'immobilite du joueur : arrete depuis
   SCENE_IDLE_DELAY_MS, le personnage regarde autour de lui (CSS de
   styles/20-monde-anime.css) ; il reprend son allure des qu'il rebouge. Le
   cache evite tout toggle a chaque frame. */
function updateSceneIdle(timestamp) {
  if (state.playerMoving) {
    lastMoveAt = timestamp;
  }
  const idle = !state.playerMoving && timestamp - lastMoveAt >= SCENE_IDLE_DELAY_MS;
  if (idle !== dynamicsCache.sceneIdle) {
    dynamicsCache.sceneIdle = idle;
    playerLayer?.classList.toggle("scene-idle", idle);
  }
}

/* Le personnage est sur son propre calque (#player-layer), hors de la grande
   carte SVG : on le place a l'ecran par un simple transform CSS (travail du
   compositeur, la carte n'est jamais repeinte pour lui). Position ecran =
   centre de la vue + (projection du joueur - camera) x echelle ; son angle a
   l'ecran ajoute la rotation de la carte (orientAngle). A rappeler apres
   chaque mouvement de camera. */
const PLAYER_LAYER_UNITS = 160; /* doit suivre le viewBox de #player-layer */
function placerJoueur() {
  if (!playerLayer || !state.scene || !mapLayer.ready) {
    return;
  }
  const s = mapLayer.s;
  const taille = PLAYER_LAYER_UNITS * s;
  const tailleTexte = `${taille.toFixed(1)}px`;
  if (tailleTexte !== dynamicsCache.playerSize) {
    dynamicsCache.playerSize = tailleTexte;
    playerLayer.style.width = tailleTexte;
    playerLayer.style.height = tailleTexte;
  }
  const camera = clampCamera(state.camera);
  const point = toDisplay(state.playerPosition);
  const x = mapLayer.viewW / 2 + (point.x - camera.x) * s - taille / 2;
  const y = mapLayer.viewH / 2 + (point.y - camera.y) * s - taille / 2;
  const angle = state.playerAngle + (state.scene.orientAngle || 0);
  const transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${angle.toFixed(1)}deg)`;
  if (transform !== dynamicsCache.playerTransform) {
    dynamicsCache.playerTransform = transform;
    playerLayer.style.transform = transform;
  }
}

function updateSceneDynamics() {
  if (!state.scene) {
    return;
  }

  const playerNode = document.getElementById("player-token");
  if (playerNode) {
    placerJoueur();
    if (state.playerMoving !== dynamicsCache.playerWalking) {
      dynamicsCache.playerWalking = state.playerMoving;
      playerNode.classList.toggle("player-walking", state.playerMoving);
    }
  }

  const hintNode = document.getElementById("interaction-hint");
  const target = interactionTarget();
  const hintVisible = state.nearObstacle && !state.panelOpen;
  if (hintNode && target) {
    const hintY = target.kind === "stop" ? target.y - 128 : target.y - 168;
    const hintTransform = `translate(${target.x.toFixed(1)}, ${hintY.toFixed(1)})${uprightSuffix()} scale(${estAppareilTactile ? 0.62 : 0.8})`;
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
}

/* ============================================================
   PARTICULES DE REUSSITE
   ============================================================ */

/* Le personnage saute de joie quand un obstacle s'ouvre ou qu'un fanion
   est valide (classe retiree a la fin de l'animation CSS). */
let celebrationTimer = null;
function celebrerJoueur() {
  const token = document.getElementById("player-token");
  if (!token) {
    return;
  }
  token.classList.remove("player-cheer");
  /* Relance l'animation meme si la classe etait deja posee. */
  void token.getBoundingClientRect();
  token.classList.add("player-cheer");
  window.clearTimeout(celebrationTimer);
  celebrationTimer = window.setTimeout(() => token.classList.remove("player-cheer"), 900);
}
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
  /* Econome : 6 eclats au lieu de 16 (chacun est un calque anime). */
  const nb = modeEconome() ? 6 : 16;
  for (let index = 0; index < nb; index += 1) {
    const angle = (Math.PI * 2 * index) / nb + Math.random() * 0.5;
    const range = 90 + Math.random() * 110;
    const tx = Math.cos(angle) * range;
    const ty = Math.sin(angle) * range - 40;
    const isStar = index % 2 === 0;
    const shape = isStar
      ? `<polygon points="${starPathMarkup(12)}" class="fx-star"></polygon>`
      : `<circle r="6" class="fx-dot"></circle>`;
    pieces.push({ tx, ty, shape });
  }
  celebrerJoueur();
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
