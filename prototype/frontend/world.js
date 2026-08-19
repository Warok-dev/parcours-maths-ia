/* ============================================================
   MONDE PROCEDURAL (geometrie pure, testable en Node)
   Genere le tracé serpentin du chemin principal, la position et
   l'ordre des obstacles, et le placement du décor — a partir d'une
   GRAINE. Meme graine => monde identique (indispensable pour que la
   carte reste stable pendant une partie et a la reprise).

   Logique PURE : aucun accès au DOM. map.js orchestre le rendu et le
   jeu ; ici on ne calcule que des coordonnées et des chemins SVG.
   Teste par test_world.js (>= 200 graines, garde-fous verifies).

   PROPRIETE DE SURETE : le chemin est GENERE en espace NATIF, ou il
   progresse toujours de haut en bas (y strictement croissant), et
   buildRoadPath place ses points de controle a mi-hauteur (midY) —
   chaque courbe reste donc dans sa propre bande verticale, ce qui rend
   l'auto-intersection du tracé principal impossible par construction.
   Le validateur le verifie quand meme geometriquement, et buildScene
   regenere en cas d'echec.

   DIRECTION DOMINANTE : la graine tire aussi une direction d'affichage
   (haut->bas, bas->haut, gauche->droite, droite->gauche). Ce n'est PAS
   une reecriture du generateur : la scene est toujours produite et
   validee en natif (axe de progression = y), puis on attache une
   ROTATION d'un multiple de 90° (isometrie) qui envoie l'espace natif
   vers l'espace d'AFFICHAGE. map.js applique cette rotation au rendu, a
   la camera, a la mini-carte et au vecteur clavier ; la logique de jeu
   (position joueur, obstacles, collisions) reste en natif. La rotation
   etant une isometrie, tous les garde-fous verifies en natif (pas
   d'auto-intersection, distances mini, bornes) restent vrais apres
   orientation — les tests le reverifient dans chaque direction.
   ============================================================ */
