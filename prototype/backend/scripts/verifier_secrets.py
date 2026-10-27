"""Verifie qu'aucun secret n'est versionne ni servi au navigateur.

Lance par la CI a chaque push, et a lancer a la main avant un deploiement :

    python prototype/backend/scripts/verifier_secrets.py            # fichiers suivis par Git
    python prototype/backend/scripts/verifier_secrets.py --historique  # + tout l'historique

Ce que le script controle :
- aucun fichier sensible n'est suivi (.env, credentials Google, cles privees,
  bases SQLite, source maps) ;
- aucun fichier texte ne contient une cle au format connu (Google/Gemini,
  Groq, OpenAI, GitHub, AWS, cle privee PEM, compte de service Google) ni une
  chaine de connexion PostgreSQL avec un vrai mot de passe ;
- les ressources compressees de la page d'accueil (landing/index.html, une
  page « bundlee » qui embarque ses scripts en base64) sont decodees et
  controlees elles aussi.

Le frontend est servi tel quel (pas d'etape de build) : les fichiers suivis
SONT les artefacts de production, ce controle porte donc sur ce qui part
reellement au navigateur.

Les cles Mistral n'ont pas de prefixe reconnaissable : elles ne peuvent etre
reperees que par leur nom (MISTRAL_API_KEY=...), ce que fait la regle
« affectation ».
"""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import re
import subprocess
import sys
import zlib
from pathlib import Path

RACINE = Path(__file__).resolve().parents[3]

# Fichiers qui n'ont jamais leur place dans le depot.
FICHIERS_INTERDITS = [
    (re.compile(r"(^|/)\.env(\.[^/]*)?$"), "fichier d'environnement"),
    (re.compile(r"credentials[^/]*\.json$", re.I), "credentials Google"),
    (re.compile(r"\.(pem|key|p12|pfx)$", re.I), "cle privee ou certificat"),
    (re.compile(r"\.(db|sqlite3?)(-journal|-wal|-shm)?$", re.I), "base de donnees"),
    (re.compile(r"\.js\.map$|\.css\.map$", re.I), "source map"),
]
# Gabarits documentes : autorises.
FICHIERS_AUTORISES = {".env.example", "prototype/.env.example"}

