/* carte/exercice.js — Fenêtre d'exercice : énoncé, mécanique, validation, correction.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

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

/* Cercle : composant SVG pour les 3 patterns cercle. Comme figureCoteeSvg, le
   dessin est schematique et ce sont les valeurs/noms affiches qui portent
   l'info. Trois formes :
   - cercle_elements : cercle DEJA trace, centre O + points nommes + segments
     candidats (le geometrie est exacte : points diametralement opposes pour le
     diametre) -> l'eleve identifie (QCM), aucun trace de sa part.
   - cercle_cote / disque_cote : cercle avec rayon (ou diametre) cote pour le
     calcul de circonference / aire. */
function cercleSvg(exercise) {
  const v = exercise.variables || {};
  const R = 46;
  const u = v.unite || "cm";
  const label = (x, y, text, anchor = "middle") =>
    `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" text-anchor="${anchor}" class="figure-label">${text}</text>`;
  const pt = (deg) => [R * Math.cos((deg * Math.PI) / 180), R * Math.sin((deg * Math.PI) / 180)];
  const dot = (x, y) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" class="figure-point"></circle>`;
  const line = (x1, y1, x2, y2) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="figure-segment"></line>`;

  if (v.forme === "cercle_elements") {
    const coords = { [v.centre]: [0, 0] };
    (v.points || []).forEach((p) => (coords[p.nom] = pt(p.angle)));
    const segs = (v.segments || [])
      .map(([p, q]) => line(coords[p][0], coords[p][1], coords[q][0], coords[q][1]))
      .join("");
    const points = (v.points || [])
      .map((p) => {
        const [x, y] = coords[p.nom];
        return dot(x, y) + label(x * 1.22, y * 1.22 + 4, p.nom);
      })
      .join("");
    return `
      <circle cx="0" cy="0" r="${R}" class="figure-shape"></circle>
      ${segs}
      ${dot(0, 0)}${label(-9, 4, v.centre, "end")}
      ${points}
    `;
  }

  // cercle_cote (circonference) / disque_cote (aire) : la cote (rayon ou
  // diametre) est tracee a l'HORIZONTALE et son etiquette posee juste au-dessus
  // du trait, pour ne jamais chevaucher la ligne.
  const disque = v.forme === "disque_cote";
  if (v.mesure === "diametre") {
    return `
      <circle cx="0" cy="0" r="${R}" class="figure-shape${disque ? " figure-disk" : ""}"></circle>
      ${line(-R, 0, R, 0)}
      ${dot(0, 0)}
      ${label(0, -7, `d = ${v.valeur_mesure} ${u}`)}
    `;
  }
  return `
    <circle cx="0" cy="0" r="${R}" class="figure-shape${disque ? " figure-disk" : ""}"></circle>
    ${line(0, 0, R, 0)}
    ${dot(0, 0)}
    ${label(R / 2, -7, `r = ${v.valeur_mesure} ${u}`)}
  `;
}

/* Triangle : figure SCHEMATIQUE (forme fixe, non a l'echelle). L'info est
   portee par les etiquettes — longueurs des cotes (classer par cotes) ou
   mesures des angles aux sommets (classer par angles). Choix produit : on
   classe par les valeurs affichees, pas par la forme dessinee. */
function triangleSvg(exercise) {
  const v = exercise.variables || {};
  const label = (x, y, text, anchor = "middle") =>
    `<text x="${(+x).toFixed(1)}" y="${(+y).toFixed(1)}" text-anchor="${anchor}" class="figure-label">${text}</text>`;
  const A = [0, -42];
  const B = [-50, 34];
  const C = [50, 34];
  const poly = `<polygon points="${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]}" class="figure-shape"></polygon>`;
  const mid = (P, Q) => [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];

  if (v.forme === "triangle_angles") {
    const [a, b, c] = v.angles;
    // Etiquette d'angle poussee vers l'INTERIEUR depuis chaque sommet.
    const inner = (P, k = 0.26) => [P[0] * (1 - k), P[1] * (1 - k)];
    const pa = inner(A);
    const pb = inner(B);
    const pc = inner(C);
    return `
      ${poly}
      ${label(pa[0], pa[1] + 12, `${a}°`)}
      ${label(pb[0] + 6, pb[1] - 4, `${b}°`, "start")}
      ${label(pc[0] - 6, pc[1] - 4, `${c}°`, "end")}
    `;
  }
  // triangle_cotes : longueur sur chaque cote.
  const [a, b, c] = v.cotes;
  const mAB = mid(A, B);
  const mAC = mid(A, C);
  const mBC = mid(B, C);
  return `
    ${poly}
    ${label(mAB[0] - 12, mAB[1], `${a}`, "end")}
    ${label(mAC[0] + 12, mAC[1], `${b}`, "start")}
    ${label(mBC[0], mBC[1] + 17, `${c}`)}
  `;
}

/* Angle : SEUL rendu geometriquement exact de la vague — deux demi-droites
   depuis un sommet, la seconde tournee de 'mesure' degres (trigonometrie). La
   mesure n'est PAS affichee : l'eleve juge le type a l'oeil. Marque d'angle
   droit pour 90 degres. */
function angleSvg(exercise) {
  const v = exercise.variables || {};
  const V = [-38, 30];
  const L = 82;
  const rad = ((v.mesure || 0) * Math.PI) / 180;
  const p1 = [V[0] + L, V[1]]; // demi-droite horizontale
  const p2 = [V[0] + L * Math.cos(rad), V[1] - L * Math.sin(rad)]; // tournee vers le haut
  const seg = (x1, y1, x2, y2) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="figure-ray"></line>`;
  const dot = `<circle cx="${V[0]}" cy="${V[1]}" r="2.8" class="figure-point"></circle>`;

  let marque;
  if (v.droit) {
    // Petit carre d'angle droit au sommet.
    const d = 15;
    const s = [
      [V[0] + d, V[1]],
      [V[0] + d, V[1] - d],
      [V[0], V[1] - d],
    ];
    marque = `<polyline points="${s.map((p) => `${p[0]},${p[1]}`).join(" ")}" class="figure-ray" fill="none"></polyline>`;
  } else {
    // Arc entre les deux demi-droites.
    const r = 22;
    const ax = V[0] + r;
    const ay = V[1];
    const bx = V[0] + r * Math.cos(rad);
    const by = V[1] - r * Math.sin(rad);
    marque = `<path d="M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${r} ${r} 0 0 0 ${bx.toFixed(1)} ${by.toFixed(1)}" class="figure-arc" fill="none"></path>`;
  }
  return `
    ${seg(V[0], V[1], p1[0], p1[1])}
    ${seg(V[0], V[1], p2[0], p2[1])}
    ${marque}
    ${dot}
  `;
}