(function () {
  /* ---- Constantes du monde (MIROIR de map.js : doivent coincider) ----
     START_X/START_Y = point de depart du joueur (map.js), le chemin doit
     y commencer. SCENE_WIDTH, SCENE_PADDING_X identiques a map.js. */
  const SCENE_WIDTH = 2200;
  const SCENE_PADDING_X = 300;
  const CENTER_X = SCENE_WIDTH / 2; /* 1100 */
  const START_X = SCENE_PADDING_X + 250; /* 550 */
  const START_Y = 458; /* SCENE_PADDING_Y(420) + 38 */
  /* Premier obstacle assez bas pour que le troncon START->obstacle0 depasse
     toujours MIN_POINT_DIST quelle que soit la position horizontale generee. */
  const FIRST_OBSTACLE_Y = 820;
  const BARRIER_OFFSET_Y = 46;
  const RIVER_HALF_HEIGHT = 62;
  const TYPES = ["castle_gate", "blocked_road", "broken_bridge", "crossroads"];

  /* Directions dominantes d'affichage. "down" = comportement historique
     (l'espace natif tel quel). Les trois autres sont des rotations d'un
     multiple de 90° appliquees a l'affichage (voir orientation()). */
  const DIRECTIONS = ["down", "up", "right", "left"];

  /* ---- Reglages du serpentin ----
     Le tracé suit une EPINE SINUSOIDALE dont les parametres varient par graine
     (vraie diversite de forme, pas un simple bruit) :
       x(t) = centre(t) + A * sin(PI * freq * t + phase),  centre(t) = 1100 + drift*t
     - freq   : nombre de virages (oscillations) le long du parcours
     - A      : amplitude globale du zigzag (resserré <-> ample)
     - drift  : derive horizontale = direction dominante (diagonale)
     - phase  : décalage de rythme / cote de depart
     Les obstacles sont echantillonnes SUR cette epine (donc toujours sur le
     chemin), la sortie aussi (terminaison variable, plus jamais verticale). */
  /* Espacement vertical entre obstacles. Le troncon entre deux obstacles porte
     les FANIONS de renforcement (2, 3 ou 4 selon la maitrise detectee EN JEU,
     donc inconnue a la generation). map.js les etale sur la fraction
     STOP_SPREAD (0.18..0.85) du troncon ; pour que meme le palier a 4 fanions
     (maitrise 1) reste bien espace, le troncon doit etre assez long pour
     accueillir le MAXIMUM de fanions. On dimensionne donc GAP_MIN a partir de
     ce maximum : longueur mini = (maxFanions-1) * espacement_vise / STOP_SPREAD,
     + les retraits haut/bas appliques a la branche par branchGeometry (56 + 72).
     Ainsi "plus de fanions possibles -> troncon plus long", sans jamais
     entasser. Les bornes du monde (hauteur) sont derivees (exitY+120), donc
     elles s'elargissent automatiquement ; les autres garde-fous (auto-
     intersection, MIN_OBSTACLE_DIST, MAX_STEP_X) ne portent que sur x/la forme
     et restent respectes puisque seul l'ecart vertical augmente. */
  const MAX_REINFORCEMENT_STOPS = 4; /* miroir de max(REINFORCEMENT_TOTALS) cote map.js */
  const STOP_SPREAD = 0.67; /* fraction du troncon utilisee (0.85 - 0.18), miroir map.js */
  const STOP_TARGET_SPACING = 150; /* espacement vise entre 2 fanions au palier max */
  const BRANCH_TRIM = 128; /* retraits verticaux de branchGeometry : 56 (haut) + 72 (bas) */
  const GAP_MIN = Math.round(
    ((MAX_REINFORCEMENT_STOPS - 1) * STOP_TARGET_SPACING) / STOP_SPREAD + BRANCH_TRIM,
  ); /* ~800 : troncon assez long pour 4 fanions bien espaces */
  const GAP_MAX = GAP_MIN + 180; /* variation de proportion, comme avant */
  const AMP_MIN = 150; /* amplitude mini (tracé resserré) */
  const AMP_MAX = 540; /* amplitude maxi (tracé tres ample) */
  const FREQ_MIN = 1.0; /* 1 = une simple courbe en C (peu de virages) */
  const FREQ_MAX = 4.5; /* zigzag serré (beaucoup de virages) */
  const EXIT_DROP_MIN = 290; /* longueur mini de la sortie */
  const EXIT_DROP_MAX = 470; /* longueur maxi de la sortie */
  const PATH_X_MIN = 560; /* bande jouable : obstacles jamais hors cadre */
  const PATH_X_MAX = SCENE_WIDTH - 560; /* 1640 */

  /* Seuils des garde-fous (verifies par validateScene / les tests) */
  const MIN_POINT_DIST = 300; /* distance mini entre 2 points consecutifs */
  const MIN_OBSTACLE_DIST = 300; /* distance mini entre 2 obstacles */
  const MAX_STEP_X = 1120; /* saut horizontal maxi (champ camera zoomée) */
  const MAX_ATTEMPTS = 40; /* tentatives avant repli garanti-valide */

  /* ---------- Aleatoire deterministe (mulberry32) ---------- */
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

  /* Melange fort de la graine (splitmix32) : mulberry32 seul decorrèle mal ses
     tout premiers tirages entre graines arbitraires (deux graines distinctes
     donnaient des phases/formes voisines -> cartes qui se ressemblaient). On
     hache la graine puis on "rechauffe" le generateur avant de s'en servir. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    a = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
    a = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
    a = (a ^ (a >>> 16)) >>> 0;
    const rand = mulberry32(a);
    for (let i = 0; i < 12; i += 1) {
      rand();
    }
    return rand;
  }

  /* ---------- Petits utilitaires geometriques ---------- */
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
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

  /* ============================================================
     TRACE PRINCIPAL
     ============================================================ */
  /* Courbe identique cote rendu (map.js) et cote echantillonnage : points
     de controle a mi-hauteur -> S vertical entre deux points consecutifs. */
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

  /* Point d'une bezier cubique (memes points de controle que buildRoadPath). */
  function cubicPoint(p0, p1, t) {
    const midY = (p0.y + p1.y) / 2;
    const c1 = { x: p0.x, y: midY };
    const c2 = { x: p1.x, y: midY };
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    return {
      x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
      y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
    };
  }

  /* Echantillonne le tracé rendu en une polyligne (pour la detection
     geometrique d'auto-intersection). */
  function sampleRoad(routePoints, perSegment = 18) {
    const poly = [];
    for (let i = 1; i < routePoints.length; i += 1) {
      const p0 = routePoints[i - 1];
      const p1 = routePoints[i];
      for (let s = i === 1 ? 0 : 1; s <= perSegment; s += 1) {
        poly.push(cubicPoint(p0, p1, s / perSegment));
      }
    }
    return poly;
  }

  /* Intersection de deux segments [p1,p2] et [p3,p4] (orientations). */
  function ccw(a, b, c) {
    return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  }
  function segmentsIntersect(p1, p2, p3, p4) {
    const d1 = ccw(p3, p4, p1);
    const d2 = ccw(p3, p4, p2);
    const d3 = ccw(p1, p2, p3);
    const d4 = ccw(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /* Auto-intersection d'une polyligne ouverte : deux segments NON adjacents
     se croisent-ils ? */
  function hasSelfIntersection(poly) {
    for (let i = 0; i + 1 < poly.length; i += 1) {
      for (let j = i + 2; j + 1 < poly.length; j += 1) {
        if (segmentsIntersect(poly[i], poly[i + 1], poly[j], poly[j + 1])) {
          return true;
        }
      }
    }
    return false;
  }

  /* ============================================================
     ORDRE DES OBSTACLES : melange equilibre, sans doublon adjacent
     ============================================================ */
  function shuffledTypes(n, rand) {
    /* Base equilibree : chaque type revient floor/ceil(n/4) fois. */
    const base = [];
    for (let i = 0; i < n; i += 1) {
      base.push(TYPES[i % TYPES.length]);
    }
    /* Fisher-Yates seedé. */
    for (let i = base.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }
    /* Casse les doublons adjacents quand c'est possible (lisibilité :
       jamais deux memes univers d'affilée si on peut l'eviter). */
    for (let i = 1; i < base.length; i += 1) {
      if (base[i] !== base[i - 1]) {
        continue;
      }
      for (let j = i + 1; j < base.length; j += 1) {
        const casseVoisin = j + 1 < base.length && base[j + 1] === base[i];
        if (base[j] !== base[i - 1] && !casseVoisin) {
          const tmp = base[i];
          base[i] = base[j];
          base[j] = tmp;
          break;
        }
      }
    }
    return base;
  }

  /* ============================================================
     PARAMETRES DE FORME (tirés une fois par graine)
     C'est ici que naît la vraie diversite : freq/amp/drift/phase sont
     independants, donc deux graines donnent des STRUCTURES differentes
     (nombre de virages, largeur, inclinaison), pas le meme gabarit bruité.
     ============================================================ */
  function tirerFormeParams(rand) {
    const phase = rand() * Math.PI * 2;
    const freq = FREQ_MIN + rand() * (FREQ_MAX - FREQ_MIN);
    /* On choisit d'abord l'amplitude, puis on laisse le CENTRE de l'epine
       voyager librement dans toute la marge horizontale restante : le centre
       de DEPART (t=0) et le centre d'ARRIVEE (t=1) sont tirés independamment.
       Une carte peut donc pencher franchement (gauche->droite en escalier),
       rester verticale, ou occuper surtout un cote. Cet ordre garantit que
       centre(t) ± amp reste dans [PATH_X_MIN, PATH_X_MAX] pour tout t —
       jamais de clamp, donc jamais de sinusoide aplatie. */
    const amp = AMP_MIN + rand() * (AMP_MAX - AMP_MIN);
    const marge = Math.max(0, (PATH_X_MAX - PATH_X_MIN) / 2 - amp); /* jeu du centre */
    const centre0 = CENTER_X + (rand() * 2 - 1) * marge;
    const centreEnd = CENTER_X + (rand() * 2 - 1) * marge;
    return { phase, freq, amp, centre0, drift: centreEnd - centre0 };
  }

  /* Abscisse de l'epine a la progression t (0 = haut, 1 = sortie). */
  function spineX(t, forme) {
    const centre = forme.centre0 + forme.drift * t;
    return clamp(centre + forme.amp * Math.sin(Math.PI * forme.freq * t + forme.phase), PATH_X_MIN, PATH_X_MAX);
  }

  /* ============================================================
     POSITIONS DES OBSTACLES + POINTS DU CHEMIN
     Obstacles echantillonnes sur l'epine a t = i/n ; la sortie a t = 1
     (elle suit l'epine -> terminaison qui varie, plus jamais verticale).
     ============================================================ */
  function assembleScene(concepts, types, rand) {
    const n = concepts.length;
    const forme = tirerFormeParams(rand);
    const obstacles = [];
    let y = FIRST_OBSTACLE_Y;
    for (let i = 0; i < n; i += 1) {
      const t = n <= 1 ? 0 : i / n; /* la sortie occupe t = 1 */
      obstacles.push({
        index: i,
        concept: concepts[i],
        type: types[i],
        x: spineX(t, forme),
        y,
        barrierY: y - BARRIER_OFFSET_Y,
      });
      if (i < n - 1) {
        y += GAP_MIN + rand() * (GAP_MAX - GAP_MIN);
      }
    }
    const lastY = obstacles.length ? obstacles[obstacles.length - 1].y : FIRST_OBSTACLE_Y;
    const exitY = lastY + (EXIT_DROP_MIN + rand() * (EXIT_DROP_MAX - EXIT_DROP_MIN));
    const height = Math.max(1000, exitY + 120);
    const routePoints = [
      { x: START_X, y: START_Y },
      ...obstacles.map((obstacle) => ({ x: obstacle.x, y: obstacle.barrierY + 12 })),
      { x: obstacles.length ? spineX(1, forme) : CENTER_X, y: exitY },
    ];
    return { width: SCENE_WIDTH, height, routePoints, obstacles, forme };
  }

  /* ============================================================
     DECOR (arbres, buissons, rochers, fleurs, touffes, taches)
     Placement par rejet le long du tracé genere ; densité coherente
     avec l'existant, avec une legere variation de quantité par graine.
     ============================================================ */
  function placeDecor(scene, rand) {
    const { routePoints, obstacles, height } = scene;
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

    /* Densité de base identique a l'existant, avec ±15% de variation par
       graine pour que la quantité change aussi d'une carte a l'autre. */
    const density = height / 300;
    const jitter = () => 0.85 + rand() * 0.3;
    const trees = placeMany(Math.round(density * 3.4 * jitter()), 110, 95, []);
    const bushes = placeMany(Math.round(density * 2.6 * jitter()), 82, 70, trees);
    const rocks = placeMany(Math.round(density * 1.4 * jitter()), 84, 120, [...trees, ...bushes]);
    const flowers = placeMany(Math.round(density * 3.2 * jitter()), 62, 60, rocks);
    const tufts = placeMany(Math.round(density * 4.2 * jitter()), 56, 46, []);
    const patches = Array.from({ length: Math.round(density * 2.2 * jitter()) }, () => ({
      x: rand() * SCENE_WIDTH,
      y: 120 + rand() * (height - 240),
      rx: 90 + rand() * 150,
      ry: 55 + rand() * 85,
      dark: rand() > 0.5,
    }));
    return { trees, bushes, rocks, flowers, tufts, patches };
  }

  /* ============================================================
     BRANCHES DE RENFORCEMENT (courte / moyenne / longue)
     S'accrochent au tracé principal généré : start = sortie de
     l'obstacle i (routePoints[i+1]), end = point suivant
     (routePoints[i+2]). Aucune dépendance a des positions fixes.
     ============================================================ */
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

    return { short, medium, long, start, end, endOffset };
  }

  /* ============================================================
     VALIDATION (garde-fous) — verifie une scene candidate
     Retourne { ok, raison } ; buildScene regenere tant que !ok.
     ============================================================ */
  function validateScene(scene) {
    const { routePoints, obstacles, width, height } = scene;

    /* 1. Progression toujours vers le bas (y strictement croissant). */
    for (let i = 1; i < routePoints.length; i += 1) {
      if (routePoints[i].y <= routePoints[i - 1].y) {
        return { ok: false, raison: "y non monotone" };
      }
    }
    /* 2. Distance mini entre points consecutifs du chemin. */
    for (let i = 1; i < routePoints.length; i += 1) {
      if (distance(routePoints[i], routePoints[i - 1]) < MIN_POINT_DIST) {
        return { ok: false, raison: "points trop proches" };
      }
      if (Math.abs(routePoints[i].x - routePoints[i - 1].x) > MAX_STEP_X) {
        return { ok: false, raison: "saut horizontal trop large" };
      }
    }
    /* 3. Obstacles dans les limites jouables + distance mini entre eux. */
    for (let i = 0; i < obstacles.length; i += 1) {
      const o = obstacles[i];
      if (o.x < PATH_X_MIN || o.x > PATH_X_MAX || o.y < 0 || o.y > height) {
        return { ok: false, raison: "obstacle hors limites" };
      }
      if (i > 0 && distance(o, obstacles[i - 1]) < MIN_OBSTACLE_DIST) {
        return { ok: false, raison: "obstacles trop proches" };
      }
    }
    /* 4. Tous les points du tracé dans le cadre du monde. */
    for (const p of routePoints) {
      if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
        return { ok: false, raison: "point hors cadre" };
      }
    }
    /* 5. Aucune auto-intersection geometrique du tracé rendu. */
    if (hasSelfIntersection(sampleRoad(routePoints))) {
      return { ok: false, raison: "auto-intersection" };
    }
    return { ok: true, raison: "" };
  }

  /* ============================================================
     ORIENTATION (rotation d'affichage, multiple de 90°)
     Envoie l'espace NATIF (x dans [0,width], y dans [0,height], la
     progression allant vers +y) vers l'espace d'AFFICHAGE. Chaque
     direction est une isometrie, donc les garde-fous natifs restent
     valides apres transformation.
     ============================================================ */
  /* Direction tiree de la graine, sur un flux dedie (sale distinct) pour ne
     pas correler la direction avec la forme (freq/amp/drift). Constante sur
     toutes les tentatives d'une meme graine : c'est une propriete du monde,
     pas du repli. */
  function directionForSeed(seed) {
    const rand = seededRandom((seed ^ 0x5bd1e995) >>> 0);
    return DIRECTIONS[Math.min(DIRECTIONS.length - 1, Math.floor(rand() * DIRECTIONS.length))];
  }

  /* Matrice SVG native->affichage, angle de rotation (deg) et dimensions
     d'affichage (width/height echanges pour les rotations a 90°). La matrice
     SVG matrix(a,b,c,d,e,f) applique X=a*x+c*y+e, Y=b*x+d*y+f. */
  function orientation(direction, width, height) {
    switch (direction) {
      case "up": /* rotation 180° */
        return { matrix: `matrix(-1,0,0,-1,${width},${height})`, angle: 180, width, height };
      case "right": /* progression natif +y -> +X (vers la droite), rotation -90° */
        return { matrix: `matrix(0,-1,1,0,0,${width})`, angle: -90, width: height, height: width };
      case "left": /* progression natif +y -> -X (vers la gauche), rotation +90° */
        return { matrix: `matrix(0,1,-1,0,${height},0)`, angle: 90, width: height, height: width };
      default: /* down : identite */
        return { matrix: "matrix(1,0,0,1,0,0)", angle: 0, width, height };
    }
  }

  /* Point natif -> point d'affichage (memes formules que orientation()). */
  function toDisplayPoint(p, direction, width, height) {
    switch (direction) {
      case "up":
        return { x: width - p.x, y: height - p.y };
      case "right":
        return { x: p.y, y: width - p.x };
      case "left":
        return { x: height - p.y, y: p.x };
      default:
        return { x: p.x, y: p.y };
    }
  }

  /* Vecteur d'AFFICHAGE (intention clavier a l'ecran) -> vecteur NATIF a
     appliquer a la position du joueur. C'est la rotation inverse (partie
     lineaire, sans translation) : ainsi "fleche du bas" pousse toujours le
     jeton vers le bas de l'ecran, quelle que soit la direction du parcours. */
  function toNativeVector(v, direction) {
    switch (direction) {
      case "up":
        return { dx: -v.dx, dy: -v.dy };
      case "right":
        return { dx: -v.dy, dy: v.dx };
      case "left":
        return { dx: v.dy, dy: -v.dx };
      default:
        return { dx: v.dx, dy: v.dy };
    }
  }

  /* Attache les metadonnees d'orientation a une scene deja construite en
     natif (coordonnees natives inchangees : map.js applique la rotation au
     rendu, la logique de jeu reste en natif). */
  function finalizeScene(scene, direction) {
    if (!scene) {
      return scene;
    }
    const o = orientation(direction, scene.width, scene.height);
    scene.direction = direction;
    scene.orientTransform = o.matrix;
    scene.orientAngle = o.angle;
    scene.displayWidth = o.width;
    scene.displayHeight = o.height;
    return scene;
  }

  /* ============================================================
     POINT D'ENTREE : construit une scene complete pour une graine.
     Les parametres d'epine + les seuils (FIRST_OBSTACLE_Y, GAP, bornes)
     garantissent normalement les garde-fous des la 1re tentative ; le
     validateur + la regeneration (graine dérivée) restent un filet de
     securite si un reglage venait a produire une scene limite.
     ============================================================ */
  function buildScene(concepts, seed) {
    const liste = Array.isArray(concepts) ? concepts : [];
    const graine = (Number.isFinite(seed) ? seed : 1) >>> 0;
    const direction = directionForSeed(graine);
    let derniere = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const rand = seededRandom((graine ^ Math.imul(attempt, 0x9e3779b1)) >>> 0);
      const types = shuffledTypes(liste.length, rand);
      const scene = assembleScene(liste, types, rand);
      scene.decor = placeDecor(scene, rand);
      derniere = scene;
      if (validateScene(scene).ok) {
        return finalizeScene(scene, direction);
      }
    }
    return finalizeScene(derniere, direction); /* filet : derniere tentative (extremement rare) */
  }

  const api = {
    buildScene,
    buildRoadPath,
    branchGeometry,
    /* orientation (direction dominante) : partagee par map.js et les tests */
    DIRECTIONS,
    directionForSeed,
    orientation,
    toDisplayPoint,
    toNativeVector,
    /* exposes pour les tests / la verification */
    mulberry32,
    shuffledTypes,
    assembleScene,
    validateScene,
    sampleRoad,
    hasSelfIntersection,
    segmentsIntersect,
    distance,
    TYPES,
    START_X,
    START_Y,
    SCENE_WIDTH,
    PATH_X_MIN,
    PATH_X_MAX,
    MIN_POINT_DIST,
    MIN_OBSTACLE_DIST,
  };

  if (typeof window !== "undefined") {
    window.ParcoursWorld = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
