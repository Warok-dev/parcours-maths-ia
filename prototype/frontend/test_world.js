/* Tests de la generation procedurale du monde (world.js).
   Lancer avec : node test_world.js
   Couvre, sur >= 200 graines et plusieurs tailles de leçon :
   - aucune auto-intersection du chemin principal ;
   - distances minimales respectees (points consecutifs, obstacles) ;
   - tous les obstacles dans les limites du monde ;
   - amplitude bornee (saut horizontal, progression monotone) ;
   - ordre des obstacles equilibre (pas de biais type "5 chateaux") ;
   - les 3 routes de renforcement bien rattachees au tracé generé ;
   - determinisme (meme graine => monde identique) et diversite. */
const W = require("./world.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  if (!cond) {
    failures += 1;
    console.log(`KO  ${label}`);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* Extrait le premier point (M x y) et le dernier point d'un chemin SVG. */
function pathEndpoints(d) {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return {
    start: { x: nums[0], y: nums[1] },
    end: { x: nums[nums.length - 2], y: nums[nums.length - 1] },
  };
}

const SEEDS = 240; /* >= 200 exige */
const TAILLES = [1, 2, 3, 4, 5, 6, 7, 8]; /* de la mini-leçon au parcours long */

let scenesGenerees = 0;
const signatures = new Set();
const bendCounts = new Set(); /* nombres de virages observes (n=5) */
const amplitudes = []; /* etendues horizontales observees (n=5) */
const directionsVues = new Set(); /* directions reellement produites par buildScene */

/* Verifie les MEMES invariants qu'en natif, mais sur la scene ORIENTEE dans
   `direction` (coordonnees d'affichage). La rotation etant une isometrie d'un
   multiple de 90°, tout doit continuer a tenir ; ce test garde surtout la
   transformation elle-meme (bornes d'affichage echangees, projection correcte,
   spawn/fin aux bonnes extremites). */
function verifierDirection(scene, direction, seed, n) {
  const o = W.orientation(direction, scene.width, scene.height);
  const proj = (p) => W.toDisplayPoint(p, direction, scene.width, scene.height);
  const dispRoute = scene.routePoints.map(proj);

  /* 1. Tous les points du tracé dans le cadre d'AFFICHAGE. */
  for (const p of dispRoute) {
    check(
      p.x >= -0.5 && p.x <= o.width + 0.5 && p.y >= -0.5 && p.y <= o.height + 0.5,
      `graine ${seed} n=${n} ${direction} : point du tracé dans le cadre affiché`,
    );
  }
  /* 2. Distances minimales entre points consecutifs (preservees par rotation). */
  for (let i = 1; i < dispRoute.length; i += 1) {
    check(
      dist(dispRoute[i], dispRoute[i - 1]) >= W.MIN_POINT_DIST - 0.5,
      `graine ${seed} n=${n} ${direction} : distance points ${i}`,
    );
  }
  /* 3. Obstacles dans le cadre d'affichage + distance mini entre eux. */
  const dispObs = scene.obstacles.map((ob) => proj(ob));
  for (let i = 0; i < dispObs.length; i += 1) {
    const p = dispObs[i];
    check(
      p.x >= -0.5 && p.x <= o.width + 0.5 && p.y >= -0.5 && p.y <= o.height + 0.5,
      `graine ${seed} n=${n} ${direction} : obstacle ${i} dans le cadre affiché`,
    );
    if (i > 0) {
      check(
        dist(dispObs[i], dispObs[i - 1]) >= W.MIN_OBSTACLE_DIST - 0.5,
        `graine ${seed} n=${n} ${direction} : obstacles ${i} espacés`,
      );
    }
  }
  /* 4. Aucune auto-intersection du tracé REELLEMENT AFFICHE (on projette la
        polyligne echantillonnee en natif : c'est exactement la courbe pivotée). */
  const dispPoly = W.sampleRoad(scene.routePoints).map(proj);
  check(
    !W.hasSelfIntersection(dispPoly),
    `graine ${seed} n=${n} ${direction} : sans auto-intersection (affiché)`,
  );
  /* 5. Spawn et fin aux bonnes extremites selon la direction (le joueur part
        d'un bord et progresse vers le bord oppose, dans le bon sens). */
  const s = dispRoute[0];
  const e = dispRoute[dispRoute.length - 1];
  const sensOk =
    direction === "down" ? e.y > s.y
      : direction === "up" ? e.y < s.y
      : direction === "right" ? e.x > s.x
      : e.x < s.x;
  check(sensOk, `graine ${seed} n=${n} ${direction} : progression du spawn vers la sortie`);
}

for (let s = 0; s < SEEDS; s += 1) {
  const seed = (s * 2654435761) >>> 0; /* graines bien reparties */
  for (const n of TAILLES) {
    const concepts = Array.from({ length: n }, (_, i) => `c${i}`);
    const scene = W.buildScene(concepts, seed);
    scenesGenerees += 1;

    /* --- Direction dominante : produite et exploitable --- */
    check(W.DIRECTIONS.includes(scene.direction), `graine ${seed} n=${n} : direction connue (${scene.direction})`);
    directionsVues.add(scene.direction);
    /* Les MEMES garde-fous, reverifies dans les 4 directions d'affichage. */
    for (const direction of W.DIRECTIONS) {
      verifierDirection(scene, direction, seed, n);
    }

    /* --- Garde-fous globaux via le validateur officiel --- */
    const v = W.validateScene(scene);
    check(v.ok, `graine ${seed} n=${n} : validateScene (${v.raison})`);

    /* --- Auto-intersection (verification independante) --- */
    check(!W.hasSelfIntersection(W.sampleRoad(scene.routePoints)), `graine ${seed} n=${n} : sans auto-intersection`);

    /* --- Distances minimales (points consecutifs) --- */
    for (let i = 1; i < scene.routePoints.length; i += 1) {
      check(
        dist(scene.routePoints[i], scene.routePoints[i - 1]) >= W.MIN_POINT_DIST - 0.5,
        `graine ${seed} n=${n} : distance points ${i}`,
      );
    }
    /* --- Obstacles dans les limites + distance mini entre eux --- */
    for (let i = 0; i < scene.obstacles.length; i += 1) {
      const o = scene.obstacles[i];
      check(
        o.x >= W.PATH_X_MIN && o.x <= W.PATH_X_MAX && o.y >= 0 && o.y <= scene.height,
        `graine ${seed} n=${n} : obstacle ${i} dans les limites`,
      );
      if (i > 0) {
        check(dist(o, scene.obstacles[i - 1]) >= W.MIN_OBSTACLE_DIST - 0.5, `graine ${seed} n=${n} : obstacles ${i} espaces`);
      }
    }

    /* --- Ordre des obstacles equilibre : aucun type ne domine (pas de
           biais type "5 chateaux d'affilee"). Chaque type apparait au plus
           ceil(n/4) fois, et jamais 3 fois d'affilee. --- */
    const comptes = {};
    for (const o of scene.obstacles) comptes[o.type] = (comptes[o.type] || 0) + 1;
    const maxParType = Math.ceil(n / W.TYPES.length);
    check(
      Object.values(comptes).every((c) => c <= maxParType),
      `graine ${seed} n=${n} : repartition equilibree des types`,
    );
    let troisSuite = false;
    for (let i = 2; i < scene.obstacles.length; i += 1) {
      if (scene.obstacles[i].type === scene.obstacles[i - 1].type && scene.obstacles[i].type === scene.obstacles[i - 2].type) {
        troisSuite = true;
      }
    }
    check(!troisSuite, `graine ${seed} n=${n} : jamais 3 memes types d'affilee`);

    /* --- Les 3 routes de renforcement rattachees au tracé --- */
    for (let i = 0; i + 2 < scene.routePoints.length; i += 1) {
      const g = W.branchGeometry(scene, i);
      check(Boolean(g), `graine ${seed} n=${n} : branche ${i} existe`);
      if (!g) continue;
      const a = scene.routePoints[i + 1];
      const b = scene.routePoints[i + 2];
      for (const kind of ["short", "medium", "long"]) {
        const { start, end } = pathEndpoints(g[kind]);
        /* start accroché juste sous l'obstacle i ; end juste au-dessus du
           point suivant (offsets exacts de branchGeometry). */
        check(
          Math.abs(start.x - a.x) < 1 && Math.abs(start.y - (a.y + 56)) < 1,
          `graine ${seed} n=${n} branche ${i}/${kind} : depart rattaché`,
        );
        check(
          Math.abs(end.x - b.x) < 1 && Math.abs(end.y - (b.y - g.endOffset)) < 1,
          `graine ${seed} n=${n} branche ${i}/${kind} : arrivée rattachée`,
        );
      }
    }

    if (n === 5) {
      signatures.add(scene.routePoints.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join("|"));
      /* Nombre de virages (extrema locaux de x) + amplitude horizontale, pour
         mesurer la diversite STRUCTURELLE (pas juste des points distincts). */
      const rx = scene.routePoints.map((p) => p.x);
      let bends = 0;
      for (let i = 1; i < rx.length - 1; i += 1) {
        if ((rx[i] - rx[i - 1]) * (rx[i + 1] - rx[i]) < 0) bends += 1;
      }
      bendCounts.add(bends);
      amplitudes.push(Math.max(...rx) - Math.min(...rx));
    }
  }
}

/* --- Diversite STRUCTURELLE (le coeur du sujet) ---
   Le nombre de virages doit reellement varier (pas toujours le meme gabarit),
   et l'amplitude horizontale doit couvrir une large plage (cartes resserrées
   ET amples). */
check(bendCounts.size >= 3, `diversite du nombre de virages : ${[...bendCounts].sort().join(",")} valeurs distinctes`);
{
  const min = Math.min(...amplitudes);
  const max = Math.max(...amplitudes);
  check(max - min >= 500, `diversite d'amplitude horizontale : etendue ${Math.round(max - min)}px (${Math.round(min)}..${Math.round(max)})`);
}

/* --- Clavier intuitif : une intention d'AFFICHAGE (fleche) doit produire, une
       fois convertie en natif puis reprojetee a l'ecran, exactement le meme
       deplacement a l'ecran. C'est la garantie que "fleche du bas = descendre a
       l'ecran" quelle que soit la direction (mapping des touches inchange). --- */
{
  const inputs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ];
  /* Partie lineaire de toDisplayPoint (rotation, sans translation) : on la
     obtient par difference de deux points projetes. */
  const projDelta = (v, dir) => {
    const a = W.toDisplayPoint({ x: 0, y: 0 }, dir, 2200, 3000);
    const b = W.toDisplayPoint({ x: v.dx, y: v.dy }, dir, 2200, 3000);
    return { dx: b.x - a.x, dy: b.y - a.y };
  };
  for (const dir of W.DIRECTIONS) {
    for (const input of inputs) {
      const natif = W.toNativeVector(input, dir);
      const ecran = projDelta(natif, dir);
      check(
        Math.abs(ecran.dx - input.dx) < 1e-9 && Math.abs(ecran.dy - input.dy) < 1e-9,
        `clavier intuitif ${dir} : (${input.dx},${input.dy}) preserve a l'ecran`,
      );
    }
  }
}

