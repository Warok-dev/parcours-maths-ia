const toggleChatButton = document.getElementById("toggle-chat");
const chatWidget = document.getElementById("chat-widget");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");

function appendMessage(text, role) {
  const entry = document.createElement("p");
  entry.className = `message ${role}`;
  entry.textContent = text;
  chatLog.appendChild(entry);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function ensureOpen() {
  chatWidget.classList.remove("hidden");
  toggleChatButton.textContent = "Fermer";
}

function closeWidget() {
  chatWidget.classList.add("hidden");
  toggleChatButton.textContent = "Ouvrir";
}

async function askTutor(question) {
  const exercise = window.ParcoursApp?.getCurrentExercise();
  const sessionId = window.ParcoursApp?.getSessionId();
  const niveau = window.ParcoursApp?.getSessionLevel();

  if (!exercise || !sessionId || !niveau) {
    throw new Error("Aucun exercice courant n'est disponible.");
  }

  const response = await fetch("http://127.0.0.1:8000/tuteur/aide", {
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

  if (!response.ok) {
    let message = "Le tuteur est indisponible.";
    try {
      const payload = await response.json();
      message = payload.detail || message;
    } catch (_error) {
      message = `${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  const data = await response.json();
  if (data.progression) {
    window.ParcoursApp?.syncSession?.();
  }
  return data;
}

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
    appendMessage(`Tuteur : ${error.message}`, "assistant");
  }
});

window.ParcoursChat = {
  open() {
    ensureOpen();
  },
  reset() {
    chatLog.innerHTML = `
      <p class="message assistant">
        Le tuteur repondra ici aux questions sur l'exercice courant.
      </p>
    `;
    closeWidget();
  },
};
