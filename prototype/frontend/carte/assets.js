/* carte/assets.js — Bibliothèque des dessins SVG (décor, personnages, obstacles).
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

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
      <path d="M -11 6 q 11 7 22 0" class="player-collar"></path>
      <circle cx="0" cy="-3" r="12.5" class="player-head"></circle>
      <path d="M -12.4 -4 a 12.5 12.5 0 0 1 24.8 0 q -3 -3.4 -6.4 -2.6 q -2.4 -3.6 -6 -3.2 q -3.6 -0.4 -6 3.2 q -3.4 -0.8 -6.4 2.6 Z" class="player-hair"></path>
      <path d="M -5 -12.6 q 3 -1.6 7 -0.6" class="player-hair-shine"></path>
      <circle cx="-4.4" cy="2.4" r="1.7" class="face-eye"></circle>
      <circle cx="4.4" cy="2.4" r="1.7" class="face-eye"></circle>
      <circle cx="-7.6" cy="5" r="2.2" class="face-cheek"></circle>
      <circle cx="7.6" cy="5" r="2.2" class="face-cheek"></circle>
      <path d="M -2.2 5.6 q 2.2 1.8 4.4 0" class="face-smile"></path>
      ${accessoire("avant")}
    `;
  },

  /* Habitants des obstacles : meme gabarit (vu du dessus, face au sud), un
     metier par type d'obstacle -- tenue et couvre-chef les distinguent. */
  npc(metier = "villageois") {
    const visage = `
      <circle cx="-3.4" cy="1.4" r="1.4" class="face-eye"></circle>
      <circle cx="3.4" cy="1.4" r="1.4" class="face-eye"></circle>
      <circle cx="-6" cy="3.6" r="1.8" class="face-cheek"></circle>
      <circle cx="6" cy="3.6" r="1.8" class="face-cheek"></circle>
    `;
    const couvreChef = {
      gardien: `
        <path d="M -10.4 -3 a 10.4 10.4 0 0 1 20.8 0 l -2 1.4 l -16.8 0 Z" class="npc-casque"></path>
        <path d="M 0 -13.4 q 7 -6 12 -2 q -6 0 -10 4 Z" class="npc-plumet"></path>
      `,
      bucheron: `
        <path d="M -9.8 -4 a 9.8 9.8 0 0 1 19.6 0 Z" class="npc-bonnet"></path>
        <rect x="-10.4" y="-5" width="20.8" height="3.4" rx="1.7" class="npc-bonnet-bord"></rect>
        <circle cx="0" cy="-13.2" r="2.6" class="npc-bonnet-pompon"></circle>
      `,
      pecheur: `
        <path d="M -9.6 -4 a 9.6 9.6 0 0 1 19.2 0 Z" class="npc-casquette"></path>
        <path d="M -8 -3.6 q 8 5 16 0 l 0 2 q -8 4 -16 0 Z" class="npc-casquette-visiere"></path>
      `,
      voyageur: `
        <path d="M -12 2 a 12 12 0 0 1 24 0 q -2 -10 -12 -13 q -10 3 -12 13 Z" class="npc-capuche"></path>
      `,
      villageois: `
        <path d="M -9 -5 a 9.5 9.5 0 0 1 18 0 q -4.5 -5.5 -9 -5.5 q -4.5 0 -9 5.5 Z" class="npc-hair"></path>
      `,
    };
    const accessoire = {
      bucheron: `<g transform="translate(16, 3) rotate(30)"><rect x="-1.4" y="-9" width="2.8" height="16" rx="1.2" class="npc-manche"></rect><path d="M -1.4 -9 l -6 -1 l 0 6 l 6 0 Z" class="npc-fer"></path></g>`,
      pecheur: `<path d="M 17 0 L 30 -22" class="npc-canne"></path><path d="M 30 -22 q 6 8 3 18" class="npc-fil"></path>`,
      voyageur: `<rect x="-8" y="-17" width="16" height="10" rx="4" class="npc-sac"></rect>`,
    };
    return `
      <ellipse cx="0" cy="5" rx="15" ry="10" class="npc-shadow"></ellipse>
      ${metier === "voyageur" ? accessoire.voyageur : ""}
      <ellipse cx="0" cy="1" rx="14" ry="11" class="npc-body npc-${metier}"></ellipse>
      <circle cx="-14" cy="1" r="4.5" class="npc-hand"></circle>
      <circle cx="14" cy="1" r="4.5" class="npc-hand"></circle>
      <circle cx="0" cy="-3" r="9.5" class="npc-head"></circle>
      ${visage}
      ${couvreChef[metier] || couvreChef.villageois}
      ${metier === "bucheron" || metier === "pecheur" ? accessoire[metier] : ""}
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

  /* Sapin vu du dessus : etoiles de branches superposees. */
  pine() {
    const etoile = (r, ratio, pointes = 8) =>
      Array.from({ length: pointes * 2 }, (_, i) => {
        const a = (Math.PI * i) / pointes - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * ratio;
        return `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
      }).join(" ");
    return `
      <ellipse cx="7" cy="9" rx="30" ry="22" class="tree-shadow"></ellipse>
      <polygon points="${etoile(32, 0.72)}" class="pine-back"></polygon>
      <polygon points="${etoile(22, 0.7)}" class="pine-mid" transform="rotate(22)"></polygon>
      <polygon points="${etoile(12, 0.66, 6)}" class="pine-top"></polygon>
    `;
  },

  /* Arbre fruitier : couronne ronde + fruits (pommes ou oranges). */
  fruitTree(variante = 0) {
    const fruit = variante % 2 === 0 ? "fruit-pomme" : "fruit-orange";
    return `
      <ellipse cx="6" cy="8" rx="32" ry="24" class="tree-shadow"></ellipse>
      <circle cx="0" cy="0" r="29" class="fruit-canopy-back"></circle>
      <circle cx="-7" cy="-6" r="16" class="fruit-canopy"></circle>
      <circle cx="9" cy="5" r="14" class="fruit-canopy"></circle>
      <circle cx="-10" cy="-10" r="6" class="tree-canopy-light"></circle>
      <circle cx="-12" cy="6" r="3.6" class="${fruit}"></circle>
      <circle cx="10" cy="-12" r="3.6" class="${fruit}"></circle>
      <circle cx="16" cy="8" r="3.6" class="${fruit}"></circle>
      <circle cx="2" cy="14" r="3.6" class="${fruit}"></circle>
      <circle cx="-2" cy="-16" r="3.2" class="${fruit}"></circle>
    `;
  },

  stump() {
    return `
      <ellipse cx="4" cy="5" rx="17" ry="11" class="tree-shadow"></ellipse>
      <path d="M -13 2 q -6 4 -10 2 M 13 3 q 5 5 9 3" class="stump-root"></path>
      <circle cx="0" cy="0" r="13" class="stump-bark"></circle>
      <circle cx="0" cy="0" r="10" class="stump-wood"></circle>
      <circle cx="0" cy="0" r="6.4" class="stump-ring"></circle>
      <circle cx="0" cy="0" r="2.6" class="stump-ring"></circle>
    `;
  },

  mushrooms() {
    return `
      <ellipse cx="2" cy="4" rx="14" ry="7" class="tree-shadow"></ellipse>
      <circle cx="-5" cy="0" r="7" class="mushroom-cap"></circle>
      <circle cx="-7" cy="-2" r="1.4" class="mushroom-dot"></circle>
      <circle cx="-3" cy="2" r="1.2" class="mushroom-dot"></circle>
      <circle cx="-2.6" cy="-3.4" r="1" class="mushroom-dot"></circle>
      <circle cx="7" cy="4" r="4.6" class="mushroom-cap"></circle>
      <circle cx="6" cy="3" r="1" class="mushroom-dot"></circle>
    `;
  },

  /* Petite prairie fleurie : une nappe d'herbe claire semee de fleurs. */
  meadow(fleurs) {
    const teintes = ["meadow-flower jaune", "meadow-flower blanc", "meadow-flower mauve"];
    return `
      <ellipse cx="0" cy="0" rx="68" ry="42" class="meadow-ground"></ellipse>
      ${fleurs
        .map((f) => `<circle cx="${f.dx}" cy="${f.dy}" r="3.2" class="${teintes[f.teinte]}"></circle>`)
        .join("")}
    `;
  },

  pond(rx, ry) {
    return `
      <ellipse cx="0" cy="0" rx="${rx + 12}" ry="${ry + 10}" class="pond-shore"></ellipse>
      <ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" class="pond-water"></ellipse>
      <ellipse cx="${(-rx * 0.15).toFixed(1)}" cy="${(-ry * 0.1).toFixed(1)}" rx="${(rx * 0.7).toFixed(1)}" ry="${(ry * 0.6).toFixed(1)}" class="pond-deep"></ellipse>
      <path d="M ${(-rx * 0.55).toFixed(1)} ${(-ry * 0.45).toFixed(1)} q ${(rx * 0.3).toFixed(1)} ${(-ry * 0.22).toFixed(1)} ${(rx * 0.6).toFixed(1)} 0" class="pond-glint"></path>
      <g transform="translate(${(rx * 0.42).toFixed(1)}, ${(ry * 0.3).toFixed(1)})">
        <path d="M 0 0 L 8 -3 A 9 9 0 1 1 8 3 Z" class="lily-pad"></path>
      </g>
      <g transform="translate(${(-rx * 0.35).toFixed(1)}, ${(ry * 0.38).toFixed(1)}) rotate(140)">
        <path d="M 0 0 L 7 -2.6 A 7.4 7.4 0 1 1 7 2.6 Z" class="lily-pad"></path>
        <circle cx="-2" cy="0" r="2.4" class="lily-flower"></circle>
      </g>
      <path d="M ${(rx * 0.86).toFixed(1)} ${(-ry * 0.5).toFixed(1)} l 4 -16 M ${(rx * 0.92).toFixed(1)} ${(-ry * 0.35).toFixed(1)} l 9 -13 M ${(rx * 0.8).toFixed(1)} ${(-ry * 0.3).toFixed(1)} l -2 -15" class="reed"></path>
    `;
  },

  /* Maison du hameau, vue de trois quarts comme le chateau et la cabane :
     un toit a deux pans (le pan sud plus sombre), puis la facade avec sa
     porte et ses fenetres. Lisible d'un coup d'oeil comme "une maison". */
  house(toit = 0) {
    const toits = ["tuiles", "ardoise", "chaume"];
    const t = toits[toit % 3];
    return `
      <ellipse cx="6" cy="40" rx="58" ry="12" class="house-shadow"></ellipse>
      <rect x="-40" y="2" width="80" height="38" rx="3" class="house-wall"></rect>
      <rect x="-9" y="16" width="18" height="24" rx="8" class="house-door"></rect>
      <circle cx="5" cy="29" r="1.6" class="house-knob"></circle>
      <rect x="-32" y="12" width="15" height="13" rx="2.5" class="house-window"></rect>
      <rect x="17" y="12" width="15" height="13" rx="2.5" class="house-window"></rect>
      <path d="M -24.5 12 v 13 M -32 18.5 h 15 M 24.5 12 v 13 M 17 18.5 h 15" class="house-window-bars"></path>
      <rect x="22" y="-40" width="11" height="18" rx="2" class="house-chimney"></rect>
      <path d="M -50 6 L -40 -30 L 40 -30 L 50 6 Z" class="house-roof ${t}"></path>
      <path d="M -50 6 L -45 -12 L 45 -12 L 50 6 Z" class="house-roof-sud ${t}"></path>
      <path d="M -42.5 -21 h 85 M -47.6 -3 h 95.2" class="house-roof-lines"></path>
      <line x1="-40" y1="-30" x2="40" y2="-30" class="house-ridge"></line>
    `;
  },

  hayBale() {
    return `
      <ellipse cx="3" cy="4" rx="17" ry="12" class="tree-shadow"></ellipse>
      <circle cx="0" cy="0" r="14" class="hay"></circle>
      <path d="M 0 0 m -2 0 a 2 2 0 1 1 4 0 a 5 5 0 1 1 -9 0 a 8 8 0 1 1 15 0 a 11 11 0 1 1 -21 0" class="hay-spiral"></path>
    `;
  },

  /* Signaletique du bord de route, dessinee DEBOUT (redressee par l'appelant). */
  lantern() {
    return `
      <ellipse cx="2" cy="1" rx="9" ry="4" class="tree-shadow"></ellipse>
      <rect x="-2" y="-34" width="4" height="34" rx="2" class="lantern-post"></rect>
      <path d="M -9 -36 h 18 l -3 -4 h -12 Z" class="lantern-cap"></path>
      <rect x="-7" y="-50" width="14" height="14" rx="3" class="lantern-glass"></rect>
      <path d="M -9 -50 h 18 l -4 -6 h -10 Z" class="lantern-cap"></path>
    `;
  },

  milestone() {
    return `
      <ellipse cx="2" cy="1" rx="13" ry="5" class="tree-shadow"></ellipse>
      <path d="M -10 0 v -18 a 10 10 0 0 1 20 0 v 18 Z" class="borne-pierre"></path>
      <path d="M -10 -18 a 10 10 0 0 1 20 0 Z" class="borne-cap"></path>
      <rect x="-5" y="-12" width="10" height="7" rx="2" class="borne-plaque"></rect>
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
    /* Chateau de trois quarts : muraille crenelee, deux tours a toit pointu
       avec fanion, et une grande porte voutee au milieu (la route la
       traverse). Fermee : deux battants cloutes et un cadenas dore. Ouverte :
       les battants se rabattent contre les murs (classes CSS) et laissent voir
       la route. Les tours restent aux memes positions qu'avant (+-118). */
    const creneaux = (x0, x1) => {
      const out = [];
      for (let x = x0; x < x1 - 4; x += 16) {
        out.push(`<rect x="${x}" y="-34" width="10" height="12" rx="2" class="castle-merlon"></rect>`);
      }
      return out.join("");
    };
    const tour = (cx) => `
      <g transform="translate(${cx}, 0)">
        <rect x="-30" y="-44" width="60" height="78" rx="8" class="castle-tower-body"></rect>
        <rect x="-30" y="-44" width="14" height="78" rx="6" class="castle-tower-light"></rect>
        <path d="M -22 -8 h 8 M -6 4 h 10 M 8 -20 h 10 M -18 18 h 10 M 6 22 h 12" class="castle-bricks"></path>
        <rect x="-6" y="-24" width="12" height="18" rx="6" class="castle-window"></rect>
        <path d="M -36 -42 L 0 -92 L 36 -42 Z" class="castle-roof"></path>
        <path d="M -36 -42 L 0 -92 L 0 -42 Z" class="castle-roof-light"></path>
        <line x1="0" y1="-92" x2="0" y2="-112" class="castle-mast"></line>
        <path d="M 0 -112 l 22 6 l -22 6 Z" class="castle-banner"></path>
      </g>
    `;
    return `
      <g class="asset-castle">
        <ellipse cx="6" cy="40" rx="170" ry="16" class="tree-shadow"></ellipse>
        <rect x="-150" y="-24" width="102" height="58" rx="4" class="castle-wall"></rect>
        <rect x="48" y="-24" width="102" height="58" rx="4" class="castle-wall"></rect>
        ${creneaux(-146, -50)}
        ${creneaux(52, 148)}
        <path d="M -140 -2 h 14 M -110 10 h 18 M -80 -6 h 16 M -132 22 h 16 M -70 18 h 12 M 62 -4 h 16 M 92 12 h 18 M 120 -6 h 14 M 70 22 h 14 M 108 24 h 12" class="castle-bricks"></path>
        ${tour(-118)}
        ${tour(118)}
        <rect x="-52" y="-56" width="104" height="90" rx="8" class="castle-gatehouse"></rect>
        ${creneaux(-50, 52).replace(/y="-34"/g, 'y="-66"')}
        <path d="M -38 34 V -6 a 38 32 0 0 1 76 0 V 34 Z" class="castle-arch"></path>
        <path d="M -32 34 V -4 a 32 27 0 0 1 64 0 V 34 Z" class="castle-arch-inner"></path>
        <g class="gate-left">
          <path d="M -32 34 V -4 a 32 27 0 0 1 32 -27 V 34 Z" class="door-panel"></path>
          <path d="M -24 -14 V 34 M -12 -24 V 34" class="door-plank"></path>
          <path d="M -32 0 h 32 M -32 22 h 32" class="door-band"></path>
        </g>
        <g class="gate-right">
          <path d="M 32 34 V -4 a 32 27 0 0 0 -32 -27 V 34 Z" class="door-panel"></path>
          <path d="M 24 -14 V 34 M 12 -24 V 34" class="door-plank"></path>
          <path d="M 32 0 h -32 M 32 22 h -32" class="door-band"></path>
        </g>
        ${
          isOpen
            ? ""
            : `
              <g class="door-lock" transform="translate(0, 10)">
                <path d="M -7 -6 a 7 7 0 0 1 14 0" class="door-lock-shackle"></path>
                <rect x="-10" y="-6" width="20" height="16" rx="5" class="door-lock-body"></rect>
                <circle cx="0" cy="2" r="2.4" class="door-lock-hole"></circle>
              </g>
            `
        }
      </g>
    `;
  },

  /* Chateau vu du DESSUS, pour les routes tres inclinees (cartes orientees
     gauche/droite) : il peut alors pivoter librement dans l'axe du chemin
     sans paraitre renverse. Memes elements : muraille crenelee, tours a toit
     conique (pans alternes) et fanion, porte a deux battants et cadenas. */
  castleTop(isOpen) {
    const merlons = (x0, x1, y) => {
      const out = [];
      for (let x = x0; x < x1 - 6; x += 15) {
        out.push(`<rect x="${x}" y="${y}" width="9" height="7" rx="1.5" class="castle-merlon"></rect>`);
      }
      return out.join("");
    };
    const toitConique = (cx) => {
      const pans = Array.from({ length: 8 }, (_, i) => {
        const a1 = (Math.PI * 2 * i) / 8;
        const a2 = (Math.PI * 2 * (i + 1)) / 8;
        return `<path d="M ${cx} 0 L ${(cx + Math.cos(a1) * 34).toFixed(1)} ${(Math.sin(a1) * 34).toFixed(1)} L ${(cx + Math.cos(a2) * 34).toFixed(1)} ${(Math.sin(a2) * 34).toFixed(1)} Z" class="${i % 2 ? "castle-roof" : "castle-roof-alt"}"></path>`;
      }).join("");
      return `
        <circle cx="${cx + 5}" cy="6" r="38" class="tree-shadow"></circle>
        <circle cx="${cx}" cy="0" r="38" class="castle-tower-body"></circle>
        ${pans}
        <circle cx="${cx}" cy="0" r="4" class="castle-mast-top"></circle>
        <path d="M ${cx} 0 l 22 -6 l -22 -6 Z" class="castle-banner"></path>
      `;
    };
    return `
      <g class="asset-castle">
        <rect x="-150" y="-26" width="102" height="52" rx="5" class="castle-wall"></rect>
        <rect x="48" y="-26" width="102" height="52" rx="5" class="castle-wall"></rect>
        <rect x="-150" y="-10" width="102" height="20" class="castle-walkway"></rect>
        <rect x="48" y="-10" width="102" height="20" class="castle-walkway"></rect>
        ${merlons(-146, -50, -24)}${merlons(-146, -50, 17)}
        ${merlons(52, 148, -24)}${merlons(52, 148, 17)}
        ${toitConique(-118)}
        ${toitConique(118)}
        <rect x="-52" y="-30" width="104" height="60" rx="6" class="castle-gatehouse"></rect>
        <rect x="-36" y="-30" width="72" height="60" class="castle-arch-inner"></rect>
        <g class="gate-left">
          <rect x="-36" y="-8" width="36" height="16" rx="3" class="door-panel"></rect>
          <path d="M -24 -8 v 16 M -12 -8 v 16" class="door-plank"></path>
        </g>
        <g class="gate-right">
          <rect x="0" y="-8" width="36" height="16" rx="3" class="door-panel"></rect>
          <path d="M 24 -8 v 16 M 12 -8 v 16" class="door-plank"></path>
        </g>
        ${
          isOpen
            ? ""
            : `<g class="door-lock" transform="translate(0, 1) scale(0.8)">
                <path d="M -7 -6 a 7 7 0 0 1 14 0" class="door-lock-shackle"></path>
                <rect x="-10" y="-6" width="20" height="16" rx="5" class="door-lock-body"></rect>
              </g>`
        }
      </g>
    `;
  },

  /* Cabane du bucheron, de trois quarts (meme convention que les maisons) :
     murs en rondins, toit de bardeaux, porte, fenetre, cheminee de pierre,
     et une pile de bois a cote. */
  cabin() {
    const rondins = [0, 12, 24, 36]
      .map((y) => `<rect x="-56" y="${y - 6}" width="112" height="12" rx="6" class="cabin-log"></rect>`)
      .join("");
    return `
      <g class="asset-cabin">
        <ellipse cx="8" cy="44" rx="78" ry="14" class="tree-shadow"></ellipse>
        <rect x="26" y="-58" width="16" height="34" rx="3" class="cabin-chimney"></rect>
        <path d="M 28 -50 h 12 M 28 -40 h 12" class="cabin-chimney-joints"></path>
        ${rondins}
        <circle cx="-56" cy="0" r="6" class="cabin-log-end"></circle>
        <circle cx="-56" cy="12" r="6" class="cabin-log-end"></circle>
        <circle cx="-56" cy="24" r="6" class="cabin-log-end"></circle>
        <circle cx="-56" cy="36" r="6" class="cabin-log-end"></circle>
        <circle cx="56" cy="0" r="6" class="cabin-log-end"></circle>
        <circle cx="56" cy="12" r="6" class="cabin-log-end"></circle>
        <circle cx="56" cy="24" r="6" class="cabin-log-end"></circle>
        <circle cx="56" cy="36" r="6" class="cabin-log-end"></circle>
        <rect x="-12" y="10" width="24" height="32" rx="4" class="cabin-door"></rect>
        <circle cx="6" cy="27" r="1.8" class="house-knob"></circle>
        <rect x="-44" y="4" width="20" height="16" rx="3" class="house-window"></rect>
        <path d="M -34 4 v 16 M -44 12 h 20" class="house-window-bars"></path>
        <path d="M -68 -2 L -46 -50 L 46 -50 L 68 -2 Z" class="cabin-roof"></path>
        <path d="M -68 -2 L -60 -20 L 60 -20 L 68 -2 Z" class="cabin-roof-front"></path>
        <path d="M -55 -34 h 110 M -63 -12 h 126" class="cabin-shingles"></path>
        <line x1="-46" y1="-50" x2="46" y2="-50" class="cabin-ridge"></line>
        <g transform="translate(86, 30)">
          <circle cx="-9" cy="6" r="7" class="cabin-log-end"></circle>
          <circle cx="5" cy="6" r="7" class="cabin-log-end"></circle>
          <circle cx="-2" cy="-6" r="7" class="cabin-log-end"></circle>
        </g>
      </g>
    `;
  },

  /* Pont de bois vu du dessus : tablier de planches cloutees, poteaux aux
     angles et rambardes de corde. Casse : deux planches manquantes, bords
     dechiquetes et l'eau visible dessous. Repare : planches neuves, plus
     claires. */
  bridge(isRepaired) {
    const planche = (y, extra = "") =>
      `<g class="bridge-plank-group ${extra}"><rect x="-42" y="${y}" width="84" height="16" rx="3" class="bridge-plank"></rect><circle cx="-34" cy="${y + 8}" r="1.6" class="bridge-nail"></circle><circle cx="34" cy="${y + 8}" r="1.6" class="bridge-nail"></circle></g>`;
    const milieu = isRepaired
      ? `${planche(-10, "neuve")}${planche(10, "neuve")}`
      : `
        <rect x="-42" y="-10" width="84" height="36" class="bridge-gap"></rect>
        <path d="M -42 -10 l 10 6 l 8 -5 l 9 7 l 7 -6 l 8 6 l 10 -5 l 9 6 l 8 -5 l 13 -4 V -12 H -42 Z" class="bridge-plank"></path>
        <path d="M -42 26 l 12 -6 l 9 5 l 10 -7 l 9 6 l 8 -5 l 10 6 l 9 -5 l 17 6 V 28 H -42 Z" class="bridge-plank"></path>
        <path d="M -36 6 q 8 -4 16 0 M 6 14 q 8 -4 16 0" class="bridge-gap-wave"></path>
      `;
    const poteau = (x, y) => `<circle cx="${x}" cy="${y}" r="9" class="bridge-post"></circle><circle cx="${x}" cy="${y}" r="4" class="bridge-post-top"></circle>`;
    return `
      <g class="asset-bridge">
        <rect x="-50" y="-74" width="108" height="156" rx="6" class="bridge-shadow"></rect>
        <rect x="-54" y="-80" width="108" height="160" rx="6" class="bridge-deck"></rect>
        ${planche(-70)}${planche(-50)}${planche(-30)}
        ${milieu}
        ${planche(30)}${planche(50)}
        <path d="M -54 -76 Q -60 -38 -54 0 Q -60 38 -54 76" class="bridge-rope"></path>
        <path d="M 54 -76 Q 60 -38 54 0 Q 60 38 54 76" class="bridge-rope"></path>
        ${poteau(-54, -76)}${poteau(54, -76)}${poteau(-54, 0)}${poteau(54, 0)}${poteau(-54, 76)}${poteau(54, 76)}
        ${
          isRepaired
            ? ""
            : `<g transform="translate(96, 40) rotate(24)" class="bridge-floating"><rect x="-26" y="-7" width="52" height="14" rx="3" class="bridge-plank"></rect></g>
               <g transform="translate(-92, 18) rotate(-14)" class="bridge-floating"><rect x="-20" y="-6" width="40" height="12" rx="3" class="bridge-plank"></rect></g>`
        }
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

  /* Tresor de l'excellence : petit coffre vu du dessus, cercle de lueur et
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
        <ellipse cx="3" cy="36" rx="20" ry="7" class="tree-shadow"></ellipse>
        <path d="M -12 36 q 12 -8 24 0 Z" class="signpost-mound"></path>
        <rect x="-5" y="-50" width="10" height="86" rx="4" class="signpost-pole"></rect>
        <path d="M -2 -40 v 70" class="signpost-grain"></path>
        <g transform="translate(0, -30)">
          <path d="M -46 -13 h 76 l 15 13 l -15 13 h -76 Z" class="signpost-board"></path>
          <path d="M -40 -5 h 64 M -40 5 h 58" class="signpost-grain"></path>
          <circle cx="-40" cy="0" r="2" class="bridge-nail"></circle>
          <text x="-6" y="8" text-anchor="middle" class="signpost-text">?</text>
        </g>
        <g transform="translate(0, 4) scale(-1, 1)">
          <path d="M -46 -13 h 76 l 15 13 l -15 13 h -76 Z" class="signpost-board ${isRevealed ? "revele" : ""}"></path>
          <path d="M -40 -5 h 64 M -40 5 h 58" class="signpost-grain"></path>
          <circle cx="-40" cy="0" r="2" class="bridge-nail"></circle>
          <text x="-6" y="8" text-anchor="middle" transform="scale(-1,1)" class="signpost-text">${isRevealed ? "→" : "..."}</text>
        </g>
        <circle cx="0" cy="-52" r="6" class="signpost-cap"></circle>
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
     distinct du coffre-tresor de l'excellence (rond/dore ou fleur vive). */
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
      return `<svg viewBox="-160 -118 320 166" aria-hidden="true"><g class="${done ? "obstacle-done" : ""}">${ASSETS.castle(done)}</g></svg>`;
    case "blocked_road":
      return `<svg viewBox="-80 -66 182 124" aria-hidden="true">${ASSETS.cabin()}</svg>`;
    case "broken_bridge":
      return `<svg viewBox="-70 -92 140 184" aria-hidden="true">${ASSETS.bridge(done)}</svg>`;
    case "crossroads":
      return `<svg viewBox="-70 -66 140 112" aria-hidden="true">${ASSETS.signpost(done)}</svg>`;
    default:
      return "";
  }
}
