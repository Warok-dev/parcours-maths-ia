/* ============================================================
   AMBIANCE SONORE
   Musique de fond en boucle, pas du personnage, SFX de feedback.
   Fichiers libres de droits (CC0) : voir audio/AUDIO_CREDITS.md.
   Contrainte navigateur : rien ne demarre avant une interaction
   utilisateur ; tout est coupable via le bouton mute du HUD.
   ============================================================ */
(function () {
  const MUSIC_VOLUME = 0.3;
  const SFX_VOLUME = 0.55;
  const STEP_VOLUME = 0.35;
  const STEP_INTERVAL_MS = 280;
  const STORAGE_KEY = "parcours-audio-muted";

  const music = new Audio("audio/musique_fond.ogg");
  music.loop = true;
  music.volume = MUSIC_VOLUME;
  music.preload = "auto";

  const stepSounds = ["audio/pas_00.ogg", "audio/pas_01.ogg"].map((src) => {
    const audio = new Audio(src);
    audio.volume = STEP_VOLUME;
    audio.preload = "auto";
    return audio;
  });

  const sfx = {
    correct: new Audio("audio/bonne_reponse.ogg"),
    wrong: new Audio("audio/mauvaise_reponse.ogg"),
    unlock: new Audio("audio/deblocage.ogg"),
  };
  for (const audio of Object.values(sfx)) {
    audio.volume = SFX_VOLUME;
    audio.preload = "auto";
  }

  let unlocked = false; /* une interaction utilisateur a eu lieu */
  let musicWanted = false; /* une session de jeu est en cours */
  let muted = false;
  try {
    muted = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (_error) {
    /* stockage indisponible : on garde le son actif par defaut */
  }
  let lastStepAt = 0;
  let stepToggle = 0;

  function refreshMusic() {
    if (!unlocked) {
      return;
    }
    if (musicWanted && !muted) {
      /* play() peut etre rejete tant que le navigateur n'a pas vu de vraie
         interaction ; on retentera au prochain geste utilisateur. */
      music.play().catch(() => {});
    } else {
      music.pause();
    }
  }

  function onUserGesture() {
    unlocked = true;
    if (music.paused) {
      refreshMusic();
    }
  }
  window.addEventListener("pointerdown", onUserGesture);
  window.addEventListener("keydown", onUserGesture);

  function playOne(audio) {
    if (muted || !unlocked) {
      return;
    }
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  window.ParcoursAudio = {
    /* La musique tourne pendant l'exploration d'une session. */
    setMusicActive(active) {
      musicWanted = active;
      refreshMusic();
    },
    isMuted: () => muted,
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
      } catch (_error) {
        /* preference non persistee, sans gravite */
      }
      refreshMusic();
      return muted;
    },
    playCorrect: () => playOne(sfx.correct),
    playWrong: () => playOne(sfx.wrong),
    playUnlock: () => playOne(sfx.unlock),
    /* Appele par la boucle de jeu pendant le mouvement : joue un pas a
       intervalle regulier (pas a chaque frame), en alternant deux sons. */
    footstep(now) {
      if (muted || !unlocked || now - lastStepAt < STEP_INTERVAL_MS) {
        return;
      }
      lastStepAt = now;
      stepToggle = 1 - stepToggle;
      const audio = stepSounds[stepToggle];
      audio.currentTime = 0;
      audio.play().catch(() => {});
    },
    /* Etat interne expose pour l'outillage et le bouton mute. */
    musicState: () => ({ paused: music.paused, currentTime: music.currentTime }),
  };
})();
