/* ============================================================
   ESPACE ENSEIGNANT
   Point d'entree separe du flux eleve (lien "Espace enseignant" sur
   l'ecran de connexion, et URL #enseignant) : inscription, connexion,
   et tableau de bord de gestion des classes (creation, code a
   partager, ajout/retrait d'eleves).

   Volontairement plus sobre que l'univers du jeu : c'est un outil pour
   adultes, sans decor. Il reutilise la meme palette / police via les
   classes de menu existantes.

   Le jeton enseignant vit en localStorage sous une cle DISTINCTE de
   celle de l'eleve (parcours_enseignant_v1), avec reconnexion
   silencieuse au chargement, comme cote eleve (compte.js).

   Le coeur pur (validation de formulaire, libelles d'erreur) s'exporte
   en Node pour les tests (test_enseignant.js).
   ============================================================ */
(function () {
  const API_BASE = "https://parcours-maths-ia.onrender.com";
  const STORAGE_KEY = "parcours_enseignant_v1";
  const NIVEAUX = ["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"];
  /* Mot exact a taper pour armer une suppression definitive d'eleve (miroir de
     CONFIRMATION_SUPPRESSION_ELEVE cote backend). Une ecole se confirme, elle,
     par son NOM exact (garde-fou encore plus fort). */
  const CONFIRMATION_SUPPRESSION = "SUPPRIMER";

  /* ---------- Coeur pur (testable sans navigateur) ---------- */

  /* Valide un formulaire d'inscription cote client, en miroir des
     contraintes du backend (nom >= 1, identifiant >= 3, mot de passe >= 6).
     Renvoie un message d'erreur lisible, ou null si tout est valide. */
  function validerInscription({ nom, identifiant, mot_de_passe } = {}) {
    if (!nom || !nom.trim()) {
      return "Indique ton nom.";
    }
    if (!identifiant || identifiant.trim().length < 3) {
      return "L'identifiant doit faire au moins 3 caractères.";
    }
    if (!mot_de_passe || mot_de_passe.length < 6) {
      return "Le mot de passe doit faire au moins 6 caractères.";
    }
    return null;
  }

  /* Message d'erreur affichable : le detail renvoye par le backend prime
     (deja en francais), sinon on retombe sur un libelle par code HTTP. */
  function libelleErreur(status, detail) {
    if (detail) {
      return detail;
    }
    switch (status) {
      case 401:
        return "Identifiant ou mot de passe incorrect.";
      case 409:
        return "Cet identifiant est déjà pris.";
      case 400:
        return "Niveau scolaire invalide.";
      default:
        return "Une erreur est survenue. Réessaie.";
    }
  }

  /* Terminologie identique au bilan de session cote eleve (carnet.js). */
  const BADGES_MAITRISE = { 1: "À retravailler", 2: "En bonne voie", 3: "Acquis" };

  /* Eleves tries du plus en difficulte au moins (plus de concepts en maitrise 1
     d'abord), puis par prenom. Fonction pure -> nouvelle liste. */
  function trierElevesParDifficulte(eleves) {
    return [...(Array.isArray(eleves) ? eleves : [])].sort(
      (a, b) =>
        (b.nb_a_retravailler || 0) - (a.nb_a_retravailler || 0) ||
        String(a.prenom || "").localeCompare(String(b.prenom || "")),
    );
  }

  /* Les n concepts qui bloquent le plus d'eleves (maitrise 1) dans la classe.
     Le backend trie deja ; on re-trie par securite et on tronque. */
  function conceptsLesPlusDifficiles(concepts, n = 3) {
    return [...(Array.isArray(concepts) ? concepts : [])]
      .filter((c) => (c.nb_eleves_en_difficulte || 0) > 0)
      .sort((a, b) => (b.nb_eleves_en_difficulte || 0) - (a.nb_eleves_en_difficulte || 0))
      .slice(0, n);
  }

  const coeur = {
    validerInscription,
    libelleErreur,
    NIVEAUX,
    BADGES_MAITRISE,
    trierElevesParDifficulte,
    conceptsLesPlusDifficiles,
  };

  if (typeof window === "undefined") {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = coeur;
    }
    return;
  }

  /* ---------- Etat (navigateur) ---------- */
  let token = null;
  let enseignant = null; /* { id, nom } */
  let classes = []; /* [{ id, nom, niveau_scolaire, code_classe, nb_eleves }] */

  /* Rafraichissement automatique leger du tableau de bord : tant que l'ecran
     reste ouvert, on re-interroge le backend a intervalle regulier pour voir
     progresser un eleve qui joue en meme temps, sans rechargement manuel. Un
     simple setTimeout re-arme (pas de WebSocket : le volume ne le justifie pas). */
  const INTERVALLE_TABLEAU_BORD_MS = 45000; /* ~45 s, dans la fourchette 30-60 s */
  let timerTableauBord = null;

  function arreterRafraichissementTableauBord() {
    if (timerTableauBord !== null) {
      clearTimeout(timerTableauBord);
      timerTableauBord = null;
    }
  }

  function lireStockage() {
    try {
      const brut = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return brut && brut.token ? brut : null;
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
      /* stockage indisponible : la session vaut pour cet onglet */
    }
  }

  async function appel(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (response.status === 204) {
      return null;
    }
    let corps = null;
    try {
      corps = await response.json();
    } catch (_error) {
      corps = null;
    }
    if (!response.ok) {
      const erreur = new Error(libelleErreur(response.status, corps && corps.detail));
      erreur.status = response.status;
      throw erreur;
    }
    return corps;
  }

  /* ---------- Operations (donnees, sans rendu : testables via harnais) ---------- */
  async function sinscrire({ nom, identifiant, mot_de_passe, code_invitation }) {
    const corps = { nom, identifiant, mot_de_passe };
    /* Avec un code d'invitation : on rejoint l'ecole invitante (enseignant
       simple). Sans code : on fonde sa propre ecole (administrateur). */
    if (code_invitation) {
      corps.code_invitation = code_invitation;
    }
    await appel("/enseignant/inscription", {
      method: "POST",
      body: JSON.stringify(corps),
    });
    /* Inscription reussie -> connexion immediate pour enchainer sur le tableau
       de bord sans redemander les identifiants. */
    return seConnecter({ identifiant, mot_de_passe });
  }

  async function seConnecter({ identifiant, mot_de_passe }) {
    const reponse = await appel("/enseignant/connexion", {
      method: "POST",
      body: JSON.stringify({ identifiant, mot_de_passe }),
    });
    token = reponse.token;
    enseignant = reponse.enseignant;
    ecrireStockage({ token, enseignant });
    return enseignant;
  }

  /* Mode demo : cree une ecole de demonstration pre-remplie cote backend et
     connecte immediatement l'appelant dessus (le backend renvoie un token,
     comme une connexion). L'objet enseignant porte est_demo/expire_le : le
     tableau de bord affichera alors son bandeau "Mode démo". */
  async function demarrerDemo() {
    const reponse = await appel("/demo/creer", { method: "POST" });
    token = reponse.token;
    enseignant = reponse.enseignant;
    ecrireStockage({ token, enseignant });
    afficherEcran();
    if (window.location.hash !== "#enseignant") {
      window.location.hash = "enseignant";
    }
    await vueDashboard();
    return enseignant;
  }

  async function chargerClasses() {
    const reponse = await appel("/classe", { method: "GET" });
    classes = reponse.classes || [];
    return classes;
  }

  /* Vrai si le compte connecte est administrateur de son ecole (la seule
     source de verite pour afficher/masquer la vue etablissement). */
  function estAdmin() {
    return Boolean(enseignant && enseignant.role === "administrateur");
  }

  /* ---------- Operations administrateur d'ecole (role administrateur) ---------- */
  async function chargerClassesEcole() {
    const reponse = await appel("/ecole/classes", { method: "GET" });
    return reponse.classes || [];
  }

  async function chargerEnseignantsEcole() {
    /* Renvoie l'objet complet : la liste des enseignants ET le nom de l'ecole
       (utilise comme confirmation litterale pour la suppression de l'ecole). */
    return appel("/ecole/enseignants", { method: "GET" });
  }

  async function inviterEnseignant() {
    // Aucune donnee sur le destinataire n'est envoyee ni stockee (minimisation) :
    // le code d'invitation suffit, n'importe quel identifiant peut le consommer.
    return appel("/ecole/enseignants/inviter", { method: "POST" });
  }

  async function changerRole(enseignantId, role) {
    return appel(`/ecole/enseignants/${enseignantId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
  }

  async function creerClasse({ nom, niveau_scolaire }) {
    const classe = await appel("/classe", {
      method: "POST",
      body: JSON.stringify({ nom, niveau_scolaire }),
    });
    await chargerClasses();
    return classe;
  }

  async function chargerEleves(classeId) {
    return appel(`/classe/${classeId}/eleves`, { method: "GET" });
  }

  async function ajouterEleve(classeId, prenom) {
    return appel(`/classe/${classeId}/eleve`, {
      method: "POST",
      body: JSON.stringify({ prenom }),
    });
  }

  async function retirerEleve(classeId, eleveId) {
    return appel(`/classe/${classeId}/eleve/${eleveId}`, { method: "DELETE" });
  }

  /* Suppression DEFINITIVE et irreversible des donnees d'un eleve (droit a
     l'effacement). Exige la confirmation litterale attendue par le backend. */
  async function supprimerEleveDefinitif(classeId, eleveId, confirmation) {
    return appel(`/classe/${classeId}/eleve/${eleveId}/suppression`, {
      method: "POST",
      body: JSON.stringify({ confirmation }),
    });
  }

  /* Suppression DEFINITIVE de l'ecole entiere (administrateur). La confirmation
     attendue est le NOM exact de l'ecole. */
  async function supprimerEcole(confirmation) {
    return appel("/ecole/suppression", {
      method: "POST",
      body: JSON.stringify({ confirmation }),
    });
  }

  /* Regenere le PIN d'un eleve : renvoie { id, prenom, pin } (nouveau PIN en
     clair, une seule fois). L'ancien cesse aussitot de fonctionner. */
  async function reinitialiserPin(classeId, eleveId) {
    return appel(`/classe/${classeId}/eleve/${eleveId}/reinitialiser_pin`, { method: "POST" });
  }

  /* (Re)genere le code d'acces parent d'un eleve : renvoie { id, prenom,
     code_parent } (nouveau code en clair, une seule fois). L'ancien cesse
     aussitot de donner acces au suivi. */
  async function regenererCodeParent(classeId, eleveId) {
    return appel(`/classe/${classeId}/eleve/${eleveId}/code_parent`, { method: "POST" });
  }

  async function chargerTableauDeBord(classeId) {
    return appel(`/classe/${classeId}/tableau_de_bord`, { method: "GET" });
  }

  async function chargerConceptsDifficiles(classeId) {
    return appel(`/classe/${classeId}/concepts_difficiles`, { method: "GET" });
  }

  /* Rapport d'apprentissage redige par IA pour un eleve (ton enseignant). Peut
     prendre quelques secondes (appel LLM cote serveur). */
  async function chargerRapportIa(classeId, eleveId) {
    return appel(`/classe/${classeId}/rapport_ia/${eleveId}`, { method: "GET" });
  }

  async function chargerLecons(niveau) {
    const payload = await appel(`/lecons/${niveau}`, { method: "GET" });
    return payload.lecons || [];
  }

  async function assignerTravail(classeId, payload) {
    return appel(`/classe/${classeId}/assigner`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async function chargerAssignationsClasse(classeId) {
    return appel(`/classe/${classeId}/assignations`, { method: "GET" });
  }

  const _nomsLeconsCache = {};
  async function chargerNomsLecons(niveau) {
    if (_nomsLeconsCache[niveau]) {
      return _nomsLeconsCache[niveau];
    }
    try {
      const payload = await appel(`/lecons/${niveau}`, { method: "GET" });
      const noms = {};
      for (const lecon of payload.lecons || []) {
        noms[lecon.lecon_id] = lecon.nom;
      }
      _nomsLeconsCache[niveau] = noms;
      return noms;
    } catch (_error) {
      return {};
    }
  }

  function deconnecter() {
    arreterRafraichissementTableauBord();
    token = null;
    enseignant = null;
    classes = [];
    ecrireStockage(null);
  }

  async function tenterReconnexion() {
    const stocke = lireStockage();
    if (!stocke) {
      return false;
    }
    token = stocke.token;
    enseignant = stocke.enseignant;
    try {
      await chargerClasses(); /* revalide le jeton contre le backend */
      return true;
    } catch (_error) {
      deconnecter();
      return false;
    }
  }

  /* ---------- Rendu (navigateur) ---------- */
  const screen = document.getElementById("enseignant-screen");
  const body = document.getElementById("enseignant-body");
  const statusLine = document.getElementById("enseignant-status");

  function setStatut(texte, type) {
    if (!statusLine) {
      return;
    }
    statusLine.textContent = texte || "";
    statusLine.className = `menu-note${type ? ` ${type}` : ""}`;
  }

  function echapper(texte) {
    return String(texte).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  function formaterDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  /* Nombre d'heures (arrondi au superieur) avant l'expiration d'une demo, ou 0
     si la date est passee/invalide. Sert au libelle du bandeau. */
  function heuresRestantes(iso) {
    const fin = new Date(iso).getTime();
    if (Number.isNaN(fin)) {
      return 0;
    }
    return Math.max(0, Math.ceil((fin - Date.now()) / 3600000));
  }

  /* Bandeau discret mais visible rappelant qu'on est sur un COMPTE DE DEMO
     ephemere. Vide (aucun bandeau) pour un vrai compte. */
  function bandeauDemoMarkup() {
    if (!enseignant?.est_demo || !enseignant.expire_le) {
      return "";
    }
    const restant = heuresRestantes(enseignant.expire_le);
    const echeance =
      restant > 0
        ? `expire dans ${restant} heure${restant > 1 ? "s" : ""}`
        : "expiration imminente";
    return `
      <div class="teacher-demo-banner" role="status">
        <span class="teacher-demo-badge">Mode démo</span>
        <span class="teacher-demo-text">Compte de démonstration (${echeance}) — les données sont fictives et seront effacées automatiquement.</span>
      </div>
    `;
  }

  /* Libelle lisible d'un concept : on reutilise ceux du carnet eleve quand il
     est charge, sinon un repli lisible (underscores -> espaces). */
  function libelleConcept(pattern) {
    const viaCarnet = window.ParcoursCarnet?.conceptLabel?.(pattern);
    return viaCarnet || String(pattern || "").replace(/_/g, " ");
  }

  /* Pastilles de decompte par niveau de maitrise (memes libelles que le bilan
     eleve : Acquis / En bonne voie / A retravailler). */
  function badgesMarkup(eleve) {
    const item = (niveau, nb) =>
      `<span class="teacher-badge niveau-${niveau}" title="${BADGES_MAITRISE[niveau]}">${nb}<span class="teacher-badge-txt"> ${BADGES_MAITRISE[niveau]}</span></span>`;
    return `
      <span class="teacher-badges">
        ${item(3, eleve.nb_acquis || 0)}
        ${item(2, eleve.nb_en_cours || 0)}
        ${item(1, eleve.nb_a_retravailler || 0)}
      </span>
    `;
  }

  function afficherEcran() {
    screen?.classList.remove("hidden");
    ["login-screen", "start-screen", "lesson-screen", "game-screen", "theme-screen"].forEach((id) =>
      document.getElementById(id)?.classList.add("hidden"),
    );
  }

  /* --- Vue : connexion --- */
  function vueConnexion() {
    setStatut("");
    body.innerHTML = `
      <form id="ens-connexion" class="login-form teacher-form" autocomplete="off">
        <label class="login-label" for="ens-identifiant">Identifiant</label>
        <input id="ens-identifiant" class="login-input teacher-input" type="text" autocomplete="username" />
        <label class="login-label" for="ens-mdp">Mot de passe</label>
        <input id="ens-mdp" class="login-input teacher-input" type="password" autocomplete="current-password" />
        <div class="login-form-actions">
          <button type="submit" class="btn-primary">Se connecter</button>
          <button type="button" id="ens-vers-inscription" class="ghost-button">Créer un compte</button>
        </div>
      </form>
      <button type="button" id="ens-retour-jeu" class="ghost-button teacher-back">&#8592; Retour au jeu</button>
    `;
    body.querySelector("#ens-vers-inscription").addEventListener("click", vueInscription);
    body.querySelector("#ens-retour-jeu").addEventListener("click", retourAuJeu);
    body.querySelector("#ens-connexion").addEventListener("submit", async (event) => {
      event.preventDefault();
      const identifiant = body.querySelector("#ens-identifiant").value.trim();
      const mot_de_passe = body.querySelector("#ens-mdp").value;
      if (!identifiant || !mot_de_passe) {
        setStatut("Renseigne ton identifiant et ton mot de passe.", "erreur");
        return;
      }
      setStatut("Connexion...");
      try {
        await seConnecter({ identifiant, mot_de_passe });
        await vueDashboard();
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* --- Vue : inscription --- */
  function vueInscription() {
    setStatut("");
    body.innerHTML = `
      <form id="ens-inscription" class="login-form teacher-form" autocomplete="off">
        <label class="login-label" for="ens-nom">Nom</label>
        <input id="ens-nom" class="login-input teacher-input" type="text" autocomplete="name" />
        <label class="login-label" for="ens-new-identifiant">Identifiant</label>
        <input id="ens-new-identifiant" class="login-input teacher-input" type="text" autocomplete="username" />
        <label class="login-label" for="ens-new-mdp">Mot de passe (6 caractères min.)</label>
        <input id="ens-new-mdp" class="login-input teacher-input" type="password" autocomplete="new-password" />
        <label class="login-label" for="ens-code-invitation">Code d'invitation (optionnel)</label>
        <input id="ens-code-invitation" class="login-input teacher-input" type="text" placeholder="Pour rejoindre une école existante" autocomplete="off" />
        <p class="teacher-hint">Sans code, vous créez votre propre établissement et en devenez l'administrateur.</p>
        <div class="login-form-actions">
          <button type="submit" class="btn-primary">Créer mon compte</button>
          <button type="button" id="ens-vers-connexion" class="ghost-button">J'ai déjà un compte</button>
        </div>
      </form>
      <button type="button" id="ens-retour-jeu" class="ghost-button teacher-back">&#8592; Retour au jeu</button>
    `;
    body.querySelector("#ens-vers-connexion").addEventListener("click", vueConnexion);
    body.querySelector("#ens-retour-jeu").addEventListener("click", retourAuJeu);
    body.querySelector("#ens-inscription").addEventListener("submit", async (event) => {
      event.preventDefault();
      const donnees = {
        nom: body.querySelector("#ens-nom").value.trim(),
        identifiant: body.querySelector("#ens-new-identifiant").value.trim(),
        mot_de_passe: body.querySelector("#ens-new-mdp").value,
        code_invitation: body.querySelector("#ens-code-invitation").value.trim(),
      };
      const probleme = validerInscription(donnees);
      if (probleme) {
        setStatut(probleme, "erreur");
        return;
      }
      setStatut("Création du compte...");
      try {
        await sinscrire(donnees);
        await vueDashboard();
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* --- Vue : tableau de bord (liste des classes) --- */
  async function vueDashboard() {
    setStatut("Chargement de vos classes...");
    try {
      await chargerClasses();
    } catch (error) {
      setStatut(error.message, "erreur");
      return;
    }
    const entete = `
      <div class="teacher-topbar">
        <p class="teacher-hello">Bonjour ${echapper(enseignant?.nom || "")}</p>
        <div class="teacher-topbar-actions">
          ${estAdmin() ? `<button type="button" id="ens-etablissement" class="ghost-button">Mon établissement</button>` : ""}
          <button type="button" id="ens-deconnexion" class="ghost-button">Se déconnecter</button>
        </div>
      </div>
    `;
    const cartes = classes.length
      ? classes
          .map(
            (c) => `
        <div class="teacher-class-card" data-classe-id="${c.id}" role="button" tabindex="0">
          <div class="teacher-class-main">
            <span class="teacher-class-name">${echapper(c.nom)}</span>
            <span class="hud-level">${c.niveau_scolaire}</span>
          </div>
          <div class="teacher-class-meta">
            <span>${c.nb_eleves} élève${c.nb_eleves > 1 ? "s" : ""}</span>
          </div>
          <div class="teacher-code-row">
            <span class="teacher-code" title="Code à communiquer aux élèves">${c.code_classe}</span>
            <button type="button" class="ghost-button teacher-copy" data-code="${c.code_classe}">Copier</button>
          </div>
        </div>
      `,
          )
          .join("")
      : `<p class="menu-lead">Aucune classe pour l'instant. Crée ta première classe ci-dessous.</p>`;

    body.innerHTML = `
      ${bandeauDemoMarkup()}
      ${entete}
      <div class="teacher-classes">${cartes}</div>
      <form id="ens-creer-classe" class="teacher-create login-form" autocomplete="off">
        <h2 class="teacher-subtitle">Créer une classe</h2>
        <div class="teacher-create-row">
          <input id="ens-classe-nom" class="login-input teacher-input" type="text" placeholder="Nom de la classe" />
          <select id="ens-classe-niveau" class="login-input teacher-input">
            ${NIVEAUX.map((n) => `<option value="${n}">${n}</option>`).join("")}
          </select>
          <button type="submit" class="btn-primary">Créer</button>
        </div>
      </form>
      <button type="button" id="ens-retour-jeu" class="ghost-button teacher-back">&#8592; Retour au jeu</button>
    `;
    setStatut("");

    body.querySelector("#ens-deconnexion").addEventListener("click", () => {
      deconnecter();
      vueConnexion();
    });
    const boutonEtablissement = body.querySelector("#ens-etablissement");
    if (boutonEtablissement) {
      boutonEtablissement.addEventListener("click", () => vueEtablissement());
    }
    body.querySelector("#ens-retour-jeu").addEventListener("click", retourAuJeu);
    body.querySelectorAll(".teacher-copy").forEach((bouton) => {
      bouton.addEventListener("click", (event) => {
        event.stopPropagation();
        copierCode(bouton.dataset.code);
      });
    });
    body.querySelectorAll(".teacher-class-card").forEach((carte) => {
      const ouvrirDetail = () => vueClasseDetail(Number(carte.dataset.classeId));
      carte.addEventListener("click", ouvrirDetail);
      carte.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ouvrirDetail();
        }
      });
    });
    body.querySelector("#ens-creer-classe").addEventListener("submit", async (event) => {
      event.preventDefault();
      const nom = body.querySelector("#ens-classe-nom").value.trim();
      const niveau_scolaire = body.querySelector("#ens-classe-niveau").value;
      if (!nom) {
        setStatut("Donne un nom à la classe.", "erreur");
        return;
      }
      setStatut("Création de la classe...");
      try {
        const classe = await creerClasse({ nom, niveau_scolaire });
        await vueDashboard();
        setStatut(`Classe créée ! Code à partager : ${classe.code_classe}`, "succes");
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  async function copierCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setStatut(`Code ${code} copié !`, "succes");
    } catch (_error) {
      setStatut(`Code à partager : ${code}`, "");
    }
  }

  /* --- Vue : Mon établissement (administrateur uniquement) ---
     Vue distincte de la vue enseignant : toutes les classes de l'ecole (avec
     leur enseignant responsable), la liste des enseignants (avec promotion),
     et l'invitation d'un nouvel enseignant. Un enseignant simple n'y accede
     jamais (bouton absent + endpoints proteges cote serveur). */
  async function vueEtablissement() {
    if (!estAdmin()) {
      return vueDashboard();
    }
    setStatut("Chargement de l'établissement...");
    let classesEcole = [];
    let infoEnseignants = { enseignants: [], ecole_nom: "" };
    try {
      [classesEcole, infoEnseignants] = await Promise.all([
        chargerClassesEcole(),
        chargerEnseignantsEcole(),
      ]);
    } catch (error) {
      setStatut(error.message, "erreur");
      return;
    }
    const enseignants = infoEnseignants.enseignants || [];
    const ecoleNom = infoEnseignants.ecole_nom || "";

    const cartesClasses = classesEcole.length
      ? classesEcole
          .map(
            (c) => `
        <div class="teacher-class-card admin-class-card">
          <div class="teacher-class-main">
            <span class="teacher-class-name">${echapper(c.nom)}</span>
            <span class="hud-level">${c.niveau_scolaire}</span>
          </div>
          <div class="teacher-class-meta">
            <span>Enseignant : ${echapper(c.enseignant?.nom || "—")}</span>
            <span>${c.nb_eleves} élève${c.nb_eleves > 1 ? "s" : ""}</span>
          </div>
          <div class="teacher-code-row">
            <span class="teacher-code">${c.code_classe}</span>
          </div>
        </div>`,
          )
          .join("")
      : `<p class="menu-lead">Aucune classe dans l'établissement pour l'instant.</p>`;

    const lignesEnseignants = enseignants
      .map((e) => {
        const admin = e.role === "administrateur";
        const badge = admin
          ? `<span class="role-badge role-admin">Administrateur</span>`
          : `<span class="role-badge role-ens">Enseignant</span>`;
        const actionLabel = admin ? "Rétrograder" : "Promouvoir admin";
        const nouveauRole = admin ? "enseignant" : "administrateur";
        return `
        <li class="admin-teacher-row">
          <div class="admin-teacher-id">
            <span class="admin-teacher-name">${echapper(e.nom)}${e.est_moi ? " (vous)" : ""}</span>
            <span class="admin-teacher-login">${echapper(e.identifiant)} · ${e.nb_classes} classe${e.nb_classes > 1 ? "s" : ""}</span>
          </div>
          ${badge}
          <button type="button" class="ghost-button admin-role-btn" data-id="${e.id}" data-role="${nouveauRole}">${actionLabel}</button>
        </li>`;
      })
      .join("");

    body.innerHTML = `
      <div class="teacher-topbar">
        <p class="teacher-hello">Mon établissement</p>
        <button type="button" id="ens-retour-classes" class="ghost-button">&#8592; Mes classes</button>
      </div>
      <section class="admin-section">
        <h2 class="teacher-subtitle">Classes de l'établissement (${classesEcole.length})</h2>
        <div class="teacher-classes">${cartesClasses}</div>
      </section>
      <section class="admin-section">
        <h2 class="teacher-subtitle">Enseignants (${enseignants.length})</h2>
        <ul class="admin-teacher-list">${lignesEnseignants}</ul>
      </section>
      <section class="admin-section">
        <h2 class="teacher-subtitle">Inviter un enseignant</h2>
        <form id="ens-inviter" class="teacher-create login-form" autocomplete="off">
          <div class="teacher-create-row">
            <button type="submit" class="btn-primary">Générer un code</button>
          </div>
        </form>
        <div id="ens-invite-resultat" class="admin-invite-result"></div>
      </section>
      <section class="admin-section admin-danger-zone">
        <h2 class="teacher-subtitle">Zone de danger</h2>
        <p class="teacher-danger-text">
          <strong>Supprimer définitivement l'établissement.</strong>
          Cette action efface l'école <em>${echapper(ecoleNom)}</em> et TOUTES ses
          données : tous les enseignants, toutes les classes, tous les élèves et
          leurs progressions. Elle est irréversible. Pour confirmer, tapez le nom
          exact de l'établissement ci-dessous.
        </p>
        <div class="teacher-danger-row">
          <input id="ens-ecole-confirm" class="login-input teacher-input teacher-danger-input" type="text" placeholder="${echapper(ecoleNom)}" autocomplete="off" />
          <button type="button" id="ens-supprimer-ecole" class="btn-danger" disabled>Supprimer l'établissement</button>
        </div>
      </section>
      <button type="button" id="ens-retour-jeu" class="ghost-button teacher-back">&#8592; Retour au jeu</button>
    `;
    setStatut("");

    const champEcole = body.querySelector("#ens-ecole-confirm");
    const btnEcole = body.querySelector("#ens-supprimer-ecole");
    champEcole.addEventListener("input", () => {
      btnEcole.disabled = champEcole.value.trim() !== ecoleNom;
    });
    btnEcole.addEventListener("click", async () => {
      if (champEcole.value.trim() !== ecoleNom) {
        return;
      }
      btnEcole.disabled = true;
      setStatut("Suppression de l'établissement...");
      try {
        await supprimerEcole(champEcole.value.trim());
        /* L'ecole (et ce compte admin) n'existent plus : on quitte proprement. */
        deconnecter();
        setStatut("L'établissement a été définitivement supprimé.", "succes");
        vueConnexion();
      } catch (error) {
        btnEcole.disabled = false;
        setStatut(error.message, "erreur");
      }
    });

    body.querySelector("#ens-retour-classes").addEventListener("click", () => vueDashboard());
    body.querySelector("#ens-retour-jeu").addEventListener("click", retourAuJeu);

    body.querySelectorAll(".admin-role-btn").forEach((bouton) => {
      bouton.addEventListener("click", async () => {
        bouton.disabled = true;
        try {
          const maj = await changerRole(Number(bouton.dataset.id), bouton.dataset.role);
          setStatut(`${maj.nom} est désormais ${maj.role}.`, "succes");
          await vueEtablissement();
        } catch (error) {
          bouton.disabled = false;
          setStatut(error.message, "erreur");
        }
      });
    });

    body.querySelector("#ens-inviter").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatut("Génération du code d'invitation...");
      try {
        const invitation = await inviterEnseignant();
        setStatut("Code d'invitation généré.", "succes");
        const zone = body.querySelector("#ens-invite-resultat");
        zone.innerHTML = `
          <p class="admin-invite-lead">Transmettez ce code au nouvel enseignant. Il le saisira à la création de son compte pour rejoindre l'établissement (à usage unique).</p>
          <div class="teacher-code-row">
            <span class="teacher-code">${echapper(invitation.code)}</span>
            <button type="button" class="ghost-button teacher-copy" data-code="${echapper(invitation.code)}">Copier</button>
          </div>`;
        zone.querySelector(".teacher-copy").addEventListener("click", () => copierCode(invitation.code));
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* Telecharge l'export Excel de la classe. Le fichier est binaire et l'endpoint
     est protege : on ne peut pas utiliser un simple lien <a href> (pas d'en-tete
     Authorization). On recupere donc le blob par fetch authentifie, puis on
     declenche le telechargement via une URL objet temporaire. */
  async function exporterExcel(classe) {
    setStatut("Préparation de l'export Excel...");
    let response;
    try {
      response = await fetch(`${API_BASE}/classe/${classe.id}/export_excel`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch (error) {
      setStatut(`Export impossible : ${error.message}`, "erreur");
      return;
    }
    if (!response.ok) {
      setStatut(libelleErreur(response.status), "erreur");
      return;
    }
    const blob = await response.blob();
    /* Nom de fichier : celui propose par le serveur (Content-Disposition), avec
       un repli lisible si l'en-tete n'est pas expose. */
    const dispo = response.headers.get("Content-Disposition") || "";
    const match = dispo.match(/filename="?([^"]+)"?/);
    const nomFichier = match ? match[1] : `classe_${classe.code_classe}_export.xlsx`;
    const url = URL.createObjectURL(blob);
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
    setStatut(`Export téléchargé : ${nomFichier}`, "succes");
  }

  /* Statut des travaux assignes (qui a termine, qui pas encore). noms = table
     lecon_id -> nom lisible, pour ne pas afficher d'identifiant technique. */
  function assignationsStatutMarkup(assignations, noms) {
    if (!assignations.length) {
      return "";
    }
    const item = (a) => {
      const label =
        a.type === "revision"
          ? `Révision : ${(a.patterns || []).map(libelleConcept).join(", ")}`
          : noms[a.lecon_id] || a.lecon_id || "Leçon";
      const statut = a.terminee
        ? `<span class="assign-statut assign-faite">Terminé</span>`
        : `<span class="assign-statut assign-attente">En attente</span>`;
      return `
        <li class="assign-ligne">
          <span class="assign-eleve">${echapper(a.prenom)}</span>
          <span class="assign-travail">${echapper(label)}</span>
          ${statut}
        </li>`;
    };
    return `
      <div class="teacher-assign-statut">
        <h3 class="teacher-subtitle">Travaux assignés</h3>
        <ul class="assign-liste">${assignations.map(item).join("")}</ul>
      </div>`;
  }

  /* --- Vue : detail d'une classe (eleves) --- */
  async function vueClasseDetail(classeId) {
    setStatut("Chargement des élèves...");
    let donnees;
    let assignations = [];
    let noms = {};
    try {
      donnees = await chargerEleves(classeId);
      /* Best-effort : le statut des assignations ne doit pas bloquer la vue. */
      noms = await chargerNomsLecons(donnees.classe.niveau_scolaire);
      try {
        assignations = (await chargerAssignationsClasse(classeId)).assignations || [];
      } catch (_error) {
        assignations = [];
      }
    } catch (error) {
      setStatut(error.message, "erreur");
      return;
    }
    const classe = donnees.classe;
    const eleves = donnees.eleves || [];
    const lignes = eleves.length
      ? eleves
          .map(
            (e) => `
        <li class="teacher-eleve" data-eleve-id="${e.id}">
          <span class="teacher-eleve-nom">${echapper(e.prenom)}</span>
          <span class="teacher-eleve-date">Ajouté le ${formaterDate(e.date_creation)}</span>
          <span class="teacher-eleve-actions">
            <button type="button" class="ghost-button teacher-reset-pin" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}">Réinitialiser le code</button>
            <button type="button" class="ghost-button teacher-code-parent" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}">Code parent</button>
            <button type="button" class="ghost-button teacher-remove" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}" title="Retirer de la classe (réversible, données conservées)">Retirer</button>
            <button type="button" class="ghost-button teacher-delete" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}" title="Effacer définitivement toutes les données (irréversible)">Supprimer les données</button>
          </span>
        </li>
      `,
          )
          .join("")
      : `<li class="teacher-eleve-vide">Aucun élève pour l'instant.</li>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-dashboard" class="ghost-button">&#8592; Mes classes</button>
        <span class="teacher-topbar-actions">
          <button type="button" id="ens-tableau-bord" class="btn-primary teacher-dashboard-btn">Tableau de bord</button>
          <button type="button" id="ens-assigner" class="btn-primary">Assigner un travail</button>
          <button type="button" id="ens-export-excel" class="ghost-button">Exporter en Excel</button>
          <button type="button" class="ghost-button teacher-copy" data-code="${classe.code_classe}">Copier le code ${classe.code_classe}</button>
        </span>
      </div>
      <h2 class="teacher-subtitle">${echapper(classe.nom)} <span class="hud-level">${classe.niveau_scolaire}</span></h2>
      <ul class="teacher-eleves">${lignes}</ul>
      ${assignationsStatutMarkup(assignations, noms)}
      <form id="ens-ajout-eleve" class="teacher-create login-form" autocomplete="off">
        <div class="teacher-create-row">
          <input id="ens-eleve-prenom" class="login-input teacher-input" type="text" placeholder="Prénom du nouvel élève" />
          <button type="submit" class="btn-primary">Ajouter</button>
        </div>
      </form>
    `;
    setStatut("");

    body.querySelector("#ens-retour-dashboard").addEventListener("click", vueDashboard);
    body.querySelector("#ens-tableau-bord").addEventListener("click", () => vueTableauDeBord(classeId));
    body.querySelector("#ens-export-excel").addEventListener("click", () => exporterExcel(classe));
    body.querySelector("#ens-assigner").addEventListener("click", () => vueAssignerTravail(classeId, classe, eleves));
    body.querySelector(".teacher-copy").addEventListener("click", () => copierCode(classe.code_classe));
    body.querySelectorAll(".teacher-remove").forEach((bouton) => {
      bouton.addEventListener("click", () => demanderRetrait(classeId, bouton));
    });
    body.querySelectorAll(".teacher-delete").forEach((bouton) => {
      bouton.addEventListener("click", () => demanderSuppressionDefinitive(classeId, bouton));
    });
    body.querySelectorAll(".teacher-reset-pin").forEach((bouton) => {
      bouton.addEventListener("click", () => demanderReinitPin(classeId, bouton));
    });
    body.querySelectorAll(".teacher-code-parent").forEach((bouton) => {
      bouton.addEventListener("click", () => demanderCodeParent(classeId, bouton));
    });
    body.querySelector("#ens-ajout-eleve").addEventListener("submit", async (event) => {
      event.preventDefault();
      const prenom = body.querySelector("#ens-eleve-prenom").value.trim();
      if (!prenom) {
        return;
      }
      setStatut("Ajout de l'élève...");
      try {
        const cree = await ajouterEleve(classeId, prenom);
        await vueClasseDetail(classeId);
        /* Le PIN n'est renvoye qu'ici, une seule fois : on le met en avant dans
           une popup a noter avant de rafraichir/quitter la vue. */
        afficherPopupPin(prenom, cree.pin);
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* --- Vue : assigner un travail (lecon ou revision ciblee) --- */
  async function vueAssignerTravail(classeId, classe, eleves) {
    setStatut("Chargement...");
    let lecons = [];
    let difficiles = [];
    try {
      [lecons, difficiles] = await Promise.all([
        chargerLecons(classe.niveau_scolaire),
        chargerConceptsDifficiles(classeId)
          .then((d) => d.concepts || [])
          .catch(() => []),
      ]);
    } catch (error) {
      setStatut(error.message, "erreur");
      return;
    }

    if (!eleves.length) {
      body.innerHTML = `
        <div class="teacher-topbar">
          <button type="button" id="ens-retour-detail" class="ghost-button">&#8592; Retour à la classe</button>
        </div>
        <p class="menu-lead">Ajoute d'abord des élèves pour pouvoir leur assigner un travail.</p>`;
      body.querySelector("#ens-retour-detail").addEventListener("click", () => vueClasseDetail(classeId));
      setStatut("");
      return;
    }

    const casesEleves = eleves
      .map(
        (e) => `
        <label class="assign-check">
          <input type="checkbox" class="assign-eleve-case" value="${e.id}" checked />
          <span>${echapper(e.prenom)}</span>
        </label>`,
      )
      .join("");
    const optionsLecons = lecons
      .map((l) => `<option value="${echapper(l.lecon_id)}">${echapper(l.nom)}</option>`)
      .join("");
    /* Suggestion intelligente : le concept qui bloque le plus d'eleves (donnees
       du tableau de bord) est pre-coche pour une revision ciblee. */
    const suggere = difficiles[0] && difficiles[0].pattern_name;
    const casesConcepts = difficiles.length
      ? difficiles
          .map(
            (c) => `
          <label class="assign-check">
            <input type="checkbox" class="assign-concept-case" value="${echapper(c.pattern_name)}" ${
              c.pattern_name === suggere ? "checked" : ""
            } />
            <span>${echapper(libelleConcept(c.pattern_name))}
              <span class="assign-hint">(${c.nb_eleves_en_difficulte} en difficulté)</span></span>
          </label>`,
          )
          .join("")
      : `<p class="menu-note">Aucun concept en difficulté identifié pour l'instant.</p>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-detail" class="ghost-button">&#8592; Retour à la classe</button>
      </div>
      <h2 class="teacher-subtitle">Assigner un travail <span class="hud-level">${classe.niveau_scolaire}</span></h2>
      <div class="assign-form">
        <fieldset class="assign-bloc">
          <legend>À quels élèves ?</legend>
          <button type="button" id="assign-tout" class="ghost-button assign-tout">Tout (dé)sélectionner</button>
          <div class="assign-cases">${casesEleves}</div>
        </fieldset>
        <fieldset class="assign-bloc">
          <legend>Quel travail ?</legend>
          <label class="assign-radio"><input type="radio" name="assign-type" value="lecon" checked /> Une leçon complète</label>
          <label class="assign-radio"><input type="radio" name="assign-type" value="revision" /> Révision ciblée</label>
          <div id="assign-lecon-zone" class="assign-type-zone">
            <select id="assign-lecon" class="login-input teacher-input">${optionsLecons}</select>
          </div>
          <div id="assign-revision-zone" class="assign-type-zone hidden">
            <p class="assign-hint">Concepts à retravailler (le plus bloquant est pré-coché) :</p>
            <div class="assign-cases">${casesConcepts}</div>
          </div>
        </fieldset>
        <button type="button" id="assign-valider" class="btn-primary">Assigner</button>
      </div>`;
    setStatut("");

    body.querySelector("#ens-retour-detail").addEventListener("click", () => vueClasseDetail(classeId));
    body.querySelector("#assign-tout").addEventListener("click", () => {
      const cases = body.querySelectorAll(".assign-eleve-case");
      const tousCoches = [...cases].every((c) => c.checked);
      cases.forEach((c) => {
        c.checked = !tousCoches;
      });
    });
    body.querySelectorAll('input[name="assign-type"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const revision =
          body.querySelector('input[name="assign-type"]:checked').value === "revision";
        body.querySelector("#assign-lecon-zone").classList.toggle("hidden", revision);
        body.querySelector("#assign-revision-zone").classList.toggle("hidden", !revision);
      });
    });
    body.querySelector("#assign-valider").addEventListener("click", async () => {
      const eleve_ids = [...body.querySelectorAll(".assign-eleve-case:checked")].map((c) =>
        Number(c.value),
      );
      if (!eleve_ids.length) {
        setStatut("Sélectionne au moins un élève.", "erreur");
        return;
      }
      const type = body.querySelector('input[name="assign-type"]:checked').value;
      const payload = { eleve_ids };
      if (type === "lecon") {
        payload.lecon_id = body.querySelector("#assign-lecon").value;
        if (!payload.lecon_id) {
          setStatut("Choisis une leçon.", "erreur");
          return;
        }
      } else {
        payload.patterns = [...body.querySelectorAll(".assign-concept-case:checked")].map(
          (c) => c.value,
        );
        if (!payload.patterns.length) {
          setStatut("Choisis au moins un concept à retravailler.", "erreur");
          return;
        }
      }
      setStatut("Assignation...");
      try {
        const rep = await assignerTravail(classeId, payload);
        await vueClasseDetail(classeId);
        setStatut(`Travail assigné à ${rep.assignations.length} élève(s).`, "succes");
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* Popup de confirmation d'un code (PIN eleve ou code d'acces parent). Le code
     n'etant jamais reaffiche en clair, on insiste ("il ne sera plus affiche") et
     on offre un bouton pour le copier. Overlay maison (pas de dialog natif). */
  function afficherPopupPin(
    prenom,
    pin,
    {
      titre = "Note ce code pour",
      lead = "Il ne sera plus affiché après. Communique-le à l'élève : il en aura besoin pour se connecter.",
    } = {},
  ) {
    document.getElementById("ens-pin-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "ens-pin-overlay";
    overlay.className = "pin-overlay";
    overlay.innerHTML = `
      <div class="pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-modal-titre">
        <h3 id="pin-modal-titre" class="pin-modal-titre">${echapper(titre)} ${echapper(prenom)}</h3>
        <p class="pin-modal-lead">${echapper(lead)}</p>
        <div class="pin-modal-code" id="pin-modal-code">${echapper(pin)}</div>
        <div class="pin-modal-actions">
          <button type="button" id="pin-modal-copier" class="btn-primary">Copier le code</button>
          <button type="button" id="pin-modal-ok" class="ghost-button">J'ai noté</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const fermer = () => overlay.remove();
    overlay.querySelector("#pin-modal-ok").addEventListener("click", fermer);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        fermer();
      }
    });
    overlay.querySelector("#pin-modal-copier").addEventListener("click", async (event) => {
      const bouton = event.currentTarget;
      try {
        await navigator.clipboard.writeText(pin);
        bouton.textContent = "Code copié !";
      } catch (_error) {
        bouton.textContent = `Code : ${pin}`;
      }
    });
  }

  /* Modale de rapport IA : ouvre aussitot avec un indicateur de chargement
     (la generation cote serveur peut prendre quelques secondes), puis remplace
     par le texte genere. Un rapport de repli (source 'regles') est signale. */
  async function genererRapportIa(classeId, eleve) {
    document.getElementById("ens-rapport-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "ens-rapport-overlay";
    overlay.className = "pin-overlay";
    overlay.innerHTML = `
      <div class="pin-modal rapport-modal" role="dialog" aria-modal="true" aria-labelledby="rapport-titre">
        <h3 id="rapport-titre" class="pin-modal-titre">Rapport de ${echapper(eleve.prenom)}</h3>
        <div id="rapport-contenu" class="rapport-contenu" aria-live="polite">
          <p class="rapport-chargement"><span class="rapport-spinner" aria-hidden="true"></span> Rédaction du rapport en cours...</p>
        </div>
        <div class="pin-modal-actions">
          <button type="button" id="rapport-fermer" class="ghost-button">Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const fermer = () => overlay.remove();
    overlay.querySelector("#rapport-fermer").addEventListener("click", fermer);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        fermer();
      }
    });

    const contenu = overlay.querySelector("#rapport-contenu");
    try {
      const reponse = await chargerRapportIa(classeId, eleve.id);
      const rapport = reponse.rapport || {};
      const note =
        rapport.source === "regles"
          ? `<p class="rapport-note">Rapport simplifié (service IA momentanément indisponible).</p>`
          : "";
      contenu.innerHTML = `<p class="rapport-texte">${echapper(rapport.texte || "")}</p>${note}`;
    } catch (error) {
      contenu.innerHTML = `<p class="rapport-erreur">Impossible de générer le rapport : ${echapper(error.message)}</p>`;
    }
  }

  /* Confirmation en ligne (pas de dialog natif qui bloque) du RETRAIT =
     archivage reversible : l'eleve quitte les vues actives mais ses donnees
     restent (recuperables si c'est une erreur). Distinct de la suppression
     definitive (demanderSuppressionDefinitive). */
  function demanderRetrait(classeId, bouton) {
    const eleveId = Number(bouton.dataset.eleveId);
    const prenom = bouton.dataset.prenom;
    const actions = bouton.closest(".teacher-eleve-actions");
    actions.innerHTML = `
      <span class="teacher-confirm-label">Retirer ${echapper(prenom)} de la classe ? (ses données sont conservées, action réversible)</span>
      <button type="button" class="btn-primary teacher-confirm-oui">Confirmer</button>
      <button type="button" class="ghost-button teacher-confirm-non">Annuler</button>
    `;
    actions.querySelector(".teacher-confirm-non").addEventListener("click", () =>
      vueClasseDetail(classeId),
    );
    actions.querySelector(".teacher-confirm-oui").addEventListener("click", async () => {
      setStatut("Retrait...");
      try {
        await retirerEleve(classeId, eleveId);
        await vueClasseDetail(classeId);
        setStatut(`${prenom} a été retiré de la classe.`, "");
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* Confirmation FORTE de la suppression DEFINITIVE (droit a l'effacement) :
     un texte explique clairement l'irreversibilite et l'enseignant doit taper
     le mot exact (CONFIRMATION_SUPPRESSION) pour armer le bouton — pas un
     simple clic. Efface l'eleve et TOUTES ses donnees (progression,
     assignations, garde-robe, sessions). */
  function demanderSuppressionDefinitive(classeId, bouton) {
    const eleveId = Number(bouton.dataset.eleveId);
    const prenom = bouton.dataset.prenom;
    const actions = bouton.closest(".teacher-eleve-actions");
    actions.innerHTML = `
      <div class="teacher-danger-confirm">
        <p class="teacher-danger-text">
          <strong>Suppression définitive et irréversible.</strong>
          Toutes les données de ${echapper(prenom)} (progression, travaux assignés,
          garde-robe, historique de jeu) seront effacées et ne pourront pas être
          récupérées. Pour confirmer, tapez <code>${CONFIRMATION_SUPPRESSION}</code> ci-dessous.
        </p>
        <div class="teacher-danger-row">
          <input type="text" class="login-input teacher-input teacher-danger-input" placeholder="${CONFIRMATION_SUPPRESSION}" autocomplete="off" />
          <button type="button" class="btn-danger teacher-danger-oui" disabled>Supprimer définitivement</button>
          <button type="button" class="ghost-button teacher-confirm-non">Annuler</button>
        </div>
      </div>
    `;
    const champ = actions.querySelector(".teacher-danger-input");
    const valider = actions.querySelector(".teacher-danger-oui");
    champ.addEventListener("input", () => {
      valider.disabled = champ.value.trim() !== CONFIRMATION_SUPPRESSION;
    });
    actions.querySelector(".teacher-confirm-non").addEventListener("click", () =>
      vueClasseDetail(classeId),
    );
    valider.addEventListener("click", async () => {
      if (champ.value.trim() !== CONFIRMATION_SUPPRESSION) {
        return;
      }
      valider.disabled = true;
      setStatut("Suppression définitive...");
      try {
        await supprimerEleveDefinitif(classeId, eleveId, champ.value.trim());
        await vueClasseDetail(classeId);
        setStatut(`Les données de ${prenom} ont été définitivement supprimées.`, "succes");
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* Confirmation en ligne de la reinitialisation du PIN : l'operation invalide
     l'ancien code (l'eleve ne pourra plus se connecter avec), on demande donc
     validation. Au succes, le nouveau PIN s'affiche dans la meme popup que la
     creation (une seule fois), puis on rafraichit la liste. */
  function demanderReinitPin(classeId, bouton) {
    const eleveId = Number(bouton.dataset.eleveId);
    const prenom = bouton.dataset.prenom;
    const actions = bouton.closest(".teacher-eleve-actions");
    actions.innerHTML = `
      <span class="teacher-confirm-label">Reinitialiser le code de ${echapper(prenom)} ? L'ancien ne marchera plus.</span>
      <button type="button" class="btn-primary teacher-confirm-oui">Confirmer</button>
      <button type="button" class="ghost-button teacher-confirm-non">Annuler</button>
    `;
    actions.querySelector(".teacher-confirm-non").addEventListener("click", () =>
      vueClasseDetail(classeId),
    );
    actions.querySelector(".teacher-confirm-oui").addEventListener("click", async () => {
      setStatut("Réinitialisation du code...");
      try {
        const reponse = await reinitialiserPin(classeId, eleveId);
        await vueClasseDetail(classeId);
        setStatut("");
        afficherPopupPin(prenom, reponse.pin, { titre: "Nouveau code pour" });
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* Confirmation en ligne du code d'acces parent. Le code n'etant jamais stocke
     en clair, on ne peut pas le reafficher : on en genere un nouveau (ce qui
     invalide l'ancien) et on l'affiche une seule fois dans la meme popup. */
  function demanderCodeParent(classeId, bouton) {
    const eleveId = Number(bouton.dataset.eleveId);
    const prenom = bouton.dataset.prenom;
    const actions = bouton.closest(".teacher-eleve-actions");
    actions.innerHTML = `
      <span class="teacher-confirm-label">Générer un code parent pour ${echapper(prenom)} ? Un ancien code éventuel cessera de marcher.</span>
      <button type="button" class="btn-primary teacher-confirm-oui">Générer</button>
      <button type="button" class="ghost-button teacher-confirm-non">Annuler</button>
    `;
    actions.querySelector(".teacher-confirm-non").addEventListener("click", () =>
      vueClasseDetail(classeId),
    );
    actions.querySelector(".teacher-confirm-oui").addEventListener("click", async () => {
      setStatut("Génération du code parent...");
      try {
        const reponse = await regenererCodeParent(classeId, eleveId);
        await vueClasseDetail(classeId);
        setStatut("");
        afficherPopupPin(prenom, reponse.code_parent, {
          titre: "Code d'accès parent pour",
          lead: "Il ne sera plus affiché après. Communiquez-le au parent : il lui permet de suivre la progression de son enfant (lecture seule).",
        });
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* --- Vue : tableau de bord d'une classe (vue d'ensemble) --- */
  async function vueTableauDeBord(classeId) {
    /* Point d'entree : premier rendu (avec messages d'etat), puis on arme le
       rafraichissement automatique s'il a reussi. */
    arreterRafraichissementTableauBord(); /* pas de doublon si on re-entre */
    setStatut("Chargement du tableau de bord...");
    const ok = await rendreTableauDeBord(classeId, { silencieux: false });
    if (ok) {
      programmerRafraichissementTableauBord(classeId);
    }
  }

  /* Re-arme un unique tick differe. A l'echeance, si l'enseignant a quitte
     l'ecran (le noeud d'ancrage a disparu du DOM apres un autre rendu), on
     arrete ; sinon on re-rend en silence et on reprogramme. */
  function programmerRafraichissementTableauBord(classeId) {
    arreterRafraichissementTableauBord();
    timerTableauBord = setTimeout(async () => {
      const ancre = body.querySelector(".teacher-bord-eleves");
      if (!ancre || !ancre.isConnected) {
        arreterRafraichissementTableauBord();
        return;
      }
      const ok = await rendreTableauDeBord(classeId, { silencieux: true });
      if (ok) {
        programmerRafraichissementTableauBord(classeId);
      } else {
        arreterRafraichissementTableauBord();
      }
    }, INTERVALLE_TABLEAU_BORD_MS);
  }

  /* Charge les donnees et (re)construit la vue. En mode silencieux (poll de
     fond), on n'affiche ni "Chargement..." ni message d'erreur : un echec
     transitoire laisse l'ecran en place, l'appelant coupe le rafraichissement. */
  async function rendreTableauDeBord(classeId, { silencieux }) {
    let bord;
    let difficiles;
    try {
      [bord, difficiles] = await Promise.all([
        chargerTableauDeBord(classeId),
        chargerConceptsDifficiles(classeId),
      ]);
    } catch (error) {
      if (!silencieux) {
        setStatut(error.message, "erreur");
      }
      return false;
    }
    const classe = bord.classe;
    const elevesTries = trierElevesParDifficulte(bord.eleves || []);
    const topDifficiles = conceptsLesPlusDifficiles(difficiles.concepts || [], 3);

    const sectionDifficiles = topDifficiles.length
      ? `
        <div class="teacher-difficiles">
          <h3 class="teacher-difficiles-titre">&#9888; À retravailler collectivement</h3>
          <ul class="teacher-difficiles-liste">
            ${topDifficiles
              .map(
                (c) => `
              <li>
                <span class="teacher-difficile-nom">${echapper(libelleConcept(c.pattern_name))}</span>
                <span class="teacher-difficile-nb">${c.nb_eleves_en_difficulte} élève${c.nb_eleves_en_difficulte > 1 ? "s" : ""} en difficulté</span>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `
      : `<p class="teacher-difficiles-aucun">Aucun concept ne bloque plusieurs élèves pour l'instant. &#128077;</p>`;

    const lignesEleves = elevesTries.length
      ? elevesTries
          .map(
            (e) => `
        <li class="teacher-bord-eleve" data-eleve-id="${e.id}" role="button" tabindex="0">
          <span class="teacher-bord-nom">${echapper(e.prenom)}</span>
          ${e.nb_total ? badgesMarkup(e) : `<span class="teacher-bord-vide">Pas encore joué</span>`}
        </li>
      `,
          )
          .join("")
      : `<li class="teacher-eleve-vide teacher-bord-eleve">Aucun élève dans cette classe.</li>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-detail" class="ghost-button">&#8592; Retour à la classe</button>
      </div>
      <h2 class="teacher-subtitle">Tableau de bord &mdash; ${echapper(classe.nom)} <span class="hud-level">${classe.niveau_scolaire}</span></h2>
      ${sectionDifficiles}
      <h3 class="teacher-bord-soustitre">Élèves <span class="teacher-bord-hint">(les plus en difficulté d'abord)</span></h3>
      <ul class="teacher-bord-eleves">${lignesEleves}</ul>
    `;
    if (!silencieux) {
      setStatut("");
    }

    body.querySelector("#ens-retour-detail").addEventListener("click", () => {
      arreterRafraichissementTableauBord();
      vueClasseDetail(classeId);
    });
    const eleveParId = new Map((bord.eleves || []).map((e) => [e.id, e]));
    body.querySelectorAll(".teacher-bord-eleve[data-eleve-id]").forEach((ligne) => {
      const eleve = eleveParId.get(Number(ligne.dataset.eleveId));
      if (!eleve) {
        return;
      }
      const ouvrir = () => {
        arreterRafraichissementTableauBord();
        vueEleveProgression(classeId, classe, eleve);
      };
      ligne.addEventListener("click", ouvrir);
      ligne.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ouvrir();
        }
      });
    });
    return true;
  }

  /* --- Vue : progression complete d'un eleve (le carnet, vu par l'enseignant) --- */
  async function vueEleveProgression(classeId, classe, eleve) {
    const badges = window.ParcoursCarnet?.masteryBadges?.() || BADGES_MAITRISE;
    const noms = await chargerNomsLecons(classe.niveau_scolaire);
    /* Meme regroupement par lecon que le carnet eleve (reutilise compte.js). */
    const pages =
      window.ParcoursCompte?.grouperProgression?.(eleve.concepts || [], {
        niveau: classe.niveau_scolaire,
        lessonNames: noms,
      }) || [];

    const contenu = pages.length
      ? pages
          .map(
            (page) => `
        <div class="teacher-progress-lecon">
          <div class="teacher-progress-head">
            <span class="teacher-progress-lecon-nom">${echapper(page.lecon_nom)}</span>
            <span class="teacher-progress-etoiles">${page.etoiles}/${page.etoiles_max} &#9733;</span>
          </div>
          <ul class="teacher-progress-concepts">
            ${page.concepts
              .map(
                (c) => `
              <li>
                <span>${echapper(libelleConcept(c.concept))}</span>
                <span class="teacher-badge niveau-${c.maitrise}">${badges[c.maitrise] || c.maitrise}</span>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `,
          )
          .join("")
      : `<p class="menu-lead">${echapper(eleve.prenom)} n'a pas encore travaillé de concept.</p>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-bord" class="ghost-button">&#8592; Tableau de bord</button>
        <button type="button" id="ens-rapport-ia" class="btn-primary">Générer un rapport</button>
      </div>
      <h2 class="teacher-subtitle">Progression de ${echapper(eleve.prenom)} <span class="hud-level">${classe.niveau_scolaire}</span></h2>
      ${badgesMarkup(eleve)}
      <div class="teacher-progress">${contenu}</div>
    `;
    setStatut("");
    body.querySelector("#ens-retour-bord").addEventListener("click", () => vueTableauDeBord(classeId));
    body.querySelector("#ens-rapport-ia").addEventListener("click", () => genererRapportIa(classeId, eleve));
  }

  /* ---------- Entree / sortie de l'espace ---------- */
  function demandeParURL() {
    return window.location.hash === "#enseignant";
  }

  async function ouvrir() {
    if (window.location.hash !== "#enseignant") {
      window.location.hash = "enseignant";
    }
    afficherEcran();
    setStatut("");
    body.innerHTML = `<p class="menu-lead">Chargement...</p>`;
    if (await tenterReconnexion()) {
      await vueDashboard();
    } else {
      vueConnexion();
    }
  }

  function retourAuJeu() {
    /* On quitte l'espace enseignant : on efface l'ancre et on recharge pour
       repartir proprement sur le flux eleve (connexion / essai libre). */
    arreterRafraichissementTableauBord();
    window.location.hash = "";
    window.location.reload();
  }

  window.ParcoursEnseignant = {
    ouvrir,
    demarrerDemo,
    demandeParURL,
    estConnecte: () => Boolean(token),
    getToken: () => token,
    deconnecter,
    /* Operations exposees pour le harnais de verification */
    sinscrire,
    seConnecter,
    chargerClasses,
    creerClasse,
    chargerEleves,
    ajouterEleve,
    retirerEleve,
    reinitialiserPin,
    regenererCodeParent,
    assignerTravail,
    chargerAssignationsClasse,
    chargerLecons,
    chargerTableauDeBord,
    chargerConceptsDifficiles,
    vueTableauDeBord,
    arreterRafraichissementTableauBord,
    /* Coeur pur */
    validerInscription,
    libelleErreur,
    trierElevesParDifficulte,
    conceptsLesPlusDifficiles,
  };
})();
