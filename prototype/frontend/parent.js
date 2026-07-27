/* ============================================================
   ESPACE PARENT (suivi en lecture seule d'un enfant)
   Point d'entree separe des flux eleve/enseignant (lien "Espace
   parent" sur l'ecran d'accueil, et URL #parent). Le parent saisit
   le code d'acces recu de l'enseignant, puis consulte le bilan de
   progression de son enfant : rien d'autre n'est possible (pas de
   modification, pas d'acces aux autres eleves).

   Ton : entre le jeu (chaleureux) et l'espace enseignant (sobre) ;
   langage accessible a un parent, sans jargon (on reutilise les noms
   de lecons lisibles et les libelles de concepts deja en place).

   Le coeur pur (comptage de maitrise, phrase de bilan) s'exporte en
   Node pour les tests (test_parent.js).
   ============================================================ */
(function () {
  const API_BASE = "http://127.0.0.1:8000";
  const STORAGE_KEY = "parcours_parent_v1";

  /* Libelles alignes sur le bilan eleve / l'espace enseignant. */
  const BADGES_MAITRISE = { 1: "A retravailler", 2: "En bonne voie", 3: "Acquis" };

  /* ---------- Coeur pur (testable sans navigateur) ---------- */

  /* Compte les concepts par niveau de maitrise (3 acquis / 2 en bonne voie /
     1 a retravailler). Fonction pure -> objet de decomptes. */
  function compterMaitrise(lignes) {
    const arr = Array.isArray(lignes) ? lignes : [];
    let acquis = 0;
    let enCours = 0;
    let aRetravailler = 0;
    for (const ligne of arr) {
      const m = ligne && ligne.maitrise;
      if (m === 3) {
        acquis += 1;
      } else if (m === 2) {
        enCours += 1;
      } else if (m === 1) {
        aRetravailler += 1;
      }
    }
    return { acquis, enCours, aRetravailler, total: acquis + enCours + aRetravailler };
  }

  /* Phrase d'accueil du bilan, en langage parent (sans jargon technique). */
  function phraseBilan(prenom, decomptes) {
    const nom = prenom || "Votre enfant";
    if (!decomptes || !decomptes.total) {
      return `${nom} n'a pas encore travaille de notion. Le suivi apparaitra des les premiers exercices.`;
    }
    const morceaux = [];
    if (decomptes.acquis) {
      morceaux.push(`${decomptes.acquis} bien maitrisee${decomptes.acquis > 1 ? "s" : ""}`);
    }
    if (decomptes.enCours) {
      morceaux.push(`${decomptes.enCours} en bonne voie`);
    }
    if (decomptes.aRetravailler) {
      morceaux.push(`${decomptes.aRetravailler} a retravailler`);
    }
    const n = decomptes.total;
    return `${nom} a travaille ${n} notion${n > 1 ? "s" : ""} : ${morceaux.join(", ")}.`;
  }

  const coeur = { compterMaitrise, phraseBilan, BADGES_MAITRISE, STORAGE_KEY };

  /* En Node (tests), on s'arrete au coeur pur : pas de DOM ni de fetch. */
  if (typeof window === "undefined") {
    if (typeof module !== "undefined" && module.exports) {
      module.exports = coeur;
    }
    return;
  }

  /* ---------- Etat (navigateur) ---------- */
  let token = null;
  let eleve = null; /* { id, prenom, niveau_scolaire } */
  const lessonNamesCache = {};

  function lireStockage() {
    try {
      const brut = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return brut && brut.token && brut.eleve ? brut : null;
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

  /* ---------- Rendu ---------- */
  const screen = document.getElementById("parent-screen");
  const body = document.getElementById("parent-body");
  const statusLine = document.getElementById("parent-status");

  function setStatut(texte, type) {
    if (!statusLine) {
      return;
    }
    statusLine.textContent = texte || "";
    statusLine.className = `menu-note${type ? ` ${type}` : ""}`;
  }

  function echapper(texte) {
    return String(texte ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  function afficherEcran() {
    screen?.classList.remove("hidden");
    ["login-screen", "start-screen", "lesson-screen", "game-screen", "theme-screen", "enseignant-screen"].forEach(
      (id) => document.getElementById(id)?.classList.add("hidden"),
    );
  }

  /* Noms lisibles des lecons d'un niveau (pour titrer les sections). */
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

  function libelleConcept(pattern) {
    const viaCarnet = window.ParcoursCarnet?.conceptLabel?.(pattern);
    return viaCarnet || String(pattern || "").replace(/_/g, " ");
  }

  /* --- Vue : saisie du code d'acces --- */
  function vueAcces() {
    setStatut("");
    body.innerHTML = `
      <p class="parent-eyebrow">Espace parent</p>
      <h1 class="parent-title">Suivre la progression de mon enfant</h1>
      <p class="parent-lead">
        Saisissez le code d'acces communique par l'enseignant. Vous verrez le
        bilan de votre enfant, en lecture seule.
      </p>
      <form id="parent-form" class="login-form parent-form" autocomplete="off">
        <label class="login-label" for="parent-code">Code d'acces</label>
        <input id="parent-code" class="login-input parent-input" type="text"
          placeholder="Ex : K7P2M9QT" autocomplete="off" aria-label="Code d'acces parent" />
        <div class="login-form-actions">
          <button type="submit" class="btn-primary">Voir le suivi</button>
          <button type="button" id="parent-retour-jeu" class="ghost-button">&#8592; Retour</button>
        </div>
      </form>
    `;
    const input = body.querySelector("#parent-code");
    input.focus();
    body.querySelector("#parent-retour-jeu").addEventListener("click", retourAuJeu);
    body.querySelector("#parent-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = input.value.trim().toUpperCase();
      if (!code) {
        return;
      }
      setStatut("Verification du code...");
      try {
        const reponse = await appel(`/parent/acces/${encodeURIComponent(code)}`, { method: "GET" });
        token = reponse.token;
        eleve = reponse.eleve;
        ecrireStockage({ token, eleve });
        await vueBilan();
      } catch (error) {
        setStatut(
          error.status === 403
            ? "Ce code d'acces n'est pas valide. Verifiez aupres de l'enseignant."
            : `Acces impossible : ${error.message}`,
        );
      }
    });
  }

  /* --- Vue : bilan de progression (lecture seule) --- */
  async function vueBilan() {
    setStatut("Chargement du suivi...");
    let payload;
    try {
      payload = await appel("/parent/progression", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error.status === 401) {
        /* token expire (redemarrage serveur) : on redemande le code */
        deconnecter();
        vueAcces();
        setStatut("Session expiree, saisissez de nouveau le code d'acces.");
        return;
      }
      setStatut(`Impossible de charger le suivi : ${error.message}`);
      return;
    }

    const infosEleve = payload.eleve || eleve || {};
    const lignes = payload.progression || [];
    const decomptes = compterMaitrise(lignes);
    const noms = await chargerNomsLecons(infosEleve.niveau_scolaire);
    /* Meme regroupement par lecon que le carnet eleve (reutilise compte.js). */
    const pages =
      window.ParcoursCompte?.grouperProgression?.(lignes, {
        niveau: infosEleve.niveau_scolaire,
        lessonNames: noms,
      }) || [];

    const tuile = (cle, valeur, libelle) =>
      `<div class="parent-tuile parent-tuile-${cle}">
        <span class="parent-tuile-nombre">${valeur}</span>
        <span class="parent-tuile-libelle">${libelle}</span>
      </div>`;

    const sections = pages.length
      ? pages
          .map(
            (page) => `
        <section class="parent-lecon">
          <h3 class="parent-lecon-titre">${echapper(page.lecon_nom)}</h3>
          <ul class="parent-concepts">
            ${page.concepts
              .map(
                (c) => `
              <li class="parent-concept niveau-${c.maitrise}">
                <span class="parent-concept-nom">${echapper(libelleConcept(c.concept))}</span>
                <span class="parent-concept-badge">${BADGES_MAITRISE[c.maitrise] || ""}</span>
              </li>
            `,
              )
              .join("")}
          </ul>
        </section>
      `,
          )
          .join("")
      : `<p class="parent-vide">Aucune notion travaillee pour l'instant. Le suivi se remplira au fur et a mesure des exercices.</p>`;

    body.innerHTML = `
      <div class="parent-topbar">
        <div>
          <p class="parent-eyebrow">Espace parent &middot; lecture seule</p>
          <h1 class="parent-title">Suivi de ${echapper(infosEleve.prenom || "")}
            <span class="hud-level">${echapper(infosEleve.niveau_scolaire || "")}</span>
          </h1>
        </div>
        <button type="button" id="parent-deconnexion" class="ghost-button">Changer d'enfant</button>
      </div>
      <p class="parent-phrase">${echapper(phraseBilan(infosEleve.prenom, decomptes))}</p>
      <div class="parent-tuiles">
        ${tuile("acquis", decomptes.acquis, "Acquis")}
        ${tuile("encours", decomptes.enCours, "En bonne voie")}
        ${tuile("retravailler", decomptes.aRetravailler, "A retravailler")}
      </div>
      <div class="parent-lecons">${sections}</div>
      <button type="button" id="parent-retour-jeu" class="ghost-button parent-retour">&#8592; Retour a l'accueil</button>
    `;
    setStatut("");
    body.querySelector("#parent-deconnexion").addEventListener("click", () => {
      deconnecter();
      vueAcces();
    });
    body.querySelector("#parent-retour-jeu").addEventListener("click", retourAuJeu);
  }

  function deconnecter() {
    token = null;
    eleve = null;
    ecrireStockage(null);
  }

  /* Reconnexion silencieuse : un token stocke est revalide contre le backend
     (les tokens vivent en memoire serveur et sautent a chaque redemarrage). */
  async function tenterReconnexion() {
    const stocke = lireStockage();
    if (!stocke) {
      return false;
    }
    token = stocke.token;
    eleve = stocke.eleve;
    try {
      await appel("/parent/progression", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      return true;
    } catch (_error) {
      deconnecter();
      return false;
    }
  }

  async function ouvrir() {
    if (window.location.hash !== "#parent") {
      window.location.hash = "parent";
    }
    afficherEcran();
    setStatut("");
    body.innerHTML = `<p class="parent-lead">Chargement...</p>`;
    if (await tenterReconnexion()) {
      await vueBilan();
    } else {
      vueAcces();
    }
  }

  function demandeParURL() {
    return window.location.hash === "#parent";
  }

  function retourAuJeu() {
    /* On quitte l'espace parent : on efface l'ancre et on recharge pour
       repartir proprement sur le flux d'accueil (connexion / essai libre). */
    window.location.hash = "";
    window.location.reload();
  }

  window.ParcoursParent = {
    ouvrir,
    demandeParURL,
    deconnecter,
    estConnecte: () => Boolean(token),
    /* Coeur pur expose pour les tests / l'affichage */
    compterMaitrise,
    phraseBilan,
  };
})();
