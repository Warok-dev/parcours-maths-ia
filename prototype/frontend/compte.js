/* ============================================================
   COMPTE ELEVE (connexion a une classe)
   Ecran de connexion affiche au tout debut, AVANT le choix du
   niveau et de la lecon : "Rejoindre ma classe" (code de classe +
   prenom) ou "Essai libre" (mode invite, comportement historique
   strictement inchange, tout en localStorage).

   Quand un eleve est connecte, map.js ajoute son jeton aux appels
   (/session/demarrer lie alors la session au compte cote backend) et
   le carnet d'aventurier se lit depuis GET /eleve/{id}/progression au
   lieu du localStorage. Le mode invite, lui, ne touche jamais la base.

   MIGRATION : on ne transfere PAS l'historique localStorage existant
   vers les comptes. Impossible de savoir a quel eleve il appartient
   (un meme navigateur a pu servir a plusieurs enfants en essai libre).
   Un compte eleve demarre donc avec une progression vierge ; le
   localStorage reste la memoire du seul mode invite.

   Le coeur pur (regroupement de la progression en pages de carnet)
   s'exporte en Node pour les tests (test_compte.js).
   ============================================================ */
(function () {
  const API_BASE = "http://127.0.0.1:8000";
  const STORAGE_KEY = "parcours_compte_v1";

  /* ---------- Coeur pur (testable sans navigateur) ---------- */

  /* Transforme la progression a plat renvoyee par le backend
     ([{pattern_name, lecon_id, maitrise, date_derniere_tentative}, ...])
     en pages de carnet groupees par lecon, au meme format que les
     entrees localStorage du mode invite (une page par lecon, etoiles
     cumulees). La meilleure maitrise est deja garantie par le backend
     (une seule ligne par (eleve, pattern)), donc aucun merge ici.
     meta = { niveau, lessonNames: { lecon_id: "Nom lisible" } }. */
  function grouperProgression(lignes, meta = {}) {
    const groupes = new Map();
    for (const ligne of Array.isArray(lignes) ? lignes : []) {
      if (!ligne || !ligne.pattern_name) {
        continue;
      }
      const cle = ligne.lecon_id || "";
      if (!groupes.has(cle)) {
        groupes.set(cle, { concepts: [], date: "" });
      }
      const groupe = groupes.get(cle);
      groupe.concepts.push({
        concept: ligne.pattern_name,
        maitrise: ligne.maitrise || 1,
      });
      /* Date de la page = tentative la plus recente de la lecon. */
      const date = ligne.date_derniere_tentative || "";
      if (date > groupe.date) {
        groupe.date = date;
      }
    }

    const lessonNames = meta.lessonNames || {};
    const entrees = [];
    for (const [lecon_id, groupe] of groupes) {
      const etoiles = groupe.concepts.reduce((s, c) => s + (c.maitrise || 0), 0);
      entrees.push({
        niveau_scolaire: meta.niveau || "",
        lecon_id,
        lecon_nom: lessonNames[lecon_id] || lecon_id,
        date: groupe.date,
        concepts: groupe.concepts,
        etoiles,
        etoiles_max: groupe.concepts.length * 3,
      });
    }
    /* Ordre stable : la lecon la plus recemment travaillee en premiere
       page (a defaut de date, ordre alphabetique de la lecon). */
    entrees.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.lecon_id.localeCompare(b.lecon_id));
    return entrees;
  }

  const coeur = { grouperProgression, STORAGE_KEY };

  /* En Node (tests), on s'arrete au coeur pur : pas de DOM ni de fetch. */
  if (typeof window === "undefined") {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = coeur;
    }
    return;
  }

  /* ---------- Etat du compte (navigateur) ---------- */
  /* decision : null tant que l'utilisateur n'a pas choisi ; "eleve" ou
     "invite" ensuite. Seul l'eleve est persiste (reconnexion au reload) ;
     l'essai libre ne laisse aucune trace de compte. */
  let decision = null;
  let compte = null; /* { token, eleveId, prenom, niveau, codeClasse } */
  let lessonNamesCache = {}; /* niveau -> {lecon_id: nom} deja charges */

  function lireStockage() {
    try {
      const brut = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return brut && brut.token && brut.eleveId ? brut : null;
    } catch (_error) {
      return null;
    }
  }

  function ecrireStockage(valeur) {
    try {
      if (valeur) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(valeur));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_error) {
      /* stockage indisponible : le compte vaut alors pour cette session */
    }
  }

  async function appel(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!response.ok) {
      let message = `${response.status}`;
      try {
        message = (await response.json()).detail || message;
      } catch (_error) {
        /* corps non-JSON : on garde le code */
      }
      const erreur = new Error(message);
      erreur.status = response.status;
      throw erreur;
    }
    return response.json();
  }

  /* ---------- Ecran de connexion ---------- */
  const loginScreen = document.getElementById("login-screen");
  const loginBody = document.getElementById("login-body");
  const loginStatus = document.getElementById("login-status");
  const loginLead = document.getElementById("login-lead");

  /* Sous-titre de l'entete, propre a chaque etape : la phrase d'accueil
     ("...ou lance un essai libre") n'a plus de sens une fois qu'on a choisi
     de rejoindre une classe. Chaque ecran repose donc son propre texte, et
     "" masque la ligne (l'ecran du PIN porte deja sa consigne dans le corps). */
  const LEAD_ACCUEIL = "Rejoins ta classe pour retrouver ta progression, ou lance un essai libre.";
  function setLead(texte) {
    if (!loginLead) {
      return;
    }
    loginLead.textContent = texte || "";
    loginLead.classList.toggle("hidden", !texte);
  }

  let apresChoix = null;

  function afficherEcran() {
    loginScreen?.classList.remove("hidden");
    document.getElementById("start-screen")?.classList.add("hidden");
    document.getElementById("lesson-screen")?.classList.add("hidden");
    document.getElementById("game-screen")?.classList.add("hidden");
  }

  function masquerEcran() {
    loginScreen?.classList.add("hidden");
  }

  function setStatut(texte) {
    if (loginStatus) {
      loginStatus.textContent = texte || "";
    }
  }

  function choisir(mode) {
    decision = mode;
    masquerEcran();
    const suite = apresChoix;
    apresChoix = null;
    if (typeof suite === "function") {
      suite();
    }
  }

  function rendreAccueil() {
    setStatut("");
    setLead(LEAD_ACCUEIL);
    loginBody.innerHTML = `
      <div class="level-actions login-choices">
        <button id="login-rejoindre" class="level-button" type="button">
          <span class="level-sign">&#127979;</span>
          <span class="level-copy">Rejoindre ma classe</span>
        </button>
        <button id="login-invite" class="level-button" type="button">
          <span class="level-sign">&#129517;</span>
          <span class="level-copy">Essai libre</span>
        </button>
      </div>
      <div class="login-liens-adultes">
        <button id="login-enseignant" class="ghost-button login-enseignant-lien" type="button">
          Espace enseignant
        </button>
        <button id="login-parent" class="ghost-button login-enseignant-lien" type="button">
          Espace parent
        </button>
      </div>
    `;
    loginBody.querySelector("#login-rejoindre").addEventListener("click", rendreSaisieCode);
    loginBody.querySelector("#login-invite").addEventListener("click", () => choisir("invite"));
    loginBody.querySelector("#login-enseignant").addEventListener("click", () => {
      window.ParcoursEnseignant?.ouvrir?.();
    });
    loginBody.querySelector("#login-parent").addEventListener("click", () => {
      window.ParcoursParent?.ouvrir?.();
    });
  }

  function rendreSaisieCode() {
    setStatut("");
    setLead("Entre le code que ton enseignant t'a donné.");
    loginBody.innerHTML = `
      <form id="login-code-form" class="login-form" autocomplete="off">
        <label class="login-label" for="login-code-input">Code de ta classe</label>
        <input id="login-code-input" class="login-input" type="text" placeholder="CE1-RENARD-42"
          autocomplete="off" aria-label="Code de la classe" />
        <div class="login-form-actions">
          <button type="submit" class="btn-primary">Voir ma classe</button>
          <button type="button" id="login-retour" class="ghost-button">&#8592; Retour</button>
        </div>
      </form>
    `;
    const input = loginBody.querySelector("#login-code-input");
    input.focus();
    loginBody.querySelector("#login-retour").addEventListener("click", rendreAccueil);
    loginBody.querySelector("#login-code-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = input.value.trim().toUpperCase();
      if (!code) {
        return;
      }
      setStatut("Recherche de ta classe...");
      try {
        const reponse = await appel(`/classe/rejoindre/${encodeURIComponent(code)}`, { method: "GET" });
        /* Le backend renvoie { classe: {...}, eleves: [...] } : les infos de
           la classe sont imbriquees sous `classe`, la liste d'eleves a plat. */
        rendreListeEleves(reponse.classe, reponse.eleves || []);
      } catch (error) {
        setStatut(
          error.status === 404
            ? "Aucune classe avec ce code. Vérifie auprès de ton enseignant."
            : `Impossible de trouver la classe : ${error.message}`,
        );
      }
    });
  }

  function rendreListeEleves(classe, eleves) {
    setStatut(`Classe ${classe.nom} (${classe.niveau_scolaire})`);
    if (!eleves.length) {
      setLead("");
      loginBody.innerHTML = `
        <p class="menu-lead">Cette classe n'a pas encore d'élèves. Demande à ton enseignant de t'ajouter.</p>
        <button type="button" id="login-retour" class="ghost-button">&#8592; Retour</button>
      `;
      loginBody.querySelector("#login-retour").addEventListener("click", rendreSaisieCode);
      return;
    }
    setLead("Choisis ton prénom dans la liste.");
    const boutons = eleves
      .map(
        (eleve) => `
          <button class="lesson-card login-eleve" type="button" data-eleve-id="${eleve.id}">
            <span class="lesson-card-icon" style="background:${couleurAvatar(eleve)};border-color:${bordAvatar(eleve)}">&#128100;</span>
            <span><span class="lesson-card-title">${escapeHtml(eleve.prenom)}</span></span>
          </button>
        `,
      )
      .join("");
    loginBody.innerHTML = `
      <div class="lesson-actions login-eleves">${boutons}</div>
      <button type="button" id="login-retour" class="ghost-button">&#8592; Changer de code</button>
    `;
    loginBody.querySelector("#login-retour").addEventListener("click", rendreSaisieCode);
    loginBody.querySelectorAll(".login-eleve").forEach((bouton) => {
      const eleve = eleves.find((e) => e.id === Number(bouton.dataset.eleveId));
      bouton.addEventListener("click", () => rendrePinPad(classe, eleve, eleves));
    });
  }

  /* Echappement minimal pour injecter un prenom (venu du backend) dans le DOM. */
  function escapeHtml(texte) {
    return String(texte ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  /* Teinte de pastille propre a chaque eleve : deux enfants cote a cote ont
     des avatars de couleur differente, et surtout la MEME couleur revient
     toujours pour le meme eleve (derivee de son id, ou de son prenom a defaut).
     Un enfant qui lit encore mal repere ainsi son avatar sans dechiffrer. */
  function teinteEleve(eleve) {
    const graine = String(eleve?.id ?? eleve?.prenom ?? "");
    let hash = 0;
    for (let i = 0; i < graine.length; i += 1) {
      hash = (hash * 31 + graine.charCodeAt(i)) & 0xffff;
    }
    /* Angle d'or (~137deg) : deux ids voisins (1, 2, 3...) atterrissent a
       l'oppose sur la roue chromatique, jamais sur des teintes voisines. */
    return (hash * 137) % 360; /* teinte 0-359, stable pour cet eleve */
  }
  function couleurAvatar(eleve) {
    return `hsl(${teinteEleve(eleve)}, 62%, 74%)`;
  }
  function bordAvatar(eleve) {
    return `hsl(${teinteEleve(eleve)}, 52%, 52%)`;
  }

  /* Ecran de saisie du PIN : clavier numerique a grandes touches, adapte a un
     enfant. On collecte 4 chiffres (affiches en pastilles) avant de tenter la
     connexion. Un mauvais PIN vide la saisie et affiche un message. */
  function rendrePinPad(classe, eleve, eleves) {
    setStatut(`Bonjour ${eleve.prenom} !`);
    setLead(""); /* la consigne du code secret vit dans le corps ci-dessous */
    let saisie = "";

    const touche = (val, extra = "") =>
      `<button type="button" class="pin-key ${extra}" data-pin="${val}">${val}</button>`;

    loginBody.innerHTML = `
      <p class="menu-lead">Tape ton code secret à 4 chiffres, ${escapeHtml(eleve.prenom)} :</p>
      <div class="pin-dots" id="pin-dots" aria-label="Code à 4 chiffres">
        <span class="pin-dot"></span><span class="pin-dot"></span>
        <span class="pin-dot"></span><span class="pin-dot"></span>
      </div>
      <div class="pin-pad">
        ${touche(1)}${touche(2)}${touche(3)}
        ${touche(4)}${touche(5)}${touche(6)}
        ${touche(7)}${touche(8)}${touche(9)}
        <button type="button" class="pin-key pin-key-action" data-pin="effacer">&#9003;</button>
        ${touche(0)}
        <button type="button" class="pin-key pin-key-valider" data-pin="valider">OK</button>
      </div>
      <button type="button" id="login-retour" class="ghost-button">&#8592; Changer d'élève</button>
    `;

    const dots = loginBody.querySelectorAll(".pin-dot");
    function rafraichir() {
      dots.forEach((d, i) => d.classList.toggle("pin-dot-rempli", i < saisie.length));
    }

    async function valider() {
      if (saisie.length !== 4) {
        setStatut("Il faut 4 chiffres.");
        return;
      }
      await connecterEleve(classe, eleve, saisie, () => {
        /* echec : on remet le pave a zero pour reessayer */
        saisie = "";
        rafraichir();
      });
    }

    loginBody.querySelector("#login-retour").addEventListener("click", () =>
      rendreListeEleves(classe, eleves || [eleve]),
    );
    loginBody.querySelectorAll(".pin-key").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        const val = bouton.dataset.pin;
        if (val === "effacer") {
          saisie = saisie.slice(0, -1);
        } else if (val === "valider") {
          valider();
          return;
        } else if (saisie.length < 4) {
          saisie += val;
        }
        rafraichir();
        if (saisie.length === 4) {
          valider();
        }
      });
    });
  }

  async function connecterEleve(classe, eleve, pin, onEchec) {
    setStatut("Connexion...");
    try {
      const reponse = await appel(`/eleve/${eleve.id}/connexion`, {
        method: "POST",
        body: JSON.stringify({ code_classe: classe.code_classe, pin }),
      });
      compte = {
        token: reponse.token,
        eleveId: reponse.eleve.id,
        prenom: reponse.eleve.prenom,
        niveau: reponse.eleve.niveau_scolaire,
        codeClasse: classe.code_classe,
      };
      ecrireStockage(compte);
      choisir("eleve");
    } catch (error) {
      /* 403 = code secret refuse ; 429 = trop d'essais rapides (anti force
         brute) : dans les deux cas, message d'enfant sans jargon. Le 429 porte
         deja un message rassurant venu du serveur. */
      setStatut(
        error.status === 403
          ? "Code secret incorrect. Réessaie !"
          : error.status === 429
            ? error.message || "Tu vas trop vite ! Attends un instant et réessaie."
            : `Connexion impossible : ${error.message}`,
      );
      if (typeof onEchec === "function") {
        onEchec();
      }
    }
  }

  /* Reconnexion silencieuse au chargement : un jeton en localStorage est
     revalide contre le backend (les jetons vivent en memoire cote serveur
     et sautent a chaque redemarrage). En cas d'echec, on repart propre. */
  async function tenterReconnexion() {
    const stocke = lireStockage();
    if (!stocke) {
      return false;
    }
    try {
      await appel(`/eleve/${stocke.eleveId}/progression`, {
        method: "GET",
        headers: { Authorization: `Bearer ${stocke.token}` },
      });
      compte = stocke;
      return true;
    } catch (_error) {
      ecrireStockage(null);
      return false;
    }
  }

  /* Point d'entree appele par map.js au demarrage : garantit qu'un choix
     (eleve reconnecte ou ecran affiche) est fait avant de continuer. */
  async function demarrerConnexion(suite) {
    apresChoix = suite;
    if (await tenterReconnexion()) {
      choisir("eleve");
      return;
    }
    afficherEcran();
    rendreAccueil();
  }

  function deconnecter() {
    compte = null;
    decision = null;
    ecrireStockage(null);
  }

  /* Noms lisibles des lecons d'un niveau (pour titrer les pages du carnet),
     charges une fois puis memorises. */
  async function chargerNomsLecons(niveau) {
    if (lessonNamesCache[niveau]) {
      return lessonNamesCache[niveau];
    }
    try {
      const payload = await appel(`/lecons/${niveau}`, { method: "GET" });
      const noms = {};
      for (const lecon of payload.lecons || []) {
        noms[lecon.lecon_id] = lecon.nom;
      }
      lessonNamesCache[niveau] = noms;
      return noms;
    } catch (_error) {
      return {};
    }
  }

  /* Pages du carnet d'un eleve connecte, construites depuis la base
     (remplace la lecture localStorage du mode invite). */
  async function chargerEntreesCarnet() {
    if (!compte) {
      return [];
    }
    const payload = await appel(`/eleve/${compte.eleveId}/progression`, {
      method: "GET",
      headers: { Authorization: `Bearer ${compte.token}` },
    });
    const lessonNames = await chargerNomsLecons(compte.niveau);
    return grouperProgression(payload.progression || [], {
      niveau: compte.niveau,
      lessonNames,
    });
  }

  /* Assignations en attente de l'eleve connecte (travaux prepares par
     l'enseignant). Best-effort : une erreur ne casse jamais le demarrage. */
  async function chargerAssignations() {
    if (!compte) {
      return [];
    }
    try {
      const payload = await appel(`/eleve/${compte.eleveId}/assignations`, {
        method: "GET",
        headers: { Authorization: `Bearer ${compte.token}` },
      });
      return payload.assignations || [];
    } catch (_error) {
      return [];
    }
  }

  /* Faiblesses REELLES de l'eleve connecte, derivees de sa progression en base
     (concepts sous la maitrise 3), les plus anciennes d'abord. Remplace, pour
     un eleve connecte, les faiblesses localStorage (partagees par appareil).
     Best-effort : une erreur renvoie une liste vide (pas de revision proposee). */
  async function chargerFaiblesses() {
    if (!compte) {
      return [];
    }
    try {
      const payload = await appel(`/eleve/${compte.eleveId}/progression`, {
        method: "GET",
        headers: { Authorization: `Bearer ${compte.token}` },
      });
      return (payload.progression || [])
        .filter((ligne) => (ligne.maitrise || 1) < 3 && ligne.pattern_name)
        .sort((a, b) =>
          String(a.date_derniere_tentative || "").localeCompare(String(b.date_derniere_tentative || "")),
        )
        .map((ligne) => ligne.pattern_name);
    } catch (_error) {
      return [];
    }
  }

  /* Garde-robe/etoiles de l'eleve connecte, depuis la base (GET). Renvoie null
     en cas d'echec pour que le frontend garde son etat courant plutot que de
     l'ecraser par un defaut. */
  async function chargerPersonnage() {
    if (!compte) {
      return null;
    }
    try {
      return await appel(`/eleve/${compte.eleveId}/personnage`, {
        method: "GET",
        headers: { Authorization: `Bearer ${compte.token}` },
      });
    } catch (_error) {
      return null;
    }
  }

  /* Sauvegarde best-effort de la garde-robe (PUT). Le backend ne fait jamais
     regresser le total d'etoiles ; un echec reseau ne casse jamais le jeu. */
  async function sauverPersonnage(etat) {
    if (!compte || !etat) {
      return null;
    }
    try {
      return await appel(`/eleve/${compte.eleveId}/personnage`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${compte.token}` },
        body: JSON.stringify({
          etoiles_totales: Math.max(0, Math.floor(etat.etoiles_totales || 0)),
          couleur: etat.couleur || "bleu",
          accessoire: etat.accessoire || "aucun",
        }),
      });
    } catch (_error) {
      return null;
    }
  }

  window.ParcoursCompte = {
    demarrerConnexion,
    aDecide: () => decision !== null,
    estEleve: () => decision === "eleve" && Boolean(compte),
    getToken: () => (compte ? compte.token : null),
    getEleveId: () => (compte ? compte.eleveId : null),
    getNiveau: () => (compte ? compte.niveau : null),
    getPrenom: () => (compte ? compte.prenom : null),
    deconnecter,
    chargerEntreesCarnet,
    chargerAssignations,
    chargerFaiblesses,
    chargerPersonnage,
    sauverPersonnage,
    /* Exposes pour les tests / l'affichage */
    grouperProgression,
  };
})();
