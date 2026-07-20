/* ============================================================
   REPONSE A LA VOIX (API Web Speech native, lang fr-FR)
   Methode de reponse ALTERNATIVE au clavier, jamais un
   remplacement : le micro remplit le champ #answer-input, l'eleve
   garde la main et valide toujours lui-meme.
   - Aucune cle API, aucun appel serveur : tout se passe dans le
     navigateur (Chrome/Edge ; Firefox et Safari sont limites).
   - Si l'API est absente ou si l'acces micro est refuse, le bouton
     disparait et le champ texte reste la methode par defaut.
   Le module s'exporte aussi en Node pour tester la conversion
   nombre-parle -> chiffres isolement (test_voice.js).
   ============================================================ */
(function () {
  /* ---------- Conversion nombre parle -> chiffres (0 a 999) ---------- */
  const WORD_VALUES = {
    zero: 0,
    un: 1,
    une: 1,
    deux: 2,
    trois: 3,
    quatre: 4,
    cinq: 5,
    six: 6,
    sept: 7,
    huit: 8,
    neuf: 9,
    dix: 10,
    onze: 11,
    douze: 12,
    treize: 13,
    quatorze: 14,
    quinze: 15,
    seize: 16,
    vingt: 20,
    trente: 30,
    quarante: 40,
    cinquante: 50,
    soixante: 60,
    /* alias internes poses par la pre-substitution des dizaines composees */
    _70: 70,
    _80: 80,
    _90: 90,
  };

  /* Dizaines irregulieres du francais, remplacees AVANT la tokenisation
     (ordre important : la plus longue d'abord). "quatre vingt dix sept"
     devient "_90 sept" -> 97 ; "quatre vingt onze" devient "_80 onze" -> 91. */
  const COMPOUND_TENS = [
    ["quatre vingt dix", "_90"],
    ["soixante dix", "_70"],
    ["quatre vingt", "_80"],
  ];

  function normaliser(texte) {
    return String(texte)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") /* accents */
      .replace(/[-']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function estMotNombre(token) {
    return token === "cent" || WORD_VALUES[token] !== undefined;
  }

  /* Convertit une transcription en nombre entier, ou null si aucun nombre
     exploitable. Accepte aussi les chiffres deja ecrits ("12"). */
  function convertirTranscription(texte) {
    const digits = String(texte).match(/-?\d+/);
    if (digits) {
      return parseInt(digits[0], 10);
    }

    let norm = normaliser(texte)
      .replace(/\bvingts\b/g, "vingt")
      .replace(/\bcents\b/g, "cent");
    for (const [phrase, alias] of COMPOUND_TENS) {
      norm = norm.split(phrase).join(alias);
    }
    const tokens = norm.split(" ");

    /* Premiere sequence contigue de mots-nombres ("la reponse est douze"). */
    let index = 0;
    while (index < tokens.length && !estMotNombre(tokens[index])) {
      index += 1;
    }
    if (index >= tokens.length) {
      return null;
    }

    let valeur = 0;
    let consomme = false;
    for (; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "et") {
        /* "soixante et onze" : on continue seulement si un nombre suit. */
        if (estMotNombre(tokens[index + 1])) {
          continue;
        }
        break;
      }
      if (token === "cent") {
        valeur = (valeur === 0 ? 1 : valeur) * 100;
        consomme = true;
        continue;
      }
      const mot = WORD_VALUES[token];
      if (mot === undefined) {
        break;
      }
      valeur += mot;
      consomme = true;
    }
    return consomme ? valeur : null;
  }

  /* ---------- Reconnaissance vocale (navigateur uniquement) ---------- */
  let micBlocked = false; /* acces micro refuse : bouton masque pour la session */
  let recognition = null;
  let listening = false;

  function speechCtor() {
    if (typeof window === "undefined") {
      return null;
    }
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function isSupported() {
    return Boolean(speechCtor());
  }

  function setStatus(statusNode, message, tone) {
    if (statusNode) {
      statusNode.textContent = message;
      statusNode.className = `mic-status ${tone}`;
    }
  }

  function stopListening(button) {
    listening = false;
    button?.classList.remove("listening");
  }

  function startListening(button, statusNode, input) {
    const Ctor = speechCtor();
    if (!Ctor) {
      return;
    }
    recognition = new Ctor();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      const alternatives = event.results && event.results[0] ? Array.from(event.results[0]) : [];
      let nombre = null;
      for (const alternative of alternatives) {
        nombre = convertirTranscription(alternative.transcript);
        if (nombre !== null) {
          break;
        }
      }
      stopListening(button);
      if (nombre === null) {
        setStatus(statusNode, "Je n'ai pas compris, reessaie ou ecris ta reponse.", "warning");
        return;
      }
      /* Remplit le champ SANS valider : l'eleve relit, corrige au besoin,
         et clique lui-meme sur Valider. */
      input.value = String(nombre);
      input.focus();
      setStatus(statusNode, `J'ai entendu : ${nombre}. Clique sur Valider si c'est bon !`, "success");
    };

    recognition.onerror = (event) => {
      stopListening(button);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        /* Refus du micro : on ne redemande pas en boucle, le bouton
           disparait pour le reste de la session. */
        micBlocked = true;
        button.remove();
        setStatus(statusNode, "Pas de souci ! Ecris ta reponse dans la case.", "warning");
      } else {
        setStatus(statusNode, "Je n'ai pas compris, reessaie ou ecris ta reponse.", "warning");
      }
    };

    recognition.onend = () => {
      stopListening(button);
    };

    listening = true;
    button.classList.add("listening");
    setStatus(statusNode, "Je t'ecoute... dis ta reponse a voix haute !", "listening");
    try {
      recognition.start();
    } catch (_error) {
      stopListening(button);
      setStatus(statusNode, "Je n'ai pas compris, reessaie ou ecris ta reponse.", "warning");
    }
  }

  /* Branche le bouton micro du popup d'exercice courant (appele a chaque
     rendu de la popup par map.js). Retire le bouton si l'API est absente
     ou si l'acces micro a deja ete refuse. */
  function attach() {
    if (typeof document === "undefined") {
      return;
    }
    const button = document.getElementById("mic-button");
    if (!button) {
      return;
    }
    if (!isSupported() || micBlocked) {
      button.remove();
      return;
    }
    const statusNode = document.getElementById("mic-status");
    const input = document.getElementById("answer-input");
    button.addEventListener("click", () => {
      if (listening) {
        recognition?.stop();
        return;
      }
      startListening(button, statusNode, input);
    });
  }

  const api = {
    attach,
    isSupported,
    isBlocked: () => micBlocked,
    convertirTranscription,
  };
  if (typeof window !== "undefined") {
    window.ParcoursVoice = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
