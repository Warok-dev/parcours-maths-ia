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
  TROP_VITE: "trop-vite", // 429 : trop de questions en peu de temps (rate limit)
  INCONNUE: "inconnue",
};

/* Un message par cause, DECLINE par tranche d'age (meme principe que
   tutor.construire_system_instruction cote backend) : seul le registre de
   langue change, l'action a faire et le mot-cle (Internet / recharge / attends
   / carte / réessaie) restent identiques. La table par defaut ci-dessous est
   le registre CE1/CE2 (le plus accompagne) ; c'est aussi le repli. */
const MESSAGES_ERREUR = {
  [CAUSE.RESEAU]:
    "Hou hou ? Je n'arrive plus à te répondre : la connexion est coupée. " +
    "Demande à un adulte de vérifier Internet, puis repose-moi ta question.",
  [CAUSE.SESSION]:
    "Oups, on ne regarde plus le même exercice ! " +
    "Recharge la page et je te retrouve tout de suite au bon endroit.",
  [CAUSE.IA_INDISPONIBLE]:
    "Ma tête de hibou est trop fatiguée pour réfléchir en ce moment. " +
    "Attends une petite minute et redemande-moi : je reviens en pleine forme !",
  [CAUSE.SANS_EXERCICE]:
    "Je ne vois aucun exercice ouvert ! " +
    "Choisis une étape sur la carte, et je pourrai t'aider.",
  [CAUSE.TROP_VITE]:
    "Oh là là, tu me poses beaucoup de questions très vite ! " +
    "Attends un petit instant, puis redemande-moi.",
  [CAUSE.INCONNUE]:
    "Aïe, quelque chose ne marche pas de mon côté. " +
    "Réessaie dans un petit moment, je reste avec toi.",
};

/* Registre CE3/CE4 : ton pose, un peu plus riche, sans etre bebe. */
const MESSAGES_ERREUR_MOYEN = {
  [CAUSE.RESEAU]:
    "Je n'arrive plus à te répondre : la connexion Internet est coupée. " +
    "Vérifie Internet, puis repose-moi ta question.",
  [CAUSE.SESSION]:
    "On ne regarde plus le même exercice. " +
    "Recharge la page et je te retrouve au bon endroit.",
  [CAUSE.IA_INDISPONIBLE]:
    "Je n'arrive pas à réfléchir juste là. " +
    "Attends un petit moment et redemande-moi.",
  [CAUSE.SANS_EXERCICE]:
    "Aucun exercice n'est ouvert. " +
    "Choisis une étape sur la carte et je pourrai t'aider.",
  [CAUSE.TROP_VITE]:
    "Tu m'envoies beaucoup de questions d'un coup ! " +
    "Attends un petit moment, puis redemande-moi.",
  [CAUSE.INCONNUE]:
    "Quelque chose ne marche pas de mon côté. " +
    "Réessaie dans un moment, je reste avec toi.",
};

/* Registre CE5/CE6 : ton respectueux, sans infantiliser. */
const MESSAGES_ERREUR_GRAND = {
  [CAUSE.RESEAU]:
    "Impossible de te répondre : la connexion Internet est interrompue. " +
    "Vérifie ta connexion, puis pose à nouveau ta question.",
  [CAUSE.SESSION]:
    "Ta session n'est plus synchronisée avec cet exercice. " +
    "Recharge la page pour reprendre au bon endroit.",
  [CAUSE.IA_INDISPONIBLE]:
    "Le service d'aide est momentanément indisponible. " +
    "Attends un instant, puis renouvelle ta demande.",
  [CAUSE.SANS_EXERCICE]:
    "Aucun exercice n'est ouvert pour l'instant. " +
    "Sélectionne une étape sur la carte et je pourrai t'aider.",
  [CAUSE.TROP_VITE]:
    "Trop de demandes en peu de temps. " +
    "Patiente un instant, puis renouvelle ta demande.",
  [CAUSE.INCONNUE]:
    "Un problème est survenu de mon côté. " +
    "Réessaie dans un instant.",
};

/* Tranche d'age depuis le niveau scolaire (CE1..CE6), memes bornes que le
   backend : petit = CE1/CE2, moyen = CE3/CE4, grand = CE5/CE6. */
