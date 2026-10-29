"""Vue « client » d'un exercice : ce qui part au navigateur, sans la reponse.

Le serveur garde l'exercice complet (reponse attendue, variables, methode)
et corrige lui-meme. Le navigateur ne recoit que de quoi AFFICHER l'exercice
et monter sa mecanique de jeu :

- ``reponse_attendue`` reduite a son format (clavier adapte, choix de la
  mecanique) : plus de ``valeur`` ni de ``tolerance`` ;
- ``variables`` filtrees : seules restent celles que le frontend dessine
  (figures, horloge, graphiques, options d'un QCM, trous d'une suite). Les
  variables de resultat (``c``, ``total``, ``tout``, ``produit``...) restent
  au serveur ;
- ``presentations`` reduites a celle qui s'affiche : la methode guidee
  (« 3 + 3 = 6 ») ne voyage plus avec un exercice joue en autonomie ;
- ``mecanique`` : les indices que chaque mecanique utilisait en lisant la
  reponse (nombre de molettes du cadenas, planches a assembler, fenetre de la
  ligne numerique, objets du panier, sections de la roue, operandes de la
  balance...). Ils ne revelent que ce que la mecanique montre deja a l'ecran.

Le mode hors-ligne (entrainement invite, sans progression) ne peut pas
demander au serveur : il recoit des EMPREINTES salees des reponses acceptees
(``verification_hors_ligne``), comparees a l'empreinte de la reponse de
l'eleve. Les memes regles de normalisation existent en JS (offline.js) ;
``test_exercice_client.py`` et ``test_offline.js`` partagent leurs cas.
"""

from __future__ import annotations

import hashlib
import random
import re
import secrets
from decimal import Decimal

# Variables lues par le frontend pour dessiner l'exercice ou monter sa
# mecanique (releve exhaustif de map.js et mechanics.js). Toute autre variable
# reste au serveur. Ajouter ici une variable qu'un nouveau dessin utilise.
VARIABLES_CLIENT = frozenset(
    {
        "a", "angles", "bas_affichee", "categories", "centre", "cote", "cotes",
        "droit", "enfants", "forme", "forme_sym", "haut_affichee", "hauteur",
        "heure", "icone", "img_label", "img_val", "k", "label1", "label2",
        "largeur", "m", "max_axe", "mesure", "minute", "n", "n_cotes",
        "options", "points", "positions_manquantes", "ref_label", "ref_val",
        "secteurs", "segments", "singulier", "solide", "titre", "unite",
        "valeur_mesure", "x_axis", "x_max", "y_axis",
        # Periode 4 : pieces et billets, collection a trier, segment sur la
        # regle (ce que le dessin montre, comme l'heure d'une horloge).
        "monnaie", "objets", "longueur_mm",
    }
)

# Bornes des mecaniques : miroir de mechanics.js.
LIGNE_MAX = 40
PANIER_MAX = 12
BALANCE_MAX_CIBLE = 100
ROUE_MAX_SECTIONS = 6
OPTION_COURTE_MAX = 12

# Patterns d'addition qui se pretent a la balance, et leurs deux operandes.
# La balance pose ces deux poids sur le plateau de gauche : l'eleve batit la
# meme masse a droite. Avant, elle affichait la somme a atteindre... qui etait
# la reponse.
BALANCE_OPERANDES = {
    "addition_2chiffres_sans_retenue": ("ab", "cd"),
    "addition_pas_a_pas_sans_retenue": ("a", "b"),
    "partie_tout_addition_non_narratif": ("partie1", "partie2"),
}


def _rang(niveau: str | None) -> int:
    m = re.match(r"^CE([1-6])$", str(niveau or ""))
    return int(m.group(1)) if m else 0


def _entier_positif(valeur) -> bool:
    return isinstance(valeur, int) and not isinstance(valeur, bool) and valeur >= 0


def _poids_disponibles(cible: int) -> list[int]:
    base = [1, 2, 5, 10]
    if cible >= 20:
        base.append(20)
    if cible >= 50:
        base.append(50)
    return base


def _poids_minimum(cible: int, palette: list[int]) -> float:
    reste, nb = cible, 0
    for p in sorted(palette, reverse=True):
        while reste >= p:
            reste -= p
            nb += 1
    return nb if reste == 0 else float("inf")


def _balance(exercice: dict, valeur) -> dict | None:
    cles = BALANCE_OPERANDES.get(exercice.get("pattern", {}).get("pattern_name", ""))
    if cles is None or not _entier_positif(valeur) or valeur <= 0:
        return None
    variables = exercice.get("variables") or {}
    gauche = [variables.get(cles[0]), variables.get(cles[1])]
    if not all(_entier_positif(x) for x in gauche) or sum(gauche) != valeur:
        return None
    cible_max, poids_max = (20, 3) if _rang(exercice.get("niveau_scolaire")) == 1 else (BALANCE_MAX_CIBLE, float("inf"))
    if valeur > cible_max or _poids_minimum(valeur, _poids_disponibles(valeur)) > poids_max:
        return None
    return {"gauche": gauche}


