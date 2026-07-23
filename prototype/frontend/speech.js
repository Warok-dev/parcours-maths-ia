/* ============================================================
   SYNTHESE VOCALE (voix neurale Google TTS, repli natif fr-FR)
   Le jeu parle a voix haute : les reponses du hibou tuteur (lues
   automatiquement) et, a la demande, l'enonce des exercices.
   - Moteur principal : le backend POST /synthese-vocale renvoie un
     MP3 (voix neurale realiste), qu'on joue via un element Audio.
   - Repli automatique : si le backend echoue (reseau, 503, timeout)
     ou est absent, on retombe sur window.speechSynthesis (voix
     native du navigateur) — jamais de silence pour l'eleve.
   - Une seule lecture a la fois : chaque nouvelle prise de parole
     interrompt la precedente (audio ET native), y compris une requete
     backend encore en vol (jeton de generation).
   - Un bouton mute (persiste en localStorage) coupe la voix
     AUTOMATIQUE du tuteur. Les lectures declenchees a la main par
     l'eleve (bouton "ecouter l'enonce") passent quand meme (force).
   - Si aucun moteur n'est disponible, isSupported() est faux et
     l'appelant masque simplement ses boutons de lecture.
   Le module s'exporte aussi en Node : les tests injectent un faux
   moteur natif via _setDeps() (pas de backend en Node), ce qui teste
   la logique de mute, de persistance et d'interruption (test_speech.js).
   ============================================================ */
