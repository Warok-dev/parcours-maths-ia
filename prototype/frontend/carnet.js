/* ============================================================
   CARNET D'AVENTURIER
   Livre illustre des lecons completees, persiste en localStorage
   (cle carnet_aventurier_v1, aucun appel backend).
   Le module ecoute les snapshots de session ("session-updated")
   pour memoriser la maitrise atteinte sur chaque concept, puis
   ajoute une page quand la carte est terminee. Une lecon rejouee
   remplace sa page existante en gardant la meilleure maitrise
   obtenue par concept (le carnet valorise le progres).
   ============================================================ */
(function () {
  const STORAGE_KEY = "carnet_aventurier_v1";

  /* Libelles courts des patterns d'exercices pour l'affichage. */
  const CONCEPT_LABELS = {
    addition_pas_a_pas_sans_retenue: "Addition pas a pas",
    partie_tout_addition_non_narratif: "Partie et tout : addition",
    addition_2chiffres_sans_retenue: "Addition a 2 chiffres",
    probleme_total_partie_tout: "Probleme : trouver le total",
    partie_tout_soustraction_non_narratif: "Partie et tout : soustraction",
    probleme_reste_partie_tout: "Probleme : trouver le reste",
    probleme_comparaison_difference: "Probleme : comparer",
    multiplication_par_10: "Multiplier par 10",
    multiplication_chiffre_x_multiple_de_10: "Chiffre x multiple de 10",
    identifier_multiple_de_10: "Reconnaitre les multiples de 10",
    multiplication_decomposee_chiffre_x_2chiffres: "Multiplication decomposee",
    addition_repetee_vers_multiplication: "De l'addition a la multiplication",
    facteur_manquant_table_de_2: "Facteur manquant (table de 2)",
    probleme_groupes_egaux_total: "Groupes egaux : le total",
    probleme_groupes_egaux_quotient: "Groupes egaux : le partage",
    moitie_via_2xn: "Trouver la moitie",
    double_via_2xn: "Trouver le double",
    suite_multiples_de_10_a_completer: "Suites de 10 a completer",
    conversion_cm_mm_vers_mm: "Convertir cm et mm",
  };

  const overlay = document.getElementById("carnet-overlay");
  const book = document.getElementById("carnet-book");
  const carnetButton = document.getElementById("carnet-button");

  let isOpen = false;
  let pageIndex = 0;

  /* Maitrise max observee par concept, par session (les snapshots ne portent
     que la maitrise du concept courant : on l'accumule au fil de la partie). */
  const masteryBySession = {};
  const recordedSessions = new Set();

  /* ---------- Stockage ---------- */
  function loadEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function saveEntries(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (_error) {
      /* stockage indisponible (mode prive...) : le jeu continue sans carnet */
    }
  }

  function totalStars(concepts) {
    return concepts.reduce((sum, item) => sum + (item.maitrise || 0), 0);
  }

  function recordCompletion(snapshot) {
    const mastery = masteryBySession[snapshot.session_id] || {};
    let concepts = (snapshot.concepts || []).map((concept) => ({
      concept,
      maitrise: mastery[concept] || 1,
    }));

    const entries = loadEntries();
    const existingIndex = entries.findIndex(
      (entry) =>
        entry.niveau_scolaire === snapshot.niveau_scolaire && entry.lecon_id === snapshot.lecon_id,
    );
    if (existingIndex >= 0) {
      /* Lecon rejouee : une seule page, meilleure maitrise conservee. */
      const previousConcepts = entries[existingIndex].concepts || [];
      concepts = concepts.map((item) => {
        const before = previousConcepts.find((p) => p.concept === item.concept);
        return before && before.maitrise > item.maitrise
          ? { ...item, maitrise: before.maitrise }
          : item;
      });
    }

    const entry = {
      niveau_scolaire: snapshot.niveau_scolaire,
      lecon_id: snapshot.lecon_id,
      lecon_nom: snapshot.lecon_nom || snapshot.lecon_id,
      date: new Date().toISOString(),
      concepts,
      etoiles: totalStars(concepts),
      etoiles_max: concepts.length * 3,
    };
    if (existingIndex >= 0) {
      entries[existingIndex] = entry;
    } else {
      entries.push(entry);
    }
    saveEntries(entries);
    if (isOpen) {
      render();
    }
  }

  window.addEventListener("session-updated", (event) => {
    const snapshot = event.detail;
    if (!snapshot || !snapshot.session_id) {
      return;
    }
    if (snapshot.concept_courant && snapshot.maitrise_actuelle > 0) {
      const perConcept =
        masteryBySession[snapshot.session_id] || (masteryBySession[snapshot.session_id] = {});
      perConcept[snapshot.concept_courant] = Math.max(
        perConcept[snapshot.concept_courant] || 0,
        snapshot.maitrise_actuelle,
      );
    }
    if (snapshot.terminee && snapshot.lecon_id && !recordedSessions.has(snapshot.session_id)) {
      recordedSessions.add(snapshot.session_id);
      recordCompletion(snapshot);
    }
  });

  /* ---------- Rendu du livre ---------- */
  function conceptLabel(conceptId) {
    return CONCEPT_LABELS[conceptId] || conceptId.replace(/_/g, " ");
  }

  function lessonIcon(lessonId) {
    return (typeof LESSON_ICONS !== "undefined" && LESSON_ICONS[lessonId]) || "★";
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function conceptStarsMarkup(level) {
    const stars = [1, 2, 3]
      .map((step) => `<span class="star ${step <= level ? "filled" : ""}">★</span>`)
      .join("");
    return `<span class="stars" role="img" aria-label="Maitrise ${level} sur 3">${stars}</span>`;
  }

  function emptyMarkup() {
    return `
      <p class="carnet-eyebrow">Carnet d'aventurier</p>
      <div class="carnet-empty">
        <span class="carnet-empty-icon" aria-hidden="true">&#129517;</span>
        <p>Ton carnet est vide...</p>
        <p class="carnet-empty-hint">Pars a l'aventure et termine une lecon pour remplir ta premiere page !</p>
      </div>
    `;
  }

  function pageMarkup(entry, index, count) {
    const conceptRows = (entry.concepts || [])
      .map(
        (item) => `
          <li>
            <span>${conceptLabel(item.concept)}</span>
            ${conceptStarsMarkup(item.maitrise)}
          </li>
        `,
      )
      .join("");
    return `
      <p class="carnet-eyebrow">Carnet d'aventurier</p>
      <div class="carnet-page-head">
        <span class="carnet-lesson-icon">${lessonIcon(entry.lecon_id)}</span>
        <div>
          <h2 class="carnet-lesson-name">${entry.lecon_nom} <span class="hud-level">${entry.niveau_scolaire}</span></h2>
          <p class="carnet-date">Terminee le ${formatDate(entry.date)}</p>
        </div>
      </div>
      <div class="carnet-stars-total">★ ${entry.etoiles} / ${entry.etoiles_max} etoiles</div>
      <ul class="carnet-concepts">${conceptRows}</ul>
      <div class="carnet-nav">
        <button id="carnet-prev" class="ghost-button carnet-nav-button" type="button" ${index === 0 ? "disabled" : ""}>&#8592; Page</button>
        <span class="carnet-page-count">Page ${index + 1} / ${count}</span>
        <button id="carnet-next" class="ghost-button carnet-nav-button" type="button" ${index >= count - 1 ? "disabled" : ""}>Page &#8594;</button>
      </div>
    `;
  }

  function render() {
    const entries = loadEntries();
    pageIndex = Math.min(Math.max(pageIndex, 0), Math.max(0, entries.length - 1));
    const content = entries.length
      ? pageMarkup(entries[pageIndex], pageIndex, entries.length)
      : emptyMarkup();
    book.innerHTML = `
      <button id="carnet-close" class="modal-close" type="button" aria-label="Fermer le carnet">&#10005;</button>
      <div class="carnet-page">${content}</div>
    `;
  }

  function turnPage(delta) {
    const count = loadEntries().length;
    const next = pageIndex + delta;
    if (next < 0 || next >= count) {
      return;
    }
    pageIndex = next;
    render();
  }

  function openCarnet() {
    isOpen = true;
    render();
    overlay.classList.remove("hidden");
  }

  function closeCarnet() {
    isOpen = false;
    overlay.classList.add("hidden");
    book.innerHTML = "";
  }

  /* ---------- Branchements ---------- */
  carnetButton.addEventListener("click", () => {
    document.getElementById("menu-dropdown")?.classList.add("hidden");
    document.getElementById("menu-button")?.setAttribute("aria-expanded", "false");
    openCarnet();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("#carnet-close")) {
      closeCarnet();
    } else if (event.target.closest("#carnet-prev")) {
      turnPage(-1);
    } else if (event.target.closest("#carnet-next")) {
      turnPage(1);
    }
  });

  /* Capture : tant que le carnet est ouvert, les fleches tournent les pages
     au lieu de deplacer le joueur, et Echap ferme le livre. */
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isOpen) {
        return;
      }
      if (event.key === "Escape") {
        closeCarnet();
      } else if (event.key === "ArrowLeft") {
        turnPage(-1);
      } else if (event.key === "ArrowRight") {
        turnPage(1);
      } else if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  window.ParcoursCarnet = {
    open: openCarnet,
    close: closeCarnet,
    isOpen: () => isOpen,
    getEntries: loadEntries,
  };
})();
