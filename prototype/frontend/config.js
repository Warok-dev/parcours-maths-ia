/* ============================================================
   CONFIGURATION — adresse du backend (une seule source de verite)
   Charge AVANT tous les autres scripts (voir index.html).

   - Page servie en local (localhost, 127.0.0.1, fichier ouvert
     directement) : backend local http://127.0.0.1:8000, pour ne
     jamais polluer la base de production ni consommer ses quotas IA
     pendant le developpement.
   - Sinon : backend de production.
   - Surcharge ponctuelle : ?api=https://autre-backend.exemple
     dans l'URL de la page (memorisee pour la session d'onglet).
   ============================================================ */
(function (racine) {
  const API_PRODUCTION = "https://parcours-maths-ia.onrender.com";
  const API_LOCALE = "http://127.0.0.1:8000";
  const HOTES_LOCAUX = ["localhost", "127.0.0.1", "[::1]", ""];

  function choisirApi(location, stockage) {
    try {
      const demande = new URLSearchParams(location.search || "").get("api");
      if (demande && /^https?:\/\//.test(demande)) {
        const adresse = demande.replace(/\/+$/, "");
        stockage?.setItem("parcours_api", adresse);
        return adresse;
      }
      const memorise = stockage?.getItem("parcours_api");
      if (memorise) {
        return memorise;
      }
    } catch (_error) {
      /* stockage indisponible (navigation privee...) : on continue */
    }
    const local = location.protocol === "file:" || HOTES_LOCAUX.includes(location.hostname);
    return local ? API_LOCALE : API_PRODUCTION;
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