MOTIFS = [
    ("cle Google / Gemini", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("cle Groq", re.compile(r"gsk_[0-9A-Za-z]{20,}")),
    ("cle OpenAI", re.compile(r"sk-(proj-)?[A-Za-z0-9_\-]{20,}")),
    ("jeton GitHub", re.compile(r"gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}")),
    ("cle AWS", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("cle privee", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("compte de service Google", re.compile(r'"private_key_id"\s*:\s*"[0-9a-f]{20,}"')),
    ("jeton Slack", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}")),
    (
        "chaine de connexion avec mot de passe",
        re.compile(r"postgres(?:ql)?(?:\+\w+)?://([^:\s/@\"'<>]+):([^@\s\"'<>]+)@([^/\s\"'<>]+)"),
    ),
    (
        "affectation d'une cle",
        re.compile(
            # Valeur « brute » (lettres, chiffres, - et _), pas un appel de
            # fonction : DATABASE_URL est couvert par la regle precedente.
            r"\b(GEMINI_API_KEY|GROQ_API_KEY|MISTRAL_API_KEY|OPENAI_API_KEY)\s*[=:]\s*[\"']?([A-Za-z0-9_\-]{20,})(?![\w(.])"
        ),
    ),
]

# Valeurs d'exemple (docs, CI avec un PostgreSQL jetable) : pas des secrets.
MOTS_DE_PASSE_EXEMPLE = {"postgres", "mdp", "mon_mot_de_passe", "password", "motdepasse", "secret"}
VALEURS_EXEMPLE = re.compile(r"your_|votre_|exemple|example|xxx|<|\$\{|\$\(", re.I)
HOTES_LOCAUX = re.compile(r"^(localhost|127\.0\.0\.1|db|postgres)(:\d+)?$")

EXTENSIONS_BINAIRES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".wav", ".ogg",
    ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".pptx", ".docx", ".xlsx", ".zip",
}


def _est_faux_positif(regle: str, m: re.Match) -> bool:
    if regle == "chaine de connexion avec mot de passe":
        mot_de_passe, hote = m.group(2), m.group(3)
        return (
            mot_de_passe in MOTS_DE_PASSE_EXEMPLE
            or bool(VALEURS_EXEMPLE.search(mot_de_passe))
            or bool(HOTES_LOCAUX.match(hote))
            or "ep-cool-name" in hote
        )
    if regle == "affectation d'une cle":
        valeur = m.group(2)
        return bool(VALEURS_EXEMPLE.search(valeur)) or valeur.startswith(("os.", "postgresql://postgres:postgres@"))
    return False


def chercher(texte: str) -> list[tuple[str, str]]:
    """Renvoie [(regle, extrait masque)] pour chaque secret trouve."""
    trouves = []
    for regle, motif in MOTIFS:
        for m in motif.finditer(texte):
            if _est_faux_positif(regle, m):
                continue
            brut = m.group(0)
            # On n'affiche jamais le secret en clair dans les journaux de CI.
            trouves.append((regle, brut[:8] + "…" if len(brut) > 8 else brut))
    return trouves


def _ressources_bundle(texte: str) -> list[tuple[str, str]]:
    """Decode les scripts embarques d'une page bundlee (landing/index.html)."""
    m = re.search(r'<script type="__bundler/manifest">(.*?)</script>', texte, re.S)
    if not m:
        return []
    try:
        manifeste = json.loads(m.group(1))
    except json.JSONDecodeError:
        return [("manifeste illisible", "")]
    sortie = []
    for cle, res in manifeste.items():
        if not str(res.get("mime", "")).startswith(("text", "application")):
            continue
        donnees = base64.b64decode(res.get("data", ""))
        if res.get("compressed"):
            try:
                donnees = gzip.decompress(donnees)
            except OSError:
                donnees = zlib.decompress(donnees)
        sortie.append((cle, donnees.decode("utf-8", "replace")))
    return sortie


def fichiers_suivis() -> list[str]:
    sortie = subprocess.run(
        ["git", "ls-files", "-z"], cwd=RACINE, capture_output=True, check=True
    ).stdout.decode()
    return [f for f in sortie.split("\0") if f]


def verifier_arbre() -> list[str]:
    problemes = []
    for chemin in fichiers_suivis():
        if chemin not in FICHIERS_AUTORISES:
            for motif, nature in FICHIERS_INTERDITS:
                if motif.search(chemin):
                    problemes.append(f"{chemin} : {nature} suivi par Git")
        if Path(chemin).suffix.lower() in EXTENSIONS_BINAIRES:
            continue
        fichier = RACINE / chemin
        if not fichier.is_file():
            continue
        texte = fichier.read_text("utf-8", errors="replace")
        for regle, extrait in chercher(texte):
            problemes.append(f"{chemin} : {regle} ({extrait})")
        for ressource, contenu in _ressources_bundle(texte):
            for regle, extrait in chercher(contenu):
                problemes.append(f"{chemin} [ressource {ressource[:8]}] : {regle} ({extrait})")
        if "sourceMappingURL=" in texte and chemin.endswith((".js", ".css")):
            problemes.append(f"{chemin} : reference a une source map")
    return problemes


def verifier_historique() -> list[str]:
    """Lignes ajoutees dans TOUT l'historique : une cle retiree depuis reste
    lisible dans Git et doit etre revoquee chez le fournisseur."""
    journal = subprocess.run(
        ["git", "log", "--all", "-p", "--no-color", "--format=commit %H"],
        cwd=RACINE, capture_output=True, check=True,
    ).stdout.decode("utf-8", "replace")
    problemes = []
    commit = "?"
    for ligne in journal.splitlines():
        if ligne.startswith("commit "):
            commit = ligne.split()[1][:9]
        elif ligne.startswith("+") and not ligne.startswith("+++"):
            for regle, extrait in chercher(ligne):
                problemes.append(f"commit {commit} : {regle} ({extrait})")
    return sorted(set(problemes))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--historique", action="store_true", help="parcourt aussi tout l'historique Git")
    args = parser.parse_args()

    problemes = verifier_arbre()
    if args.historique:
        problemes += verifier_historique()
    if problemes:
        print("Secrets ou fichiers sensibles trouvés :")
        for p in problemes:
            print(f"  - {p}")
        print("\nRetirez-les du dépôt ET révoquez la clé chez le fournisseur : "
              "une clé poussée sur GitHub doit être considérée comme compromise.")
        return 1
    print(f"Aucun secret trouvé ({len(fichiers_suivis())} fichiers suivis"
          f"{', historique compris' if args.historique else ''}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
