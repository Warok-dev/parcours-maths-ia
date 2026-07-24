/* ============================================================
   PERSONNALISATION DU PERSONNAGE
   Couleurs et petits accessoires debloques avec les etoiles
   cumulees sur toutes les sessions (le score du HUD, lui, repart
   de zero a chaque carte). Persiste en localStorage sous la cle
   personnage_v1, comme le carnet et les faiblesses.

   Les couleurs ne touchent QUE deux variables CSS
   (--player-shirt / --player-shirt-dark) : le jeton sur la carte,
   la mini-carte et l'apercu de cet ecran suivent automatiquement.
   Les accessoires sont injectes dans le dessin du personnage
   (ASSETS.player de map.js) en deux couches : derriere le corps
   (cape) et devant (chapeau, lunettes, badge).

   Le coeur (catalogue, seuils, selection) est pur et s'exporte en
   Node pour les tests (test_personnage.js).
   ============================================================ */
(function () {
  const STORAGE_KEY = "personnage_v1";

  /* Couleurs du corps. Les valeurs pointent vers la palette du systeme de
     design : aucune couleur ad hoc n'est introduite ici.
     `teinte` reprend la valeur de la variable CSS (miroir de :root, comme
     REINFORCEMENT_TOTALS l'est du backend dans map.js) : elle sert au calcul
     de contraste avec le decor, qui doit rester pur et testable. */
  const COULEURS = [
    { id: "bleu", nom: "Bleu du matin", cout: 0, shirt: "var(--player-bleu)", shirtDark: "var(--player-bleu-dark)", teinte: "#4a7bc4" },
    { id: "vert", nom: "Vert prairie", cout: 40, shirt: "var(--grass)", shirtDark: "var(--grass-dark)", teinte: "#6fbe53" },
    { id: "orange", nom: "Orange soleil", cout: 100, shirt: "var(--road)", shirtDark: "var(--road-dark)", teinte: "#e8703a" },
    { id: "jaune", nom: "Jaune tresor", cout: 200, shirt: "var(--gold)", shirtDark: "var(--gold-dark)", teinte: "#ffc23e" },
    { id: "framboise", nom: "Rouge framboise", cout: 320, shirt: "var(--npc-body)", shirtDark: "var(--npc-body-dark)", teinte: "#a64d5f" },
  ];

  /* Ce que l'eleve traverse sur la carte : herbe et routes. Un personnage de
     la meme teinte que son fond s'y noie, d'ou le halo renforce. */
  const DECOR_TEINTES = ["#6fbe53", "#85d066", "#e8703a", "#f5905c"];
  /* Sous cette distance, la silhouette se confond avec le decor. Le seuil est
     verrouille par les tests (vert et orange sont pris DANS le decor, donc a
     distance 0 ; le bleu d'origine est a ~234). */
  const SEUIL_CONTRASTE_DECOR = 130;

  /* Accessoires, dessines vus du dessus comme tout le reste de la carte et
     centres sur (0,0) : `arriere` passe sous le corps, `avant` par-dessus.
     Le personnage fait ~19 px de rayon, tete ronde en (0,-3) r 12.5. */
  const ACCESSOIRES = [
    {
      id: "aucun",
      nom: "Sans accessoire",
      cout: 0,
      avant: "",
      arriere: "",
    },
    {
      id: "chapeau",
      nom: "Chapeau d'explorateur",
      cout: 60,
      arriere: "",
      avant: `
        <circle cx="0" cy="-3" r="13.5" class="acc-chapeau-bord"></circle>
        <circle cx="0" cy="-4.5" r="8" class="acc-chapeau-fond"></circle>
      `,
    },
    {
      id: "lunettes",
      nom: "Lunettes rondes",
      cout: 150,
      arriere: "",
      avant: `
        <line x1="-4.4" y1="1.5" x2="4.4" y2="1.5" class="acc-lunettes-pont"></line>
        <circle cx="-6.2" cy="1.5" r="3.6" class="acc-lunettes-verre"></circle>
        <circle cx="6.2" cy="1.5" r="3.6" class="acc-lunettes-verre"></circle>
      `,
    },
    {
      id: "cape",
      nom: "Cape courte",
      cout: 260,
      arriere: `
        <path d="M -18 -4 q 18 -8 36 0 q 4 16 -4 24 q -14 5 -28 0 q -8 -8 -4 -24 Z" class="acc-cape"></path>
      `,
      avant: `
        <path d="M -8 -7 q 8 -4 16 0 q -8 4 -16 0 Z" class="acc-cape-col"></path>
      `,
    },
    {
      id: "badge",
      nom: "Badge etoile",
      cout: 420,
      arriere: "",
      avant: `
        <circle cx="-14.5" cy="7" r="4.6" class="acc-badge-fond"></circle>
        <path d="M -14.5 3.6 l 1 2.1 2.3 0.3 -1.7 1.6 0.4 2.3 -2 -1.1 -2 1.1 0.4 -2.3 -1.7 -1.6 2.3 -0.3 Z" class="acc-badge-etoile"></path>
      `,
    },
  ];

  const CATALOGUE = { couleur: COULEURS, accessoire: ACCESSOIRES };
  const DEFAUTS = { couleur: "bleu", accessoire: "aucun" };

  /* ---------- Coeur de decision (testable sans navigateur) ---------- */
  function trouver(type, id) {
    return CATALOGUE[type]?.find((item) => item.id === id) || null;
  }

  function versRgb(teinte) {
    const hex = String(teinte || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) {
      return null;
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  /* Distance "redmean" : approximation perceptuelle courante, bien meilleure
     qu'une distance RGB brute pour dire si deux couleurs se distinguent a
     l'oeil, et sans dependance. Resultat entre 0 et ~765. */
  function distanceTeinte(a, b) {
    const rgbA = versRgb(a);
    const rgbB = versRgb(b);
    if (!rgbA || !rgbB) {
      return Infinity;
    }
    const moyenneRouge = (rgbA[0] + rgbB[0]) / 2;
    const dR = rgbA[0] - rgbB[0];
    const dG = rgbA[1] - rgbB[1];
    const dB = rgbA[2] - rgbB[2];
    return Math.sqrt(
      (2 + moyenneRouge / 256) * dR * dR +
        4 * dG * dG +
        (2 + (255 - moyenneRouge) / 256) * dB * dB,
    );
  }

  /* Distance a l'element de decor le plus proche. */
  function distanceAuDecor(teinte) {
    return Math.min(...DECOR_TEINTES.map((fond) => distanceTeinte(teinte, fond)));
  }

  /* Une couleur prise dans le decor (le vert de l'herbe, l'orange des routes)
     rend le personnage difficile a suivre : son halo est alors renforce. */
  function haloRenforce(couleurId) {
    const couleur = trouver("couleur", couleurId);
    return Boolean(couleur) && distanceAuDecor(couleur.teinte) < SEUIL_CONTRASTE_DECOR;
  }

  function estDebloque(item, etoilesTotales) {
    return Boolean(item) && (etoilesTotales || 0) >= item.cout;
  }

  /* Etoiles restant a gagner avant de pouvoir choisir cet element. */
  function etoilesRestantes(item, etoilesTotales) {
    return Math.max(0, item.cout - (etoilesTotales || 0));
  }

  function elementsDebloques(etoilesTotales, type) {
    return CATALOGUE[type].filter((item) => estDebloque(item, etoilesTotales)).map((i) => i.id);
  }

  /* Elements franchis entre deux totaux : sert a feliciter l'eleve au moment
     exact ou il gagne l'etoile qui debloque. */
  function nouveauxDeblocages(avant, apres) {
    const nouveaux = [];
    for (const type of Object.keys(CATALOGUE)) {
      for (const item of CATALOGUE[type]) {
        if (item.cout > 0 && !estDebloque(item, avant) && estDebloque(item, apres)) {
          nouveaux.push({ type, id: item.id, nom: item.nom, cout: item.cout });
        }
      }
    }
    return nouveaux;
  }

  function etatNormalise(brut) {
    const etat = brut && typeof brut === "object" ? brut : {};
    const total = Number.isFinite(etat.etoiles_totales) ? Math.max(0, etat.etoiles_totales) : 0;
    const normalise = { etoiles_totales: total, couleur: DEFAUTS.couleur, accessoire: DEFAUTS.accessoire };
    /* Une selection inconnue ou plus debloquee (stockage bricole a la main)
       retombe sur le defaut plutot que de laisser un personnage invisible. */
    for (const type of ["couleur", "accessoire"]) {
      const item = trouver(type, etat[type]);
      if (item && estDebloque(item, total)) {
        normalise[type] = item.id;
      }
    }
    return normalise;
  }

  /* Selection : refusee si l'element est inconnu ou encore verrouille.
     Fonction pure, elle retourne un nouvel etat. */
  function appliquerSelection(etat, type, id) {
    const courant = etatNormalise(etat);
    const item = trouver(type, id);
    if (!item || !estDebloque(item, courant.etoiles_totales)) {
      return courant;
    }
    return { ...courant, [type]: id };
  }

  function ajouterEtoilesA(etat, points) {
    const courant = etatNormalise(etat);
    const gain = Number.isFinite(points) && points > 0 ? points : 0;
    return { ...courant, etoiles_totales: courant.etoiles_totales + gain };
  }

  /* ---------- Stockage ---------- */
  function charger() {
    try {
      return etatNormalise(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch (_error) {
      return etatNormalise(null);
    }
  }

  function sauver(etat) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(etat));
    } catch (_error) {
      /* stockage indisponible : le jeu continue avec le personnage par defaut */
    }
    return etat;
  }

  /* ---------- Apparence appliquee au jeu ---------- */
  function apparence(etat) {
    const courant = etatNormalise(etat);
    return {
      couleur: trouver("couleur", courant.couleur),
      accessoire: trouver("accessoire", courant.accessoire),
    };
  }

  /* Markup injecte par ASSETS.player() (map.js), couche par couche. */
  function markupAccessoire(couche, etat) {
    const item = apparence(etat || charger()).accessoire;
    return (item && item[couche]) || "";
  }

  function appliquerCouleur(etat) {
    if (typeof document === "undefined") {
      return;
    }
    const couleur = apparence(etat).couleur;
    const racine = document.documentElement;
    racine.style.setProperty("--player-shirt", couleur.shirt);
    racine.style.setProperty("--player-shirt-dark", couleur.shirtDark);
    /* Le halo est porte par la racine, pas par le jeton : il survit ainsi a
       chaque reconstruction de la scene et vaut aussi pour l'apercu. */
    racine.classList.toggle("player-halo-fort", haloRenforce(couleur.id));
  }

  /* Couleur (variables CSS) + accessoires (redessin du jeton). */
  function appliquerApparence(etat) {
    if (typeof window === "undefined") {
      return;
    }
    appliquerCouleur(etat);
    window.ParcoursApp?.refreshPlayerToken?.();
  }

  /* ---------- Etat vivant ---------- */
  let etat = typeof localStorage === "undefined" ? etatNormalise(null) : charger();

  /* Appelee par le score du jeu : les etoiles gagnees s'accumulent d'une
     session a l'autre, contrairement au compteur affiche dans le HUD. */
  function ajouterEtoiles(points) {
    const avant = etat.etoiles_totales;
    etat = sauver(ajouterEtoilesA(etat, points));
    const nouveaux = nouveauxDeblocages(avant, etat.etoiles_totales);
    if (nouveaux.length && isOpen) {
      render();
    }
    return nouveaux;
  }

  function selectionner(type, id) {
    etat = sauver(appliquerSelection(etat, type, id));
    appliquerApparence(etat);
    if (isOpen) {
      render();
    }
    return etat;
  }

  /* ---------- Ecran de personnalisation ---------- */
  const overlay = typeof document === "undefined" ? null : document.getElementById("personnage-overlay");
  const card = typeof document === "undefined" ? null : document.getElementById("personnage-card");
  const bouton = typeof document === "undefined" ? null : document.getElementById("personnage-button");
  let isOpen = false;

  /* Apercu : le MEME dessin que sur la carte, simplement agrandi. */
  function apercuMarkup() {
    const dessin = window.ParcoursApp?.playerMarkup?.() || "";
    return `
      <svg class="personnage-apercu" viewBox="-32 -32 64 64" role="img" aria-label="Apercu de ton personnage">
        <g class="player-token">${dessin}</g>
      </svg>
    `;
  }

  function pastilleMarkup(item, debloque) {
    if (item.id === "aucun") {
      return `<span class="personnage-pastille vide" aria-hidden="true">&#8709;</span>`;
    }
    if (item.shirt) {
      return `<span class="personnage-pastille" style="background:${item.shirt};border-color:${item.shirtDark}" aria-hidden="true"></span>`;
    }
    /* Accessoire : sa vraie silhouette, sur un personnage neutre reduit. */
    return `
      <svg class="personnage-pastille-svg" viewBox="-20 -20 40 40" aria-hidden="true">
        <g class="player-token ${debloque ? "" : "verrouille"}">
          ${item.arriere || ""}
          <ellipse cx="0" cy="2" rx="15" ry="12" class="player-body"></ellipse>
          <circle cx="0" cy="-3" r="10" class="player-head"></circle>
          ${item.avant || ""}
        </g>
      </svg>
    `;
  }

  function ligneMarkup(type, item, choisi) {
    const debloque = estDebloque(item, etat.etoiles_totales);
    const restantes = etoilesRestantes(item, etat.etoiles_totales);
    const statut = !debloque
      ? `<span class="personnage-statut verrouille">&#128274; ${restantes} &#9733; a gagner</span>`
      : choisi
        ? `<span class="personnage-statut choisi">Porte</span>`
        : `<span class="personnage-statut libre">Choisir</span>`;
    return `
      <li>
        <button
          class="personnage-item ${debloque ? "" : "verrouille"} ${choisi ? "choisi" : ""}"
          type="button"
          data-type="${type}"
          data-id="${item.id}"
          ${debloque ? "" : "disabled aria-disabled=\"true\""}
        >
          ${pastilleMarkup(item, debloque)}
          <span class="personnage-item-nom">${item.nom}</span>
          ${statut}
        </button>
      </li>
    `;
  }

  function render() {
    if (!card) {
      return;
    }
    const couleurs = COULEURS.map((item) => ligneMarkup("couleur", item, item.id === etat.couleur)).join("");
    const accessoires = ACCESSOIRES.map((item) =>
      ligneMarkup("accessoire", item, item.id === etat.accessoire),
    ).join("");
    card.innerHTML = `
      <button id="personnage-close" class="modal-close" type="button" aria-label="Fermer">&#10005;</button>
      <p class="bilan-eyebrow">Mon personnage</p>
      <div class="personnage-head">
        ${apercuMarkup()}
        <div class="personnage-total">
          <span class="personnage-total-valeur">&#9733; ${etat.etoiles_totales}</span>
          <span class="personnage-total-copy">etoiles gagnees en tout</span>
        </div>
      </div>
      <h3 class="personnage-section">Couleurs</h3>
      <ul class="personnage-liste">${couleurs}</ul>
      <h3 class="personnage-section">Accessoires</h3>
      <ul class="personnage-liste">${accessoires}</ul>
    `;
  }

  function open() {
    isOpen = true;
    render();
    overlay.classList.remove("hidden");
    window.ParcoursApp?.refreshScenePaused?.();
  }

  function close() {
    isOpen = false;
    overlay.classList.add("hidden");
    card.innerHTML = "";
    window.ParcoursApp?.refreshScenePaused?.();
  }

  if (typeof document !== "undefined") {
    bouton?.addEventListener("click", () => {
      document.getElementById("menu-dropdown")?.classList.add("hidden");
      document.getElementById("menu-button")?.setAttribute("aria-expanded", "false");
      open();
    });

    overlay?.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("#personnage-close")) {
        close();
        return;
      }
      const item = event.target.closest(".personnage-item");
      if (item && !item.disabled) {
        selectionner(item.dataset.type, item.dataset.id);
      }
    });

    window.addEventListener(
      "keydown",
      (event) => {
        if (isOpen && event.key === "Escape") {
          close();
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );

    /* Couleur posee des le chargement : le personnage apparait tout de suite
       avec son apparence, sans attendre une premiere ouverture de l'ecran. */
    appliquerCouleur(etat);
  }

  const api = {
    open,
    close,
    isOpen: () => isOpen,
    ajouterEtoiles,
    selectionner,
    markupAccessoire,
    appliquerApparence,
    getEtat: () => ({ ...etat }),
    /* Exposes pour les tests */
    STORAGE_KEY,
    COULEURS,
    ACCESSOIRES,
    CATALOGUE,
    DEFAUTS,
    trouver,
    DECOR_TEINTES,
    SEUIL_CONTRASTE_DECOR,
    distanceTeinte,
    distanceAuDecor,
    haloRenforce,
    estDebloque,
    etoilesRestantes,
    elementsDebloques,
    nouveauxDeblocages,
    etatNormalise,
    appliquerSelection,
    ajouterEtoilesA,
    charger,
    sauver,
  };

  if (typeof window !== "undefined") {
    window.ParcoursPersonnage = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