def _planches(valeur: int, rnd: random.Random) -> list[str]:
    """Chiffres de la reponse + leurres (chiffres absents de la reponse, sans
    doublon), melanges. Le total vise reste celui de mechanics.js."""
    chiffres = list(str(valeur))
    leurres = [d for d in "0123456789" if d not in chiffres]
    rnd.shuffle(leurres)
    nb_leurres = max(0, min(6, len(chiffres) + 3) - len(chiffres))
    planches = chiffres + leurres[:nb_leurres]
    rnd.shuffle(planches)
    return planches


def _positions_masquees(exercice: dict, longueur: int) -> list[int]:
    positions = (exercice.get("variables") or {}).get("positions_manquantes")
    if not isinstance(positions, list):
        return list(range(2, longueur))
    return sorted({p for p in positions if isinstance(p, int) and not isinstance(p, bool) and 0 <= p < longueur})


def _melange_sans_ordre(valeurs: list, rnd: random.Random) -> list:
    """Melange qui n'est jamais l'ordre attendu (ni, pour une suite, l'ordre
    croissant) : sinon la lecture de gauche a droite donne la reponse."""
    if len(valeurs) < 2:
        return list(valeurs)
    interdits = [list(valeurs), sorted(valeurs)]
    melange = list(valeurs)
    for _ in range(12):
        rnd.shuffle(melange)
        if melange not in interdits:
            return melange
    melange = list(valeurs)
    melange[0], melange[1] = melange[1], melange[0]
    return melange


def hash_chaine(texte: str) -> int:
    """Miroir exact de hashString (mechanics.js) : entier 32 bits signe."""
    h = 0
    for caractere in str(texte):
        h = (h * 31 + ord(caractere)) & 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return abs(h)


VERROU_MAX_CHIFFRES = 3
BLOCS_MAX = 999


def mecaniques_possibles(exercice: dict) -> list[str]:
    """Regle d'assignation des mecaniques (anciennement baseMechanics +
    compatibleMechanics dans mechanics.js). Elle a besoin de la reponse, donc
    elle vit desormais ici. Ordre identique a l'ancienne version JS."""
    attendue = exercice.get("reponse_attendue") or {}
    valeur = attendue.get("valeur")
    fmt = attendue.get("format") or "nombre_entier"
    famille = (exercice.get("pattern") or {}).get("pattern_family")
    if fmt == "heure":
        return ["horloge"]
    if fmt in ("expression", "decimal"):
        # Calculette a grosses touches (virgule, ×, =) plutot que le clavier
        # systeme, peu pratique sur tablette pour un enfant.
        return ["calculette"]
    if fmt == "liste_ordonnee":
        if not (isinstance(valeur, list) and len(valeur) >= 2):
            return ["clavier"]
        options = ["ligne"]
        if _rang(exercice.get("niveau_scolaire")) != 1 or len(valeur) <= 4:
            options.append("ordre")
        return options
    if fmt == "choix_multiple":
        choix = (exercice.get("variables") or {}).get("options")
        numerique = isinstance(choix, list) and bool(choix) and all(
            o not in ("", None) and _nombre(o) is not None for o in choix
        )
        # Options longues (« 10 DH + 5 DH + 5 DH ») : illisibles dans une
        # bulle ou une part de roue, on garde les planches.
        if isinstance(choix, list) and any(len(str(o)) > OPTION_COURTE_MAX for o in choix):
            return ["planches"]
        return ["planches", "roue", "bulles"] if numerique else ["planches", "bulles"]
    if not _entier_positif(valeur):
        return ["calculette"] if _nombre(valeur) is not None else ["clavier"]
    chiffres = len(str(valeur))
    if famille == "calcul_direct":
        options = (["ligne"] if valeur <= LIGNE_MAX else []) + ["planches"]
    elif famille == "exercice_a_trous_serie":
        options = (["cadenas"] if chiffres <= VERROU_MAX_CHIFFRES else []) + (["ligne"] if valeur <= LIGNE_MAX else [])
        options = options or ["calculette"]
    elif famille == "probleme_narratif_simple":
        if valeur <= PANIER_MAX:
            options = ["panier"]
        else:
            options = ["cadenas"] if chiffres <= VERROU_MAX_CHIFFRES else ["calculette"]
    else:
        options = ["calculette"]
    # Blocs de base dix (centaines, dizaines, unites) : la numeration du CE1 au
    # CE3. Pas pour de tres petits nombres (un seul cube a poser n'apprend rien).
    # Le nombre de colonnes depend du NIVEAU (dizaines/unites au CE1, centaines
    # en plus ensuite), jamais de la reponse : les blocs ne revelent rien.
    rang = _rang(exercice.get("niveau_scolaire"))
    plafond_blocs = 99 if rang == 1 else BLOCS_MAX
    if famille in ("calcul_direct", "exercice_a_trous_serie") and 10 <= valeur <= plafond_blocs and 1 <= rang <= 3:
        options.append("blocs")
    if _balance(exercice, valeur) is not None and "balance" not in options:
        options.append("balance")
    return options


