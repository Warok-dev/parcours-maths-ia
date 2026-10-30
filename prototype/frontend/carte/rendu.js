/* carte/rendu.js — Rendu SVG de la scène, décor vivant, variante visuelle par niveau.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

/* ============================================================
   RENDU DE LA SCENE
   ============================================================ */

/* Mode d'animation (perf.js) : en econome, la carte est allegee (moins de
   brins d'herbe, aucun element anime en plus) et la CSS coupe les
   animations d'ambiance. Sans perf.js (tests), on reste vivant. */
function modeEconome() {
  return Boolean(window.ParcoursPerf?.estEconome?.());
}

/* Decalage d'animation stable par element : chaque arbre ondule a son
   propre rythme, sans hasard (meme carte = meme mouvement). */
function decalageAnimation(x, y, periode) {
  const h = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
  return `animation-delay: ${(-h * periode).toFixed(2)}s`;
}
function decorMarkup(scene) {
  const { decor } = scene;
  return `
    ${decor.patches
      .map(
        (patch) =>
          `<ellipse cx="${patch.x}" cy="${patch.y}" rx="${patch.rx}" ry="${patch.ry}" class="ground-patch ${patch.dark ? "dark" : ""}"></ellipse>`,
      )
      .join("")}
    ${(decor.meadows || []).map((m) => `<g transform="translate(${m.x}, ${m.y})">${ASSETS.meadow(m.fleurs)}</g>`).join("")}
    ${(decor.ponds || [])
      .map((p) => `<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${p.tilt})">${ASSETS.pond(p.rx, p.ry)}</g>`)
      .join("")}
  `;
}

/* Hameau : maisons (avec meule de foin) et signaletique du bord de route.
   Mode vivant : la cheminee fume. */
function villageMarkup(scene) {
  const { decor } = scene;
  const fumee = modeEconome() ? "" : `<g class="smoke" transform="translate(27.5, -44)">${ASSETS.smoke()}</g>`;
  const maisons = (decor.houses || [])
    .map(
      (h) => `
      <g transform="translate(${h.x.toFixed(1)}, ${h.y.toFixed(1)})${uprightSuffix()}">${ASSETS.house(h.toit)}${fumee}</g>
      ${h.foin ? `<g transform="translate(${(h.x + h.foin.dx).toFixed(1)}, ${(h.y + h.foin.dy).toFixed(1)})">${ASSETS.hayBale()}</g>` : ""}
    `,
    )
    .join("");
  const bornes = (decor.roadsideMarkers || [])
    .map(
      (m) =>
        `<g transform="translate(${m.x.toFixed(1)}, ${m.y.toFixed(1)})${uprightSuffix()}">${m.type === "borne" ? ASSETS.milestone() : ASSETS.lantern()}</g>`,
    )
    .join("");
  return maisons + bornes;
}

function propsMarkup(scene) {
  const { decor } = scene;
  const econome = modeEconome();
  /* Econome : une touffe sur deux et pas de brins isoles (des centaines de
     petits chemins a redessiner a chaque recentrage de la carte). */
  const tufts = econome ? decor.tufts.filter((_, i) => i % 2 === 0) : decor.tufts;
  const brins = econome ? [] : decor.brins || [];
  /* Arbres dans le vent (mode vivant) : un groupe interieur ondule, le
     groupe exterieur garde le placement (meme motif que le decor vivant). */
  const arbre = (p, dessin, periode) => {
    const pos = `translate(${Number(p.x).toFixed(1)}, ${Number(p.y).toFixed(1)})`;
    return econome
      ? `<g transform="${pos}">${dessin}</g>`
      : `<g transform="${pos}"><g class="sway" style="${decalageAnimation(p.x, p.y, periode)}">${dessin}</g></g>`;
  };
  return `
    ${tufts.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.grassTuft()}</g>`).join("")}
    ${brins
      .map((p, i) => `<path d="M ${(p.x - 4).toFixed(0)} ${p.y.toFixed(0)} q -1 -6 2 -9 M ${(p.x + 1).toFixed(0)} ${(p.y + 1).toFixed(0)} q 1 -7 4 -9" class="${i % 3 === 0 ? "grass-tuft clair" : "grass-tuft"}"></path>`)
      .join("")}
    ${decor.flowers
      .map((p, index) => `<g transform="translate(${p.x}, ${p.y})">${index % 3 === 0 ? ASSETS.flowerPink() : ASSETS.flower()}</g>`)
      .join("")}
    ${(decor.mushrooms || []).map((p) => `<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)})">${ASSETS.mushrooms()}</g>`).join("")}
    ${(decor.stumps || []).map((p) => `<g transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)})">${ASSETS.stump()}</g>`).join("")}
    ${decor.rocks.map((p) => `<g transform="translate(${p.x}, ${p.y})${uprightSuffix()}">${ASSETS.rock()}</g>`).join("")}
    ${decor.bushes.map((p) => `<g transform="translate(${p.x}, ${p.y})">${ASSETS.bush()}</g>`).join("")}
    ${decor.trees.map((p) => arbre(p, ASSETS.tree(), 6)).join("")}
    ${(decor.fruitTrees || []).map((p, i) => arbre(p, ASSETS.fruitTree(i), 6)).join("")}
    ${(decor.pines || []).map((p) => arbre(p, ASSETS.pine(), 7)).join("")}
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

  /* Mode econome : rien d'anime en plus du decor fixe. */
  if (modeEconome()) {
    return "";
  }

  /* Papillons poses au-dessus des fleurs (ils les butinent), jusqu'a 4. */
  flowers.slice(0, 4).forEach((f, i) => {
    bits.push(`
      <g class="living-decor" transform="translate(${f.x.toFixed(1)}, ${(f.y - 24).toFixed(1)})${uprightSuffix()}">
        <g class="critter-flutter" style="animation-delay: ${(i * -1.9).toFixed(1)}s">
          ${ASSETS.butterfly(i % 2 === 0 ? "orange" : "bleu")}
        </g>
      </g>
    `);
  });

  /* Un chat qui flane pres d'un buisson (a defaut d'un arbre). */
  const perchoir = bushes[0] || trees[0] || null;
  if (perchoir) {
    bits.push(`
      <g class="living-decor" transform="translate(${(perchoir.x + 34).toFixed(1)}, ${(perchoir.y + 20).toFixed(1)})${uprightSuffix()}">
        <g class="cat-stroll">${ASSETS.cat()}</g>
      </g>
    `);
  }

  /* Sur chaque mare : un canard qui fait des ronds et des ronds dans l'eau. */
  (decor.ponds || []).forEach((p, i) => {
    const rx = Math.max(18, p.rx * 0.45);
    const ry = Math.max(12, p.ry * 0.4);
    bits.push(`
      <g class="living-decor" transform="translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) rotate(${p.tilt})">
        <g class="ripple-wrap" transform="translate(${(-p.rx * 0.3).toFixed(1)}, ${(-p.ry * 0.15).toFixed(1)})">${ASSETS.ripple()}</g>
        <g class="ripple-wrap ripple-tard" transform="translate(${(p.rx * 0.25).toFixed(1)}, ${(p.ry * 0.2).toFixed(1)})">${ASSETS.ripple()}</g>
        <g class="duck-orbit" style="--orbite-x: ${rx.toFixed(0)}px; --orbite-y: ${ry.toFixed(0)}px; animation-delay: ${(i * -7).toFixed(0)}s">
          <g class="duck-swim">${ASSETS.duck()}</g>
        </g>
      </g>
    `);
  });

  /* Des villageois qui se promenent devant leur maison et reviennent. */
  (decor.houses || []).slice(0, 2).forEach((h, i) => {
    bits.push(`
      <g class="living-decor" transform="translate(${(h.x - 30).toFixed(1)}, ${(h.y + 76).toFixed(1)})${uprightSuffix()}">
        <g class="villager-walk${i % 2 ? " inverse" : ""}" style="animation-delay: ${(i * -5).toFixed(0)}s">
          <g class="villager-pas">${ASSETS.npc("villageois")}</g>
        </g>
      </g>
    `);
  });
  return bits.join("");
}

