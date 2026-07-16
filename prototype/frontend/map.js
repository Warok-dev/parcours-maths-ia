const mapElement = document.getElementById("map");
const mapStatus = document.getElementById("map-status");

function drawFallbackMap() {
  mapElement.innerHTML = `
    <path d="M 80 140 Q 150 80 220 100" class="path-line"></path>
    <circle cx="80" cy="140" r="18" class="step unlocked"></circle>
    <circle cx="220" cy="100" r="18" class="step locked"></circle>
    <text x="64" y="145">1</text>
    <text x="204" y="105">2</text>
  `;
  mapStatus.textContent = "Carte factice locale affichee.";
}

async function loadMap() {
  // TODO: Switch level dynamically from the game state.
  const level = "CE1";

  try {
    const response = await fetch(`http://127.0.0.1:8000/carte/${level}`);
    if (!response.ok) {
      throw new Error("HTTP error");
    }

    const data = await response.json();
    const steps = data.chemins.flatMap((path) => path.etapes);

    const circles = steps
      .map(
        (step) => `
          <circle
            cx="${step.x}"
            cy="${step.y}"
            r="18"
            class="step ${step.deverrouillee ? "unlocked" : "locked"}"
            data-step-id="${step.id}"
          ></circle>
          <text x="${step.x - 6}" y="${step.y + 5}">${step.label.replace("Etape ", "")}</text>
        `
      )
      .join("");

    mapElement.innerHTML = `
      <path d="M 80 140 Q 150 80 220 100" class="path-line"></path>
      ${circles}
    `;
    mapStatus.textContent = `${data.titre} chargee. Clique sur une etape bientot.`;
  } catch (error) {
    drawFallbackMap();
  }
}

loadMap();