def choisir_mecanique(exercice: dict) -> str:
    """Mecanique jouee pour cet exercice : rotation deterministe par id, comme
    avant (varie d'un exercice a l'autre, stable au rechargement)."""
    options = mecaniques_possibles(exercice)
    return options[hash_chaine(exercice.get("id", "")) % len(options)]


# Indices transmis pour chaque mecanique : SEULEMENT ceux-la. Envoyer les
# indices de toutes les mecaniques permettrait de les croiser (fenetre de la
# ligne x objets du panier x planches) et de retrouver la reponse.
INDICES_PAR_MECANIQUE = {
    "planches": ("planches", "nb_planches"),
    "ligne": ("ligne_debut", "suite", "suite_reserve", "longueur"),
    "cadenas": ("nb_chiffres",),
    "panier": ("panier_objets",),
    "ordre": ("ordre", "longueur"),
    "roue": ("roue",),
    "balance": ("balance",),
    "horloge": (),
    "clavier": (),
    "blocs": (),
    "bulles": ("bulles",),
    "calculette": (),
}


def indices_mecanique(exercice: dict, mecanique: str | None = "auto") -> dict:
    """Indices de la mecanique choisie (``"auto"``), d'une mecanique donnee,
    ou de toutes (``None``, pour les tests). La mecanique choisie est jointe
    sous ``choisie``."""
    tous = _tous_les_indices(exercice)
    if mecanique is None:
        return tous
    choisie = choisir_mecanique(exercice) if mecanique == "auto" else mecanique
    garde = {cle: tous[cle] for cle in INDICES_PAR_MECANIQUE.get(choisie, ()) if cle in tous}
    return {"choisie": choisie, **garde}


def _tous_les_indices(exercice: dict) -> dict:
    """Ce dont les mecaniques ont besoin, calcule a partir de la reponse sans
    la transmettre. Deterministe par exercice (graine = son id)."""
    attendue = exercice.get("reponse_attendue") or {}
    valeur = attendue.get("valeur")
    fmt = attendue.get("format") or "nombre_entier"
    variables = exercice.get("variables") or {}
    rnd = random.Random(str(exercice.get("id", "")))
    indices: dict = {}

    if fmt == "liste_ordonnee" and isinstance(valeur, list):
        indices["longueur"] = len(valeur)
        trous = _positions_masquees(exercice, len(valeur))
        indices["suite"] = [None if i in trous else x for i, x in enumerate(valeur)]
        indices["suite_reserve"] = _melange_sans_ordre([valeur[i] for i in trous], rnd)
        indices["ordre"] = _melange_sans_ordre(list(valeur), rnd)
        return indices

    if fmt == "choix_multiple":
        options = variables.get("options") or [valeur]
        melange = [str(o) for o in options]
        rnd.shuffle(melange)
        indices["planches"] = melange
        indices["nb_planches"] = 1
        # Seulement les choix du QCM : des voisins ajoutes (« 70 » pour « le
        # multiple de 10 parmi 26, 67, 60 ») pouvaient eux aussi etre justes.
        roue = [str(o) for o in options]
        rnd.shuffle(roue)
        indices["roue"] = roue
        bulles = [str(o) for o in options]
        rnd.shuffle(bulles)
        indices["bulles"] = bulles
        return indices

    if _entier_positif(valeur):
        indices.update(
            entier_positif=True,
            nb_chiffres=len(str(valeur)),
            ligne_ok=valeur <= LIGNE_MAX,
            panier_ok=valeur <= PANIER_MAX,
            planches=_planches(valeur, rnd),
            nb_planches=len(str(valeur)),
        )
        if valeur <= LIGNE_MAX:
            indices["ligne_debut"] = max(0, valeur - (3 + rnd.randrange(5)))
        if valeur <= PANIER_MAX:
            indices["panier_objets"] = valeur + 3 + rnd.randrange(3)
        balance = _balance(exercice, valeur)
        if balance is not None:
            indices["balance"] = balance
    return indices


# --- Verification hors-ligne par empreintes ---------------------------------

_MULT = re.compile(r"^(?:(\d+)=)?(\d+)x(\d+)$")
_NOMBRE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")
_NOMBRE_MILLIERS = re.compile(r"^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$")


