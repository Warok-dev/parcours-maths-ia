"""Verification de bout en bout contre un VRAI PostgreSQL.

Parcours complet sans surcharge de get_db : enseignant, classe, eleve,
verrou PIN, partie relue en base apres "redemarrage", acces parent,
revocation, deconnexion, creation d'une demo.

Usage (base JETABLE, le script y cree des donnees) :
    cd prototype/backend
    DATABASE_URL=postgresql://user@host/base RATE_LIMIT_ENABLED=0 \
        python scripts/verifier_postgres.py
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
if not os.environ.get("DATABASE_URL", "").startswith(("postgresql", "postgres")):
    raise SystemExit("DATABASE_URL doit pointer vers une base PostgreSQL jetable.")

from fastapi.testclient import TestClient  # noqa: E402

import comptes  # noqa: E402
import main  # noqa: E402

ok = 0


def check(cond, label):
    global ok
    if not cond:
        raise SystemExit(f"ECHEC : {label}")
    ok += 1
    print("ok ", label)


with TestClient(main.app) as c:  # ouvre le lifespan (init_db, purges)
    import secrets

    ident = f"prof-{secrets.token_hex(3)}"
    check(c.post("/enseignant/inscription", json={"nom": "P", "identifiant": ident, "mot_de_passe": "secret123", "ecole": "E2E"}).status_code == 201, "inscription")
    tok = c.post("/enseignant/connexion", json={"identifiant": ident, "mot_de_passe": "secret123"}).json()["token"]
    H = {"Authorization": f"Bearer {tok}"}
    cl = c.post("/classe", json={"nom": "A", "niveau_scolaire": "CE1"}, headers=H).json()
    check(len(cl["code_classe"].split("-")[-1]) == 5, "code de classe fort")
    el = c.post(f"/classe/{cl['id']}/eleve", json={"prenom": "Lea"}, headers=H).json()
    check(c.get(f"/classe/rejoindre/{cl['code_classe'].lower()}").status_code == 200, "rejoindre (minuscules)")

    faux = "0000" if el["pin"] != "0000" else "1111"
    for _ in range(comptes.PIN_ECHECS_MAX):
        c.post(f"/eleve/{el['id']}/connexion", json={"code_classe": cl["code_classe"], "pin": faux})
    check(c.post(f"/eleve/{el['id']}/connexion", json={"code_classe": cl["code_classe"], "pin": el["pin"]}).status_code == 429, "verrou PIN (timestamptz PG)")
    pin = c.post(f"/classe/{cl['id']}/eleve/{el['id']}/reinitialiser_pin", headers=H).json()["pin"]
    r = c.post(f"/eleve/{el['id']}/connexion", json={"code_classe": cl["code_classe"], "pin": pin})
    check(r.status_code == 200, "deverrouillage par nouveau PIN")
    E = {"Authorization": f"Bearer {r.json()['token']}"}

    # Programme de classe (tables programme_classe / concept_ouvert) : la lecon
    # est fermee tant que l'enseignant n'en a ouvert aucun concept.
    check(c.post("/session/demarrer", json={"niveau_scolaire": "CE1", "lecon_id": "addition"}, headers=E).status_code == 403, "lecon fermee par le programme")
    ouvert = c.post(f"/classe/{cl['id']}/programme/ouvrir", json={"patterns": ["addition_pas_a_pas_sans_retenue"]}, headers=H)
    check(ouvert.status_code == 200 and ouvert.json()["nb_ouverts"] == 2, "ouverture d'un concept (PG)")
    s = c.post("/session/demarrer", json={"niveau_scolaire": "CE1", "lecon_id": "addition"}, headers=E).json()
    check(s["progression"]["aspects"] == ["calcul", "recit", "calcul"], "carte d'un concept en 3 aspects")
    sid, ex = s["session_id"], s["exercice"]
    main.SESSION_STATE.clear()
    main.EXERCICE_CACHE.clear()
    r = c.post("/evaluer", json={"session_id": sid, "exercice_id": ex["id"], "reponse_eleve": "999999"}, headers=E)
    check(r.status_code == 200 and r.json()["statut"] == "incorrect", "partie relue en base apres 'redemarrage'")

    p = c.get(f"/parent/acces/{el['code_parent']}").json()["token"]
    P = {"Authorization": f"Bearer {p}"}
    check(c.get("/parent/progression", headers=P).status_code == 200, "acces parent")
    c.post(f"/classe/{cl['id']}/eleve/{el['id']}/code_parent", headers=H)
    check(c.get("/parent/progression", headers=P).status_code == 401, "revocation parent (PG)")
    check(c.post("/deconnexion", headers=H).status_code == 204, "deconnexion")
    check(c.get("/classe", headers=H).status_code == 401, "jeton enseignant revoque")

    d = c.post("/demo/creer")
    check(d.status_code == 201, "creation demo (seeding sur PG)")

print(f"\n{ok} verifications OK sur PostgreSQL")
