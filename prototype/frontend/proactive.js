/* ============================================================
   TUTEUR PROACTIF
   Detecte les signaux de blocage (echecs repetes, inactivite) et
   propose spontanement l'aide du hibou : petite bulle + animation,
   sans JAMAIS ouvrir le chat a la place de l'eleve. Le clic
   volontaire sur le hibou reste inchange, la proactivite s'ajoute.
   Seuils plus prudents au niveau 3 (autonome) : 3 echecs / 40 s au
   lieu de 2 echecs / 25 s, relances espacees d'au moins 45 s par
   exercice pour ne pas devenir intrusif.
   Le coeur de decision (sans DOM, horloge injectee) s'exporte en
   Node pour les tests (test_proactive.js).
   ============================================================ */
(function () {
  const COOLDOWN_MS = 45000; /* espacement minimal entre deux propositions */
  const BUBBLE_VISIBLE_MS = 7000;
  const CHECK_INTERVAL_MS = 1000;
  const THRESHOLDS = {
    standard: { echecs: 2, inactiviteMs: 25000 }, /* niveaux 1 et 2 */
    autonome: { echecs: 3, inactiviteMs: 40000 }, /* niveau 3 */
  };
  const BUBBLE_MESSAGE = "On dirait que tu bloques, je peux t'aider ?";
  const GREETING_MESSAGE =
    "J'ai vu que ce n'etait pas facile, je suis la pour t'aider ! Dis-moi ce qui te bloque.";

  function seuilsPourNiveau(niveau) {
    return niveau >= 3 ? THRESHOLDS.autonome : THRESHOLDS.standard;
  }

  /* ---------- Coeur de decision (testable sans navigateur) ---------- */
  function createTracker() {
    const state = {
      exerciseId: null,
      niveau: 1,
      echecs: 0,
      lastActivityAt: 0,
      lastProposalByExercise: {},
      active: false,
    };

    function cooldownOk(now) {
      const last = state.lastProposalByExercise[state.exerciseId];
      return last === undefined || now - last >= COOLDOWN_MS;
    }

    function marquerProposition(now) {
      state.lastProposalByExercise[state.exerciseId] = now;
      state.lastActivityAt = now; /* l'inactivite repart de la proposition */
    }

    return {
      exerciseShown(exerciseId, niveau, now) {
        state.active = true;
        state.niveau = niveau || 1;
        if (exerciseId !== state.exerciseId) {
          /* Nouvel exercice : compteurs remis a zero (le cooldown par
             exercice, lui, est conserve dans lastProposalByExercise). */
          state.exerciseId = exerciseId;
          state.echecs = 0;
          state.lastActivityAt = now;
        }
      },
      panelClosed() {
        state.active = false;
        state.exerciseId = null;
        state.echecs = 0;
      },
      recordActivity(now) {
        state.lastActivityAt = now;
      },
      /* Retourne true si la proposition proactive doit se declencher. */
      recordWrongAnswer(now) {
        if (!state.active) {
          return false;
        }
        state.echecs += 1;
        state.lastActivityAt = now;
        if (state.echecs >= seuilsPourNiveau(state.niveau).echecs && cooldownOk(now)) {
          marquerProposition(now);
          return true;
        }
        return false;
      },
      /* Retourne true si l'inactivite depasse le seuil du niveau. */
      checkInactivity(now) {
        if (!state.active || !state.exerciseId) {
          return false;
        }
        const seuil = seuilsPourNiveau(state.niveau).inactiviteMs;
        if (now - state.lastActivityAt >= seuil && cooldownOk(now)) {
          marquerProposition(now);
          return true;
        }
        return false;
      },
      getState: () => ({ ...state }),
    };
  }

  /* ---------- Couche navigateur (bulle + animation du hibou) ---------- */
  const tracker = createTracker();
  let intervalId = null;
  let hideTimer = null;

  function bubbleNode() {
    return typeof document === "undefined" ? null : document.getElementById("proactive-bubble");
  }

  function owlNode() {
    return typeof document === "undefined" ? null : document.getElementById("toggle-chat");
  }

  function chatIsOpen() {
    return Boolean(window.ParcoursChat?.isOpen?.());
  }

  function hideProposal() {
    window.clearTimeout(hideTimer);
    bubbleNode()?.classList.add("hidden");
    owlNode()?.classList.remove("tutor-attention");
  }

  function showProposal() {
    const bubble = bubbleNode();
    const owl = owlNode();
    if (!bubble || !owl || chatIsOpen()) {
      return;
    }
    window.clearTimeout(hideTimer);
    bubble.textContent = BUBBLE_MESSAGE;
    bubble.classList.remove("hidden");
    owl.classList.add("tutor-attention");
    /* La bulle s'efface seule si l'eleve l'ignore ; l'aide reste
       accessible en cliquant sur le hibou comme d'habitude. */
    hideTimer = window.setTimeout(hideProposal, BUBBLE_VISIBLE_MS);
  }

  function acceptProposal() {
    hideProposal();
    window.ParcoursChat?.openWithGreeting?.(GREETING_MESSAGE);
    document.getElementById("chat-input")?.focus();
  }

  function ensureInterval() {
    if (intervalId || typeof window === "undefined") {
      return;
    }
    intervalId = window.setInterval(() => {
      if (tracker.checkInactivity(Date.now())) {
        showProposal();
      }
    }, CHECK_INTERVAL_MS);
  }

  function stopInterval() {
    if (intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function bindActivityListeners() {
    const form = typeof document === "undefined" ? null : document.getElementById("exercise-form");
    if (!form || form.dataset.proactiveBound) {
      return;
    }
    form.dataset.proactiveBound = "1";
    for (const eventName of ["input", "click", "keydown"]) {
      form.addEventListener(eventName, () => tracker.recordActivity(Date.now()));
    }
  }

  if (typeof document !== "undefined") {
    /* La bulle accepte l'aide ; un clic sur le hibou pendant une
       proposition ajoute le message d'ouverture (chat.js gere l'ouverture). */
    bubbleNode()?.addEventListener("click", acceptProposal);
    owlNode()?.addEventListener("click", () => {
      const bubble = bubbleNode();
      if (bubble && !bubble.classList.contains("hidden")) {
        hideProposal();
        window.ParcoursChat?.appendAssistant?.(GREETING_MESSAGE);
      }
    });
  }

  const api = {
    /* Appele a chaque rendu de la popup d'exercice. */
    exerciseShown(exerciseId, niveau) {
      tracker.exerciseShown(exerciseId, niveau, Date.now());
      ensureInterval();
      bindActivityListeners();
    },
    panelClosed() {
      tracker.panelClosed();
      stopInterval();
      hideProposal();
    },
    activity() {
      tracker.recordActivity(Date.now());
    },
    wrongAnswer() {
      if (tracker.recordWrongAnswer(Date.now())) {
        showProposal();
      }
    },
    /* Exposes pour les tests */
    createTracker,
    COOLDOWN_MS,
    THRESHOLDS,
  };

  if (typeof window !== "undefined") {
    window.ParcoursProactive = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
