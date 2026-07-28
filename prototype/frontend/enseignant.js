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
  const API_BASE = "http://127.0.0.1:8000";
  const STORAGE_KEY = "parcours_enseignant_v1";
  const NIVEAUX = ["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"];

  /* ---------- Coeur pur (testable sans navigateur) ---------- */

  /* Valide un formulaire d'inscription cote client, en miroir des
     contraintes du backend (nom >= 1, identifiant >= 3, mot de passe >= 6).
     Renvoie un message d'erreur lisible, ou null si tout est valide. */
  function validerInscription({ nom, identifiant, mot_de_passe } = {}) {
    if (!nom || !nom.trim()) {
      return "Indique ton nom.";
    }
    if (!identifiant || identifiant.trim().length < 3) {
      return "L'identifiant doit faire au moins 3 caracteres.";
    }
    if (!mot_de_passe || mot_de_passe.length < 6) {
      return "Le mot de passe doit faire au moins 6 caracteres.";
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
        return "Cet identifiant est deja pris.";
      case 400:
        return "Niveau scolaire invalide.";
      default:
        return "Une erreur est survenue. Reessaie.";
    }
  }

  /* Terminologie identique au bilan de session cote eleve (carnet.js). */
  const BADGES_MAITRISE = { 1: "A retravailler", 2: "En bonne voie", 3: "Acquis" };

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
  async function sinscrire({ nom, identifiant, mot_de_passe }) {
    await appel("/enseignant/inscription", {
      method: "POST",
      body: JSON.stringify({ nom, identifiant, mot_de_passe }),
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

  async function chargerClasses() {
    const reponse = await appel("/classe", { method: "GET" });
    classes = reponse.classes || [];
    return classes;
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
          <button type="button" id="ens-vers-inscription" class="ghost-button">Creer un compte</button>
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
        <label class="login-label" for="ens-new-mdp">Mot de passe (6 caracteres min.)</label>
        <input id="ens-new-mdp" class="login-input teacher-input" type="password" autocomplete="new-password" />
        <div class="login-form-actions">
          <button type="submit" class="btn-primary">Creer mon compte</button>
          <button type="button" id="ens-vers-connexion" class="ghost-button">J'ai deja un compte</button>
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
      };
      const probleme = validerInscription(donnees);
      if (probleme) {
        setStatut(probleme, "erreur");
        return;
      }
      setStatut("Creation du compte...");
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
        <button type="button" id="ens-deconnexion" class="ghost-button">Se deconnecter</button>
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
            <span>${c.nb_eleves} eleve${c.nb_eleves > 1 ? "s" : ""}</span>
          </div>
          <div class="teacher-code-row">
            <span class="teacher-code" title="Code a communiquer aux eleves">${c.code_classe}</span>
            <button type="button" class="ghost-button teacher-copy" data-code="${c.code_classe}">Copier</button>
          </div>
        </div>
      `,
          )
          .join("")
      : `<p class="menu-lead">Aucune classe pour l'instant. Cree ta premiere classe ci-dessous.</p>`;

    body.innerHTML = `
      ${entete}
      <div class="teacher-classes">${cartes}</div>
      <form id="ens-creer-classe" class="teacher-create login-form" autocomplete="off">
        <h2 class="teacher-subtitle">Creer une classe</h2>
        <div class="teacher-create-row">
          <input id="ens-classe-nom" class="login-input teacher-input" type="text" placeholder="Nom de la classe" />
          <select id="ens-classe-niveau" class="login-input teacher-input">
            ${NIVEAUX.map((n) => `<option value="${n}">${n}</option>`).join("")}
          </select>
          <button type="submit" class="btn-primary">Creer</button>
        </div>
      </form>
      <button type="button" id="ens-retour-jeu" class="ghost-button teacher-back">&#8592; Retour au jeu</button>
    `;
    setStatut("");

    body.querySelector("#ens-deconnexion").addEventListener("click", () => {
      deconnecter();
      vueConnexion();
    });
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
        setStatut("Donne un nom a la classe.", "erreur");
        return;
      }
      setStatut("Creation de la classe...");
      try {
        const classe = await creerClasse({ nom, niveau_scolaire });
        await vueDashboard();
        setStatut(`Classe creee ! Code a partager : ${classe.code_classe}`, "succes");
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  async function copierCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setStatut(`Code ${code} copie !`, "succes");
    } catch (_error) {
      setStatut(`Code a partager : ${code}`, "");
    }
  }

  /* Telecharge l'export Excel de la classe. Le fichier est binaire et l'endpoint
     est protege : on ne peut pas utiliser un simple lien <a href> (pas d'en-tete
     Authorization). On recupere donc le blob par fetch authentifie, puis on
     declenche le telechargement via une URL objet temporaire. */
  async function exporterExcel(classe) {
    setStatut("Preparation de l'export Excel...");
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
    setStatut(`Export telecharge : ${nomFichier}`, "succes");
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
          ? `Revision : ${(a.patterns || []).map(libelleConcept).join(", ")}`
          : noms[a.lecon_id] || a.lecon_id || "Lecon";
      const statut = a.terminee
        ? `<span class="assign-statut assign-faite">Termine</span>`
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
        <h3 class="teacher-subtitle">Travaux assignes</h3>
        <ul class="assign-liste">${assignations.map(item).join("")}</ul>
      </div>`;
  }

  /* --- Vue : detail d'une classe (eleves) --- */
  async function vueClasseDetail(classeId) {
    setStatut("Chargement des eleves...");
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
          <span class="teacher-eleve-date">Ajoute le ${formaterDate(e.date_creation)}</span>
          <span class="teacher-eleve-actions">
            <button type="button" class="ghost-button teacher-reset-pin" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}">Reinitialiser le code</button>
            <button type="button" class="ghost-button teacher-code-parent" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}">Code parent</button>
            <button type="button" class="ghost-button teacher-remove" data-eleve-id="${e.id}" data-prenom="${echapper(e.prenom)}">Retirer</button>
          </span>
        </li>
      `,
          )
          .join("")
      : `<li class="teacher-eleve-vide">Aucun eleve pour l'instant.</li>`;

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
          <input id="ens-eleve-prenom" class="login-input teacher-input" type="text" placeholder="Prenom du nouvel eleve" />
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
      setStatut("Ajout de l'eleve...");
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
          <button type="button" id="ens-retour-detail" class="ghost-button">&#8592; Retour a la classe</button>
        </div>
        <p class="menu-lead">Ajoute d'abord des eleves pour pouvoir leur assigner un travail.</p>`;
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
              <span class="assign-hint">(${c.nb_eleves_en_difficulte} en difficulte)</span></span>
          </label>`,
          )
          .join("")
      : `<p class="menu-note">Aucun concept en difficulte identifie pour l'instant.</p>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-detail" class="ghost-button">&#8592; Retour a la classe</button>
      </div>
      <h2 class="teacher-subtitle">Assigner un travail <span class="hud-level">${classe.niveau_scolaire}</span></h2>
      <div class="assign-form">
        <fieldset class="assign-bloc">
          <legend>A quels eleves ?</legend>
          <button type="button" id="assign-tout" class="ghost-button assign-tout">Tout (de)selectionner</button>
          <div class="assign-cases">${casesEleves}</div>
        </fieldset>
        <fieldset class="assign-bloc">
          <legend>Quel travail ?</legend>
          <label class="assign-radio"><input type="radio" name="assign-type" value="lecon" checked /> Une lecon complete</label>
          <label class="assign-radio"><input type="radio" name="assign-type" value="revision" /> Revision ciblee</label>
          <div id="assign-lecon-zone" class="assign-type-zone">
            <select id="assign-lecon" class="login-input teacher-input">${optionsLecons}</select>
          </div>
          <div id="assign-revision-zone" class="assign-type-zone hidden">
            <p class="assign-hint">Concepts a retravailler (le plus bloquant est pre-coche) :</p>
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
        setStatut("Selectionne au moins un eleve.", "erreur");
        return;
      }
      const type = body.querySelector('input[name="assign-type"]:checked').value;
      const payload = { eleve_ids };
      if (type === "lecon") {
        payload.lecon_id = body.querySelector("#assign-lecon").value;
        if (!payload.lecon_id) {
          setStatut("Choisis une lecon.", "erreur");
          return;
        }
      } else {
        payload.patterns = [...body.querySelectorAll(".assign-concept-case:checked")].map(
          (c) => c.value,
        );
        if (!payload.patterns.length) {
          setStatut("Choisis au moins un concept a retravailler.", "erreur");
          return;
        }
      }
      setStatut("Assignation...");
      try {
        const rep = await assignerTravail(classeId, payload);
        await vueClasseDetail(classeId);
        setStatut(`Travail assigne a ${rep.assignations.length} eleve(s).`, "succes");
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
      lead = "Il ne sera plus affiche apres. Communique-le a l'eleve : il en aura besoin pour se connecter.",
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
          <button type="button" id="pin-modal-ok" class="ghost-button">J'ai note</button>
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
        bouton.textContent = "Code copie !";
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
          <p class="rapport-chargement"><span class="rapport-spinner" aria-hidden="true"></span> Redaction du rapport en cours...</p>
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
          ? `<p class="rapport-note">Rapport simplifie (service IA momentanement indisponible).</p>`
          : "";
      contenu.innerHTML = `<p class="rapport-texte">${echapper(rapport.texte || "")}</p>${note}`;
    } catch (error) {
      contenu.innerHTML = `<p class="rapport-erreur">Impossible de generer le rapport : ${echapper(error.message)}</p>`;
    }
  }

  /* Confirmation en ligne (pas de dialog natif qui bloque) : retirer un eleve
     supprime aussi sa progression en cascade, on demande donc validation. */
  function demanderRetrait(classeId, bouton) {
    const ligne = bouton.closest(".teacher-eleve");
    const eleveId = Number(bouton.dataset.eleveId);
    const prenom = bouton.dataset.prenom;
    const actions = bouton.closest(".teacher-eleve-actions");
    actions.innerHTML = `
      <span class="teacher-confirm-label">Retirer ${prenom} et sa progression ?</span>
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
        setStatut(`${prenom} a ete retire de la classe.`, "");
      } catch (error) {
        setStatut(error.message, "erreur");
      }
      void ligne;
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
      <span class="teacher-confirm-label">Reinitialiser le code de ${prenom} ? L'ancien ne marchera plus.</span>
      <button type="button" class="btn-primary teacher-confirm-oui">Confirmer</button>
      <button type="button" class="ghost-button teacher-confirm-non">Annuler</button>
    `;
    actions.querySelector(".teacher-confirm-non").addEventListener("click", () =>
      vueClasseDetail(classeId),
    );
    actions.querySelector(".teacher-confirm-oui").addEventListener("click", async () => {
      setStatut("Reinitialisation du code...");
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
      <span class="teacher-confirm-label">Generer un code parent pour ${prenom} ? Un ancien code eventuel cessera de marcher.</span>
      <button type="button" class="btn-primary teacher-confirm-oui">Generer</button>
      <button type="button" class="ghost-button teacher-confirm-non">Annuler</button>
    `;
    actions.querySelector(".teacher-confirm-non").addEventListener("click", () =>
      vueClasseDetail(classeId),
    );
    actions.querySelector(".teacher-confirm-oui").addEventListener("click", async () => {
      setStatut("Generation du code parent...");
      try {
        const reponse = await regenererCodeParent(classeId, eleveId);
        await vueClasseDetail(classeId);
        setStatut("");
        afficherPopupPin(prenom, reponse.code_parent, {
          titre: "Code d'acces parent pour",
          lead: "Il ne sera plus affiche apres. Communiquez-le au parent : il lui permet de suivre la progression de son enfant (lecture seule).",
        });
      } catch (error) {
        setStatut(error.message, "erreur");
      }
    });
  }

  /* --- Vue : tableau de bord d'une classe (vue d'ensemble) --- */
  async function vueTableauDeBord(classeId) {
    setStatut("Chargement du tableau de bord...");
    let bord;
    let difficiles;
    try {
      [bord, difficiles] = await Promise.all([
        chargerTableauDeBord(classeId),
        chargerConceptsDifficiles(classeId),
      ]);
    } catch (error) {
      setStatut(error.message, "erreur");
      return;
    }
    const classe = bord.classe;
    const elevesTries = trierElevesParDifficulte(bord.eleves || []);
    const topDifficiles = conceptsLesPlusDifficiles(difficiles.concepts || [], 3);

    const sectionDifficiles = topDifficiles.length
      ? `
        <div class="teacher-difficiles">
          <h3 class="teacher-difficiles-titre">&#9888; A retravailler collectivement</h3>
          <ul class="teacher-difficiles-liste">
            ${topDifficiles
              .map(
                (c) => `
              <li>
                <span class="teacher-difficile-nom">${echapper(libelleConcept(c.pattern_name))}</span>
                <span class="teacher-difficile-nb">${c.nb_eleves_en_difficulte} eleve${c.nb_eleves_en_difficulte > 1 ? "s" : ""} en difficulte</span>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `
      : `<p class="teacher-difficiles-aucun">Aucun concept ne bloque plusieurs eleves pour l'instant. &#128077;</p>`;

    const lignesEleves = elevesTries.length
      ? elevesTries
          .map(
            (e) => `
        <li class="teacher-bord-eleve" data-eleve-id="${e.id}" role="button" tabindex="0">
          <span class="teacher-bord-nom">${echapper(e.prenom)}</span>
          ${e.nb_total ? badgesMarkup(e) : `<span class="teacher-bord-vide">Pas encore joue</span>`}
        </li>
      `,
          )
          .join("")
      : `<li class="teacher-eleve-vide teacher-bord-eleve">Aucun eleve dans cette classe.</li>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-detail" class="ghost-button">&#8592; Retour a la classe</button>
      </div>
      <h2 class="teacher-subtitle">Tableau de bord &mdash; ${echapper(classe.nom)} <span class="hud-level">${classe.niveau_scolaire}</span></h2>
      ${sectionDifficiles}
      <h3 class="teacher-bord-soustitre">Eleves <span class="teacher-bord-hint">(les plus en difficulte d'abord)</span></h3>
      <ul class="teacher-bord-eleves">${lignesEleves}</ul>
    `;
    setStatut("");

    body.querySelector("#ens-retour-detail").addEventListener("click", () => vueClasseDetail(classeId));
    const eleveParId = new Map((bord.eleves || []).map((e) => [e.id, e]));
    body.querySelectorAll(".teacher-bord-eleve[data-eleve-id]").forEach((ligne) => {
      const eleve = eleveParId.get(Number(ligne.dataset.eleveId));
      if (!eleve) {
        return;
      }
      const ouvrir = () => vueEleveProgression(classeId, classe, eleve);
      ligne.addEventListener("click", ouvrir);
      ligne.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ouvrir();
        }
      });
    });
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
      : `<p class="menu-lead">${echapper(eleve.prenom)} n'a pas encore travaille de concept.</p>`;

    body.innerHTML = `
      <div class="teacher-topbar">
        <button type="button" id="ens-retour-bord" class="ghost-button">&#8592; Tableau de bord</button>
        <button type="button" id="ens-rapport-ia" class="btn-primary">Generer un rapport</button>
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
    window.location.hash = "";
    window.location.reload();
  }

  window.ParcoursEnseignant = {
    ouvrir,
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
    /* Coeur pur */
    validerInscription,
    libelleErreur,
    trierElevesParDifficulte,
    conceptsLesPlusDifficiles,
  };
})();
