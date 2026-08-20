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
  const STEP_VOLUME = 0.12; /* discret, en retrait des SFX et de la musique */
  const STEP_INTERVAL_MS = 280;
  const STORAGE_KEY = "parcours-audio-muted";

  /* Choix du format selon le navigateur. Chromium et Firefox lisent l'OGG
     Vorbis ; WebKit/Safari NE le lit PAS et ne joue que le MP3 (chaque son
     existe dans les deux formats dans audio/). canPlayType tranche a l'execution.
     Si AUCUN format n'est jouable (moteur exotique), EXT vaut null : on ne cree
     aucun element Audio -> degradation propre et silencieuse, sans requetes en
     echec ni exception (le jeu reste entierement jouable, juste sans son). */
  const probe = typeof Audio !== "undefined" ? new Audio() : null;
  function canPlay(type) {
    return Boolean(probe && typeof probe.canPlayType === "function" && probe.canPlayType(type) !== "");
  }
  const EXT = canPlay("audio/ogg; codecs=vorbis") ? "ogg" : canPlay("audio/mpeg") ? "mp3" : null;

  function makeAudio(base, volume, loop) {
    if (!EXT || typeof Audio === "undefined") {
      return null;
    }
    const audio = new Audio(`audio/${base}.${EXT}`);
    audio.volume = volume;
    audio.preload = "auto";
    if (loop) {
      audio.loop = true;
    }
    return audio;
  }

  const music = makeAudio("musique_fond", MUSIC_VOLUME, true);
  const stepSounds = ["pas_00", "pas_01"].map((base) => makeAudio(base, STEP_VOLUME));
  const sfx = {
    correct: makeAudio("bonne_reponse", SFX_VOLUME),
    wrong: makeAudio("mauvaise_reponse", SFX_VOLUME),
    unlock: makeAudio("deblocage", SFX_VOLUME),
  };

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
    if (!unlocked || !music) {
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
    if (music && music.paused) {
      refreshMusic();
    }
  }
  window.addEventListener("pointerdown", onUserGesture);
  window.addEventListener("keydown", onUserGesture);

  function playOne(audio) {
    if (muted || !unlocked || !audio) {
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
      if (!audio) {
        return;
      }
      audio.currentTime = 0;
      audio.play().catch(() => {});
    },
    /* Etat interne expose pour l'outillage et le bouton mute. */
    musicState: () =>
      music ? { paused: music.paused, currentTime: music.currentTime } : { paused: true, currentTime: 0 },
  };
})();