def _texte_js(valeur) -> str:
    """Comme String() en JS pour les valeurs d'une reponse (listes jointes
    par des virgules, sans espace)."""
    if valeur is None:
        return ""
    if isinstance(valeur, list):
        return ",".join(_texte_js(v) for v in valeur)
    if isinstance(valeur, bool):
        return "true" if valeur else "false"
    if isinstance(valeur, float) and valeur.is_integer():
        return str(int(valeur))
    return str(valeur)


def _normaliser(valeur, tolerance: dict) -> str:
    texte = _texte_js(valeur).replace("×", "x").replace("*", "x")
    if tolerance.get("ignorer_espaces"):
        texte = re.sub(r"\s+", "", texte)
    return texte.strip().lower()


def _nombre(texte) -> Decimal | None:
    t = re.sub(r"[   ]", " ", str(texte)).strip()
    if _NOMBRE_MILLIERS.match(t):
        t = t.replace(" ", "")
    if not _NOMBRE.match(t):
        return None
    return Decimal(t.replace(",", "."))


def _texte_nombre(d: Decimal) -> str:
    texte = format(d.normalize(), "f")
    return "0" if texte in ("-0", "+0") else texte


def forme_canonique(reponse, tolerance: dict) -> str:
    """Forme unique d'une reponse : deux reponses equivalentes pour la
    correction hors-ligne ont la meme forme. Miroir de formeCanonique (JS)."""
    t = _normaliser(reponse, tolerance)
    m = _MULT.match(t)
    if m:
        facteurs = sorted((int(m.group(2)), int(m.group(3))))
        if m.group(1) is not None and int(m.group(1)) != facteurs[0] * facteurs[1]:
            return "faux:" + t
        return f"mul:{facteurs[0]}x{facteurs[1]}"
    n = _nombre(t)
    if n is not None:
        return "num:" + _texte_nombre(n)
    return "txt:" + t


def empreinte(sel: str, forme: str) -> str:
    return hashlib.sha256(f"{sel}|{forme}".encode("utf-8")).hexdigest()


def verification_hors_ligne(exercice: dict) -> dict:
    attendue = exercice.get("reponse_attendue") or {}
    tolerance = attendue.get("tolerance") or {}
    acceptees = [attendue.get("valeur"), *(tolerance.get("equivalences_acceptees") or [])]
    sel = secrets.token_hex(8)
    formes = {forme_canonique(r, tolerance) for r in acceptees}
    return {
        "sel": sel,
        "ignorer_espaces": bool(tolerance.get("ignorer_espaces")),
        "empreintes": sorted(empreinte(sel, f) for f in formes),
    }


# --- Vue client --------------------------------------------------------------


def pour_client(
    exercice: dict | None,
    presentation: str | None = None,
    *,
    hors_ligne: bool = False,
    mecanique: str | None = "auto",
) -> dict | None:
    """Copie de l'exercice sans rien qui donne la reponse.

    ``presentation`` : la seule presentation a garder (celle qui s'affiche).
    ``None`` garde toutes les presentations (tampon hors-ligne, ou le niveau
    d'aide n'est pas connu du serveur).
    """
    if exercice is None:
        return None
    attendue = exercice.get("reponse_attendue") or {}
    vue = {
        cle: valeur
        for cle, valeur in exercice.items()
        if cle not in ("reponse_attendue", "variables", "presentations")
    }
    vue["reponse_attendue"] = {"format": attendue.get("format") or "nombre_entier"}
    vue["variables"] = {
        cle: valeur
        for cle, valeur in (exercice.get("variables") or {}).items()
        if cle in VARIABLES_CLIENT
    }
    presentations = exercice.get("presentations") or {}
    if presentation is not None and presentation in presentations:
        vue["presentations"] = {presentation: presentations[presentation]}
    else:
        vue["presentations"] = presentations
    vue["mecanique"] = indices_mecanique(exercice, mecanique)
    # Signature de dedoublonnage du tampon hors-ligne : calculee sur TOUTES
    # les variables (les variables filtrees ne suffisent plus a distinguer
    # deux exercices), sans les reveler.
    vue["signature"] = hashlib.sha256(
        repr((exercice.get("pattern", {}).get("pattern_name"), sorted((exercice.get("variables") or {}).items(), key=lambda kv: kv[0]))).encode("utf-8")
    ).hexdigest()[:16]
    if hors_ligne:
        vue["verification_hors_ligne"] = verification_hors_ligne(exercice)
    return vue


def reponse_affichable(exercice: dict) -> str:
    """La bonne reponse, telle qu'on l'ecrit a l'eleve dans une correction."""
    valeur = (exercice.get("reponse_attendue") or {}).get("valeur")
    if isinstance(valeur, list):
        return ", ".join(str(v) for v in valeur)
    return str(valeur)
