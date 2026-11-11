/* carte/monde.js — Modèle de scène : routes, arrêts, trésor, ambiance, obstacles.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

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

/* Chemin de renforcement : UN SEUL trace continu entre l'obstacle courant et
   le suivant, quelle que soit la maitrise. Seul le NOMBRE de haltes varie
   (REINFORCEMENT_TOTALS). */
function reinforcementPath(geometry) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", geometry.d);
  return path;
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

  const path = reinforcementPath(geometry);
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
   Accorde a la maitrise 3 uniquement (regle dans tresor.js), pose sur
   le chemin AVANT l'unique fanion bonus : l'eleve le ramasse en
   marchant. Ici on ne fait que le placer sur le trace et le ramasser.
   ============================================================ */
function computeTreasure() {
  if (!state.scene || !window.ParcoursTresor?.tresorDisponible(state.session, state.treasuresCollected)) {
    return null;
  }
  const geometry = branchGeometry(state.scene, state.session.concept_index);
  if (!geometry) {
    return null;
  }
  const path = reinforcementPath(geometry);
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
  setFeedback(`Trésor de l’excellence ! +${window.ParcoursTresor.BONUS} étoiles`, "success");
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
    posts.push(
      `<circle cx="${x + 3}" cy="${y + 4}" r="8" class="fence-post-shadow"></circle><circle cx="${x}" cy="${y}" r="7.5" class="fence-post"></circle><circle cx="${x}" cy="${y}" r="3.4" class="fence-post-top"></circle>`,
    );
  }
  return `
    <line x1="${fromX}" y1="${y + 5}" x2="${toX}" y2="${y + 5}" class="fence-rail-shadow"></line>
    <line x1="${fromX}" y1="${y - 4}" x2="${toX}" y2="${y - 4}" class="fence-rail"></line>
    <line x1="${fromX}" y1="${y + 4}" x2="${toX}" y2="${y + 4}" class="fence-rail"></line>
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
        <circle cx="0" cy="-12" r="27" class="marker-halo"></circle>
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
const CASTLE_MAX_TILT = 18; /* degres */
const CASTLE_DECALAGE_AVAL = 62; /* unites monde */

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
      /* Le chateau est dessine de trois quarts (tours et toits vers le haut de
         l'ecran) : au-dela d'une legere inclinaison il paraitrait renverse.
         On borne donc le pivot ; la route passe sous la muraille et ressort
         par la porte, alignee sur les clotures horizontales. */
      const angleRoute = castleGateAngle(obstacle);
      const vueDessus = Math.abs(angleRoute) > CASTLE_MAX_TILT + 12;
      const gateAngle = vueDessus ? angleRoute : clamp(angleRoute, -CASTLE_MAX_TILT, CASTLE_MAX_TILT);
      return `
        ${fenceMarkup(Math.max(40, obstacle.x - 560), obstacle.x - 165, y)}
        ${fenceMarkup(obstacle.x + 165, Math.min(SCENE_WIDTH - 40, obstacle.x + 560), y)}
        ${
          vueDessus
            ? `<g transform="translate(${obstacle.x}, ${y})${uprightSuffix()} rotate(${gateAngle.toFixed(1)})">${ASSETS.castleTop(done)}</g>`
            : /* Vue de trois quarts : le chateau est decale vers l'AVAL de la
                 route (native +y), pour que le joueur qui arrive par l'amont
                 s'arrete devant la muraille au lieu de marcher dessus. */
              `<g transform="translate(${obstacle.x}, ${y + CASTLE_DECALAGE_AVAL})${uprightSuffix()} rotate(${gateAngle.toFixed(1)})">${ASSETS.castle(done)}</g>`
        }
        <g transform="translate(${obstacle.x + 150}, ${y + 52})${uprightSuffix()}">${ASSETS.npc("gardien")}</g>
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
              <g class="log-cleared" transform="translate(${obstacle.x - 140}, ${y + 66}) rotate(18)">
                <ellipse cx="4" cy="8" rx="60" ry="14" class="tree-shadow"></ellipse>
                <rect x="-46" y="-12" width="44" height="24" rx="12" class="log-shape"></rect>
                <rect x="4" y="-12" width="44" height="24" rx="12" class="log-shape"></rect>
                <circle cx="48" cy="0" r="12" class="log-end"></circle>
                <circle cx="48" cy="0" r="6" class="log-ring"></circle>
                <circle cx="-2" cy="0" r="12" class="log-end"></circle>
                <circle cx="-2" cy="0" r="6" class="log-ring"></circle>
              </g>
            `
            : `
              <g class="log-block" transform="translate(${obstacle.x}, ${y}) rotate(-7)">
                <ellipse cx="6" cy="10" rx="110" ry="20" class="tree-shadow"></ellipse>
                <!-- Arbre tombe en travers : tronc, branches, houppier encore feuillu. -->
                <circle cx="96" cy="-6" r="30" class="fallen-crown"></circle>
                <circle cx="114" cy="16" r="22" class="fallen-crown"></circle>
                <circle cx="86" cy="18" r="18" class="fallen-crown-light"></circle>
                <path d="M 50 -6 l 26 -22 M 58 6 l 22 18" class="fallen-branch"></path>
                <rect x="-84" y="-14" width="160" height="28" rx="14" class="log-shape"></rect>
                <path d="M -70 -6 h 30 M -30 4 h 40 M 20 -5 h 36 M -56 7 h 18" class="log-bark"></path>
                <circle cx="-84" cy="0" r="14" class="log-end"></circle>
                <circle cx="-84" cy="0" r="8" class="log-ring"></circle>
                <circle cx="-84" cy="0" r="3" class="log-ring"></circle>
                <ellipse cx="22" cy="-28" rx="20" ry="14" class="block-rock"></ellipse>
                <ellipse cx="-30" cy="26" rx="15" ry="11" class="block-rock"></ellipse>
              </g>
            `
        }
        <g transform="translate(${obstacle.x - versCentre * 110}, ${y + 46})${uprightSuffix()}">${ASSETS.npc("bucheron")}</g>
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
        <g transform="translate(${obstacle.x + 118}, ${y + 108})${uprightSuffix()}">${ASSETS.npc("pecheur")}</g>
      `;
    case "crossroads":
      return `
        <line x1="${Math.max(40, obstacle.x - 520)}" y1="${y + 6}" x2="${obstacle.x - 120}" y2="${y + 6}" class="hedge-line ombre"></line>
        <line x1="${obstacle.x + 120}" y1="${y + 6}" x2="${Math.min(SCENE_WIDTH - 40, obstacle.x + 520)}" y2="${y + 6}" class="hedge-line ombre"></line>
        <line x1="${Math.max(40, obstacle.x - 520)}" y1="${y}" x2="${obstacle.x - 120}" y2="${y}" class="hedge-line"></line>
        <line x1="${obstacle.x + 120}" y1="${y}" x2="${Math.min(SCENE_WIDTH - 40, obstacle.x + 520)}" y2="${y}" class="hedge-line"></line>
        <line x1="${Math.max(40, obstacle.x - 520)}" y1="${y - 5}" x2="${obstacle.x - 120}" y2="${y - 5}" class="hedge-line clair"></line>
        <line x1="${obstacle.x + 120}" y1="${y - 5}" x2="${Math.min(SCENE_WIDTH - 40, obstacle.x + 520)}" y2="${y - 5}" class="hedge-line clair"></line>
        <path d="M ${obstacle.x + 30} ${y + 6} C ${obstacle.x + 130} ${y - 10} ${obstacle.x + 200} ${y - 70} ${obstacle.x + 250} ${y - 150}" class="hidden-path-edge"></path>
        <path d="M ${obstacle.x + 30} ${y + 6} C ${obstacle.x + 130} ${y - 10} ${obstacle.x + 200} ${y - 70} ${obstacle.x + 250} ${y - 150}" class="hidden-path"></path>
        <!-- Le panneau est une SIGNALETIQUE (poteau + boards + "?"), redressee
             comme les plaques (uprightSuffix) : sans ça le "?" s'affiche en "¿"
             sur une carte up (180°). Les haies, la brume et le PNJ restent, eux,
             du decor de terrain qui pivote avec la carte. -->
        <g transform="translate(${obstacle.x - 110}, ${y - 30})${uprightSuffix()}">${ASSETS.signpost(done)}</g>
        <!-- Brume en nappes (cercles fondus) : elle cache le sentier jusqu'a la
             bonne reponse, puis se dissipe (classe obstacle-done). -->
        <g class="mist-cloud">
          ${[
            [150, -60, 34], [190, -78, 42], [234, -66, 32], [176, -40, 26],
            [214, -112, 30], [252, -128, 36], [286, -110, 26], [232, -146, 24],
          ]
            .map(([dx, dy, r]) => `<circle cx="${obstacle.x + dx}" cy="${y + dy}" r="${r}" class="mist"></circle>`)
            .join("")}
        </g>
        <g transform="translate(${obstacle.x + 116}, ${y + 46})${uprightSuffix()}">${ASSETS.npc("voyageur")}</g>
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