/* Symetrie : la figure connue est rendue SANS ses axes (l'eleve les compte).
   Polygones reguliers + rectangle, memes briques que figureCoteeSvg. */
function symetrieSvg(exercise) {
  const v = exercise.variables || {};
  const R = 44;
  const regular = (n, start = -90) => {
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const ang = ((start + (i * 360) / n) * Math.PI) / 180;
      pts.push(`${(Math.cos(ang) * R).toFixed(1)},${(Math.sin(ang) * R).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(" ")}" class="figure-shape"></polygon>`;
  };
  switch (v.forme_sym) {
    case "triangle_equilateral":
      return regular(3);
    case "pentagone":
      return regular(5);
    case "hexagone":
      return regular(6);
    case "carre": {
      const s = 74;
      return `<rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="3" class="figure-shape"></rect>`;
    }
    default: {
      // rectangle (non carre)
      const w = 96;
      const h = 58;
      return `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" class="figure-shape"></rect>`;
    }
  }
}

/* Agrandissement / reduction : deux carres cotes cote a cote (reference + image),
   tailles proportionnelles aux valeurs, la longueur du cote etiquetee dessous.
   Le dessin illustre ; l'info est portee par les etiquettes. */
function deuxRectanglesSvg(exercise) {
  const v = exercise.variables || {};
  const label = (x, y, text) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="figure-label">${text}</text>`;
  const maxv = Math.max(v.ref_val, v.img_val) || 1;
  const sideOf = (val) => 22 + 42 * (val / maxv);
  const square = (cx, side, text) => {
    const x = cx - side / 2;
    const y = 30 - side; // pose sur une base commune a y = 30
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" rx="3" class="figure-shape"></rect>
      ${label(cx, 44, text)}
    `;
  };
  const sref = sideOf(v.ref_val);
  const simg = sideOf(v.img_val);
  return `
    ${square(-34, sref, v.ref_label)}
    <line x1="-6" y1="6" x2="8" y2="6" class="figure-segment"></line>
    <polyline points="4,2 9,6 4,10" class="figure-segment" fill="none"></polyline>
    ${square(34, simg, v.img_label)}
  `;
}

