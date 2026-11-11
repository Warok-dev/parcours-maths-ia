/* carte/camera.js — Orientation du parcours et caméra (super-fenêtre + translate3d).
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

/* ============================================================
   ORIENTATION (direction dominante du parcours)
   La scene est generee/jouee en espace NATIF (progression vers +y) ; la
   direction tiree par la graine (world.js) est une rotation d'affichage
   d'un multiple de 90°. Ces helpers relaient la transformation de world.js
   au rendu, a la camera et au clavier. La logique de jeu
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

/* ------------------------------------------------------------
   Couche carte composite (P5). Etat geometrique de la super-fenetre : le
   viewBox couvre "zone visible + marge" et n'est reecrit (1 repaint) que
   lorsque la camera approche du bord de la marge ; entre-temps le suivi se
   fait par translate3d (composite GPU, 0 repaint). Au repos : ni pan ni
   repaint (le cache lastTransform + l'aimant camera coupent tout). */
const mapLayer = {
  ready: false,
  s: 1,                 /* px CSS par unite d'affichage (echelle "slice" courante) */
  viewW: 0, viewH: 0,   /* taille visible reelle (px CSS = #game-screen) */
  marginX: 0, marginY: 0, /* marge de part et d'autre (px CSS) */
  superW: CAMERA_WIDTH, superH: CAMERA_HEIGHT, /* super-fenetre (unites d'affichage) */
  originX: 0, originY: 0, /* coin haut-gauche de la super-fenetre (unites d'affichage) */
  entiere: false,       /* la couche couvre toute la carte : plus jamais de recentrage */
  lastTransform: "",
};

/* (Re)calcule la geometrie de la couche depuis la taille reelle du viewport.
   A appeler quand #game-screen est visible (init de scene, resize/rotation).
   Ne touche NI a la camera NI aux coordonnees monde : pur rendu. */
function setupMapLayer() {
  const rect = gameScreen.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return; /* ecran encore masque : setupMapLayer sera rappele a l'affichage */
  }
  const dpr = window.devicePixelRatio || 1;
  /* Echelle d'affichage = celle du slice actuel (l'image couvre le viewport). */
  const s = Math.max(rect.width / CAMERA_WIDTH, rect.height / CAMERA_HEIGHT);
  /* Plus grande marge tenant sous la limite de texture GPU, au DPR reel de
     l'appareil : borne la couche composite meme sur mobile haute densite. */
  const maxSuperCss = MAX_LAYER_TEXTURE_PX / dpr;
  const marginX = Math.min(SUPER_MARGIN_TARGET_PX, Math.max(0, (maxSuperCss - rect.width) / 2));
  const marginY = Math.min(SUPER_MARGIN_TARGET_PX, Math.max(0, (maxSuperCss - rect.height) / 2));
  mapLayer.s = s;
  mapLayer.viewW = rect.width;
  mapLayer.viewH = rect.height;
  mapLayer.marginX = marginX;
  mapLayer.marginY = marginY;
  /* Couche = TOUTE la carte quand la scene est connue. Le recentrage de la
     super-fenetre reecrivait le viewBox : tout le contenu bougeait dans le
     calque, qui devait etre entierement repeint et rasterise (une saccade
     environ chaque seconde de marche). Une couche couvrant la carte entiere
     n'est jamais repeinte en se deplacant : le navigateur la decoupe en tuiles
     et ne rasterise, une seule fois, que celles qui approchent de l'ecran. */
  mapLayer.entiere = Boolean(state.scene && displayWidth() && displayHeight());
  if (mapLayer.entiere) {
    mapLayer.superW = displayWidth();
    mapLayer.superH = displayHeight();
  } else {
    mapLayer.superW = (rect.width + 2 * marginX) / s;
    mapLayer.superH = (rect.height + 2 * marginY) / s;
  }
  /* Taille px explicite de la couche (aspect identique au viewBox => aucun
     recadrage interne ; le recadrage vient de #game-screen overflow:hidden). */
  mapElement.style.width = `${(mapLayer.superW * s).toFixed(1)}px`;
  mapElement.style.height = `${(mapLayer.superH * s).toFixed(1)}px`;
  mapElement.style.transformOrigin = "0 0";
  mapElement.style.willChange = "transform";
  mapLayer.ready = true;
  mapLayer.lastTransform = "";
  recenterSuperWindow(
    mapLayer.entiere
      ? { x: mapLayer.superW / 2, y: mapLayer.superH / 2 }
      : state.camera || { x: mapLayer.superW / 2, y: mapLayer.superH / 2 },
  );
  applyCamera();
  if (typeof surveillerAnimationsCarte === "function") {
    window.requestAnimationFrame(surveillerAnimationsCarte);
  }
  if (typeof placerJoueur === "function") {
    dynamicsCache.playerSize = null;
    placerJoueur();
  }
}

/* Recentre la super-fenetre sur la camera et reecrit le viewBox (le seul
   repaint complet). Appele a l'init, au resize, et au franchissement du seuil
   de marge. */
function recenterSuperWindow(camera) {
  mapLayer.originX = camera.x - mapLayer.superW / 2;
  mapLayer.originY = camera.y - mapLayer.superH / 2;
  mapElement.setAttribute(
    "viewBox",
    `${mapLayer.originX.toFixed(1)} ${mapLayer.originY.toFixed(1)} ${mapLayer.superW.toFixed(1)} ${mapLayer.superH.toFixed(1)}`,
  );
  mapLayer.lastTransform = ""; /* le pan doit etre reapplique apres recentrage */
}

/* Suivi camera image par image. Meme camera (clampCamera) qu'avant : seul le
   MECANISME de rendu change (translate3d au lieu de reecrire le viewBox). */
function applyCamera() {
  if (!mapLayer.ready) {
    return;
  }
  const clamped = clampCamera(state.camera);
  const s = mapLayer.s;
  /* Recentrage si la camera approche du bord de la marge (avant que la zone
     visible n'atteigne le bord peint). Marge disponible de chaque cote =
     marginX/s unites ; on garde RECENTER_PAD en securite. */
  const superCx = mapLayer.originX + mapLayer.superW / 2;
  const superCy = mapLayer.originY + mapLayer.superH / 2;
  const slackX = (mapLayer.marginX / s) * (1 - RECENTER_PAD);
  const slackY = (mapLayer.marginY / s) * (1 - RECENTER_PAD);
  if (
    !mapLayer.entiere &&
    (Math.abs(clamped.x - superCx) > slackX || Math.abs(clamped.y - superCy) > slackY)
  ) {
    recenterSuperWindow(clamped);
  }
  /* Place le point monde "clamped" au centre de la zone visible via translate3d
     (transform-origin 0 0, pas d'echelle) : screen = translate + (P-origin)*s. */
  const tx = mapLayer.viewW / 2 - (clamped.x - mapLayer.originX) * s;
  const ty = mapLayer.viewH / 2 - (clamped.y - mapLayer.originY) * s;
  const transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
  if (transform === mapLayer.lastTransform) {
    return; /* camera immobile => aucun travail (equivalent de l'ancien cache) */
  }
  mapLayer.lastTransform = transform;
  mapElement.style.transform = transform;
}
