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

  /* ----- Horloge : source unique de la geometrie des aiguilles -----
     Angles en degres, sens horaire depuis 12h (0 = vers le haut). Utilisee
     PAR le composant SVG (ASSETS.clock dans map.js) ET testee en Node : une
     seule definition de l'angle des aiguilles, jamais recalculee differemment. */
  function clockAngles(hour, minute) {
    const h = (((Number(hour) % 12) + 12) % 12);
    const m = (((Number(minute) % 60) + 60) % 60);
    return { minuteAngle: m * 6, hourAngle: h * 30 + m * 0.5 };
  }

  /* Reponse canonique d'une horloge : H:MM (minutes sur 2 chiffres). Le
     backend produit exactement ce format ; le mecanisme s'y aligne. */
  function formatHeure(hour, minute) {
    const m = (((Number(minute) % 60) + 60) % 60);
    return `${Number(hour)}:${String(m).padStart(2, "0")}`;
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

    if (info.format === "heure") {
      return ["horloge"];
    }
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

  /* Indices des trous, dans l'ordre de la suite (gauche a droite). */
  function holeIndexes(exercise) {
    return [...maskedLinePositions(exercise)].sort((a, b) => a - b);
  }

  /* Valeurs a retrouver, dans l'ordre naturel de la suite. */
  function missingLineValues(exercise) {
    const valeurs = exercise?.reponse_attendue?.valeur;
    if (!Array.isArray(valeurs)) {
      return [];
    }
    return holeIndexes(exercise)
      .filter((index) => index < valeurs.length)
      .map((index) => Number(valeurs[index]));
  }

  /* Melange les nombres proposes a l'eleve. L'ordre croissant naturel est
     exclu : il donnerait la reponse par simple lecture de gauche a droite.
     Consequence assumee : avec deux trous, la seule permutation valide est
     l'ordre decroissant. A partir de trois trous, l'ordre varie reellement
     d'une generation a l'autre. Fonction pure, exportee pour les tests. */
  function shuffleMissingValues(valeurs, random = Math.random) {
    const melange = [...valeurs];
    if (melange.length < 2) {
      return melange;
    }
    const croissant = [...valeurs].sort((a, b) => a - b);
    const estCroissant = (liste) => liste.every((valeur, i) => valeur === croissant[i]);

    for (let essai = 0; essai < 12; essai += 1) {
      for (let i = melange.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [melange[i], melange[j]] = [melange[j], melange[i]];
      }
      if (!estCroissant(melange)) {
        return melange;
      }
    }
    /* Tirages malchanceux (ou liste de 2) : on force un ordre non croissant. */
    [melange[0], melange[1]] = [melange[1], melange[0]];
    return melange;
  }

  /* Graduations de la ligne : valeurs connues lisibles, trous en "?". */
  function lineTicksMarkup(ticks, masked) {
    return ticks
      .map((value, i) => {
        const trou = masked.has(i);
        return `<button type="button" class="line-tick" data-index="${i}" tabindex="-1" ${
          trou ? 'aria-label="Nombre a trouver"' : `data-value="${value}" disabled`
        }>
          <span class="line-hop" aria-hidden="true"></span>
          <span class="line-notch" aria-hidden="true"></span>
          <span class="line-label${trou ? " masked" : ""}">${trou ? "?" : value}</span>
        </button>`;
      })
      .join("");
  }

  /* ----- Ligne numerique, suite a trous ------------------------
     L'eleve choisit parmi des nombres MELANGES et les place dans les
     trous, de gauche a droite. Il doit donc reconstituer l'ordre de la
     suite, la ligne ne le lui donne plus. */
  function mountLineSequence(container, exercise, api) {
    const values = answerInfo(exercise).raw.map(Number);
    const masked = maskedLinePositions(exercise);
    const holes = holeIndexes(exercise).filter((index) => index < values.length);
    const pool = shuffleMissingValues(missingLineValues(exercise));
    /* filled[rang du trou] = index du bouton pose, ou null. */
    const filled = new Array(holes.length).fill(null);

    container.innerHTML = `
      <p class="mech-hint">Clique les nombres pour completer la suite, de gauche a droite.</p>
      <div class="mech-line" tabindex="0" data-mode="liste" aria-label="Ligne numerique a completer">
        <div class="line-track">${lineTicksMarkup(values, masked)}</div>
        <div class="line-pool" role="group" aria-label="Nombres a placer">
          ${pool
            .map(
              (valeur, i) =>
                `<button type="button" class="line-number" data-pool="${i}">${valeur}</button>`,
            )
            .join("")}
        </div>
        <div class="line-actions">
          <button type="button" class="line-remove btn-help">Retirer</button>
          <span class="line-progress" aria-live="polite"></span>
        </div>
      </div>
    `;

    const root = container.querySelector(".mech-line");
    const tickNodes = [...container.querySelectorAll(".line-tick")];
    const poolNodes = [...container.querySelectorAll(".line-number")];
    const progressNode = container.querySelector(".line-progress");
    const removeNode = container.querySelector(".line-remove");

    const usedPoolIndexes = () => new Set(filled.filter((index) => index !== null));
    const nextHoleRank = () => filled.indexOf(null);
    const filledCount = () => filled.filter((index) => index !== null).length;

    /* Suite telle que l'eleve l'a reconstituee ; les trous vides valent null. */
    function rebuiltSequence() {
      const suite = [...values];
      holes.forEach((position, rang) => {
        const poolIndex = filled[rang];
        suite[position] = poolIndex === null ? null : pool[poolIndex];
      });
      return suite;
    }

    function refresh() {
      const suite = rebuiltSequence();
      const used = usedPoolIndexes();
      const cible = nextHoleRank();

      holes.forEach((position, rang) => {
        const node = tickNodes[position];
        const label = node.querySelector(".line-label");
        const valeur = suite[position];
        const rempli = valeur !== null;
        label.textContent = rempli ? String(valeur) : "?";
        label.classList.toggle("masked", !rempli);
        label.classList.toggle("placed", rempli);
        /* Seul un trou deja rempli se reclique, pour retirer sa valeur. */
        node.disabled = !rempli;
        node.classList.toggle("on", rang === cible);
      });

      poolNodes.forEach((node, i) => {
        node.disabled = used.has(i);
        node.classList.toggle("used", used.has(i));
      });

      const complet = cible === -1;
      /* La reponse attendue est la suite ENTIERE : on ne la transmet qu'une
         fois tous les trous remplis, sinon la validation part incomplete. */
      api.setValue(complet ? suite.join(", ") : "");
      removeNode.disabled = filledCount() === 0;
      progressNode.textContent = `Ta suite : ${suite
        .map((valeur) => (valeur === null ? "?" : valeur))
        .join(", ")} (${filledCount()}/${holes.length})`;
    }

    function placeNumber(poolIndex) {
      if (usedPoolIndexes().has(poolIndex)) return;
      const rang = nextHoleRank();
      if (rang === -1) return;
      filled[rang] = poolIndex;
      refresh();
    }

    function removeAt(rang) {
      if (rang < 0 || filled[rang] === null) return;
      filled[rang] = null;
      refresh();
    }

    /* "Retirer" annule le dernier trou rempli ; comme le remplissage va
       toujours de gauche a droite, c'est le trou rempli le plus a droite. */
    function removeLast() {
      for (let rang = filled.length - 1; rang >= 0; rang -= 1) {
        if (filled[rang] !== null) {
          removeAt(rang);
          return;
        }
      }
    }

    poolNodes.forEach((node, i) => node.addEventListener("click", () => placeNumber(i)));
    holes.forEach((position, rang) => {
      tickNodes[position].addEventListener("click", () => removeAt(rang));
    });
    removeNode.addEventListener("click", removeLast);

    root.addEventListener("keydown", (event) => {
      if (event.key === "Backspace") {
        event.preventDefault();
        removeLast();
      }
    });

    refresh();
    poolNodes[0]?.focus();
  }

  /* ----- Ligne numerique : sauter jusqu'au bon nombre ---------- */
  function mountLineSimple(container, exercise, api) {
    const info = answerInfo(exercise);
    const offset = 3 + (hashString(exercise.id) % 5);
    const start = Math.max(0, info.numeric - offset);
    const ticks = [];
    for (let value = start; value <= start + 12; value += 1) {
      ticks.push(value);
    }

    let position = 0;

    container.innerHTML = `
      <p class="mech-hint">Saute avec les fleches jusqu'au bon nombre, puis valide avec Entree.</p>
      <div class="mech-line" tabindex="0" data-mode="simple" aria-label="Ligne numerique">
        <div class="line-track">${lineTicksMarkup(ticks, new Set())}</div>
      </div>
    `;

    const root = container.querySelector(".mech-line");
    const tickNodes = [...container.querySelectorAll(".line-tick")];

    function refresh() {
      tickNodes.forEach((node, i) => node.classList.toggle("on", i === position));
      api.setValue(String(ticks[position]));
    }

    tickNodes.forEach((node, i) => {
      /* Les graduations d'une ligne simple restent cliquables. */
      node.disabled = false;
      node.addEventListener("click", () => {
        position = i;
        refresh();
        root.focus();
      });
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
        api.submit();
      }
    });

    refresh();
    root.focus();
  }

  function mountLine(container, exercise, api) {
    if (answerInfo(exercise).format === "liste_ordonnee") {
      mountLineSequence(container, exercise, api);
      return;
    }
    mountLineSimple(container, exercise, api);
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

  /* ----- Horloge : reglage de l'heure a deux molettes ----------
     L'eleve LIT l'horloge affichee dans l'enonce (ASSETS.clock) et
     reconstitue l'heure : une molette pour les heures (1-12), une pour les
     minutes (pas de 30 en CE1, de 5 ailleurs). La valeur ecrite est H:MM. */
  function mountClock(container, exercise, api) {
    const stepFive = exercise.niveau_scolaire !== "CE1";
    const minuteStep = stepFive ? 5 : 30;
    const minuteValues = [];
    for (let value = 0; value < 60; value += minuteStep) {
      minuteValues.push(value);
    }

    let hour = 12; /* depart neutre, rarement la bonne reponse */
    let minuteIndex = 0;
    let active = "hour";

    container.innerHTML = `
      <p class="mech-hint">Règle l'heure que tu lis sur l'horloge, puis valide.</p>
      <div class="mech-clock-set" tabindex="0" aria-label="Réglage de l'heure">
        <div class="clock-dial" data-dial="hour">
          <button type="button" class="clock-up" data-dial="hour" aria-label="Heures plus">&#9650;</button>
          <span class="clock-value" data-dial="hour">12</span>
          <button type="button" class="clock-down" data-dial="hour" aria-label="Heures moins">&#9660;</button>
          <span class="clock-caption">heures</span>
        </div>
        <span class="clock-colon" aria-hidden="true">:</span>
        <div class="clock-dial" data-dial="minute">
          <button type="button" class="clock-up" data-dial="minute" aria-label="Minutes plus">&#9650;</button>
          <span class="clock-value" data-dial="minute">00</span>
          <button type="button" class="clock-down" data-dial="minute" aria-label="Minutes moins">&#9660;</button>
          <span class="clock-caption">minutes</span>
        </div>
      </div>
    `;

    const root = container.querySelector(".mech-clock-set");
    const dials = [...container.querySelectorAll(".clock-dial")];
    const hourValue = container.querySelector('.clock-value[data-dial="hour"]');
    const minuteValue = container.querySelector('.clock-value[data-dial="minute"]');

    function refresh() {
      hourValue.textContent = String(hour);
      minuteValue.textContent = String(minuteValues[minuteIndex]).padStart(2, "0");
      dials.forEach((node) => node.classList.toggle("active", node.dataset.dial === active));
      api.setValue(formatHeure(hour, minuteValues[minuteIndex]));
    }

    function spinHour(delta) {
      hour = ((hour - 1 + delta + 12) % 12) + 1; /* reste dans 1..12 */
      active = "hour";
      refresh();
    }

    function spinMinute(delta) {
      minuteIndex = (minuteIndex + delta + minuteValues.length) % minuteValues.length;
      active = "minute";
      refresh();
    }

    container.querySelectorAll(".clock-up").forEach((node) =>
      node.addEventListener("click", () =>
        node.dataset.dial === "hour" ? spinHour(1) : spinMinute(1),
      ),
    );
    container.querySelectorAll(".clock-down").forEach((node) =>
      node.addEventListener("click", () =>
        node.dataset.dial === "hour" ? spinHour(-1) : spinMinute(-1),
      ),
    );

    root.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        active === "hour" ? spinHour(1) : spinMinute(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        active === "hour" ? spinHour(-1) : spinMinute(-1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        active = active === "hour" ? "minute" : "hour";
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
    horloge: mountClock,
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
    /* Geometrie de l'horloge : source unique partagee avec ASSETS.clock. */
    clockAngles,
    formatHeure,
    /* Exposes pour les tests */
    compatibleMechanics,
    maskedLinePositions,
    missingLineValues,
    shuffleMissingValues,
  };

  if (typeof window !== "undefined") {
    window.ParcoursMechanics = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