/* Solides en perspective cavaliere (G7) : figure DEJA rendue, l'eleve nomme.
   Faces visibles nuancees (dessus clair, cote fonce), aretes cachees en
   pointilles. Geometrie figee validee au prototype ; jamais de trace. */
function solideSvg(exercise) {
  const v = exercise.variables || {};
  switch (v.solide) {
    case "cube":
      return `
        <polygon points="-32,-2 -10,-24 48,-24 26,-2" class="solide-top"></polygon>
        <polygon points="26,-2 48,-24 48,34 26,56" class="solide-side"></polygon>
        <polygon points="-32,-2 26,-2 26,56 -32,56" class="solide-front"></polygon>
        <line x1="-10" y1="-24" x2="-10" y2="34" class="solide-hidden"></line>
        <line x1="-10" y1="34" x2="48" y2="34" class="solide-hidden"></line>
        <line x1="-32" y1="56" x2="-10" y2="34" class="solide-hidden"></line>
      `;
    case "pave":
      return `
        <polygon points="-40,4 -20,-16 52,-16 32,4" class="solide-top"></polygon>
        <polygon points="32,4 52,-16 52,28 32,48" class="solide-side"></polygon>
        <polygon points="-40,4 32,4 32,48 -40,48" class="solide-front"></polygon>
        <line x1="-20" y1="-16" x2="-20" y2="28" class="solide-hidden"></line>
        <line x1="-20" y1="28" x2="52" y2="28" class="solide-hidden"></line>
        <line x1="-40" y1="48" x2="-20" y2="28" class="solide-hidden"></line>
      `;
    case "cylindre": {
      const rx = 38;
      const ry = 13;
      const t = -30;
      const b = 40;
      return `
        <rect x="${-rx}" y="${t}" width="${2 * rx}" height="${b - t}" class="solide-front" stroke="none"></rect>
        <ellipse cx="0" cy="${b}" rx="${rx}" ry="${ry}" class="solide-front" stroke="none"></ellipse>
        <path d="M ${-rx} ${b} A ${rx} ${ry} 0 0 0 ${rx} ${b}" class="solide-edge" fill="none"></path>
        <path d="M ${-rx} ${b} A ${rx} ${ry} 0 0 1 ${rx} ${b}" class="solide-hidden" fill="none"></path>
        <line x1="${-rx}" y1="${t}" x2="${-rx}" y2="${b}" class="solide-edge"></line>
        <line x1="${rx}" y1="${t}" x2="${rx}" y2="${b}" class="solide-edge"></line>
        <ellipse cx="0" cy="${t}" rx="${rx}" ry="${ry}" class="solide-top"></ellipse>
      `;
    }
    default: {
      // pyramide (base carree en fuyante + apex)
      const apex = [8, -42];
      const FL = [-34, 46];
      const FR = [30, 46];
      const BR = [50, 26];
      const BL = [-14, 26];
      const pt = (p) => `${p[0]},${p[1]}`;
      return `
        <polygon points="${pt(apex)} ${pt(FR)} ${pt(BR)}" class="solide-side"></polygon>
        <polygon points="${pt(apex)} ${pt(FL)} ${pt(FR)}" class="solide-front"></polygon>
        <line x1="${apex[0]}" y1="${apex[1]}" x2="${BL[0]}" y2="${BL[1]}" class="solide-hidden"></line>
        <line x1="${BL[0]}" y1="${BL[1]}" x2="${FL[0]}" y2="${FL[1]}" class="solide-hidden"></line>
        <line x1="${BL[0]}" y1="${BL[1]}" x2="${BR[0]}" y2="${BR[1]}" class="solide-hidden"></line>
        <line x1="${apex[0]}" y1="${apex[1]}" x2="${BR[0]}" y2="${BR[1]}" class="solide-edge"></line>
      `;
    }
  }
}

