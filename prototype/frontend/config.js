/* ============================================================
   CONFIGURATION — adresse du backend (une seule source de verite)
   Charge AVANT tous les autres scripts (voir index.html).

   - Page servie en local (localhost, 127.0.0.1, fichier ouvert
     directement) : backend local http://127.0.0.1:8000, pour ne
     jamais polluer la base de production ni consommer ses quotas IA
     pendant le developpement.
   - Sinon : backend de production.
   - Surcharge ponctuelle : ?api=http://localhost:8001 dans l'URL
     (memorisee pour la session d'onglet). Acceptee UNIQUEMENT depuis
     une page locale, ou vers un backend local ; ignoree sinon
     (protection contre les liens de hameconnage).
   ============================================================ */
(function (racine) {
  const API_PRODUCTION = "https://parcours-maths-ia.onrender.com";
  const API_LOCALE = "http://127.0.0.1:8000";
  const HOTES_LOCAUX = ["localhost", "127.0.0.1", "[::1]", ""];

  // Vrai si l'adresse (chaine) pointe vers une machine locale.
  function adresseLocale(adresse) {
    try {
      return HOTES_LOCAUX.includes(new URL(adresse).hostname) && new URL(adresse).hostname !== "";
    } catch (_error) {
      return false;
    }
  }

  // La surcharge n'est acceptee que depuis une page locale, ou vers un
  // backend local : sinon un lien piege ?api=https://pirate enverrait les
  // codes de classe et PIN des eleves a un serveur tiers.
  function surchargeAutorisee(pageLocale, adresse) {
    return pageLocale || adresseLocale(adresse);
  }

  function choisirApi(location, stockage) {
    const pageLocale = location.protocol === "file:" || HOTES_LOCAUX.includes(location.hostname);
    try {
      const demande = new URLSearchParams(location.search || "").get("api");
      if (demande && /^https?:\/\//.test(demande)) {
        const adresse = demande.replace(/\/+$/, "");
        if (surchargeAutorisee(pageLocale, adresse)) {
          stockage?.setItem("parcours_api", adresse);
          return adresse;
        }
      }
      const memorise = stockage?.getItem("parcours_api");
      if (memorise) {
        if (surchargeAutorisee(pageLocale, memorise)) {
          return memorise;
        }
        stockage?.removeItem?.("parcours_api");
      }
    } catch (_error) {
      /* stockage indisponible (navigation privee...) : on continue */
    }
    return pageLocale ? API_LOCALE : API_PRODUCTION;
  }

  const config = { API_PRODUCTION, API_LOCALE, choisirApi };
  if (racine.location) {
    let stockage = null;
    try {
      stockage = racine.sessionStorage;
    } catch (_error) {
      stockage = null;
    }
    config.API_BASE = choisirApi(racine.location, stockage);
  } else {
    config.API_BASE = API_PRODUCTION;
  }
  racine.PARCOURS_CONFIG = config;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = config;
  }
})(typeof window !== "undefined" ? window : globalThis);
