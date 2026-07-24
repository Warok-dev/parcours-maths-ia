/* ============================================================
   THEME NARRATIF
   L'eleve choisit son univers une fois, au tout premier
   lancement : les problemes narratifs generes par l'IA se
   deroulent ensuite dans ce monde (foot, dinosaures...).
   Persiste en localStorage sous la cle theme_v1, comme le
   carnet, les faiblesses et le personnage.

   Le choix n'est qu'un identifiant transmis au backend : ce
   sont les banques de personnages et d'objets de narrative.py
   qui changent, pas la validation.
   ============================================================ */
(function () {
  const STORAGE_KEY = "theme_v1";
  const THEME_NEUTRE = "neutre";

  /* Les identifiants doivent correspondre EXACTEMENT aux cles de THEMES
     dans generation/narrative.py : c'est le contrat avec le backend. */
  const THEMES = [
    { id: "foot", nom: "Foot", icone: "⚽", couleur: "var(--grass)" },
    { id: "dinosaures", nom: "Dinosaures", icone: "\u{1F996}", couleur: "var(--grass-dark)" },
    { id: "princesses", nom: "Princesses et chevaliers", icone: "\u{1F451}", couleur: "var(--gold)" },
    { id: "espace", nom: "Espace", icone: "\u{1F680}", couleur: "var(--water-dark)" },
    { id: "animaux", nom: "Animaux", icone: "\u{1F98A}", couleur: "var(--road)" },
    { id: THEME_NEUTRE, nom: "Pas de preference", icone: "✨", couleur: "var(--stone)" },
  ];

  /* ---------- Coeur (testable sans navigateur) ---------- */
  function estThemeConnu(id) {
    return THEMES.some((theme) => theme.id === id);
  }

  function trouver(id) {
    return THEMES.find((theme) => theme.id === id) || null;
  }

  /* Un theme absent ou inconnu retombe sur le neutre : c'est exactement ce
     que fait le backend, les deux cotes restent d'accord. */
  function normaliser(id) {
    return estThemeConnu(id) ? id : THEME_NEUTRE;
  }

  /* ---------- Stockage ---------- */
  function lireBrut() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  /* A-t-il deja choisi ? Distinct de getTheme() : un eleve peut choisir
     "Pas de preference", ce qui est un choix, pas une absence de choix. */
  function aChoisi() {
    return estThemeConnu(lireBrut());
  }

  function getTheme() {
    return normaliser(lireBrut());
  }

  function setTheme(id) {
    const theme = normaliser(id);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_error) {
      /* stockage indisponible : la session en cours gardera le neutre */
    }
    return theme;
  }

  /* ---------- Ecran de choix ---------- */
  const screen = typeof document === "undefined" ? null : document.getElementById("theme-screen");
  const actions = typeof document === "undefined" ? null : document.getElementById("theme-actions");
  const titre = typeof document === "undefined" ? null : document.getElementById("theme-title");
  const retour = typeof document === "undefined" ? null : document.getElementById("theme-back-button");
  const bouton = typeof document === "undefined" ? null : document.getElementById("theme-button");

  /* Ce qu'on fait une fois le theme choisi : demarrer le jeu au premier
     lancement, revenir d'ou l'on vient si on le change en cours de route. */
  let apresChoix = null;

  function render() {
    if (!actions) {
      return;
    }
    const courant = getTheme();
    actions.innerHTML = THEMES.map(
      (theme) => `
        <button
          class="theme-card ${aChoisi() && theme.id === courant ? "choisi" : ""}"
          type="button"
          data-theme-id="${theme.id}"
        >
          <span class="theme-card-icon" style="background:${theme.couleur}" aria-hidden="true">${theme.icone}</span>
          <span class="theme-card-title">${theme.nom}</span>
        </button>
      `,
    ).join("");
  }

  function ouvrir(options = {}) {
    apresChoix = options.apresChoix || null;
    if (titre) {
      titre.textContent = options.titre || "Choisis ton univers";
    }
    retour?.classList.toggle("hidden", !options.retour);
    render();
    document.getElementById("start-screen")?.classList.add("hidden");
    document.getElementById("lesson-screen")?.classList.add("hidden");
    document.getElementById("game-screen")?.classList.add("hidden");
    screen?.classList.remove("hidden");
  }

  function fermer() {
    screen?.classList.add("hidden");
  }

  if (typeof document !== "undefined") {
    actions?.addEventListener("click", (event) => {
      const carte = event.target.closest(".theme-card");
      if (!carte) {
        return;
      }
      setTheme(carte.dataset.themeId);
      fermer();
      const suite = apresChoix;
      apresChoix = null;
      suite?.();
    });

    retour?.addEventListener("click", () => {
      fermer();
      const suite = apresChoix;
      apresChoix = null;
      suite?.();
    });

    bouton?.addEventListener("click", () => {
      document.getElementById("menu-dropdown")?.classList.add("hidden");
      document.getElementById("menu-button")?.setAttribute("aria-expanded", "false");
      /* Changement en cours de partie : le theme s'appliquera aux prochains
         problemes narratifs generes, l'exercice en cours ne bouge pas. */
      window.ParcoursTheme.demanderChangement();
    });
  }

  const api = {
    getTheme,
    setTheme,
    aChoisi,
    ouvrir,
    fermer,
    /* Branche par map.js, qui sait ou revenir apres le choix. */
    demanderChangement: () => ouvrir({ titre: "Changer d'univers", retour: true }),
    /* Exposes pour les tests */
    STORAGE_KEY,
    THEME_NEUTRE,
    THEMES,
    estThemeConnu,
    trouver,
    normaliser,
  };

  if (typeof window !== "undefined") {
    window.ParcoursTheme = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
