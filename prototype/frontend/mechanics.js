/* ============================================================
   BIBLIOTHEQUE DE MECANIQUES D'INTERACTION
   Chaque exercice se resout via une mecanique choisie selon sa
   famille de pattern : planches du pont, ligne numerique,
   cadenas a molettes, panier a remplir, ou saisie clavier.
   Toutes ecrivent leur valeur dans le champ #answer-input (cache)
   et sont jouables au clavier ET a la souris/tactile.
   ============================================================ */
(function () {
  const BASKET_MAX_COUNT = 12;
  const LINE_MAX_VALUE = 40;
  const LOCK_MAX_DIGITS = 3;

  function hashString(text) {
    let hash = 0;
    for (const char of String(text)) {
      hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return Math.abs(hash);
  }

  function seededShuffle(items, seed) {
    const array = [...items];
    let state = seed >>> 0 || 1;
    for (let index = array.length - 1; index > 0; index -= 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const swap = state % (index + 1);
      [array[index], array[swap]] = [array[swap], array[index]];
    }
    return array;
  }

  function answerInfo(exercise) {
    const reponse = exercise.reponse_attendue || {};
    const raw = reponse.valeur;
    return {
      raw,
      format: reponse.format || "nombre_entier",
      numeric: typeof raw === "number" ? raw : Number(raw),
      isInteger: typeof raw === "number" && Number.isInteger(raw) && raw >= 0,
    };
  }

  /* ----- Regle d'assignation -----------------------------------
     calcul_direct            -> ligne numerique / planches (rotation)
     exercice_a_trous_serie   -> cadenas / ligne numerique (rotation)
     probleme_narratif_simple -> panier (cadenas si trop grand)
     Fallback clavier pour les formats non couverts (expressions).
     Deterministe par exercice (hash id + concept) mais varie d'un
     exercice et d'un concept a l'autre. */
  function compatibleMechanics(exercise) {
    const family = exercise.pattern?.pattern_family;
    const info = answerInfo(exercise);

    if (info.format === "expression") {
      return ["clavier"];
    }
    if (info.format === "liste_ordonnee") {
      return Array.isArray(info.raw) && info.raw.length >= 2 ? ["ligne"] : ["clavier"];
    }
    if (info.format === "choix_multiple") {
      return ["planches"];
    }
    if (!info.isInteger) {
      return ["clavier"];
    }

    const digits = String(info.raw).length;
    if (family === "calcul_direct") {
      const options = [];
      if (info.numeric <= LINE_MAX_VALUE) options.push("ligne");
      options.push("planches");
      return options;
    }
    if (family === "exercice_a_trous_serie") {
      const options = [];
      if (digits <= LOCK_MAX_DIGITS) options.push("cadenas");
      if (info.numeric <= LINE_MAX_VALUE) options.push("ligne");
      return options.length ? options : ["clavier"];
    }
    if (family === "probleme_narratif_simple") {
      if (info.numeric <= BASKET_MAX_COUNT) return ["panier"];
      return digits <= LOCK_MAX_DIGITS ? ["cadenas"] : ["clavier"];
    }
    return ["clavier"];
  }

  function choose(exercise, conceptIndex) {
    const options = compatibleMechanics(exercise);
    const rotation = (hashString(exercise.id) + (conceptIndex || 0)) % options.length;
    return options[rotation];
  }

  /* ----- Planches du pont : assembler la reponse --------------- */
  function mountPlanks(container, exercise, api) {
    const info = answerInfo(exercise);
    const seed = hashString(exercise.id);
    const isChoice = info.format === "choix_multiple";

    let candidates;
    let slotCount;
    if (isChoice) {
      const options = exercise.variables?.options || [info.raw];
      candidates = seededShuffle(options.map(String), seed);
      slotCount = 1;
    } else {
      const digits = String(info.raw).split("");
      const decoys = [];
      let cursor = seed;
      while (digits.length + decoys.length < Math.min(6, digits.length + 3)) {
        cursor = (cursor * 1103515245 + 12345) & 0x7fffffff;
        const decoy = String(cursor % 10);
        if (decoys.filter((d) => d === decoy).length < 1) {
          decoys.push(decoy);
        }
      }
      candidates = seededShuffle([...digits, ...decoys], seed);
      slotCount = digits.length;
    }

    const slots = new Array(slotCount).fill(null); /* index de planche posee */
    container.innerHTML = `
      <p class="mech-hint">${
        isChoice
          ? "Clique la bonne planche pour reparer le passage."
          : "Pose les planches dans l'ordre pour construire la reponse."
      }</p>
      <div class="plank-slots" role="group" aria-label="Reponse en construction">
        ${slots.map((_, i) => `<button type="button" class="plank-slot" data-slot="${i}" aria-label="Emplacement ${i + 1}"><span>?</span></button>`).join("")}
      </div>
      <div class="plank-pool" role="group" aria-label="Planches disponibles">
        ${candidates
          .map(
            (value, i) =>
              `<button type="button" class="plank-piece" data-index="${i}" ${isChoice ? `data-choice="${value}"` : `data-value="${value}"`}>${value}</button>`,
          )
          .join("")}
      </div>
    `;

    const slotNodes = [...container.querySelectorAll(".plank-slot")];
    const pieceNodes = [...container.querySelectorAll(".plank-piece")];

    function refresh() {
      slotNodes.forEach((node, i) => {
        const pieceIndex = slots[i];
        node.classList.toggle("filled", pieceIndex !== null);
        node.querySelector("span").textContent = pieceIndex === null ? "?" : candidates[pieceIndex];
      });
      pieceNodes.forEach((node, i) => {
        node.disabled = slots.includes(i);
      });
      const complete = slots.every((s) => s !== null);
      api.setValue(complete ? slots.map((i) => candidates[i]).join("") : "");
    }

    pieceNodes.forEach((node, pieceIndex) => {
      node.addEventListener("click", () => {
        const free = slots.indexOf(null);
        if (free === -1) return;
        slots[free] = pieceIndex;
        refresh();
      });
    });
    slotNodes.forEach((node, slotIndex) => {
      node.addEventListener("click", () => {
        if (slots[slotIndex] === null) return;
        slots[slotIndex] = null;
        refresh();
      });
    });
    refresh();
    pieceNodes[0]?.focus();
  }

  /* Suites a trous : les positions a deviner ne doivent PAS afficher leur
     valeur sur la ligne numerique (sinon la reponse est deja ecrite dessus).
     Elles montrent un "?" ; les valeurs donnees dans l'enonce restent
     visibles et servent de reperes pour retrouver le pas de la suite.
     Fonction pure, exportee pour les tests (test_mechanics.js). */
  function maskedLinePositions(exercise) {
    const reponse = exercise?.reponse_attendue || {};
    if (reponse.format !== "liste_ordonnee") {
      return new Set();
    }
    const positions = exercise?.variables?.positions_manquantes;
    if (!Array.isArray(positions)) {
      /* Pas d'information sur les trous : on masque tout sauf les deux
         premieres valeurs, qui suffisent a donner le pas de la suite. */
      const length = Array.isArray(reponse.valeur) ? reponse.valeur.length : 0;
      const fallback = new Set();
      for (let index = 2; index < length; index += 1) {
        fallback.add(index);
      }
      return fallback;
    }
    return new Set(positions.filter((index) => Number.isInteger(index) && index >= 0));
  }

  /* ----- Ligne numerique : sauter jusqu'au bon nombre ---------- */
  function mountLine(container, exercise, api) {
    const info = answerInfo(exercise);
    const isListe = info.format === "liste_ordonnee";
    const values = isListe ? info.raw.map(Number) : null;
    const step = isListe && values.length > 1 ? values[1] - values[0] : 1;
    const maskedPositions = maskedLinePositions(exercise);

    let start;
    let end;
    if (isListe) {
      start = Math.min(...values);
      end = Math.max(...values);
    } else {
      const offset = 3 + (hashString(exercise.id) % 5);
      start = Math.max(0, info.numeric - offset);
      end = start + 12;
    }
    const ticks = [];
    for (let value = start; value <= end; value += step) {
      ticks.push(value);
    }

    let position = 0;
    const collected = [];

    container.innerHTML = `
      <p class="mech-hint">${
        isListe
          ? "Saute sur chaque nombre de la suite dans l'ordre, puis ajoute-le (Entree ou bouton)."
          : "Saute avec les fleches jusqu'au bon nombre, puis valide avec Entree."
      }</p>
      <div class="mech-line" tabindex="0" data-mode="${isListe ? "liste" : "simple"}" aria-label="Ligne numerique">
        <div class="line-track">
          ${ticks
            .map(
              (value, i) =>
                `<button type="button" class="line-tick" data-index="${i}" tabindex="-1" ${maskedPositions.has(i) ? 'aria-label="Nombre a trouver"' : `data-value="${value}"`}>
                  <span class="line-hop" aria-hidden="true"></span>
                  <span class="line-notch" aria-hidden="true"></span>
                  <span class="line-label${maskedPositions.has(i) ? " masked" : ""}">${maskedPositions.has(i) ? "?" : value}</span>
                </button>`,
            )
            .join("")}
        </div>
        ${
          isListe
            ? `<div class="line-actions">
                <button type="button" class="line-add btn-help">Ajouter</button>
                <button type="button" class="line-remove btn-help">Retirer</button>
                <span class="line-progress" aria-live="polite"></span>
              </div>`
            : ""
        }
      </div>
    `;

    const root = container.querySelector(".mech-line");
    const tickNodes = [...container.querySelectorAll(".line-tick")];
    const progressNode = container.querySelector(".line-progress");

    function refresh() {
      tickNodes.forEach((node, i) => node.classList.toggle("on", i === position));
      if (isListe) {
        api.setValue(collected.join(", "));
        progressNode.textContent = collected.length
          ? `Ta suite : ${collected.join(", ")} (${collected.length}/${values.length})`
          : `Ta suite : ... (0/${values.length})`;
      } else {
        api.setValue(String(ticks[position]));
      }
    }

    function addCurrent() {
      if (!isListe || collected.length >= values.length) return;
      collected.push(ticks[position]);
      refresh();
    }

    tickNodes.forEach((node, i) => {
      node.addEventListener("click", () => {
        position = i;
        refresh();
        root.focus();
      });
    });
    container.querySelector(".line-add")?.addEventListener("click", addCurrent);
    container.querySelector(".line-remove")?.addEventListener("click", () => {
      collected.pop();
      refresh();
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        position = Math.min(ticks.length - 1, position + 1);
        refresh();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        position = Math.max(0, position - 1);
        refresh();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (isListe) {
          addCurrent();
        } else {
          api.submit();
        }
      } else if (event.key === "Backspace" && isListe) {
        event.preventDefault();
        collected.pop();
        refresh();
      }
    });

    refresh();
    root.focus();
  }

  /* ----- Cadenas a combinaison : molettes chiffre par chiffre -- */
  function mountLock(container, exercise, api) {
    const info = answerInfo(exercise);
    const digitCount = String(info.raw).length;
    const wheels = new Array(digitCount).fill(0);
    let activeWheel = 0;

    container.innerHTML = `
      <p class="mech-hint">Tourne les molettes (haut/bas ou clic) pour former la reponse.</p>
      <div class="mech-lock" tabindex="0" aria-label="Cadenas a combinaison">
        <div class="lock-shackle" aria-hidden="true"></div>
        <div class="lock-body">
          ${wheels
            .map(
              (_, i) => `
              <div class="lock-wheel" data-wheel="${i}">
                <button type="button" class="lock-up" data-wheel="${i}" aria-label="Molette ${i + 1} plus">&#9650;</button>
                <span class="lock-digit" data-wheel="${i}">0</span>
                <button type="button" class="lock-down" data-wheel="${i}" aria-label="Molette ${i + 1} moins">&#9660;</button>
              </div>`,
            )
            .join("")}
        </div>
      </div>
    `;

    const root = container.querySelector(".mech-lock");
    const wheelNodes = [...container.querySelectorAll(".lock-wheel")];

    function refresh() {
      wheelNodes.forEach((node, i) => {
        node.classList.toggle("active", i === activeWheel);
        node.querySelector(".lock-digit").textContent = String(wheels[i]);
      });
      api.setValue(wheels.join(""));
    }

    function spin(index, delta) {
      wheels[index] = (wheels[index] + delta + 10) % 10;
      activeWheel = index;
      refresh();
    }

    container.querySelectorAll(".lock-up").forEach((node) =>
      node.addEventListener("click", () => spin(Number(node.dataset.wheel), 1)),
    );
    container.querySelectorAll(".lock-down").forEach((node) =>
      node.addEventListener("click", () => spin(Number(node.dataset.wheel), -1)),
    );

    root.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        spin(activeWheel, 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        spin(activeWheel, -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        activeWheel = Math.min(digitCount - 1, activeWheel + 1);
        refresh();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        activeWheel = Math.max(0, activeWheel - 1);
        refresh();
      } else if (event.key === "Enter") {
        event.preventDefault();
        api.submit();
      }
    });

    refresh();
    root.focus();
  }

  /* ----- Panier a remplir : denombrer en cliquant -------------- */
  function mountBasket(container, exercise, api) {
    const info = answerInfo(exercise);
    const objectName = exercise.contexte_narratif?.objet || "objets";
    const fieldCount = Math.min(15, info.numeric + 3 + (hashString(exercise.id) % 3));
    const inBasket = new Set();

    container.innerHTML = `
      <p class="mech-hint">Clique les ${objectName} pour remplir le panier avec le bon compte.</p>
      <div class="basket-field" role="group" aria-label="Objets a ramasser">
        ${Array.from({ length: fieldCount })
          .map(
            (_, i) => `
            <button type="button" class="basket-item" data-item="${i}" aria-label="Objet ${i + 1}">
              <svg viewBox="-14 -14 28 28" aria-hidden="true">
                <circle cx="0" cy="1" r="11" class="basket-fruit"></circle>
                <circle cx="-3.5" cy="-2.5" r="3.4" class="basket-shine"></circle>
                <path d="M 0 -10 q 1 -5 6 -6 q -1 5 -6 6" class="basket-leaf"></path>
              </svg>
            </button>`,
          )
          .join("")}
      </div>
      <div class="basket-zone">
        <svg viewBox="0 0 64 40" aria-hidden="true" class="basket-svg">
          <path d="M 6 12 L 58 12 L 52 36 Q 32 40 12 36 Z" class="basket-body"></path>
          <path d="M 16 12 Q 32 -6 48 12" class="basket-handle"></path>
        </svg>
        <span class="basket-counter" aria-live="polite">0</span>
      </div>
    `;

    const itemNodes = [...container.querySelectorAll(".basket-item")];
    const counterNode = container.querySelector(".basket-counter");

    function refresh() {
      itemNodes.forEach((node, i) => node.classList.toggle("in-basket", inBasket.has(i)));
      counterNode.textContent = String(inBasket.size);
      api.setValue(String(inBasket.size));
    }

    itemNodes.forEach((node, i) => {
      node.addEventListener("click", () => {
        if (inBasket.has(i)) {
          inBasket.delete(i);
        } else {
          inBasket.add(i);
        }
        refresh();
      });
    });
    refresh();
    itemNodes[0]?.focus();
  }

  const MOUNTERS = {
    planches: mountPlanks,
    ligne: mountLine,
    cadenas: mountLock,
    panier: mountBasket,
  };

  const api = {
    choose,
    mount(container, mechanic, exercise, handlers) {
      const mounter = MOUNTERS[mechanic];
      if (!mounter) {
        return;
      }
      mounter(container, exercise, handlers);
    },
    /* Exposes pour les tests */
    compatibleMechanics,
    maskedLinePositions,
  };

  if (typeof window !== "undefined") {
    window.ParcoursMechanics = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