(function () {
  const STORAGE_KEY = "parcours_voix_muet_v1";
  const LANG = "fr-FR";
  const BACKEND_URL = "http://127.0.0.1:8000/synthese-vocale";
  const BACKEND_TIMEOUT_MS = 6000;

  /* Dependances resolues paresseusement : le navigateur passe par window,
     les tests Node injectent un faux moteur natif via _setDeps() (et n'ont
     ni fetch ni Audio, donc restent sur le chemin natif). */
  let deps = null;
  let muted = false;

  /* Lecture backend en cours + jeton de generation : chaque nouvelle prise de
     parole incremente le jeton, ce qui invalide toute requete/lecture plus
     ancienne (pas de chevauchement, meme avec un fetch encore en vol). */
  let currentAudio = null;
  let currentToken = 0;

  function synth() {
    if (deps) {
      return deps.synth || null;
    }
    return typeof window !== "undefined" ? window.speechSynthesis || null : null;
  }

  function storage() {
    if (deps) {
      return deps.storage || null;
    }
    return typeof window !== "undefined" ? window.localStorage || null : null;
  }

  function makeUtterance(text) {
    if (deps && deps.Utterance) {
      return new deps.Utterance(text);
    }
    if (typeof window !== "undefined" && typeof window.SpeechSynthesisUtterance === "function") {
      return new window.SpeechSynthesisUtterance(text);
    }
    return null;
  }

  /* Moteur natif du navigateur disponible (ou faux moteur injecte en test). */
  function nativeSupported() {
    if (deps) {
      return Boolean(deps.synth && deps.Utterance);
    }
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof window.SpeechSynthesisUtterance === "function"
    );
  }

  /* Le navigateur sait-il jouer l'audio du backend (fetch + Audio) ? Jamais en
     mode test (deps injecte) : les tests Node ciblent le moteur natif. */
  function backendCapable() {
    return (
      typeof fetch === "function" &&
      typeof AbortController === "function" &&
      typeof Audio !== "undefined"
    );
  }

  function canUseBackend() {
    return !deps && backendCapable();
  }

  /* Un moteur au moins est disponible : sinon l'appelant masque ses boutons. */
  function isSupported() {
    if (deps) {
      return Boolean(deps.synth && deps.Utterance);
    }
    return nativeSupported() || backendCapable();
  }

  /* ---------- Mute persiste ---------- */
  function readMuted() {
    try {
      return storage()?.getItem(STORAGE_KEY) === "1";
    } catch (_error) {
      /* stockage indisponible : on repart voix active */
      return false;
    }
  }

  /* Recharge l'etat mute depuis le stockage. Appele au demarrage (et par les
     tests pour simuler un rechargement de page). */
  function init() {
    muted = readMuted();
    return muted;
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = Boolean(value);
    try {
      storage()?.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch (_error) {
      /* pas de persistance : le choix vaut au moins pour la session */
    }
    if (muted) {
      /* Couper tout de suite une lecture eventuellement en cours. */
      cancel();
    }
    return muted;
  }

  function toggleMuted() {
    return setMuted(!muted);
  }

  /* ---------- Choix de la voix native (repli) ---------- */
  /* Une voix francaise si le navigateur en propose une, sinon la voix par
     defaut (utter.voice reste null). getVoices() peut etre vide tant que la
     liste n'est pas chargee : on choisit au moment de parler, ou elle l'est. */
  function pickFrenchVoice() {
    const s = synth();
    if (!s || typeof s.getVoices !== "function") {
      return null;
    }
    const voices = s.getVoices() || [];
    return voices.find((voice) => /^fr/i.test(voice.lang || "")) || null;
  }

  /* ---------- Interruption ---------- */
  function stopPlayback() {
    /* Coupe la voix native... */
    const s = synth();
    if (s && typeof s.cancel === "function") {
      s.cancel();
    }
    /* ...et l'audio backend en cours de lecture. */
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch (_error) {
        /* lecture deja arretee */
      }
      currentAudio.src = "";
      currentAudio = null;
    }
  }

  /* Interrompt toute lecture (audio + native) et invalide toute requete
     backend encore en vol. */
  function cancel() {
    currentToken += 1;
    stopPlayback();
  }

  /* ---------- Repli : synthese native du navigateur ---------- */
  /* Comportement historique conserve : interrompt la lecture native en cours,
     puis parle en fr-FR avec une voix francaise si disponible. */
  function speakNative(text) {
    if (!nativeSupported()) {
      return false;
    }
    const s = synth();
    s.cancel();
    const utter = makeUtterance(String(text));
    if (!utter) {
      return false;
    }
    utter.lang = LANG;
    const voice = pickFrenchVoice();
    if (voice) {
      utter.voice = voice;
    }
    s.speak(utter);
    return true;
  }

  /* ---------- Moteur principal : backend Google TTS ---------- */
  function speakViaBackend(text, options) {
    /* Nouvelle prise de parole : on invalide la precedente et on coupe toute
       lecture en cours AVANT de lancer la requete. */
    const myToken = (currentToken += 1);
    stopPlayback();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    const body = { texte: text };
    if (options.source) {
      body.source = options.source;
    }

    fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`synthese-vocale ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        clearTimeout(timer);
        /* Une lecture plus recente a demarre entre-temps : on abandonne. */
        if (myToken !== currentToken) {
          return;
        }
        if (!data || !data.audio_base64) {
          throw new Error("audio vide");
        }
        const audio = new Audio(`data:audio/mpeg;base64,${data.audio_base64}`);
        currentAudio = audio;
        audio.play().catch(() => {
          /* Autoplay bloque / lecture impossible : repli natif si toujours
             d'actualite. */
          if (myToken === currentToken) {
            speakNative(text);
          }
        });
      })
      .catch(() => {
        clearTimeout(timer);
        /* Supplantee par une lecture plus recente : ne rien dire. */
        if (myToken !== currentToken) {
          return;
        }
        /* Backend indisponible (reseau, 503, timeout) : repli automatique sur
           la synthese native, pas de silence pour l'eleve. */
        speakNative(text);
      });
  }

  /* ---------- API publique ---------- */
  /* Lit `text` a voix haute. Renvoie true si une lecture a ete lancee.
     options.force  : ignore le mute (lecture declenchee explicitement).
     options.source : "tuteur" | "enonce" (ton de la voix cote backend). */
  function speak(text, options = {}) {
    if (!text || !isSupported()) {
      return false;
    }
    if (muted && !options.force) {
      return false;
    }
    const value = String(text);
    if (canUseBackend()) {
      speakViaBackend(value, options);
      return true;
    }
    /* Pas de backend (ou mode test) : moteur natif directement. */
    return speakNative(value);
  }

  if (typeof window !== "undefined") {
    init();
  }

  const api = {
    isSupported,
    isMuted,
    setMuted,
    toggleMuted,
    speak,
    cancel,
    init,
    /* Exposes pour les tests Node */
    STORAGE_KEY,
    _setDeps(injected) {
      deps = injected;
    },
    _clearDeps() {
      deps = null;
    },
  };

  if (typeof window !== "undefined") {
    window.ParcoursSpeech = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
