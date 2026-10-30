/* carte/boucle.js — Clavier, boucle de jeu, boussole de guidage.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

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

/* Intention de deplacement en espace d'affichage : direction unitaire et
   force (0..1). Le joystick tactile est analogique (direction libre, force
   selon l'inclinaison) ; le clavier donne 8 directions a pleine vitesse. */
function movementVector() {
  const j = state.joystick;
  if (j && j.force > 0) {
    return { dx: j.x, dy: j.y, force: j.force };
  }
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
  return { dx: dx / length, dy: dy / length, force: 1 };
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
      /* Vitesse proportionnelle a l'inclinaison du joystick (au moins un
         petit pas, pour qu'un leger geste fasse toujours avancer). */
      const vitesse = PLAYER_SPEED * Math.max(0.3, input.force ?? 1);
      const proposed = {
        x: state.playerPosition.x + vector.dx * vitesse * deltaSeconds,
        y: state.playerPosition.y + vector.dy * vitesse * deltaSeconds,
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
  updateSceneIdle(timestamp);

  /* Suivi de camera avec easing doux (jamais de recentrage brutal). Sous un
     dixieme de pixel, la camera s'aimante sur la cible : l'easing s'arrete
     vraiment et applyCamera cesse d'ecrire le transform (donc aucun travail). */
  if (state.scene) {
    /* La camera vit en espace d'affichage : on suit la PROJECTION de la
       position joueur (natif -> affichage). */
    const target = clampCamera(toDisplay(state.playerPosition));
    const factor = 1 - Math.exp(-CAMERA_EASE * deltaSeconds);
    state.camera.x += (target.x - state.camera.x) * factor;
    state.camera.y += (target.y - state.camera.y) * factor;
    if (Math.abs(target.x - state.camera.x) < 0.1) state.camera.x = target.x;
    if (Math.abs(target.y - state.camera.y) < 0.1) state.camera.y = target.y;
    applyCamera();
    updateGuideCompass();
  }

  /* Position sauvegardee regulierement (le beforeunload couvre le reste). */
  if (state.sessionId && timestamp - lastPositionSaveAt > 2000) {
    lastPositionSaveAt = timestamp;
    saveSessionRef();
  }

  animationFrameId = window.requestAnimationFrame(tick);
}

/* ============================================================
   BOUSSOLE DE GUIDAGE
   Quand l'objectif courant (obstacle ou prochain fanion) sort de l'ecran,
   une fleche se colle au bord, du cote ou il se trouve, et pointe vers lui.
   N'ecrit dans le DOM que si l'etat change (meme principe que dynamicsCache).
   ============================================================ */
const BOUSSOLE_MARGE = 46; /* px CSS entre la fleche et le bord de l'ecran */
const boussoleCache = { visible: null, transform: "" };

function updateGuideCompass() {
  const node = document.getElementById("guide-boussole");
  if (!node || !mapLayer.ready) {
    return;
  }
  const cible = interactionTarget();
  let visible = false;
  let transform = boussoleCache.transform;
  if (cible && !state.panelOpen) {
    const camera = clampCamera(state.camera);
    const point = toDisplay(cible);
    const s = mapLayer.s;
    const cx = mapLayer.viewW / 2;
    const cy = mapLayer.viewH / 2;
    const dx = (point.x - camera.x) * s;
    const dy = (point.y - camera.y) * s;
    /* Zone ou la fleche peut se poser : on evite le HUD en haut, le hibou en
       bas a droite et, sur tablette/telephone, le pave directionnel en bas. */
    const haut = 96;
    const bas = mapLayer.viewH - (estAppareilTactile ? 236 : 110);
    const gauche = BOUSSOLE_MARGE;
    const droite = mapLayer.viewW - BOUSSOLE_MARGE;
    const horsEcran =
      cx + dx < BOUSSOLE_MARGE ||
      cx + dx > mapLayer.viewW - BOUSSOLE_MARGE ||
      cy + dy < BOUSSOLE_MARGE ||
      cy + dy > mapLayer.viewH - BOUSSOLE_MARGE;
    if (horsEcran && bas > haut) {
      /* Point du rectangle autorise sur la droite centre -> cible. */
      const kx = dx > 0 ? (droite - cx) / dx : dx < 0 ? (gauche - cx) / dx : Infinity;
      const ky = dy > 0 ? (bas - cy) / dy : dy < 0 ? (haut - cy) / dy : Infinity;
      const k = Math.max(0, Math.min(kx, ky));
      const x = cx + dx * k;
      const y = cy + dy * k;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${angle.toFixed(0)}deg)`;
      visible = true;
    }
  }
  if (visible !== boussoleCache.visible) {
    boussoleCache.visible = visible;
    node.classList.toggle("hidden", !visible);
  }
  if (visible && transform !== boussoleCache.transform) {
    boussoleCache.transform = transform;
    node.style.transform = transform;
  }
}