/* Trace guide : une ligne de cailloux dores sur le troncon de route qui mene
   a l'obstacle en cours (depuis l'obstacle precedent, ou le depart). Statique
   (aucune animation, donc aucun repaint de la carte) ; redessinee avec la
   scene a chaque changement d'etape. */
function guideTrailMarkup(scene) {
  const obstacle = activeObstacle();
  if (!obstacle || obstacleStatus(obstacle.index) !== "current") {
    return "";
  }
  const depart = scene.routePoints[obstacle.index];
  const arrivee = scene.routePoints[obstacle.index + 1];
  if (!depart || !arrivee) {
    return "";
  }
  return `<path d="${buildRoadPath([depart, arrivee])}" class="road-guide"></path>`;
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
      <path d="${roadPath}" class="road-fringe"></path>
      <path d="${roadPath}" class="road-edge"></path>
      <path d="${roadPath}" class="road-surface"></path>
      <path d="${roadPath}" class="road-paving"></path>
      <path d="${roadPath}" class="road-paving offset" transform="translate(14, 10)"></path>
      <path d="${roadPath}" class="road-paving offset" transform="translate(-14, -8)"></path>
      ${guideTrailMarkup(scene)}
    </g>
    <g class="village-layer">${villageMarkup(scene)}</g>
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

/* Dernieres valeurs ecrites dans le DOM par la boucle de jeu : evite de
   reecrire des attributs identiques a chaque frame (chaque setAttribute
   invalide le rendu du SVG). Invalide apres chaque re-rendu de la scene. */
const dynamicsCache = {
  playerTransform: null,
  playerWalking: null,
  hintTransform: null,
  hintVisible: null,
  hintText: null,
  sceneIdle: null,
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
  document.getElementById("ciel-anime")?.classList.toggle("pause", overlayOpen);
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
  updateSceneDynamics();
  applyCamera();
}
