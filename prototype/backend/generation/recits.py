"""Problemes racontes : le MEME concept, habille d'une petite histoire.

Un eleve qui travaille longtemps un seul concept (le professeur n'a ouvert
que lui) doit le rencontrer sous plusieurs aspects. Le premier, c'est le
calcul (generateurs de substitution.py) ; celui-ci, c'est le probleme
raconte, dans l'univers que l'eleve a choisi (foot, dinosaures, espace...).

Pas de LLM ici : les histoires sont des gabarits remplis avec les banques de
personnages et d'objets du theme (narrative.py). L'exercice garde le
pattern_name du concept, pour que la maitrise gagnee compte bien pour ce
concept (carnet, tableau de bord, programme).

`recit_disponible(pattern)` dit si le concept a une version racontee ;
`generer_recit(pattern, niveau, theme)` la produit.
"""

from __future__ import annotations

import random

from generation import substitution as s
from generation.narrative import objets_pour_theme, personnages_pour_theme


def _rang(niveau: str) -> int:
    return int(niveau[-1]) if niveau and niveau[-1].isdigit() else 1


def _personnages(theme: str | None, n: int) -> list[str]:
    return random.sample(list(personnages_pour_theme(theme)), n)


def _objet(theme: str | None, taille: str = "small_count") -> str:
    return random.choice(list(objets_pour_theme(theme, taille)))


def _exo(pattern: str, niveau: str, enonce: str, valeur, steps: list[str], variables: dict, **kw) -> dict:
    exercice = s._build_exercise(
        niveau=niveau, pattern_name=pattern, enonce=enonce, valeur=valeur, steps=steps,
        variables={**variables, "aspect": "recit"}, **kw,
    )
    # Un probleme raconte se joue avec les mecaniques des problemes (panier,
    # cadenas...), pas celles du calcul pose.
    exercice["pattern"]["pattern_family"] = "probleme_narratif_simple"
    exercice["contexte_narratif"] = {"aspect": "recit"}
    return exercice


# ---------- Gabarits par famille ----------
def _plafond(pattern: str, niveau: str) -> int:
    r = _rang(niveau)
    if r == 1:
        return 99 if pattern == "addition_posee" else 20
    if r == 2:
        return 999 if pattern in ("addition_posee", "soustraction_posee") else 100
    return 1000


