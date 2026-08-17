/* ============================================================
   MODE HORS-LIGNE PARTIEL (essai libre uniquement)
   Quand le backend devient injoignable pendant une partie en mode
   invité, l'élève continue à s'entraîner sur des exercices
   PROCÉDURAUX pré-chargés (jamais les problèmes narratifs, qui
   exigent le LLM), corrigés localement contre reponse_attendue.valeur.

   Ce module porte trois choses, toutes testables sans navigateur
   (test_offline.js) :
     1. le TAMPON d'exercices (remplissage, consommation, épuisement),
        persisté en localStorage et cantonné à un niveau ;
     2. l'ÉVALUATION locale, miroir fidèle de evaluation.py côté backend
        (mêmes règles de normalisation, commutativité de la multiplication) ;
     3. la BASCULE en ligne / hors-ligne (machine à deux états) et la
        distinction erreur réseau (pas de statut HTTP) vs erreur serveur.

   Aucune progression pédagogique n'est persistée hors-ligne : c'est un
   entraînement local, cohérent avec le mode invité déjà non-persistant
   côté serveur. Voir [[portee-donnees-compte-vs-invite]].
   ============================================================ */
(function () {
  const STORAGE_KEY = "hors_ligne_tampon_v1";
  /* Cible de remplissage et seuil de renouvellement : on vise ~12 exercices
     d'avance et on complète tant qu'on reste au-dessus de zéro. */
  const CIBLE_TAMPON = 12;
  /* Seules ces deux familles procédurales alimentent le tampon : ce sont les
     exercices générés par pure substitution, sans aucun appel LLM. On écarte
     donc explicitement les problèmes narratifs (probleme_narratif_simple) ET
     l'horloge (lecture_horloge), conformément au périmètre demandé. */
  const FAMILLES_PROCEDURALES = ["calcul_direct", "exercice_a_trous_serie"];

  /* ---------- Évaluation locale (miroir de evaluation.py) ---------- */

  /* Normalisation minimale identique au backend : × et * valent x, espaces
     retirés si la tolérance le demande, minuscules. Les tableaux sont rendus
     comme le fait String() (jointure par virgule) ; la comparaison réelle des
     listes passe de toute façon par les équivalences fournies. */
  function normaliser(valeur, tolerance) {
    let texte = valeur === null || valeur === undefined ? "" : String(valeur);
    tolerance = tolerance || {};
    texte = texte.replace(/×/g, "x").replace(/\*/g, "x");
    if (tolerance.ignorer_espaces) {
      texte = texte.replace(/\s+/g, "");
    }
    return texte.trim().toLowerCase();
  }

  const MULT_EXPR = /^(?:(\d+)=)?(\d+)x(\d+)$/;

  function parseMultiplication(texte) {
    const m = MULT_EXPR.exec(texte);
    if (!m) {
      return null;
    }
    const total = m[1] ? parseInt(m[1], 10) : null;
    const facteurs = [parseInt(m[2], 10), parseInt(m[3], 10)].sort((a, b) => a - b);
    return { total, facteurs };
  }

  /* La multiplication est commutative : "10 x 7" vaut "7 x 10". Mêmes facteurs
     (ordre libre) ; un total écrit d'un côté doit correspondre au produit. */
  function multiplicationsEquivalentes(reponseNorm, attenduNorm) {
    const reponse = parseMultiplication(reponseNorm);
    const attendu = parseMultiplication(attenduNorm);
    if (!reponse || !attendu) {
      return false;
    }
    if (reponse.facteurs[0] !== attendu.facteurs[0] || reponse.facteurs[1] !== attendu.facteurs[1]) {
      return false;
    }
    const produit = attendu.facteurs[0] * attendu.facteurs[1];
    for (const candidat of [reponse, attendu]) {
      if (candidat.total !== null && candidat.total !== produit) {
        return false;
      }
    }
    return true;
  }

  /* Vrai si la réponse de l'élève est correcte pour cet exercice mis en cache.
     reponse_attendue.valeur est déjà présent dans l'exercice : aucun serveur
     n'est nécessaire pour une comparaison aussi simple. */
  function evaluer(exercice, reponseEleve) {
    const attendue = (exercice && exercice.reponse_attendue) || {};
    const tolerance = attendue.tolerance || {};
    const reponseNorm = normaliser(reponseEleve, tolerance);
    const attenduNorm = normaliser(attendue.valeur, tolerance);
    const equivalences = (tolerance.equivalences_acceptees || []).map((item) =>
      normaliser(item, tolerance),
    );

    let correct = reponseNorm === attenduNorm || equivalences.includes(reponseNorm);
    if (!correct) {
      correct =
        multiplicationsEquivalentes(reponseNorm, attenduNorm) ||
        equivalences.some((equivalence) => multiplicationsEquivalentes(reponseNorm, equivalence));
    }
    return correct;
  }

  /* ---------- Reconnaissance d'un exercice procédural ---------- */
  function estProcedural(exercice) {
    const pattern = exercice && exercice.pattern;
    if (!pattern) {
      return false;
    }
    return (
      pattern.generation_method === "substitution" &&
      FAMILLES_PROCEDURALES.includes(pattern.pattern_family)
    );
  }

  /* Signature stable {pattern_name, variables} : miroir de _exercise_signature
     côté backend, pour écarter les quasi-doublons consécutifs du tampon (les
     id générés sont, eux, toujours uniques et donc inutiles à dédupliquer). */
  function signature(exercice) {
    const pattern = (exercice && exercice.pattern) || {};
    return stableStringify({
      pattern_name: pattern.pattern_name,
      variables: exercice ? exercice.variables : null,
    });
  }

  function stableStringify(valeur) {
    if (Array.isArray(valeur)) {
      return `[${valeur.map(stableStringify).join(",")}]`;
    }
    if (valeur && typeof valeur === "object") {
      const cles = Object.keys(valeur).sort();
      return `{${cles.map((cle) => `${JSON.stringify(cle)}:${stableStringify(valeur[cle])}`).join(",")}}`;
    }
    return JSON.stringify(valeur);
  }

  /* ---------- Tampon (état + persistance localStorage) ----------
     Cantonné à un niveau : changer de niveau vide le tampon (un exercice CE2
     n'a rien à faire dans un entraînement CE1). Chargé paresseusement. */
  let _items = null;
  let _niveau = null;

  function _lireBrut() {
    try {
      return JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) || "null");
    } catch (_error) {
      return null;
    }
  }

  function _assurerCharge() {
    if (_items === null) {
      const brut = _lireBrut();
      _items = brut && Array.isArray(brut.exercices) ? brut.exercices : [];
      _niveau = brut ? brut.niveau || null : null;
    }
  }

  function _persister() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ niveau: _niveau, exercices: _items }));
      }
    } catch (_error) {
      /* stockage indisponible (mode privé...) : l'entraînement continue en RAM */
    }
  }

  /* Fixe le niveau du tampon ; s'il change, on repart d'un tampon vide. */
  function definirNiveau(niveau) {
    _assurerCharge();
    if (niveau && niveau !== _niveau) {
      _niveau = niveau;
      _items = [];
      _persister();
    }
  }

  function taille() {
    _assurerCharge();
    return _items.length;
  }

  function estVide() {
    return taille() === 0;
  }

  /* Ajoute un exercice procédural au tampon (dédupliqué par signature, plafonné
     à la cible). Retourne true s'il a réellement été ajouté. */
  function ajouter(exercice) {
    _assurerCharge();
    if (!estProcedural(exercice) || _items.length >= CIBLE_TAMPON) {
      return false;
    }
    const sig = signature(exercice);
    if (_items.some((item) => signature(item) === sig)) {
      return false;
    }
    _items.push(exercice);
    _persister();
    return true;
  }

  /* Retire et retourne le prochain exercice, ou null si le tampon est vide. */
  function consommer() {
    _assurerCharge();
    if (!_items.length) {
      return null;
    }
    const exercice = _items.shift();
    _persister();
    return exercice;
  }

  function vider() {
    _items = [];
    _persister();
  }

  /* Remplit le tampon jusqu'à la cible en tirant au hasard parmi les patterns
     fournis. `fetchExercice(pattern)` renvoie (promesse d')un exercice ou lève.
     - erreur réseau (pas de statut) => on arrête, inutile d'insister ;
     - erreur HTTP (404 narratif...) ou exercice non procédural => le pattern
       est écarté du pool pour cette passe ;
     - doublon => on retente un autre pattern.
     Retourne le nombre d'exercices réellement ajoutés. */
  async function remplir(options) {
    options = options || {};
    const fetchExercice = options.fetchExercice;
    const cible = options.cible || CIBLE_TAMPON;
    if (options.niveau) {
      definirNiveau(options.niveau);
    }
    if (typeof fetchExercice !== "function") {
      return 0;
    }
    const pool = (options.patterns || []).slice();
    if (!pool.length) {
      return 0;
    }

    let ajouts = 0;
    let tentatives = 0;
    const maxTentatives = (cible - taille()) * 4 + pool.length * 2 + 8;
    while (taille() < cible && tentatives < maxTentatives && pool.length) {
      tentatives += 1;
      const pattern = pool[Math.floor(Math.random() * pool.length)];
      let exercice;
      try {
        exercice = await fetchExercice(pattern);
      } catch (error) {
        if (estErreurReseau(error)) {
          break;
        }
        _retirer(pool, pattern);
        continue;
      }
      if (exercice && estProcedural(exercice)) {
        if (ajouter(exercice)) {
          ajouts += 1;
        }
      } else {
        _retirer(pool, pattern);
      }
    }
    return ajouts;
  }

  function _retirer(pool, valeur) {
    const index = pool.indexOf(valeur);
    if (index >= 0) {
      pool.splice(index, 1);
    }
  }

  /* ---------- Machine à deux états : en ligne / hors-ligne ---------- */
  let _horsLigne = false;
  const _abonnes = [];

  function estHorsLigne() {
    return _horsLigne;
  }

  function _notifier() {
    for (const cb of _abonnes) {
      try {
        cb(_horsLigne);
      } catch (_error) {
        /* un abonné défaillant ne doit pas casser les autres */
      }
    }
  }

  /* Bascule hors-ligne ; retourne true seulement s'il y a eu transition. */
  function basculerHorsLigne() {
    if (_horsLigne) {
      return false;
    }
    _horsLigne = true;
    _notifier();
    return true;
  }

  /* Bascule en ligne ; retourne true seulement s'il y a eu transition. */
  function basculerEnLigne() {
    if (!_horsLigne) {
      return false;
    }
    _horsLigne = false;
    _notifier();
    return true;
  }

  function onChangement(callback) {
    if (typeof callback === "function") {
      _abonnes.push(callback);
    }
  }

  /* Une erreur de fetch qui n'a PAS de statut HTTP numérique est une panne
     réseau (fetch rejeté, timeout/abort) : le serveur n'a pas répondu. Une
     erreur porteuse d'un `.status` (404, 429, 503...) prouve au contraire que
     le serveur est joignable — ce n'est jamais un motif de bascule hors-ligne. */
  function estErreurReseau(error) {
    if (!error) {
      return false;
    }
    return typeof error.status !== "number";
  }

  const api = {
    /* Évaluation */
    normaliser,
    evaluer,
    multiplicationsEquivalentes,
    estProcedural,
    signature,
    /* Tampon */
    STORAGE_KEY,
    CIBLE_TAMPON,
    FAMILLES_PROCEDURALES,
    definirNiveau,
    taille,
    estVide,
    ajouter,
    consommer,
    vider,
    remplir,
    /* Connectivité */
    estHorsLigne,
    basculerHorsLigne,
    basculerEnLigne,
    onChangement,
    estErreurReseau,
    /* Exposé pour les tests : réinitialise l'état en mémoire. */
    _reset() {
      _items = null;
      _niveau = null;
      _horsLigne = false;
      _abonnes.length = 0;
    },
  };

  if (typeof window !== "undefined") {
    window.ParcoursOffline = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