/* --- Determinisme : meme graine => tracé identique --- */
{
  const a = W.buildScene(["a", "b", "c", "d"], 123456);
  const b = W.buildScene(["a", "b", "c", "d"], 123456);
  check(JSON.stringify(a.routePoints) === JSON.stringify(b.routePoints), "determinisme : meme graine, meme tracé");
  const c = W.buildScene(["a", "b", "c", "d"], 123457);
  check(JSON.stringify(a.routePoints) !== JSON.stringify(c.routePoints), "graines differentes => tracés differents");
}

/* --- Diversite reelle : >= 200 graines n=5 doivent donner une large
       majorite de tracés distincts (sinon la randomisation est illusoire). --- */
check(signatures.size >= SEEDS * 0.95, `diversite : ${signatures.size}/${SEEDS} tracés n=5 distincts`);

/* --- Les 4 directions dominantes apparaissent bien sur l'echantillon de
       graines (sinon la randomisation de direction serait illusoire). --- */
check(
  directionsVues.size === W.DIRECTIONS.length,
  `4 directions produites : ${[...directionsVues].sort().join(",")}`,
);

console.log(`\n${scenesGenerees} scenes generees ; ${total - failures}/${total} verifications passent`);
console.log(failures === 0 ? "TOUT VERT" : `${failures} ECHECS`);
process.exit(failures === 0 ? 0 : 1);
