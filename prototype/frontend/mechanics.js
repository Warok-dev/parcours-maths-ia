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
  const BALANCE_MAX_CIBLE = 100;

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
  function baseMechanics(exercise) {
    const family = exercise.pattern?.pattern_family;
    const info = answerInfo(exercise);

    if (info.format === "heure") {
      return ["horloge"];
    }
    if (info.format === "expression") {
      return ["clavier"];
    }
    if (info.format === "liste_ordonnee") {
      /* Deux representations complementaires d'une suite ordonnee :
         - "ligne" : completer la suite sur une ligne graduee (reperes
           visibles, on cherche le pas et les valeurs manquantes) ;
         - "ordre" : remettre toute la suite, donnee melangee en blocs, dans
           le bon ordre (competence "ranger dans l'ordre").
         Elles ne se remplacent pas : la rotation par exercice alterne les
         deux, la ligne garde son role. */
      return Array.isArray(info.raw) && info.raw.length >= 2 ? ["ligne", "ordre"] : ["clavier"];
    }
    if (info.format === "choix_multiple") {
      /* Les QCM numeriques (identifier_multiple_de_10, etc.) peuvent aussi se
         jouer a la roue : sections colorees + repere fixe, on VISE la bonne.
         Les QCM symboliques (< > =) restent aux planches : on ne fabrique pas
         de faux symboles pour atteindre les 4 sections de la roue. */
      const options = exercise.variables?.options;
      const numerique =
        Array.isArray(options) &&
        options.length > 0 &&
        options.every((o) => o !== "" && o !== null && Number.isFinite(Number(o)));
      return numerique ? ["planches", "roue"] : ["planches"];
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

  /* Patterns de DECOMPOSITION ADDITIVE du catalogue : une cible est atteinte
     par une somme d'elements. Ils se pretent a la balance a equilibrer.
     - addition_2chiffres_sans_retenue, addition_pas_a_pas_sans_retenue
       (famille calcul_direct) : la reponse est la somme a construire ;
     - partie_tout_addition_non_narratif (famille exercice_a_trous_serie) :
       le "tout" est la reponse, decompose en poids sur le plateau. */
  const ADDITIF_DECOMPOSITION = new Set([
    "addition_2chiffres_sans_retenue",
    "addition_pas_a_pas_sans_retenue",
    "partie_tout_addition_non_narratif",
  ]);

  /* La balance ne convient que si la cible est un entier positif RAISONNABLE
     a batir avec des poids (sinon empiler 90 jetons serait fastidieux). */
  function peutEquilibrer(exercise) {
    const info = answerInfo(exercise);
    if (!info.isInteger || info.numeric <= 0 || info.numeric > BALANCE_MAX_CIBLE) {
      return false;
    }
    return ADDITIF_DECOMPOSITION.has(exercise.pattern?.pattern_name || "");
  }

  /* La balance s'AJOUTE aux mecaniques compatibles (rotation par exercice),
     sans jamais retirer celles deja proposees par la regle d'assignation. */
  function compatibleMechanics(exercise) {
    const options = baseMechanics(exercise);
    if (peutEquilibrer(exercise) && !options.includes("balance")) {
      options.push("balance");
    }
    return options;
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

  /* ----- Glisser-deposer en ordre -----------------------------
     L'eleve recoit tous les elements MELANGES dans une zone de depart et
     les remet dans le bon ordre, en les glissant ou en cliquant l'element
     puis l'emplacement (meme principe que le puzzle, accessible tactile).
     Aucune validation par bloc : le bouton "Valider" du modal verifie
     l'ordre complet d'un coup (la valeur soumise n'est renseignee qu'une
     fois tous les emplacements remplis).

     Le COEUR (placement, detection du bon ordre) est pur et sans DOM, donc
     testable en Node. */

  /* Melange qui evite de rendre l'ordre attendu tel quel (sinon les blocs
     seraient deja tries). Deterministe par graine. */
  function melangerOrdre(valeurs, seed) {
    const attendu = [...valeurs];
    let melange = seededShuffle(valeurs, seed);
    let essai = 0;
    while (melange.every((v, i) => v === attendu[i]) && essai < 8) {
      essai += 1;
      melange = seededShuffle(melange, seed + essai);
    }
    if (melange.length > 1 && melange.every((v, i) => v === attendu[i])) {
      [melange[0], melange[1]] = [melange[1], melange[0]];
    }
    return melange;
  }

  /* Etat de placement (sans DOM). `elements` : [{id, valeur}] a ranger ;
     `ordreAttendu` : la suite des valeurs dans le bon ordre. */
  function creerPlacementOrdre({ elements, ordreAttendu }) {
    const slots = new Array(ordreAttendu.length).fill(null); /* id d'element, ou null */
    const placeDe = {}; /* id d'element -> index d'emplacement */

    const existe = (id) => elements.some((e) => e.id === id);
    const valeurDe = (id) => {
      const e = elements.find((x) => x.id === id);
      return e ? e.valeur : null;
    };

    function placer(elementId, slotIndex) {
      if (!existe(elementId) || slotIndex < 0 || slotIndex >= slots.length) {
        return false;
      }
      if (slots[slotIndex] !== null) {
        return false; /* emplacement deja occupe : retirer d'abord */
      }
      if (placeDe[elementId] !== undefined) {
        slots[placeDe[elementId]] = null; /* l'element se deplace */
      }
      slots[slotIndex] = elementId;
      placeDe[elementId] = slotIndex;
      return true;
    }

    function retirer(slotIndex) {
      const id = slots[slotIndex];
      if (id === null || id === undefined) {
        return null;
      }
      slots[slotIndex] = null;
      delete placeDe[id];
      return id;
    }

    function ordreActuel() {
      return slots.map((id) => (id === null ? null : valeurDe(id)));
    }
    function estComplet() {
      return slots.every((id) => id !== null);
    }
    /* Detection du bon ordre : complet ET chaque emplacement porte la valeur
       attendue a sa position. */
    function estCorrect() {
      return estComplet() && ordreActuel().every((v, i) => String(v) === String(ordreAttendu[i]));
    }
    /* Valeur soumise au backend : la suite reconstituee, au meme format que
       la ligne numerique ("v0, v1, ..."). Vide tant que c'est incomplet. */
    function valeur() {
      return estComplet() ? ordreActuel().join(", ") : "";
    }

    return {
      placer,
      retirer,
      slots: () => slots.slice(),
      enPool: () => elements.filter((e) => placeDe[e.id] === undefined).map((e) => e.id),
      estPlace: (id) => placeDe[id] !== undefined,
      ordreActuel,
      estComplet,
      estCorrect,
      valeur,
    };
  }

  function mountOrder(container, exercise, api) {
    const raw = answerInfo(exercise).raw;
    const ordreAttendu = Array.isArray(raw) ? raw.map(Number) : [];
    const seed = hashString(exercise.id);
    const melange = melangerOrdre(ordreAttendu, seed);
    const elements = melange.map((valeur, i) => ({ id: i, valeur }));
    const placement = creerPlacementOrdre({ elements, ordreAttendu });

    container.innerHTML = `
      <p class="mech-hint">Glisse (ou clique l'etiquette puis l'emplacement) pour remettre la suite dans l'ordre.</p>
      <div class="order-slots" role="group" aria-label="Emplacements ordonnes">
        ${ordreAttendu
          .map((_, i) => `<button type="button" class="order-slot" data-slot="${i}" aria-label="Emplacement ${i + 1}"><span class="order-slot-rang">${i + 1}</span></button>`)
          .join("")}
      </div>
      <div class="order-pool" role="group" aria-label="Etiquettes a ranger">
        ${elements
          .map((e) => `<button type="button" class="order-piece" draggable="true" data-id="${e.id}">${e.valeur}</button>`)
          .join("")}
      </div>
    `;

    const slotNodes = [...container.querySelectorAll(".order-slot")];
    const poolNode = container.querySelector(".order-pool");
    let selection = null; /* id d'element choisi (clic) */

    function refresh() {
      const slots = placement.slots();
      slotNodes.forEach((node, i) => {
        const id = slots[i];
        const rempli = id !== null && id !== undefined;
        node.classList.toggle("rempli", rempli);
        node.innerHTML = rempli
          ? `<span class="order-slot-valeur">${elements.find((e) => e.id === id).valeur}</span>`
          : `<span class="order-slot-rang">${i + 1}</span>`;
      });
      [...poolNode.querySelectorAll(".order-piece")].forEach((node) => {
        const place = placement.estPlace(Number(node.dataset.id));
        node.classList.toggle("placee", place);
        node.classList.toggle("selectionne", Number(node.dataset.id) === selection);
        node.setAttribute("aria-hidden", place ? "true" : "false");
      });
      /* Rien n'est valide ici : on ne renseigne la reponse que si complete. */
      api.setValue(placement.valeur());
    }

    function poser(elementId, slotIndex) {
      if (placement.placer(elementId, slotIndex)) {
        selection = null;
        refresh();
      }
    }

    poolNode.querySelectorAll(".order-piece").forEach((node) => {
      const id = Number(node.dataset.id);
      node.addEventListener("click", () => {
        if (placement.estPlace(id)) {
          return;
        }
        selection = selection === id ? null : id;
        refresh();
      });
      node.addEventListener("dragstart", (event) => {
        selection = id;
        event.dataTransfer?.setData("text/plain", String(id));
      });
    });

    slotNodes.forEach((node, slotIndex) => {
      node.addEventListener("click", () => {
        const occupant = placement.slots()[slotIndex];
        if (occupant !== null && occupant !== undefined) {
          placement.retirer(slotIndex); /* reclic sur un emplacement rempli : liberer */
          selection = null;
          refresh();
          return;
        }
        if (selection !== null) {
          poser(selection, slotIndex);
        }
      });
      node.addEventListener("dragover", (event) => event.preventDefault());
      node.addEventListener("drop", (event) => {
        event.preventDefault();
        const id = Number(event.dataTransfer?.getData("text/plain"));
        if (!Number.isNaN(id)) {
          poser(id, slotIndex);
        }
      });
    });

    refresh();
    poolNode.querySelector(".order-piece")?.focus();
  }

  /* ----- Roue a tourner ----------------------------------------
     L'eleve fait tourner une roue divisee en 4-6 sections colorees (une bonne
     reponse, les autres plausibles). Un repere FIXE en haut pointe une
     section. Ce n'est PAS un tirage au sort : la rotation finale est une
     fonction DETERMINISTE de la force de lancer que l'eleve regle (mini-jeu
     de precision). Il vise, la roue ralentit, s'arrete pile sur un centre de
     section ; il valide ensuite lui-meme (pas de validation automatique).

     Le COEUR (sections/distracteurs, geometrie du repere, valeur soumise) est
     pur et sans DOM, donc testable en Node. */

  const ROUE_MIN_SECTIONS = 4;
  const ROUE_MAX_SECTIONS = 6;

  /* Genere les sections de la roue. `options` (facultatif) fournit les choix
     du QCM ; sinon on fabrique des distracteurs credibles PROCHES de la bonne
     reponse (meme principe "chiffres proches" que le catalogue). La bonne
     reponse est toujours presente. Melange deterministe par graine pour que
     la bonne ne soit pas toujours a la meme place. Fonction pure. */
  function genererSectionsRoue({ options, bonneReponse, seed = 1 }) {
    const bonne = String(bonneReponse);
    const vues = new Set();
    const valeurs = [];
    const ajoute = (v) => {
      const s = String(v);
      if (s === "" || s === "null" || s === "undefined" || vues.has(s)) return;
      vues.add(s);
      valeurs.push(s);
    };

    ajoute(bonne); /* la bonne reponse d'abord : jamais perdue au decoupage */
    (Array.isArray(options) ? options : []).forEach(ajoute);

    const numerique = valeurs.every((v) => Number.isFinite(Number(v)));
    /* Taille cible deterministe dans [4,6]. */
    let cible = ROUE_MIN_SECTIONS + (Math.abs(seed) % (ROUE_MAX_SECTIONS - ROUE_MIN_SECTIONS + 1));

    if (numerique) {
      const base = Number(bonne);
      /* Distracteurs proches : voisins directs puis dizaines et permutations
         d'unites, jamais negatifs, jamais egaux a une valeur deja vue. */
      const deltas = [10, -10, 1, -1, 20, -20, 2, -2, 11, -11, 9, -9, 3, -3, 30, -30];
      for (let i = 0; i < deltas.length && valeurs.length < cible; i += 1) {
        const cand = base + deltas[i];
        if (cand >= 0) ajoute(cand);
      }
    } else {
      /* Non numerique : on garde les seules vraies options (pas de faux
         symboles). La roue tournera avec ce nombre de sections. */
      cible = valeurs.length;
    }

    const retenus = valeurs.slice(0, Math.min(Math.max(cible, 1), ROUE_MAX_SECTIONS));
    const ordonnees = seededShuffle(retenus, (seed >>> 0) || 1);
    return ordonnees.map((valeur) => ({ valeur, correcte: valeur === bonne }));
  }

  /* Geometrie du repere fixe. Les sections sont disposees dans le sens horaire
     depuis le haut : le centre de la section i est a l'angle i*(360/n) horaire
     depuis le repere (12h). Quand la roue tourne de `rotation` degres (horaire),
     le repere du haut (0 degre) pointe la section dont le centre revient a 0.
     Fonction pure : source unique de "quelle section sous le repere". */
  function sectionSousRepere(rotation, nbSections) {
    if (!nbSections || nbSections < 1) return 0;
    const secteur = 360 / nbSections;
    let idx = Math.round(-rotation / secteur) % nbSections;
    return ((idx % nbSections) + nbSections) % nbSections;
  }

  /* Rotation finale (deterministe) pour une force de lancer donnee. `force`
     dans [0,1] balaie toutes les sections une fois : l'eleve regle "un peu
     plus / un peu moins fort" pour viser. Un dephasage propre a l'exercice
     evite de memoriser une force universelle. Le resultat est cale (snap) sur
     un centre de section, donc sectionSousRepere() rend un indice net. */
  function rotationDepuisForce(force, nbSections, seed = 1) {
    const n = Math.max(1, nbSections);
    const secteur = 360 / n;
    const f = Math.min(1, Math.max(0, Number(force) || 0));
    const dephasage = Math.abs(seed) % n; /* section de depart propre a l'exercice */
    const toursBase = 4; /* tours visuels avant l'arret */
    const positionSection = dephasage + f * n;
    const rotationBrute = -(toursBase * 360 + positionSection * secteur);
    return Math.round(rotationBrute / secteur) * secteur; /* snap au centre */
  }

  /* Controleur pur de la roue (sans DOM). `sections` : [{valeur, correcte}].
     `viser(force)` rend la rotation cible pour l'animation ; `arreter(rot)`
     enregistre l'arret (snap) et rend l'indice sous le repere. La valeur n'est
     soumise qu'apres un premier lancer (sinon rien sous le repere ne compte). */
  function creerRoue({ sections, seed = 1 }) {
    const n = sections.length;
    const secteur = n ? 360 / n : 360;
    let rotation = 0;
    let lance = false;

    function sectionCourante() {
      return sectionSousRepere(rotation, n);
    }
    return {
      sections: () => sections.slice(),
      nbSections: n,
      rotation: () => rotation,
      aLance: () => lance,
      /* rotation cible pour une force (pour piloter l'animation). */
      viser: (force) => rotationDepuisForce(force, n, seed),
      /* enregistre l'arret sur une rotation quelconque (fin d'animation ou
         relachement d'un glissement) : on cale sur le centre le plus proche. */
      arreter(rotationFinale) {
        rotation = Math.round(Number(rotationFinale) / secteur) * secteur;
        lance = true;
        return sectionCourante();
      },
      sectionCourante,
      section: () => (lance ? sections[sectionCourante()] : null),
      valeur: () => (lance ? sections[sectionCourante()].valeur : ""),
      estCorrecte: () => lance && sections[sectionCourante()].correcte === true,
    };
  }

  /* Couleurs des secteurs : palette du design, rotation stable. */
  const ROUE_COULEURS = [
    { fill: "var(--grass)", stroke: "var(--grass-dark)" },
    { fill: "var(--water)", stroke: "var(--water-dark)" },
    { fill: "var(--gold)", stroke: "var(--gold-dark)" },
    { fill: "var(--road)", stroke: "var(--road-dark)" },
    { fill: "var(--wood-light)", stroke: "var(--wood-dark)" },
    { fill: "var(--water-light)", stroke: "var(--water-dark)" },
  ];

  /* Point du cercle a l'angle `deg` HORAIRE depuis le haut (0 = 12h). */
  function pointRoue(deg, rayon) {
    const rad = (deg * Math.PI) / 180;
    return [rayon * Math.sin(rad), -rayon * Math.cos(rad)];
  }

  function secteurPath(i, nbSections, rayon) {
    const secteur = 360 / nbSections;
    const debut = i * secteur - secteur / 2;
    const fin = i * secteur + secteur / 2;
    const [x1, y1] = pointRoue(debut, rayon);
    const [x2, y2] = pointRoue(fin, rayon);
    const grandArc = secteur > 180 ? 1 : 0;
    return `M 0 0 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rayon} ${rayon} 0 ${grandArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  }

  function mountWheel(container, exercise, api) {
    const info = answerInfo(exercise);
    const seed = hashString(exercise.id);
    const sections = genererSectionsRoue({
      options: exercise.variables?.options,
      bonneReponse: info.raw,
      seed,
    });
    const roue = creerRoue({ sections, seed });
    const n = sections.length;
    const rayon = 100;

    const secteursMarkup = sections
      .map((section, i) => {
        const couleur = ROUE_COULEURS[i % ROUE_COULEURS.length];
        const [lx, ly] = pointRoue(i * (360 / n), rayon * 0.62);
        return `
          <path class="roue-secteur" data-section="${i}" d="${secteurPath(i, n, rayon)}"
                fill="${couleur.fill}" stroke="${couleur.stroke}" stroke-width="2"></path>
          <text class="roue-label" data-section="${i}" x="${lx.toFixed(2)}" y="${ly.toFixed(2)}"
                text-anchor="middle" dominant-baseline="central">${section.valeur}</text>`;
      })
      .join("");

    container.innerHTML = `
      <p class="mech-hint">Regle la force, lance la roue pour viser la bonne section, puis valide.</p>
      <div class="mech-wheel">
        <div class="roue-cadre">
          <div class="roue-repere" aria-hidden="true"></div>
          <svg class="roue-svg" viewBox="-110 -110 220 220" role="img" aria-label="Roue a tourner">
            <g class="roue-plateau" data-plateau>
              <circle cx="0" cy="0" r="${rayon + 4}" fill="var(--cream)" stroke="var(--wood-dark)" stroke-width="4"></circle>
              ${secteursMarkup}
              <circle cx="0" cy="0" r="14" fill="var(--wood)" stroke="var(--wood-dark)" stroke-width="3"></circle>
            </g>
          </svg>
        </div>
        <div class="roue-controls">
          <label class="roue-force-label" for="roue-force">Force du lancer</label>
          <input id="roue-force" class="roue-force" type="range" min="0" max="100" value="50" step="1" />
          <button type="button" class="roue-spin btn-primary">Tourner</button>
        </div>
        <p class="roue-statut" aria-live="polite">Regle la force puis lance la roue.</p>
      </div>
    `;

    const plateau = container.querySelector("[data-plateau]");
    const forceInput = container.querySelector(".roue-force");
    const spinBtn = container.querySelector(".roue-spin");
    const statut = container.querySelector(".roue-statut");
    const secteurNodes = [...container.querySelectorAll(".roue-secteur")];
    const labelNodes = [...container.querySelectorAll(".roue-label")];
    /* Centre (ancre) de chaque etiquette : sert de pivot a la contre-rotation. */
    const labelCentres = sections.map((_, i) => pointRoue(i * (360 / n), rayon * 0.62));

    const secteur = 360 / n;
    let rotationVisuelle = 0; /* angle applique, cumulatif (pas de saut) */
    let enRotation = false;
    let animId = null;

    /* La rotation est posee en ATTRIBUT SVG (rotate(angle) autour de 0,0 = le
       centre du viewBox), et animee en JS image par image. On evite ainsi une
       transition CSS qui promeut le plateau sur une couche GPU (rendu instable
       a la capture, et inutile ici).

       Seule la SECTION coloree doit tourner : chaque etiquette recoit une
       contre-rotation de -rot autour de sa propre ancre, ce qui annule le tilt
       herite du plateau (texte toujours a l'endroit) sans changer sa position
       (le pivot est un point fixe de sa propre rotation). */
    function appliquer(rot) {
      plateau.setAttribute("transform", `rotate(${rot})`);
      labelNodes.forEach((node, i) => {
        const [lx, ly] = labelCentres[i];
        node.setAttribute("transform", `rotate(${-rot} ${lx.toFixed(2)} ${ly.toFixed(2)})`);
      });
    }
    appliquer(0);

    function marquerSection(idx) {
      secteurNodes.forEach((node, i) => node.classList.toggle("visee", i === idx));
    }

    function annoncerArret() {
      const idx = roue.sectionCourante();
      marquerSection(idx);
      api.setValue(roue.valeur());
      statut.textContent = `La roue pointe sur ${sections[idx].valeur}. Valide si c'est ton choix, ou relance.`;
    }

    /* Tween decelerant (ease-out cubique) vers `cible`, sur `duree` ms. */
    function animerVers(cible, duree, apres) {
      const depart = rotationVisuelle;
      const delta = cible - depart;
      const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
      enRotation = true;
      if (animId) cancelAnimationFrame(animId);
      function frame(now) {
        const t = duree <= 0 ? 1 : Math.min(1, (now - t0) / duree);
        const eased = 1 - Math.pow(1 - t, 3); /* ralentissement progressif */
        rotationVisuelle = depart + delta * eased;
        appliquer(rotationVisuelle);
        if (t < 1) {
          animId = requestAnimationFrame(frame);
        } else {
          rotationVisuelle = cible;
          appliquer(cible);
          enRotation = false;
          animId = null;
          if (apres) apres();
        }
      }
      animId = requestAnimationFrame(frame);
    }

    /* Lance la roue vers la cible visee, en avancant toujours (l'angle ne recule
       jamais d'un coup) et en ajoutant 4 tours pour l'effet de rotation. */
    function lancer(rotationCible) {
      if (enRotation) return;
      let cible = rotationCible;
      while (cible > rotationVisuelle) cible -= 360;
      while (cible <= rotationVisuelle - 360) cible += 360;
      cible -= 360 * 4;
      spinBtn.disabled = true;
      statut.textContent = "La roue tourne...";
      secteurNodes.forEach((node) => node.classList.remove("visee"));
      animerVers(cible, 2400, () => {
        spinBtn.disabled = false;
        roue.arreter(rotationVisuelle);
        annoncerArret();
      });
    }

    spinBtn.addEventListener("click", () => {
      const force = Number(forceInput.value) / 100;
      lancer(roue.viser(force));
    });

    /* Glissement : l'eleve saisit la roue et la fait tourner directement, puis
       relache ; on cale sur le centre le plus proche (meme repere fixe). */
    let drag = null;
    function angleSouris(event) {
      const rect = plateau.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI;
    }
    plateau.addEventListener("pointerdown", (event) => {
      if (enRotation) return;
      drag = { depart: angleSouris(event), base: rotationVisuelle };
      plateau.setPointerCapture?.(event.pointerId);
    });
    plateau.addEventListener("pointermove", (event) => {
      if (!drag) return;
      rotationVisuelle = drag.base + (angleSouris(event) - drag.depart);
      appliquer(rotationVisuelle);
    });
    function finDrag() {
      if (!drag) return;
      drag = null;
      const cale = Math.round(rotationVisuelle / secteur) * secteur;
      animerVers(cale, 450, () => {
        roue.arreter(cale);
        annoncerArret();
      });
    }
    plateau.addEventListener("pointerup", finDrag);
    plateau.addEventListener("pointercancel", finDrag);

    api.setValue(""); /* rien tant que la roue n'a pas ete lancee */
    forceInput.focus();
  }

  /* ----- Balance a equilibrer ----------------------------------
     Un plateau FIXE porte la valeur cible (la reponse attendue). L'eleve pose
     des poids un a un sur le plateau VIDE jusqu'a ce que leur somme egale la
     cible : la balance penche du cote le plus lourd et revient a l'horizontale
     a l'equilibre. Aucune validation automatique : l'eleve valide lui-meme.

     Le COEUR (somme des poids, ecart, equilibre, valeur soumise) et la
     geometrie du basculement sont purs et sans DOM, donc testables en Node. */

  /* Palette de poids adaptee a la cible : de quoi batir n'importe quel entier
     jusqu'a la cible sans empilement fastidieux. Deterministe. */
  function poidsDisponibles(cible) {
    const base = [1, 2, 5, 10];
    if (cible >= 20) base.push(20);
    if (cible >= 50) base.push(50);
    return base;
  }

  /* Angle de basculement (degres) en fonction de l'ecart = somme - cible.
     >0 : le plateau de l'eleve est plus lourd (il descend). Sature en douceur
     pour rester lisible meme tres desequilibre. Fonction pure. */
  const BALANCE_ANGLE_MAX = 16;
  function angleBascule(ecart) {
    return BALANCE_ANGLE_MAX * Math.tanh(Number(ecart) / 8);
  }

  /* Etat de la balance (sans DOM). Chaque poids pose est une instance (on peut
     poser plusieurs fois la meme valeur) reperee par un id stable. */
  function creerBalance({ cible, poids }) {
    const places = []; /* [{id, valeur}] sur le plateau de l'eleve */
    let compteur = 0;

    const somme = () => places.reduce((total, p) => total + p.valeur, 0);
    return {
      cible,
      poids: () => poids.slice(),
      placer(valeur) {
        const id = compteur;
        compteur += 1;
        places.push({ id, valeur: Number(valeur) });
        return id;
      },
      retirer(id) {
        const i = places.findIndex((p) => p.id === id);
        if (i === -1) return false;
        places.splice(i, 1);
        return true;
      },
      places: () => places.map((p) => ({ ...p })),
      somme,
      ecart: () => somme() - cible, /* >0 : plateau eleve plus lourd */
      estEquilibre: () => somme() === cible,
      /* Valeur soumise = la somme batie (vide tant que rien n'est pose, pour ne
         pas soumettre "0" par inadvertance). */
      valeur: () => (places.length ? String(somme()) : ""),
    };
  }

  function mountBalance(container, exercise, api) {
    const info = answerInfo(exercise);
    const cible = info.numeric;
    const poids = poidsDisponibles(cible);
    const balance = creerBalance({ cible, poids });

    /* Geometrie (unites du viewBox). Origine = pivot du fleau. */
    const L = 96; /* demi-longueur du fleau */
    const DROP = 30; /* longueur des suspentes (fleau -> plateau) */

    container.innerHTML = `
      <p class="mech-hint">Pose des poids sur le plateau vide jusqu'a egaler ${cible}, puis valide.</p>
      <div class="mech-balance">
        <svg class="balance-svg" viewBox="-140 -96 280 210" role="img" aria-label="Balance a equilibrer">
          <line data-string="left" class="balance-string" x1="0" y1="0" x2="0" y2="0"></line>
          <line data-string="right" class="balance-string" x1="0" y1="0" x2="0" y2="0"></line>
          <g data-fleau class="balance-fleau">
            <rect x="${-L}" y="-4" width="${2 * L}" height="8" rx="4" class="balance-beam"></rect>
          </g>
          <polygon points="0,2 -22,74 22,74" class="balance-pivot"></polygon>
          <rect x="-40" y="72" width="80" height="10" rx="5" class="balance-socle"></rect>
          <g data-plate="left" class="balance-plate">
            <ellipse cx="0" cy="0" rx="46" ry="9" class="balance-bowl"></ellipse>
            <text class="balance-plate-val" x="0" y="-16" text-anchor="middle">${cible}</text>
            <text class="balance-plate-cap" x="0" y="22" text-anchor="middle">cible</text>
          </g>
          <g data-plate="right" class="balance-plate">
            <ellipse cx="0" cy="0" rx="46" ry="9" class="balance-bowl"></ellipse>
            <g data-chips></g>
            <text class="balance-plate-val" data-somme x="0" y="22" text-anchor="middle">0</text>
          </g>
        </svg>
        <div class="balance-pool" role="group" aria-label="Poids disponibles">
          ${poids
            .map(
              (valeur) =>
                `<button type="button" class="balance-poids" data-poids="${valeur}" aria-label="Ajouter un poids de ${valeur}">${valeur}</button>`,
            )
            .join("")}
        </div>
        <div class="balance-actions">
          <button type="button" class="balance-remove btn-help">Retirer le dernier</button>
          <span class="balance-statut" aria-live="polite"></span>
        </div>
      </div>
    `;

    const fleau = container.querySelector("[data-fleau]");
    const plateLeft = container.querySelector('[data-plate="left"]');
    const plateRight = container.querySelector('[data-plate="right"]');
    const stringLeft = container.querySelector('[data-string="left"]');
    const stringRight = container.querySelector('[data-string="right"]');
    const chipsGroup = container.querySelector("[data-chips]");
    const sommeNode = container.querySelector("[data-somme]");
    const statut = container.querySelector(".balance-statut");
    const removeBtn = container.querySelector(".balance-remove");
    const poolNodes = [...container.querySelectorAll(".balance-poids")];

    /* Positionne fleau, suspentes et plateaux pour un angle donne. Rotation en
       ATTRIBUT SVG (pivot 0,0) + positions calculees en JS : aucune transition
       CSS (rendu stable a la capture, comme la roue). Les plateaux restent
       horizontaux (ils "pendent"), seul le fleau s'incline. */
    function appliquer(angleDeg) {
      fleau.setAttribute("transform", `rotate(${angleDeg})`);
      const rad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const bouts = {
        left: { x: -L * cos, y: -L * sin },
        right: { x: L * cos, y: L * sin },
      };
      [
        [stringLeft, plateLeft, bouts.left],
        [stringRight, plateRight, bouts.right],
      ].forEach(([corde, plate, bout]) => {
        corde.setAttribute("x1", bout.x.toFixed(2));
        corde.setAttribute("y1", bout.y.toFixed(2));
        corde.setAttribute("x2", bout.x.toFixed(2));
        corde.setAttribute("y2", (bout.y + DROP).toFixed(2));
        plate.setAttribute("transform", `translate(${bout.x.toFixed(2)} ${(bout.y + DROP).toFixed(2)})`);
      });
    }

    /* Animation en temps reel : l'angle affiche glisse vers l'angle cible a
       chaque frame (requestAnimationFrame), tant que l'ecart n'est pas resorbe. */
    let angleAffiche = 0;
    let angleCible = 0;
    let raf = null;
    function boucle() {
      const diff = angleCible - angleAffiche;
      if (Math.abs(diff) < 0.05) {
        angleAffiche = angleCible;
        appliquer(angleAffiche);
        raf = null;
        return;
      }
      angleAffiche += diff * 0.18;
      appliquer(angleAffiche);
      raf = requestAnimationFrame(boucle);
    }
    function viserAngle(a) {
      angleCible = a;
      if (raf === null) raf = requestAnimationFrame(boucle);
    }

    /* Rendu des jetons poses sur le plateau de l'eleve (une puce par poids). */
    function renderChips() {
      const items = balance.places();
      const parLigne = 4;
      const pas = 22;
      chipsGroup.innerHTML = items
        .map((p, i) => {
          const col = i % parLigne;
          const ligne = Math.floor(i / parLigne);
          const nb = Math.min(parLigne, items.length - ligne * parLigne);
          const x = (col - (nb - 1) / 2) * pas;
          const y = -10 - ligne * pas;
          return `<g class="balance-chip" data-id="${p.id}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="Retirer le poids ${p.valeur}">
            <circle r="11" class="balance-chip-disc"></circle>
            <text class="balance-chip-val" text-anchor="middle" dominant-baseline="central">${p.valeur}</text>
          </g>`;
        })
        .join("");
      chipsGroup.querySelectorAll(".balance-chip").forEach((node) => {
        const id = Number(node.dataset.id);
        node.addEventListener("click", () => {
          balance.retirer(id);
          onChange();
        });
        node.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            balance.retirer(id);
            onChange();
          }
        });
      });
    }

    function majStatut() {
      const somme = balance.somme();
      sommeNode.textContent = String(somme);
      if (balance.places().length === 0) {
        statut.textContent = `Plateau vide. Cible : ${cible}.`;
      } else if (balance.estEquilibre()) {
        statut.textContent = `Equilibre ! ${somme} = ${cible}. Tu peux valider.`;
      } else if (somme < cible) {
        statut.textContent = `Plateau : ${somme}. Trop leger, il manque ${cible - somme}.`;
      } else {
        statut.textContent = `Plateau : ${somme}. Trop lourd de ${somme - cible}.`;
      }
      statut.classList.toggle("equilibre", balance.estEquilibre());
      removeBtn.disabled = balance.places().length === 0;
    }

    function onChange() {
      renderChips();
      majStatut();
      api.setValue(balance.valeur());
      viserAngle(angleBascule(balance.ecart()));
    }

    poolNodes.forEach((node) => {
      node.addEventListener("click", () => {
        balance.placer(Number(node.dataset.poids));
        onChange();
      });
    });
    removeBtn.addEventListener("click", () => {
      const items = balance.places();
      if (items.length) {
        balance.retirer(items[items.length - 1].id);
        onChange();
      }
    });

    /* Depart : plateau eleve vide (somme 0) => tres plus leger, penche du cote
       fixe (cible), donc angle negatif. On l'affiche directement. */
    appliquer(0);
    onChange();
    /* Positionne d'emblee a l'inclinaison de depart, sans partir de 0. */
    angleAffiche = angleBascule(balance.ecart());
    appliquer(angleAffiche);
    poolNodes[0]?.focus();
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
    ordre: mountOrder,
    roue: mountWheel,
    balance: mountBalance,
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
    creerPlacementOrdre,
    melangerOrdre,
    genererSectionsRoue,
    sectionSousRepere,
    rotationDepuisForce,
    creerRoue,
    creerBalance,
    angleBascule,
    poidsDisponibles,
  };

  if (typeof window !== "undefined") {
    window.ParcoursMechanics = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
