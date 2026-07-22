/* ============================================================
   CHAT DU HIBOU TUTEUR
   Les pannes sont expliquees a l'enfant selon leur cause reelle :
   une coupure reseau, une session desynchronisee et une IA
   indisponible n'appellent pas la meme reaction de sa part
   (verifier Internet / recharger la page / patienter).
   La classification est pure et exportee pour les tests Node
   (test_chat.js) ; le detail technique part dans la console.
   ============================================================ */

/* Causes d'echec distinguees cote eleve. */
const CAUSE = {
  RESEAU: "reseau",
  SESSION: "session",
  IA_INDISPONIBLE: "ia-indisponible",
  SANS_EXERCICE: "sans-exercice",
  INCONNUE: "inconnue",
};

/* Un message par cause : phrases courtes, vocabulaire CE1/CE2, et
   surtout l'action que l'enfant peut faire lui-meme. */
const MESSAGES_ERREUR = {
  [CAUSE.RESEAU]:
    "Hou hou ? Je n'arrive plus a te repondre : la connexion est coupee. " +
    "Demande a un adulte de verifier Internet, puis repose-moi ta question.",
  [CAUSE.SESSION]:
    "Oups, on ne regarde plus le meme exercice ! " +
    "Recharge la page et je te retrouve tout de suite au bon endroit.",
  [CAUSE.IA_INDISPONIBLE]:
    "Ma tete de hibou est trop fatiguee pour reflechir en ce moment. " +
    "Attends une petite minute et redemande-moi : je reviens en pleine forme !",
  [CAUSE.SANS_EXERCICE]:
    "Je ne vois aucun exercice ouvert ! " +
    "Choisis une etape sur la carte, et je pourrai t'aider.",
  [CAUSE.INCONNUE]:
    "Aie, quelque chose ne marche pas de mon cote. " +
    "Reessaie dans un petit moment, je reste avec toi.",
};

/* Statut HTTP du backend -> cause.
   404 (session introuvable, ex. serveur redemarre) et 409 (exercice
   courant invalide) se reglent tous deux en rechargeant la page.
   503 = build_tutor_reply a epuise la chaine Gemini -> Groq -> Mistral. */
function causeDepuisStatut(status) {
  if (status === 404 || status === 409) {
    return CAUSE.SESSION;
  }
  if (status === 503) {
    return CAUSE.IA_INDISPONIBLE;
  }
  return CAUSE.INCONNUE;
}

function messageErreurTuteur(cause) {
  return MESSAGES_ERREUR[cause] || MESSAGES_ERREUR[CAUSE.INCONNUE];
}

/* Erreur portant sa cause : le detail technique reste disponible pour
   la console sans jamais etre montre a l'eleve. */
class TutorError extends Error {
  constructor(cause, detail) {
    super(detail || cause);
    this.name = "TutorError";
    this.cause = cause;
  }
}

const hasDom = typeof document !== "undefined";
const toggleChatButton = hasDom ? document.getElementById("toggle-chat") : null;
const chatWidget = hasDom ? document.getElementById("chat-widget") : null;
const chatForm = hasDom ? document.getElementById("chat-form") : null;
const chatInput = hasDom ? document.getElementById("chat-input") : null;
const chatLog = hasDom ? document.getElementById("chat-log") : null;

function appendMessage(text, role) {
  const entry = document.createElement("p");
  entry.className = `message ${role}`;
  entry.textContent = text;
  chatLog.appendChild(entry);
  chatLog.scrollTop = chatLog.scrollHeight;
}

/* Message d'echec : meme voix du hibou, mais repere visuellement pour
   ne pas etre confondu avec une explication de l'exercice. */
function appendError(cause, detail) {
  console.warn(`[tuteur] echec (${cause}) :`, detail || "sans detail");
  appendMessage(`Tuteur : ${messageErreurTuteur(cause)}`, "assistant tutor-error");
}

function ensureOpen() {
  chatWidget.classList.remove("hidden");
  toggleChatButton.classList.add("chat-open");
  toggleChatButton.setAttribute("aria-expanded", "true");
}

function closeWidget() {
  chatWidget.classList.add("hidden");
  toggleChatButton.classList.remove("chat-open");
  toggleChatButton.setAttribute("aria-expanded", "false");
}

async function askTutor(question) {
  const exercise = window.ParcoursApp?.getCurrentExercise();
  const sessionId = window.ParcoursApp?.getSessionId();
  const niveau = window.ParcoursApp?.getSessionLevel();

  if (!exercise || !sessionId || !niveau) {
    throw new TutorError(CAUSE.SANS_EXERCICE, "Aucun exercice courant n'est disponible.");
  }

  let response;
  try {
    response = await fetch("http://127.0.0.1:8000/tuteur/aide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        exercice_id: exercise.id,
        niveau,
        question,
      }),
    });
  } catch (error) {
    /* fetch ne rejette que pour une panne de transport (serveur eteint,
       Wi-Fi coupe, CORS) : jamais pour un statut HTTP d'erreur. */
    throw new TutorError(CAUSE.RESEAU, error.message);
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch (_error) {
      /* Corps non JSON (proxy, 502...) : on garde le statut brut. */
    }
    throw new TutorError(causeDepuisStatut(response.status), detail);
  }

  const data = await response.json();
  if (data.progression) {
    window.ParcoursApp?.syncSession?.();
  }
  return data;
}

if (hasDom) {
  toggleChatButton.addEventListener("click", () => {
    if (chatWidget.classList.contains("hidden")) {
      ensureOpen();
    } else {
      closeWidget();
    }
  });

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = chatInput.value.trim();
    if (!question) {
      return;
    }

    ensureOpen();
    appendMessage(`Eleve : ${question}`, "user");
    chatInput.value = "";

    try {
      const data = await askTutor(question);
      appendMessage(`Tuteur : ${data.reponse}`, "assistant");
      if (data.progression?.niveau_resolution_courant >= 2) {
        window.ParcoursApp?.setFeedback?.(
          "Le tuteur a aide sur ce niveau : la chaine parfaite est desormais interrompue pour cette detection de maitrise.",
          "warning",
        );
      }
    } catch (error) {
      appendError(error.cause || CAUSE.INCONNUE, error.message);
    }
  });
}

const api = {
  open() {
    ensureOpen();
  },
  isOpen() {
    return !chatWidget.classList.contains("hidden");
  },
  appendAssistant(text) {
    appendMessage(`Tuteur : ${text}`, "assistant");
  },
  /* Ouverture proactive : message d'accueil contextualise du hibou. */
  openWithGreeting(text) {
    appendMessage(`Tuteur : ${text}`, "assistant");
    ensureOpen();
  },
  reset() {
    chatLog.innerHTML = `
      <p class="message assistant">
        Hou hou ! Pose-moi une question sur l'exercice.
      </p>
    `;
    closeWidget();
  },
  /* Exposes pour les tests */
  CAUSE,
  MESSAGES_ERREUR,
  causeDepuisStatut,
  messageErreurTuteur,
  askTutor,
};

if (typeof window !== "undefined") {
  window.ParcoursChat = api;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