def _ajout(pattern: str, niveau: str, theme: str | None) -> dict:
    maxi = _plafond(pattern, niveau)
    a = random.randint(2, maxi * 2 // 3)
    b = random.randint(2, max(2, maxi - a))
    qui, = _personnages(theme, 1)
    objet = _objet(theme, "small_count" if maxi <= 20 else "medium_count")
    enonce = random.choice([
        f"{qui} a {a} {objet}. On lui en donne encore {b}. Combien de {objet} a-t-il maintenant ?",
        f"{qui} range {a} {objet} dans une boîte et {b} dans une autre. Combien de {objet} en tout ?",
    ])
    return _exo(pattern, niveau, enonce, a + b, [
        "On réunit les deux quantités : c'est une addition.",
        f"{a} + {b} = {a + b}.",
    ], {"a": a, "b": b})


def _retrait(pattern: str, niveau: str, theme: str | None) -> dict:
    maxi = _plafond(pattern, niveau)
    a = random.randint(max(5, maxi // 3), maxi)
    if pattern == "soustraction_passage_dizaine":
        u = random.randint(1, 8)
        a = 10 + u
        b = random.randint(u + 1, 9)
    else:
        b = random.randint(1, a - 1)
    qui, = _personnages(theme, 1)
    objet = _objet(theme, "small_count" if maxi <= 20 else "medium_count")
    enonce = random.choice([
        f"{qui} a {a} {objet}. Il en donne {b} à un ami. Combien de {objet} lui reste-t-il ?",
        f"Il y avait {a} {objet} dans le panier de {qui}. {b} sont tombés. Combien en reste-t-il ?",
    ])
    return _exo(pattern, niveau, enonce, a - b, [
        "Une partie s'en va : on cherche ce qui reste, c'est une soustraction.",
        f"{a} - {b} = {a - b}.",
    ], {"a": a, "b": b})


def _comparaison(pattern: str, niveau: str, theme: str | None) -> dict:
    grand_max = 150 if _rang(niveau) <= 2 else 800
    b = random.randint(10, grand_max)
    ecart = random.randint(5, max(6, grand_max // 4))
    un, deux = _personnages(theme, 2)
    objet = _objet(theme, "medium_count")
    return _exo(pattern, niveau, f"{un} a {b + ecart} {objet} et {deux} en a {b}. Combien {un} en a-t-il de plus que {deux} ?", ecart, [
        "Pour comparer, on cherche l'écart : le plus grand moins le plus petit.",
        f"{b + ecart} - {b} = {ecart}.",
    ], {"a": b + ecart, "b": b})


def _groupes(pattern: str, niveau: str, theme: str | None) -> dict:
    r = _rang(niveau)
    if pattern == "multiplication_par_10":
        n, k = 10, random.randint(2, 30)
    elif pattern == "multiplication_chiffre_x_multiple_de_10":
        n, k = random.randint(2, 9), random.randint(2, 9) * 10
    elif pattern in ("multiplication_posee_2chiffres", "multiplication_decomposee_chiffre_x_2chiffres"):
        n, k = random.randint(2, 9), random.randint(12, 49)
    elif r == 1:
        n, k = random.randint(2, 5), random.randint(2, 5)
    else:
        n, k = random.randint(2, 9), random.randint(2, 9)
    qui, = _personnages(theme, 1)
    objet = _objet(theme, "grouped_count")
    contenant = random.choice(["sacs", "boîtes", "paquets", "rangées"])
    calcul = " + ".join([str(k)] * n) if r == 1 else f"{n} × {k}"
    return _exo(pattern, niveau, f"{qui} prépare {n} {contenant} de {k} {objet}. Combien de {objet} y a-t-il en tout ?", n * k, [
        f"Il y a {n} groupes égaux de {k}.",
        f"{calcul} = {n * k}.",
    ], {"n": n, "k": k})


def _partage(pattern: str, niveau: str, theme: str | None) -> dict:
    r = _rang(niveau)
    parts = random.randint(2, 4 if r == 1 else 9)
    chacun = random.randint(2, 5 if r == 1 else 9)
    qui, = _personnages(theme, 1)
    objet = _objet(theme, "grouped_count")
    division = f"{parts * chacun} ÷ {parts} = {chacun}" if r >= 3 else f"{' + '.join([str(chacun)] * parts)} = {parts * chacun}"
    return _exo(pattern, niveau, f"{qui} partage {parts * chacun} {objet} entre {parts} amis, à parts égales. Combien chacun en reçoit-il ?", chacun, [
        "On distribue un par un, chacun son tour, jusqu'au dernier.",
        f"{division} : chacun reçoit {chacun}.",
    ], {"total": parts * chacun, "parts": parts})


def _double_moitie(pattern: str, niveau: str, theme: str | None) -> dict:
    qui, = _personnages(theme, 1)
    objet = _objet(theme, "medium_count")
    if pattern == "double_via_2xn":
        n = random.randint(3, 40)
        return _exo(pattern, niveau, f"{qui} avait {n} {objet}. Aujourd'hui, il en a le double. Combien en a-t-il ?", 2 * n, [
            "Le double, c'est deux fois le nombre.",
            f"{n} + {n} = {2 * n}.",
        ], {"n": n})
    n = random.randint(2, 30) * 2
    return _exo(pattern, niveau, f"{qui} a {n} {objet}. Il en donne la moitié à sa sœur. Combien en donne-t-il ?", n // 2, [
        "La moitié, c'est partager en 2 parts égales.",
        f"{n // 2} + {n // 2} = {n} : la moitié de {n} est {n // 2}.",
    ], {"n": n})


_ARTICLES = [("un cahier", 4, 15), ("un stylo", 2, 8), ("une gomme", 1, 5), ("un livre", 12, 45), ("un ballon", 15, 60), ("une bouteille d'eau", 3, 9)]


def _achat(pattern: str, niveau: str, theme: str | None) -> dict:
    (a1, lo1, hi1), (a2, lo2, hi2) = random.sample(_ARTICLES, 2)
    p1, p2 = random.randint(lo1, hi1), random.randint(lo2, hi2)
    if _rang(niveau) == 1:
        p1, p2 = min(p1, 40), min(p2, 40)
    qui, = _personnages(theme, 1)
    return _exo(pattern, niveau, f"{qui} achète {a1} à {p1} DH et {a2} à {p2} DH. Combien paie-t-il en tout, en DH ?", p1 + p2, [
        "On additionne les prix.",
        f"{p1} + {p2} = {p1 + p2} DH.",
    ], {"a": p1, "b": p2})


def _masse(pattern: str, niveau: str, theme: str | None) -> dict:
    kg = random.randint(1, 6)
    g = random.choice([0, random.randint(1, 9) * 100, random.randint(1, 99) * 10])
    qui, = _personnages(theme, 1)
    produit = random.choice(["dattes", "pommes de terre", "oranges", "farine", "amandes"])
    texte = f"{kg} kg {g} g" if g else f"{kg} kg"
    return _exo(pattern, niveau, f"Au marché, {qui} achète {texte} de {produit}. Combien de grammes cela fait-il ?", kg * 1000 + g, [
        "1 kg = 1 000 g.",
        f"{texte} = {kg * 1000} g + {g} g = {kg * 1000 + g} g." if g else f"{kg} kg = {kg * 1000} g.",
    ], {"kg": kg, "g": g})


def _longueur(pattern: str, niveau: str, theme: str | None) -> dict:
    cm, mm = random.randint(2, 15), random.randint(1, 9)
    qui, = _personnages(theme, 1)
    objet = random.choice(["crayon", "ruban", "clou", "pinceau", "bâton de colle"])
    return _exo(pattern, niveau, f"Le {objet} de {qui} mesure {cm} cm {mm} mm. Combien de millimètres cela fait-il ?", cm * 10 + mm, [
        "1 cm = 10 mm.",
        f"{cm} cm {mm} mm = {cm * 10} mm + {mm} mm = {cm * 10 + mm} mm.",
    ], {"cm": cm, "mm": mm})


def _duree(pattern: str, niveau: str, theme: str | None) -> dict:
    qui, = _personnages(theme, 1)
    a, b = random.randint(10, 45), random.randint(5, 40)
    if pattern == "conversion_duree_min":
        h, m = random.randint(1, 3), random.randint(5, 55)
        return _exo(pattern, niveau, f"Le film que regarde {qui} dure {h} h {m} min. Combien de minutes cela fait-il ?", h * 60 + m, [
            "1 h = 60 min.",
            f"{h} h {m} min = {h * 60} min + {m} min = {h * 60 + m} min.",
        ], {"h": h, "m": m})
    return _exo(pattern, niveau, f"{qui} lit pendant {a} min, puis joue pendant {b} min. Combien de minutes en tout ?", a + b, [
        "On additionne les deux durées.",
        f"{a} min + {b} min = {a + b} min.",
    ], {"a": a, "b": b})


_FRACTIONS = {2: "la moitié", 3: "le tiers", 4: "le quart", 5: "le cinquième", 10: "le dixième"}


def _fraction(pattern: str, niveau: str, theme: str | None) -> dict:
    d = random.choice(list(_FRACTIONS))
    k = random.randint(2, 9)
    qui, = _personnages(theme, 1)
    objet = _objet(theme, "medium_count")
    return _exo(pattern, niveau, f"{qui} a {d * k} {objet}. Il en offre {_FRACTIONS[d]}. Combien en offre-t-il ?", k, [
        f"{_FRACTIONS[d].capitalize()}, c'est partager en {d} parts égales et en prendre une.",
        f"{d * k} ÷ {d} = {k}.",
    ], {"d": d, "total": d * k})


def _pourcentage(pattern: str, niveau: str, theme: str | None) -> dict:
    p = random.choice([10, 20, 25, 50])
    base = random.choice([20, 40, 60, 80, 100, 200, 300])
    return _exo(pattern, niveau, f"Dans une école de {base} élèves, {p} % viennent à vélo. Combien d'élèves viennent à vélo ?", base * p // 100, [
        f"{p} %, c'est {p} sur 100.",
        f"{base} × {p} ÷ 100 = {base * p // 100}.",
    ], {"p": p, "base": base})


def _decimaux(pattern: str, niveau: str, theme: str | None) -> dict:
    qui, = _personnages(theme, 1)
    a, b = random.randint(110, 900), random.randint(105, 600)
    if pattern == "soustraction_decimaux" and b > a:
        a, b = b, a
    total = a + b if pattern == "addition_decimaux" else a - b
    sa, sb, st = s._fmt_dec(a), s._fmt_dec(b), s._fmt_dec(total)
    if pattern == "addition_decimaux":
        enonce = f"{qui} court {sa} km le matin et {sb} km le soir. Combien de kilomètres en tout ?"
        steps = ["On additionne en alignant les virgules.", f"{sa} + {sb} = {st}."]
    else:
        enonce = f"Une corde mesure {sa} m. {qui} en coupe {sb} m. Combien de mètres reste-t-il ?"
        steps = ["On soustrait en alignant les virgules.", f"{sa} - {sb} = {st}."]
    return _exo(pattern, niveau, enonce, st, steps, {"a": sa, "b": sb},
                format_reponse="decimal", equivalences=[st.replace(",", ".")])


def _perimetre(pattern: str, niveau: str, theme: str | None) -> dict:
    lo, la = random.randint(6, 25), random.randint(3, 15)
    if lo == la:
        lo += 1
    qui, = _personnages(theme, 1)
    return _exo(pattern, niveau, f"Le jardin rectangulaire de {qui} mesure {lo} m sur {la} m. Quelle longueur de grillage faut-il pour en faire le tour ?", 2 * (lo + la), [
        "Faire le tour, c'est le périmètre : 2 × (longueur + largeur).",
        f"2 × ({lo} + {la}) = {2 * (lo + la)} m.",
    ], {"longueur": lo, "largeur": la})


RECITS = {
    "addition_pas_a_pas_sans_retenue": _ajout,
    "partie_tout_addition_non_narratif": _ajout,
    "addition_2chiffres_sans_retenue": _ajout,
    "addition_posee": _ajout,
    "addition_ligne_decomposee": _ajout,
    "partie_tout_soustraction_non_narratif": _retrait,
    "soustraction_passage_dizaine": _retrait,
    "soustraction_posee": _retrait,
    "ecart_entre_nombres": _comparaison,
    "addition_repetee_somme": _groupes,
    "addition_repetee_vers_multiplication": _groupes,
    "multiplication_par_10": _groupes,
    "multiplication_chiffre_x_multiple_de_10": _groupes,
    "multiplication_decomposee_chiffre_x_2chiffres": _groupes,
    "multiplication_posee_2chiffres": _groupes,
    "multiplication_groupes_egaux_modele": _groupes,
    "division_exacte_partage": _partage,
    "double_via_2xn": _double_moitie,
    "moitie_via_2xn": _double_moitie,
    "monnaie_valeur": _achat,
    "conversion_kg_g": _masse,
    "masse_kg_g_mixte": _masse,
    "conversion_cm_mm_vers_mm": _longueur,
    "lecture_regle": _longueur,
    "addition_durees_min": _duree,
    "conversion_duree_min": _duree,
    "fraction_quantite": _fraction,
    "pourcentage_d_une_quantite": _pourcentage,
    "addition_decimaux": _decimaux,
    "soustraction_decimaux": _decimaux,
    "figure_cotee_simple": _perimetre,
}


def recit_disponible(pattern: str) -> bool:
    return pattern in RECITS


def generer_recit(pattern: str, niveau: str, theme: str | None = None) -> dict:
    if pattern not in RECITS:
        raise ValueError(f"Pas de probleme raconte pour {pattern}.")
    return RECITS[pattern](pattern, niveau, theme)