/* Pictogramme (CE1) : lecture de donnees par DENOMBREMENT. 1 symbole = 1 unite
   (legende explicite) ; l'eleve compte des icones identiques, il n'estime
   jamais une hauteur. Les valeurs sont portees par le NOMBRE d'icones. */
function pictoIconMarkup(type, cx, cy) {
  if (type === "medaille") {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 3.1 : 7;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${pts.join(" ")}" class="picto-icon picto-medaille"></polygon>`;
  }
  if (type === "fleur") {
    let petals = "";
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      petals += `<circle cx="${(cx + 4.2 * Math.cos(a)).toFixed(1)}" cy="${(cy + 4.2 * Math.sin(a)).toFixed(1)}" r="3.2" class="picto-icon picto-fleur"></circle>`;
    }
    return `${petals}<circle cx="${cx}" cy="${cy}" r="2.8" class="picto-fleur-coeur"></circle>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="6.5" class="picto-icon picto-bille"></circle>`;
}

function pictogrammeSvg(exercise) {
  const v = exercise.variables || {};
  const enfants = v.enfants || [];
  const icone = v.icone || "bille";
  const rowH = 30;
  const top = 40;
  const xIcon0 = 70;
  const gap = 19;
  const rows = enfants
    .map((e, i) => {
      const y = top + i * rowH;
      const icons = Array.from({ length: e.valeur }, (_, k) =>
        pictoIconMarkup(icone, xIcon0 + k * gap, y),
      ).join("");
      return `<text x="8" y="${y + 4}" text-anchor="start" class="figure-label">${e.nom}</text>${icons}`;
    })
    .join("");
  const legendY = top + enfants.length * rowH + 6;
  return `
    <text x="125" y="16" text-anchor="middle" class="chart-title">${v.titre || ""}</text>
    ${rows}
    <line x1="8" y1="${legendY - 16}" x2="242" y2="${legendY - 16}" class="chart-axis"></line>
    ${pictoIconMarkup(icone, 20, legendY + 4)}
    <text x="34" y="${legendY + 8}" text-anchor="start" class="figure-legend">= 1 ${v.singulier || ""}</text>
  `;
}

/* Diagramme circulaire (CE5) : chaque secteur porte son POURCENTAGE ecrit, plus
   une legende couleur->categorie. On lit une valeur affichee ; l'angle n'a
   qu'un role illustratif (jamais mesure a l'oeil). */
function camembertSvg(exercise) {
  const v = exercise.variables || {};
  const secteurs = v.secteurs || [];
  const cx = 66;
  const cy = 82;
  const R = 52;
  let a0 = -Math.PI / 2;
  let parts = "";
  let labels = "";
  secteurs.forEach((s) => {
    const sweep = (s.pct / 100) * 2 * Math.PI;
    const a1 = a0 + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
    const p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
    parts += `<path d="M ${cx} ${cy} L ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${R} ${R} 0 ${large} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Z" fill="${s.couleur}" class="pie-sector"></path>`;
    const am = a0 + sweep / 2;
    const lr = R * 0.62;
    labels += `<text x="${(cx + lr * Math.cos(am)).toFixed(1)}" y="${(cy + lr * Math.sin(am) + 4).toFixed(1)}" text-anchor="middle" class="pie-pct">${s.pct} %</text>`;
    a0 = a1;
  });
  const legend = secteurs
    .map((s, i) => {
      const y = 40 + i * 22;
      return `<rect x="140" y="${y - 9}" width="13" height="13" rx="2" fill="${s.couleur}" class="pie-swatch"></rect><text x="160" y="${y + 2}" text-anchor="start" class="figure-legend">${s.nom}</text>`;
    })
    .join("");
  return `
    <text x="125" y="16" text-anchor="middle" class="chart-title">${v.titre || ""}</text>
    ${parts}
    ${labels}
    ${legend}
  `;
}

/* Diagramme en batons (CE1) : jumeau du pictogramme. La valeur se LIT sur l'axe
   gradue de gauche (une ligne par unite, sommet de barre pile sur une
   graduation) ; aucune valeur n'est ecrite sur la barre, sinon ce ne serait
   plus une lecture de graphique. */
