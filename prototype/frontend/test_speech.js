/* Tests de la synthese vocale (speech.js).
   Lancer avec : node test_speech.js
   On teste la logique testable en Node sans navigateur : mute + persistance
   localStorage, et l'interruption d'une lecture en cours (pas de
   chevauchement de voix). Le moteur de synthese, le stockage et la fabrique
   d'utterance sont injectes via _setDeps(). */
const speech = require("./speech.js");

/* ---------- Doublures ---------- */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    _data: data,
  };
}

function fakeSynth(voices = []) {
  const calls = [];
  return {
    calls,
    cancel() {
      calls.push("cancel");
    },
    speak(utter) {
      calls.push("speak");
      this.lastUtterance = utter;
    },
    getVoices() {
      return voices;
    },
    lastUtterance: null,
  };
}

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = null;
    this.voice = null;
  }
}

function makeDeps(voices = []) {
  return {
    synth: fakeSynth(voices),
    storage: fakeStorage(),
    Utterance: FakeUtterance,
  };
}

/* ---------- Runner minimal ---------- */
let failures = 0;
function check(name, condition) {
  if (!condition) {
    failures += 1;
  }
  console.log(`${condition ? "ok " : "KO "} ${name}`);
}

/* ---------- 1. Persistance du mute ---------- */
{
  const deps = makeDeps();
  speech._setDeps(deps);
  speech.init();

  check("part voix active par defaut", speech.isMuted() === false);

  speech.setMuted(true);
  check("mute ecrit '1' en storage", deps.storage._data[speech.STORAGE_KEY] === "1");
  check("isMuted vrai apres setMuted(true)", speech.isMuted() === true);

  /* Simule un rechargement de page : meme storage, nouvel init(). */
  speech._setDeps({ synth: deps.synth, storage: deps.storage, Utterance: FakeUtterance });
  speech.init();
  check("mute persiste apres rechargement", speech.isMuted() === true);

  speech.setMuted(false);
  check("mute ecrit '0' en storage", deps.storage._data[speech.STORAGE_KEY] === "0");
  speech.init();
  check("voix active persiste apres rechargement", speech.isMuted() === false);
}

/* ---------- 2. toggle ---------- */
{
  const deps = makeDeps();
  speech._setDeps(deps);
  speech.init();
  check("toggle depuis actif -> muet", speech.toggleMuted() === true && speech.isMuted() === true);
  check("toggle depuis muet -> actif", speech.toggleMuted() === false && speech.isMuted() === false);
}

/* ---------- 3. Mute coupe la voix automatique ---------- */
{
  const deps = makeDeps();
  speech._setDeps(deps);
  speech.init();

  speech.setMuted(true);
  const started = speech.speak("Bravo !");
  check("speak muet ne demarre pas", started === false);
  check("speak muet n'appelle pas synth.speak", !deps.synth.calls.includes("speak"));

  /* Un clic explicite (force) passe malgre le mute. */
  const forced = speech.speak("Ecoute l'enonce", { force: true });
  check("speak force ignore le mute", forced === true);
  check("speak force appelle synth.speak", deps.synth.calls.includes("speak"));
}

/* ---------- 4. Interruption : chaque prise de parole coupe la precedente ---------- */
{
  const deps = makeDeps();
  speech._setDeps(deps);
  speech.init();

  speech.speak("Premiere reponse");
  speech.speak("Deuxieme reponse");

  /* Ordre attendu : cancel, speak, cancel, speak (chaque speak precede
     d'une annulation, donc aucun chevauchement possible). */
  check(
    "chaque speak est precede d'un cancel",
    deps.synth.calls.join(",") === "cancel,speak,cancel,speak",
  );
  check("la derniere utterance est la nouvelle", deps.synth.lastUtterance.text === "Deuxieme reponse");
}

/* ---------- 5. setMuted(true) coupe une lecture en cours ---------- */
{
  const deps = makeDeps();
  speech._setDeps(deps);
  speech.init();

  speech.speak("Longue explication en cours");
  const avant = deps.synth.calls.length;
  speech.setMuted(true);
  check("setMuted(true) annule la lecture en cours", deps.synth.calls.length === avant + 1 && deps.synth.calls[avant] === "cancel");
}

/* ---------- 6. Choix de la voix francaise + langue ---------- */
{
  const voices = [
    { lang: "en-US", name: "Alex" },
    { lang: "fr-FR", name: "Amelie" },
  ];
  const deps = makeDeps(voices);
  speech._setDeps(deps);
  speech.init();

  speech.speak("Bonjour");
  check("utterance en fr-FR", deps.synth.lastUtterance.lang === "fr-FR");
  check("voix francaise choisie si dispo", deps.synth.lastUtterance.voice?.name === "Amelie");
}

/* ---------- 7. Voix par defaut si aucune voix francaise ---------- */
{
  const voices = [{ lang: "en-US", name: "Alex" }];
  const deps = makeDeps(voices);
  speech._setDeps(deps);
  speech.init();

  speech.speak("Bonjour");
  check("voix par defaut (null) sans voix fr", deps.synth.lastUtterance.voice === null);
}

/* ---------- 8. Non supporte : masquage propre (isSupported faux) ---------- */
{
  speech._setDeps({ synth: null, storage: fakeStorage(), Utterance: FakeUtterance });
  speech.init();
  check("isSupported faux sans moteur", speech.isSupported() === false);
  check("speak ne fait rien sans moteur", speech.speak("rien") === false);
}

speech._clearDeps();

console.log(`\n${failures === 0 ? "TOUS LES TESTS PASSENT" : `${failures} test(s) en echec`}`);
if (failures > 0) {
  process.exit(1);
}
