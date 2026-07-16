const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");

function appendMessage(text, role) {
  const entry = document.createElement("p");
  entry.className = `message ${role}`;
  entry.textContent = text;
  chatLog.appendChild(entry);
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = chatInput.value.trim();

  if (!question) {
    return;
  }

  appendMessage(`Eleve: ${question}`, "user");
  chatInput.value = "";

  try {
    const response = await fetch("http://127.0.0.1:8000/tuteur/aide", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        exercice_id: "CE1-mock-substitution-001",
        niveau: "CE1",
        question,
      }),
    });

    if (!response.ok) {
      throw new Error("HTTP error");
    }

    const data = await response.json();
    appendMessage(`Tuteur: ${data.reponse}`, "assistant");
  } catch (error) {
    appendMessage(
      "Tuteur: Le backend n'est pas encore relie. Reviens apres le demarrage de l'API.",
      "assistant",
    );
  }
});