function barresSvg(exercise) {
  const v = exercise.variables || {};
  const cats = v.categories || [];
  const axeMax = v.max_axe || 6;
  const baseY = 150;
  const left = 30;
  const right = 238;
  const unit = 18; /* hauteur d'une graduation (px du viewBox) */

  let grid = "";
  for (let i = 0; i <= axeMax; i += 1) {
    const y = baseY - i * unit;
    grid += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="bar-grid"></line>`;
    grid += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" class="figure-label">${i}</text>`;
  }
  const slot = (right - left) / cats.length;
  const barW = Math.min(34, slot * 0.5);
  const bars = cats
    .map((c, j) => {
      const cx = left + slot * (j + 0.5);
      const h = c.valeur * unit;
      return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="bar-rect"></rect><text x="${cx.toFixed(1)}" y="${baseY + 16}" text-anchor="middle" class="figure-label">${c.nom}</text>`;
    })
    .join("");
  return `
    <text x="134" y="16" text-anchor="middle" class="chart-title">${v.titre || ""}</text>
    ${grid}
    <line x1="${left}" y1="${baseY - axeMax * unit}" x2="${left}" y2="${baseY}" class="bar-axis"></line>
    <line x1="${left}" y1="${baseY}" x2="${right}" y2="${baseY}" class="bar-axis"></line>
    ${bars}
  `;
}

/* Proportionnalite graphique (CE6) : SEUL graphique a vraie lecture visuelle.
   Anti-estimation : quadrillage entier, axe vertical gradue en multiples du
   taux k, point interroge (a, k*a) PILE sur une intersection. On trace le guide
   vertical depuis a (methode du corpus) ; l'eleve lit l'ordonnee en face. */
function graphiqueProportionSvg(exercise) {
  const v = exercise.variables || {};
  const xMax = v.x_max || 5;
  const k = v.k || 2;
  const a = v.a || 2;
  const left = 42;
  const baseY = 150;
  const right = 228;
  const top = 32;
  const dx = (right - left) / xMax;
  const dy = (baseY - top) / xMax;
  const px = (i) => left + i * dx;
  const py = (j) => baseY - j * dy; /* j = indice de graduation (valeur = j*k) */

  let grid = "";
  for (let i = 0; i <= xMax; i += 1) {
    grid += `<line x1="${px(i).toFixed(1)}" y1="${top}" x2="${px(i).toFixed(1)}" y2="${baseY}" class="bar-grid"></line>`;
    grid += `<text x="${px(i).toFixed(1)}" y="${baseY + 14}" text-anchor="middle" class="figure-label">${i}</text>`;
  }
  for (let j = 0; j <= xMax; j += 1) {
    grid += `<line x1="${left}" y1="${py(j).toFixed(1)}" x2="${right}" y2="${py(j).toFixed(1)}" class="bar-grid"></line>`;
    grid += `<text x="${left - 7}" y="${(py(j) + 4).toFixed(1)}" text-anchor="end" class="figure-label">${j * k}</text>`;
  }
  const dotX = px(a);
  const dotY = py(a); /* la droite y=k*x passe par l'indice a -> valeur k*a */
  return `
    ${grid}
    <line x1="${left}" y1="${baseY}" x2="${right}" y2="${top}" class="graph-line"></line>
    <line x1="${dotX.toFixed(1)}" y1="${baseY}" x2="${dotX.toFixed(1)}" y2="${dotY.toFixed(1)}" class="graph-guide"></line>
    <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="4" class="graph-point"></circle>
    <line x1="${left}" y1="${top}" x2="${left}" y2="${baseY}" class="bar-axis"></line>
    <line x1="${left}" y1="${baseY}" x2="${right}" y2="${baseY}" class="bar-axis"></line>
    <text x="8" y="20" text-anchor="start" class="graph-axis-title">${v.y_axis || ""}</text>
    <text x="${right}" y="${baseY + 30}" text-anchor="end" class="graph-axis-title">${v.x_axis || ""}</text>
  `;
}

/* Fraction sur une figure (CE3) : parts EGALES nettement delimitees, m
   coloriees sur n. La reponse se lit en DENOMBRANT (parts pleines / total),
   jamais en estimant une proportion. Barre (parts verticales) ou disque
   (secteurs egaux). */
function fractionFigureSvg(exercise) {
  const v = exercise.variables || {};
  const n = v.n || 2;
  const m = v.m || 1;
  if (v.forme === "disque") {
    const R = 46;
    const rad = (deg) => (deg * Math.PI) / 180;
    let parts = "";
    for (let i = 0; i < n; i += 1) {
      const a0 = rad(-90 + (i * 360) / n);
      const a1 = rad(-90 + ((i + 1) * 360) / n);
      const large = 360 / n > 180 ? 1 : 0;
      const x0 = (R * Math.cos(a0)).toFixed(1);
      const y0 = (R * Math.sin(a0)).toFixed(1);
      const x1 = (R * Math.cos(a1)).toFixed(1);
      const y1 = (R * Math.sin(a1)).toFixed(1);
      const cls = i < m ? "frac-fill" : "frac-empty";
      parts += `<path d="M 0 0 L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z" class="${cls}"></path>`;
    }
    return `${parts}<circle cx="0" cy="0" r="${R}" class="frac-border"></circle>`;
  }
  // barre : rectangle partage en n parts verticales egales, m coloriees.
  const W = 112;
  const H = 34;
  const x0 = -56;
  const y0 = -17;
  const pw = W / n;
  let parts = "";
  for (let i = 0; i < n; i += 1) {
    const cls = i < m ? "frac-fill" : "frac-empty";
    parts += `<rect x="${(x0 + i * pw).toFixed(2)}" y="${y0}" width="${pw.toFixed(2)}" height="${H}" class="${cls}"></rect>`;
  }
  return `${parts}<rect x="${x0}" y="${y0}" width="${W}" height="${H}" class="frac-border"></rect>`;
}

/* ----- Concepts P4 (programme_p4.py) : monnaie, regle graduee, collection ----- */

/* Pieces et billets marocains, du plus grand au plus petit (CE1, semaine 4).
   Rendu schematique, lisible avant tout : la valeur est ecrite sur chaque
   piece, la taille et la couleur suivent la vraie monnaie (1 et 2 DH
   argentees, 5 DH bicolore, 10 DH doree, billets de 20 DH). */
const MONNAIE_STYLE = {
  1: { r: 15, classe: "piece-argent" },
  2: { r: 17, classe: "piece-argent" },
  5: { r: 19, classe: "piece-bicolore" },
  10: { r: 21, classe: "piece-or" },
};

function monnaieFigure(exercise) {
  const tas = exercise.variables?.monnaie || [];
  const gap = 8;
  let x = 6;
  let dessin = "";
  for (const valeur of tas) {
    if (valeur >= 20) {
      dessin += `
        <g transform="translate(${x}, 12)">
          <rect class="billet billet-${valeur}" width="74" height="40" rx="5"></rect>
          <rect class="billet-cadre" x="4" y="4" width="66" height="32" rx="3"></rect>
          <circle class="billet-sceau" cx="16" cy="20" r="8"></circle>
          <text class="monnaie-valeur" x="47" y="26" text-anchor="middle">${valeur}</text>
          <text class="monnaie-unite" x="47" y="35" text-anchor="middle">DH</text>
        </g>`;
      x += 74 + gap;
    } else {
      const { r, classe } = MONNAIE_STYLE[valeur] || MONNAIE_STYLE[1];
      dessin += `
        <g transform="translate(${x + r}, 32)" class="${classe}">
          <circle class="piece" r="${r}"></circle>
          <circle class="piece-coeur" r="${(r * 0.72).toFixed(1)}"></circle>
          <text class="monnaie-valeur" y="3" text-anchor="middle">${valeur}</text>
          <text class="monnaie-unite" y="${(r * 0.55).toFixed(1)}" text-anchor="middle">DH</text>
        </g>`;
      x += 2 * r + gap;
    }
  }
  const largeur = Math.max(60, x - gap + 6);
  return { viewBox: `0 0 ${largeur} 64`, largeur, dessin };
}

/* Regle graduee en cm et mm, 0 a 12 cm (CE2, semaine 3). Le segment a
   mesurer est pose au-dessus, son debut aligne sur le 0 -- exactement le
   geste enseigne (« je place le 0 au bout du segment »). */
function regleSvg(exercise) {
  const longueurMm = exercise.variables?.longueur_mm || 0;
  const PX = 2; /* 1 mm = 2 unites SVG */
  const X0 = 12;
  const CM = 12;
  let graduations = "";
  for (let mm = 0; mm <= CM * 10; mm += 1) {
    const x = X0 + mm * PX;
    const h = mm % 10 === 0 ? 14 : mm % 5 === 0 ? 9 : 5;
    graduations += `<line class="regle-trait" x1="${x}" y1="40" x2="${x}" y2="${40 + h}"></line>`;
    if (mm % 10 === 0) {
      graduations += `<text class="regle-nombre" x="${x}" y="66" text-anchor="middle">${mm / 10}</text>`;
    }
  }
  const fin = X0 + longueurMm * PX;
  return `
    <line class="regle-segment" x1="${X0}" y1="26" x2="${fin}" y2="26"></line>
    <line class="regle-borne" x1="${X0}" y1="19" x2="${X0}" y2="33"></line>
    <line class="regle-borne" x1="${fin}" y1="19" x2="${fin}" y2="33"></line>
    <line class="regle-guide" x1="${fin}" y1="33" x2="${fin}" y2="40"></line>
    <rect class="regle-corps" x="2" y="38" width="${CM * 10 * PX + 34}" height="34" rx="4"></rect>
    ${graduations}
    <text class="regle-unite" x="${X0 + CM * 10 * PX + 15}" y="66" text-anchor="middle">cm</text>
  `;
}

/* Collection melangee a trier (CE1, semaine 3 : تصنيف المعطيات). */
function collectionMarkup(exercise) {
  const objets = exercise.variables?.objets || [];
  return `<div class="collection-figure" role="img" aria-label="Collection d'objets à trier">${objets
    .map((o) => `<span class="collection-objet" aria-hidden="true">${o}</span>`)
    .join("")}</div>`;
}

function renderExerciseModal() {
  if (!state.panelOpen || !state.currentExercise || !state.session) {
    return;
  }

  const exercise = state.currentExercise;
  const isClock = exercise.pattern?.pattern_name === "lecture_heure_analogique";
  const isTable = exercise.pattern?.pattern_name === "completer_tableau_proportionnalite";
  // La base cotee d'un prisme reutilise le meme composant que figure_cotee.
  const isFigure = ["figure_cotee_simple", "prisme_aire_base", "prisme_aire_totale"].includes(
    exercise.pattern?.pattern_name,
  );
  const isCercle = ["cercle_identifier_elements", "circonference_cercle", "aire_disque"].includes(
    exercise.pattern?.pattern_name,
  );
  const isTriangle = ["triangle_classer_cotes", "triangle_classer_angles"].includes(
    exercise.pattern?.pattern_name,
  );
  const isAngle = exercise.pattern?.pattern_name === "angle_type";
  const isSymetrie = exercise.pattern?.pattern_name === "symetrie_axes";
  const isAgrandissement = exercise.pattern?.pattern_name === "agrandissement_facteur";
  const isSolide = ["solide_nommer", "solide_compter"].includes(
    exercise.pattern?.pattern_name,
  );
  const isPictogramme = exercise.pattern?.pattern_name === "graphique_pictogramme";
  const isCamembert = exercise.pattern?.pattern_name === "graphique_circulaire";
  const isBarres = exercise.pattern?.pattern_name === "graphique_barres";
  const isProportion = exercise.pattern?.pattern_name === "graphique_proportionnalite";
  const isFractionFigure = exercise.pattern?.pattern_name === "fraction_lire_figure";
  const isMonnaie = exercise.pattern?.pattern_name === "monnaie_valeur";
  const isRegle = exercise.pattern?.pattern_name === "lecture_regle";
  const isCollection = exercise.pattern?.pattern_name === "classer_compter";
  const monnaie = isMonnaie ? monnaieFigure(exercise) : null;
  const fractionVB =
    exercise.variables?.forme === "disque" ? "-56 -56 112 112" : "-62 -26 124 52";
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

  /* P2 : coquille instantanee. Monter tout le popup d'un coup est une tache
     longue (~140 ms sur mobile : icones SVG, figures, formulaire, mecanique)
     qui fige le thread au moment du tap et ressemble a un gel. On affiche donc
     d'abord une coquille legere (bouton fermer + spinner), puis on remplit le
     contenu lourd au frame SUIVANT, apres que le navigateur a peint la coquille :
     le popup apparait instantanement, le montage lourd ne bloque plus le geste. */
  exerciseModal.className = `exercise-modal ${theme.modalClass} is-preparing`;
  exerciseModal.innerHTML = `
    <button id="close-exercise-shell" class="modal-close" type="button" aria-label="Fermer">&#10005;</button>
    <div class="modal-preparing" role="status" aria-label="Préparation de l'exercice">
      <span class="modal-spinner" aria-hidden="true"></span>
    </div>
  `;
  exerciseOverlay.classList.remove("hidden");
  document.getElementById("close-exercise-shell")?.addEventListener("click", closeExercisePanel);

  const remplirCorps = () => {
    /* Fermeture ou changement d'exercice entre-temps : on abandonne le remplissage
       (la coquille a deja ete retiree/remplacee). */
    if (!state.panelOpen || state.currentExercise !== exercise) {
      return;
    }
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
        isCercle
          ? `<div class="figure-figure">
               <svg viewBox="-64 -64 128 128" role="img" aria-label="Figure de cercle">${cercleSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isTriangle
          ? `<div class="figure-figure">
               <svg viewBox="-64 -60 128 116" role="img" aria-label="Triangle">${triangleSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isAngle
          ? `<div class="figure-figure">
               <svg viewBox="-56 -40 112 90" role="img" aria-label="Angle">${angleSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isSymetrie
          ? `<div class="figure-figure">
               <svg viewBox="-60 -56 120 112" role="img" aria-label="Figure">${symetrieSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isAgrandissement
          ? `<div class="figure-figure">
               <svg viewBox="-70 -30 140 90" role="img" aria-label="Agrandissement">${deuxRectanglesSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isSolide
          ? `<div class="figure-figure">
               <svg viewBox="-58 -50 116 120" role="img" aria-label="Solide">${solideSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isPictogramme
          ? `<div class="figure-figure figure-wide">
               <svg viewBox="0 0 250 ${60 + 30 * (exercise.variables?.enfants?.length || 3)}" role="img" aria-label="Pictogramme">${pictogrammeSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isCamembert
          ? `<div class="figure-figure figure-wide">
               <svg viewBox="0 0 250 150" role="img" aria-label="Diagramme circulaire">${camembertSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isBarres
          ? `<div class="figure-figure figure-wide">
               <svg viewBox="0 0 250 178" role="img" aria-label="Diagramme en bâtons">${barresSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isProportion
          ? `<div class="figure-figure figure-wide">
               <svg viewBox="0 0 250 190" role="img" aria-label="Graphique de proportionnalité">${graphiqueProportionSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isFractionFigure
          ? `<div class="figure-figure">
               <svg viewBox="${fractionVB}" role="img" aria-label="Figure partagée en parts égales">${fractionFigureSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${
        isMonnaie
          ? `<div class="figure-figure figure-monnaie">
               <svg viewBox="${monnaie.viewBox}" style="--monnaie-largeur:${monnaie.largeur}" role="img" aria-label="Pièces et billets à compter">${monnaie.dessin}</svg>
             </div>`
          : ""
      }
      ${
        isRegle
          ? `<div class="figure-figure figure-wide figure-regle">
               <svg viewBox="0 0 280 76" role="img" aria-label="Segment posé sur une règle graduée">${regleSvg(exercise)}</svg>
             </div>`
          : ""
      }
      ${isCollection ? collectionMarkup(exercise) : ""}
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
        <p id="modal-feedback" class="modal-feedback hidden" aria-live="polite"></p>
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
  /* Un message arrive pendant le montage differe (reponse fausse qui
     re-rend la popup) : on l'affiche maintenant dans son emplacement. */
  if (modalFeedbackEnAttente) {
    const { message, tone } = modalFeedbackEnAttente;
    modalFeedbackEnAttente = null;
    setFeedback(message, tone);
  }
  };
  /* Double rAF : le 1er laisse le navigateur PEINDRE la coquille, le 2nd
     execute le remplissage lourd juste apres cette peinture (sinon les deux
     seraient regroupes dans la meme frame et le gain disparaitrait). */
  requestAnimationFrame(() => requestAnimationFrame(remplirCorps));
}
