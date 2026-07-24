/* ============================================================
   FAIBLESSES DETECTEES
   Memorise en localStorage (cle faiblesses_v1, aucun appel backend,
   comme le carnet d'aventurier) les concepts termines a une maitrise
   1 ou 2. Un concept repasse plus tard a la maitrise 3 SORT de la
   liste : c'est une photo a jour des points faibles, pas un
   historique qui s'accumule.
   Alimente le bouton "Revoir mes points faibles" de l'ecran de choix
   de lecon (rendu par map.js) et donc le pool de la session de
   revision ciblee.
   Le coeur (pur, sans stockage) s'exporte en Node pour les tests
   (test_faiblesses.js).
   ============================================================ */
(function () {
  const STORAGE_KEY = "faiblesses_v1";
  /* Une maitrise strictement inferieure marque le concept comme faible. */
  const MAITRISE_ACQUISE = 3;

  /* ---------- Coeur de decision (testable sans navigateur) ---------- */

  /* Concepts d'une lecon terminee avec la maitrise atteinte sur chacun.
     Le backend renvoie maitrises_concepts_terminees dans l'ordre de
     concepts ; un concept sans maitrise connue compte comme 1, comme
     partout ailleurs dans le jeu. */
  function conceptsTermines(snapshot) {
    const concepts = snapshot?.concepts || [];
    const maitrises = snapshot?.maitrises_concepts_terminees || [];
    return concepts.map((pattern_name, index) => ({
      pattern_name,
      maitrise: maitrises[index] || 1,
    }));
  }

  function memeEntree(entry, niveau, pattern) {
    return entry.niveau_scolaire === niveau && entry.pattern_name === pattern;
  }

  /* Applique la fin d'une lecon a la liste : ajout/mise a jour des concepts
     restes sous la maitrise 3, retrait de ceux qui viennent de l'atteindre.
     Fonction pure : elle retourne une nouvelle liste. */
  function appliquerFinDeLecon(entries, snapshot, dateIso) {
    const niveau = snapshot?.niveau_scolaire;
    if (!niveau) {
      return entries;
    }
    const date = dateIso || new Date().toISOString();
    let resultat = Array.isArray(entries) ? entries.slice() : [];

    for (const { pattern_name, maitrise } of conceptsTermines(snapshot)) {
      const index = resultat.findIndex((entry) => memeEntree(entry, niveau, pattern_name));

      if (maitrise >= MAITRISE_ACQUISE) {
        /* Acquis : le concept quitte la liste des points faibles. */
        if (index >= 0) {
          resultat.splice(index, 1);
        }
        continue;
      }

      /* La lecon d'origine est conservee lors d'une mise a jour : c'est elle
         qui situe le concept dans le parcours, pas la revision qui vient de
         le rejouer. */
      const entry = {
        pattern_name,
        lecon_id: index >= 0 ? resultat[index].lecon_id : snapshot.lecon_id || null,
        niveau_scolaire: niveau,
        maitrise,
        date,
      };
      if (index >= 0) {
        resultat[index] = entry;
      } else {
        resultat.push(entry);
      }
    }
    return resultat;
  }

  /* ---------- Stockage ---------- */
  function loadEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function saveEntries(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (_error) {
      /* stockage indisponible (mode prive...) : le jeu continue sans revision */
    }
  }

  function enregistrerFinDeLecon(snapshot) {
    const entries = appliquerFinDeLecon(loadEntries(), snapshot);
    saveEntries(entries);
    return entries;
  }

  /* Faiblesses d'un niveau donne, les plus anciennes d'abord : ce sont
     elles qui trainent depuis le plus longtemps. */
  function listerPourNiveau(niveau) {
    return loadEntries()
      .filter((entry) => entry.niveau_scolaire === niveau && entry.pattern_name)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function patternsPourNiveau(niveau) {
    return listerPourNiveau(niveau).map((entry) => entry.pattern_name);
  }

  /* ---------- Branchement au jeu ---------- */
  /* Meme signal que le carnet : une carte terminee cloture la lecon. Les
     sessions de revision comptent aussi, ce sont elles qui retirent les
     concepts enfin acquis. */
  const sessionsEnregistrees = new Set();
  if (typeof window !== "undefined") {
    window.addEventListener("session-updated", (event) => {
      const snapshot = event.detail;
      if (!snapshot?.session_id || !snapshot.terminee) {
        return;
      }
      if (sessionsEnregistrees.has(snapshot.session_id)) {
        return;
      }
      sessionsEnregistrees.add(snapshot.session_id);
      enregistrerFinDeLecon(snapshot);
    });
  }

  const api = {
    listerPourNiveau,
    patternsPourNiveau,
    enregistrerFinDeLecon,
    /* Exposes pour les tests */
    STORAGE_KEY,
    MAITRISE_ACQUISE,
    conceptsTermines,
    appliquerFinDeLecon,
    loadEntries,
    saveEntries,
  };

  if (typeof window !== "undefined") {
    window.ParcoursFaiblesses = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