function trancheAge(niveau) {
  const rang = parseInt(String(niveau || "").replace(/\D/g, ""), 10) || 0;
  if (rang >= 5) {
    return "grand";
  }
  if (rang >= 3) {
    return "moyen";
  }
  return "petit";
}

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
  if (status === 429) {
    return CAUSE.TROP_VITE;
  }
  return CAUSE.INCONNUE;
}

/* Message d'erreur adapte a l'age (registre) ; niveau optionnel -> registre
   CE1/CE2 par defaut, qui sert aussi de repli pour une cause inconnue. */
function messageErreurTuteur(cause, niveau) {
  const tranche = trancheAge(niveau);
  const table =
    tranche === "grand" ? MESSAGES_ERREUR_GRAND : tranche === "moyen" ? MESSAGES_ERREUR_MOYEN : MESSAGES_ERREUR;
  return table[cause] || MESSAGES_ERREUR[CAUSE.INCONNUE];
}

/* Niveau scolaire de la session en cours (pour choisir le registre), ou "" si
   indisponible (registre CE1/CE2 par defaut). */
function niveauScolaireCourant() {
  return (typeof window !== "undefined" && window.ParcoursApp?.getSessionLevel?.()) || "";
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
const tutorMuteButton = hasDom ? document.getElementById("tutor-mute") : null;

/* Haut-parleur : plein = voix active, barre = voix coupee. Un seul bouton
   dont l'icone suit l'etat mute persiste par ParcoursSpeech. */
function speakerIconSvg(muted) {
  const slash = muted
    ? `<line x1="4" y1="4" x2="28" y2="28" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></line>`
    : `<path d="M22 11 a 7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
       <path d="M25 8 a 12 12 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>`;
  return `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 12 h5 l6 -5 v18 l-6 -5 h-5 Z" fill="currentColor"></path>
      ${slash}
    </svg>
  `;
}

function refreshMuteButton() {
  if (!tutorMuteButton) {
    return;
  }
  /* Pas de synthese vocale sur ce navigateur : le bouton mute n'a aucun sens,
     on le retire (aucune erreur, aucun blocage). */
  if (!window.ParcoursSpeech?.isSupported?.()) {
    tutorMuteButton.remove();
    return;
  }
  const muted = window.ParcoursSpeech.isMuted();
  tutorMuteButton.classList.toggle("muted", muted);
  tutorMuteButton.setAttribute("aria-pressed", muted ? "true" : "false");
  const label = muted ? "Activer la voix du tuteur" : "Couper la voix du tuteur";
  tutorMuteButton.setAttribute("aria-label", label);
  tutorMuteButton.title = label;
  tutorMuteButton.innerHTML = speakerIconSvg(muted);
}

/* Chaque reponse du hibou est lue a voix haute (sauf si l'eleve a coupe le
   son). Une nouvelle reponse interrompt la lecture precedente. */
function speakTutor(text) {
  window.ParcoursSpeech?.speak?.(text, { source: "tuteur" });
}

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
  appendMessage(`Tuteur : ${messageErreurTuteur(cause, niveauScolaireCourant())}`, "assistant tutor-error");
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

  /* Token eleve joint quand l'eleve est connecte : le backend verifie alors que
     la session appartient bien a cet eleve (au-dela de la possession du
     session_id). En essai libre il n'y a pas de token, comportement inchange. */
  const token = window.ParcoursCompte?.getToken?.();
  let response;
  try {
    response = await fetch("http://127.0.0.1:8000/tuteur/aide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  refreshMuteButton();
  tutorMuteButton?.addEventListener("click", () => {
    window.ParcoursSpeech?.toggleMuted?.();
    refreshMuteButton();
  });

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
    appendMessage(`Élève : ${question}`, "user");
    chatInput.value = "";

    try {
      const data = await askTutor(question);
      appendMessage(`Tuteur : ${data.reponse}`, "assistant");
      speakTutor(data.reponse);
      if (data.progression?.niveau_resolution_courant >= 2) {
        window.ParcoursApp?.setFeedback?.(
          "Le tuteur a aidé sur ce niveau : la chaîne parfaite est désormais interrompue pour cette détection de maîtrise.",
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
    speakTutor(text);
  },
  /* Ouverture proactive : message d'accueil contextualise du hibou. */
  openWithGreeting(text) {
    appendMessage(`Tuteur : ${text}`, "assistant");
    speakTutor(text);
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
