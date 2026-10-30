"""Concepts du programme de la periode 4 (P4), CE1 -> CE6.

Ajoutes apres une relecture seance par seance des 150 PowerPoint du ministere
(data/raw/N1..N6, 5 semaines x 5 seances par niveau) : chaque semaine traite
3 ou 4 notions, mais le jeu n'en couvrait parfois qu'une seule, et des notions
entieres manquaient (la monnaie et le partage en CE1, les longueurs a la regle
en CE2, l'arrondi des decimaux en CE4, la regle de trois en CE6...).

Meme contrat que substitution.py : chaque generateur prend le niveau scolaire
et renvoie un exercice complet construit par ``_build_exercise`` (presentations
guide / semi-guide / autonome, reponse attendue, tolerance). La seance source de
chaque concept est citee dans pattern_catalog.json (champ ``examples``).

Le module est importe A LA FIN de substitution.py, qui enregistre
``GENERATEURS_P4`` dans son registre : on ne lit donc les helpers de
substitution qu'a l'appel (``s._build_exercise``), jamais a l'import.
"""

from __future__ import annotations

import random

from generation import substitution as s


def _rang(niveau: str) -> int:
    return int(niveau[-1]) if niveau and niveau[-1].isdigit() else 1


def _qcm(niveau: str, pattern: str, enonce: str, bonne: str, autres: list[str], variables: dict, steps: list[str]) -> dict:
    options = [bonne, *autres]
    random.shuffle(options)
    return s._build_exercise(
        niveau=niveau,
        pattern_name=pattern,
        enonce=enonce,
        variables={**variables, "options": options},
        valeur=bonne,
        format_reponse="choix_multiple",
        equivalences=[bonne],
        steps=steps,
    )


def _exo(niveau: str, pattern: str, enonce: str, valeur, variables: dict, steps: list[str], **kw) -> dict:
    return s._build_exercise(
        niveau=niveau, pattern_name=pattern, enonce=enonce, variables=variables, valeur=valeur, steps=steps, **kw
    )


def _decimal(niveau: str, pattern: str, enonce: str, centiemes: int, variables: dict, steps: list[str]) -> dict:
    texte = s._fmt_dec(centiemes)
    return _exo(
        niveau, pattern, enonce, texte, variables, steps,
        format_reponse="decimal", equivalences=[texte.replace(",", ".")],
    )


# ============================================================
#  CE1 -- semaine 4 : la monnaie (النقود)
#  Pieces de 1, 2, 5 et 10 DH ; billets de 20 et 50 DH. Le corpus fait
#  « calculer la valeur de ces pieces » en partant de la plus grande, puis
#  « echanger » des pieces contre un billet de meme valeur.
# ============================================================
PIECES = (1, 2, 5, 10)
BILLETS = (20, 50)


def _libelle_monnaie(valeur: int) -> str:
    return f"{'billet' if valeur in BILLETS else 'pièce'} de {valeur} DH"


def generer_monnaie_valeur(niveau: str = "CE1") -> dict:
    """Valeur d'un petit tas de pieces et billets (rendu : monnaieSvg)."""
    while True:
        nb = random.randint(2, 5)
        tas = sorted(random.choices(PIECES + BILLETS[:1], weights=(3, 3, 3, 3, 2), k=nb), reverse=True)
        total = sum(tas)
        if total <= 99 and len(set(tas)) >= 2:
            break
    return _exo(
        niveau, "monnaie_valeur", "Combien d'argent y a-t-il ? Écris la somme en dirhams.", total,
        {"forme": "monnaie", "monnaie": tas},
        [
            "On commence par la plus grande valeur, puis on ajoute les autres.",
            " + ".join(str(v) for v in tas) + f" = {total} DH.",
        ],
    )


def _decompositions(cible: int, max_pieces: int = 5) -> list[list[int]]:
    """Facons de faire `cible` avec 2 a `max_pieces` pieces ou billets
    (20, 10, 5, 2, 1), en ordre decroissant -- jamais le billet seul."""
    valeurs = (20, 10, 5, 2, 1)
    facons: list[list[int]] = []

    def chercher(reste: int, depuis: int, tas: list[int]) -> None:
        if reste == 0:
            if len(tas) >= 2:
                facons.append(tas.copy())
            return
        if len(tas) == max_pieces:
            return
        for i in range(depuis, len(valeurs)):
            if valeurs[i] <= reste and valeurs[i] < cible:
                tas.append(valeurs[i])
                chercher(reste - valeurs[i], i, tas)
                tas.pop()

    chercher(cible, 0, [])
    return facons


def generer_monnaie_echange(niveau: str = "CE1") -> dict:
    """Quelles pieces ont la meme valeur qu'un billet ou qu'une piece ?
    (corpus : « ابادل » -- echanger contre un billet de 20 ou de 50 DH).
    La piece de 10 DH s'ajoute aux deux billets pour varier les cibles."""
    cible = random.choice([10, 20, 20, 50, 50])
    nom_cible = "une pièce de 10 DH" if cible == 10 else f"un billet de {cible} DH"
    bonne = random.choice(_decompositions(cible))
    texte_bonne = " + ".join(f"{v} DH" for v in bonne)
    fausses: list[str] = []
    while len(fausses) < 2:
        ecart = random.choice([-5, -2, -1, 1, 2, 5])
        facons = _decompositions(cible + ecart) if cible + ecart > 1 else []
        if not facons:
            continue
        texte = " + ".join(f"{v} DH" for v in random.choice(facons))
        if texte not in fausses and texte != texte_bonne:
            fausses.append(texte)
    groupe = "pièces et billets" if any("20 DH" in t for t in (texte_bonne, *fausses)) else "pièces"
    return _qcm(
        niveau, "monnaie_echange",
        f"Quel groupe de {groupe} a la même valeur qu'{nom_cible} ?",
        texte_bonne, fausses, {"billet": cible},
        [
            "Calcule la valeur de chaque groupe, en commençant par la plus grande.",
            f"{texte_bonne} = {cible} DH : on peut l'échanger contre {nom_cible}.",
        ],
    )


# ============================================================
#  CE1/CE2 -- addition repetee, partage et groupement egaux
#  (CE1 semaine 2 : الجمع المتكرر / التوزيع بالتساوي / التجميع بالتساوي ;
#   CE2 semaine 2 : التوزيع بالتساوي / التجميع بالتساوي)
# ============================================================
_OBJETS_PARTAGE = [
    ("bonbons", "enfants"), ("billes", "amis"), ("oranges", "assiettes"),
    ("crayons", "trousses"), ("ballons", "équipes"), ("gâteaux", "boîtes"),
]


def generer_addition_repetee_somme(niveau: str = "CE1") -> dict:
    terme = random.randint(2, 5)
    fois = random.randint(3, 5)
    total = terme * fois
    expr = " + ".join([str(terme)] * fois)
    return _exo(
        niveau, "addition_repetee_somme", f"Calcule : {expr} = ...", total,
        {"terme": terme, "fois": fois},
        [
            f"Le nombre {terme} se répète {fois} fois.",
            "On ajoute pas à pas : " + ", ".join(str(terme * k) for k in range(1, fois + 1)) + ".",
            f"{expr} = {total}.",
        ],
    )


def generer_partage_equitable(niveau: str = "CE1") -> dict:
    parts = random.randint(2, 4) if _rang(niveau) == 1 else random.randint(2, 6)
    chacun = random.randint(2, 5) if _rang(niveau) == 1 else random.randint(3, 9)
    total = parts * chacun
    objets, receveurs = random.choice(_OBJETS_PARTAGE)
    return _exo(
        niveau, "partage_equitable",
        f"On partage {total} {objets} entre {parts} {receveurs}, à parts égales. Combien en reçoit chacun ?",
        chacun, {"total": total, "parts": parts, "objets": objets},
        [
            f"On distribue les {objets} un par un, chacun à son tour, jusqu'au dernier.",
            f"{total} partagé en {parts} parts égales : {' + '.join([str(chacun)] * parts)} = {total}.",
            f"Chacun reçoit {chacun} {objets}.",
        ],
    )


def generer_groupement_egal(niveau: str = "CE1") -> dict:
    par_groupe = random.randint(2, 5) if _rang(niveau) == 1 else random.randint(3, 9)
    groupes = random.randint(2, 6)
    total = par_groupe * groupes
    objets, _ = random.choice(_OBJETS_PARTAGE)
    return _exo(
        niveau, "groupement_egal",
        f"On range {total} {objets} par paquets de {par_groupe}. Combien de paquets faut-il ?",
        groupes, {"total": total, "par_groupe": par_groupe, "objets": objets},
        [
            f"On entoure les {objets} {par_groupe} par {par_groupe}.",
            f"{' + '.join([str(par_groupe)] * groupes)} = {total} : on compte les groupes.",
            f"Il faut {groupes} paquets.",
        ],
    )


# ============================================================
#  CE1/CE2 -- techniques de calcul (التقنية الاعتيادية للجمع, الطرح)
# ============================================================
def generer_addition_posee(niveau: str = "CE1") -> dict:
    """Addition posee en colonnes, avec ou sans retenue (CE1 : < 100 ;
    CE2 : 3 chiffres)."""
    retenue = random.random() < 0.6
    if _rang(niveau) == 1:
        while True:
            a, b = random.randint(12, 79), random.randint(3, 49)
            if a + b < 100 and ((a % 10 + b % 10 >= 10) == retenue):
                break
    else:
        while True:
            a, b = random.randint(120, 789), random.randint(15, 199)
            if a + b < 1000 and ((a % 10 + b % 10 >= 10) == retenue):
                break
    total = a + b
    u = a % 10 + b % 10
    steps = [f"On pose {a} + {b} en alignant les unités."]
    if u >= 10:
        steps.append(f"Unités : {a % 10} + {b % 10} = {u} ; on écrit {u % 10} et on retient 1 dizaine.")
    else:
        steps.append(f"Unités : {a % 10} + {b % 10} = {u}.")
    steps.append(f"{a} + {b} = {total}.")
    return _exo(niveau, "addition_posee", f"Pose et calcule : {a} + {b} = ...", total, {"a": a, "b": b}, steps)


def generer_soustraction_passage_dizaine(niveau: str = "CE1") -> dict:
    """13 - 8 : on « casse » la dizaine (corpus N1 S3.1 : on fait 10 - 8 = 2,
    puis 2 + 3 = 5)."""
    unites = random.randint(1, 8)
    a = 10 + unites
    b = random.randint(unites + 1, 9)
    d = a - b
    return _exo(
        niveau, "soustraction_passage_dizaine", f"Calcule : {a} - {b} = ...", d,
        {"a": a, "b": b},
        [
            f"On ne peut pas enlever {b} de {unites} : on décompose {a} = 10 + {unites}.",
            f"10 - {b} = {10 - b}, puis {10 - b} + {unites} = {d}.",
            f"{a} - {b} = {d}.",
        ],
    )


def generer_soustraction_posee(niveau: str = "CE2") -> dict:
    """Soustraction posee avec emprunt au moins une fois sur deux."""
    hauts = {2: (120, 999), 3: (300, 9999)}
    lo, hi = hauts.get(_rang(niveau), (120, 999))
    emprunt = random.random() < 0.6
    while True:
        a = random.randint(lo, hi)
        b = random.randint(11, a - 10)
        if (a % 10 < b % 10) == emprunt:
            break
    d = a - b
    steps = [f"On pose {a} - {b} en alignant les unités."]
    if a % 10 < b % 10:
        steps.append(f"Unités : {a % 10} < {b % 10}, on échange une dizaine contre 10 unités : {a % 10 + 10} - {b % 10} = {a % 10 + 10 - b % 10}.")
    steps.append(f"{a} - {b} = {d}.")
    return _exo(niveau, "soustraction_posee", f"Pose et calcule : {a} - {b} = ...", d, {"a": a, "b": b}, steps)


def generer_ecart_entre_nombres(niveau: str = "CE2") -> dict:
    """Comparaison sans recit (corpus N2 حل المسائل المقارنة : 142 - 116 = 26)."""
    b = random.randint(20, 150) if _rang(niveau) == 2 else random.randint(100, 800)
    ecart = random.randint(8, 60) if _rang(niveau) == 2 else random.randint(25, 250)
    a = b + ecart
    forme = random.choice(["depasse", "manque"])
    enonce = (
        f"De combien {a} dépasse-t-il {b} ?" if forme == "depasse"
        else f"Combien faut-il ajouter à {b} pour obtenir {a} ?"
    )
    return _exo(
        niveau, "ecart_entre_nombres", enonce, ecart, {"a": a, "b": b, "forme": forme},
        ["L'écart entre deux nombres se trouve par une soustraction : le plus grand moins le plus petit.", f"{a} - {b} = {ecart}."],
    )


def generer_addition_ligne_decomposee(niveau: str = "CE2") -> dict:
    """83 + 14 = 93 + 4 = 97 : on decompose le 2e nombre en dizaines et
    unites (corpus N2 S3.1, strategie de calcul rapide)."""
    while True:
        a = random.randint(21, 85)
        d, u = random.randint(1, 4), random.randint(1, 9)
        if a % 10 + u < 10 and a + 10 * d + u < 100:
            break
    b = 10 * d + u
    total = a + b
    return _exo(
        niveau, "addition_ligne_decomposee",
        f"Calcule en décomposant le 2e nombre : {a} + {b} = {a} + {10 * d} + {u} = ...",
        total, {"a": a, "b": b},
        [f"{b} = {10 * d} + {u}.", f"{a} + {10 * d} = {a + 10 * d}, puis {a + 10 * d} + {u} = {total}."],
    )


def generer_completer_suite_pas(niveau: str = "CE1") -> dict:
    """Suite a pas constant, nombre suivant (corpus N1 S2.2 : « on ajoute 5
    a chaque fois », « on ajoute 2 »)."""
    if _rang(niveau) == 1:
        pas = random.choice([2, 5, 10])
        depart = random.randint(0, 6) * (pas if pas != 2 else 1)
    else:
        pas = random.choice([5, 10, 50, 100])
        depart = random.randint(1, 8) * pas + (random.randint(1, 9) if pas >= 50 else 0)
    termes = [depart + k * pas for k in range(4)]
    suivant = depart + 4 * pas
    return _exo(
        niveau, "completer_suite_pas",
        f"Trouve le nombre qui suit : {', '.join(map(str, termes))}, ...", suivant,
        {"termes": termes, "pas": pas},
        [f"On ajoute {pas} à chaque fois.", f"{termes[-1]} + {pas} = {suivant}."],
        format_reponse="nombre_entier",
    )


# ============================================================
#  CE1 -- semaine 3 : classer et compter (تصنيف المعطيات)
# ============================================================
_COLLECTIONS = [
    ("fruits", [("pomme", "pommes", "🍎"), ("orange", "oranges", "🍊"), ("banane", "bananes", "🍌")]),
    ("jouets", [("voiture", "voitures", "🚗"), ("nounours", "nounours", "🧸"), ("ballon", "ballons", "⚽")]),
    ("fournitures", [("crayon", "crayons", "✏️"), ("livre", "livres", "📕"), ("règle", "règles", "📏")]),
]


def generer_classer_compter(niveau: str = "CE1") -> dict:
    """Une collection melangee a trier puis compter (rendu : grille d'icones)."""
    _, especes = random.choice(_COLLECTIONS)
    comptes = random.sample(range(2, 8), 3)
    objets = [e[2] for e, n in zip(especes, comptes) for _ in range(n)]
    random.shuffle(objets)
    question = random.choice(["une", "deux", "plus"])
    if question == "une":
        i = random.randrange(3)
        valeur = comptes[i]
        enonce = f"Trie les objets. Combien y a-t-il de {especes[i][1]} ?"
        steps = [f"On regarde seulement les {especes[i][1]} {especes[i][2]}.", f"On les compte : il y en a {valeur}."]
    elif question == "deux":
        i, j = random.sample(range(3), 2)
        valeur = comptes[i] + comptes[j]
        enonce = f"Combien y a-t-il de {especes[i][1]} et de {especes[j][1]} en tout ?"
        steps = [f"{especes[i][1].capitalize()} : {comptes[i]} ; {especes[j][1]} : {comptes[j]}.", f"{comptes[i]} + {comptes[j]} = {valeur}."]
    else:
        i, j = sorted(random.sample(range(3), 2), key=lambda k: -comptes[k])
        valeur = comptes[i] - comptes[j]
        enonce = f"Combien y a-t-il de {especes[i][1]} de plus que de {especes[j][1]} ?"
        steps = [f"{especes[i][1].capitalize()} : {comptes[i]} ; {especes[j][1]} : {comptes[j]}.", f"{comptes[i]} - {comptes[j]} = {valeur}."]
    return _exo(
        niveau, "classer_compter", enonce, valeur,
        {"forme": "collection", "objets": objets, "categories": [e[1] for e in especes], "comptes": comptes},
        steps,
    )


# ============================================================
#  CE1 -- semaine 1 : lire l'heure, ecriture de l'heure (قراءة الساعة)
# ============================================================
_HEURES_MOTS = ["une", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "midi"]
_MINUTES_MOTS = {5: "cinq", 10: "dix", 20: "vingt", 25: "vingt-cinq"}


def _heure_en_mots(h: int, m: int) -> str:
    """Heure dite comme a l'ecole : « trois heures et quart », « dix heures
    moins le quart », « sept heures vingt »."""
    def nom(heure: int) -> str:
        heure = (heure - 1) % 12 + 1
        return "midi" if heure == 12 else f"{_HEURES_MOTS[heure - 1]} heure{'s' if heure > 1 else ''}"
    if m == 0:
        return nom(h)
    if m == 15:
        return f"{nom(h)} et quart"
    if m == 30:
        return f"{nom(h)} et demie"
    if m == 45:
        return f"{nom(h + 1)} moins le quart"
    if m < 30:
        return f"{nom(h)} {_MINUTES_MOTS[m]}"
    return f"{nom(h + 1)} moins {_MINUTES_MOTS[60 - m]}"


def generer_heure_ecrite(niveau: str = "CE1") -> dict:
    """« trois heures et demie » -> 3:30. CE1 : heures pleines et demies
    (les deux seances قراءة الساعة) ; CE3 : heures et minutes, de 5 en 5
    (قراءة الساعات : الساعات والدقائق)."""
    h = random.randint(1, 11)
    if _rang(niveau) == 1:
        m = random.choice([0, 30])
    else:
        m = random.choice([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    mots = _heure_en_mots(h, m)
    bonne = f"{h}:{m:02d}"
    if _rang(niveau) == 1:
        candidats = {f"{h}:{30 - m:02d}", f"{h % 12 + 1}:{m:02d}", f"{h}:15", f"{max(1, h - 1)}:30"}
    else:
        # Erreurs typiques : « moins le quart » lu sur l'heure d'avant/apres,
        # minutes et complement a 60 confondus.
        candidats = {f"{h + 1}:{m:02d}" if h < 11 else f"1:{m:02d}", f"{h}:{(60 - m) % 60:02d}", f"{max(1, h - 1)}:{m:02d}", f"{h}:{(m + 10) % 60:02d}"}
    candidats.discard(bonne)
    return _qcm(
        niveau, "heure_ecrite", f"Comment écrit-on « {mots} » ?", bonne, random.sample(sorted(candidats), 2),
        {"heure": h, "minute": m},
        ["Le nombre avant les deux points, ce sont les heures ; après, les minutes.", f"« {mots} » s'écrit {bonne}."],
    )


# ============================================================
#  CE2 -- semaine 3 : les longueurs (الأطوال) -- lecture a la regle
# ============================================================
def generer_lecture_regle(niveau: str = "CE2") -> dict:
    """Segment pose sur une regle graduee en cm et mm (rendu : regleSvg).
    Le corpus fait lire « 5 cm 7 mm » puis convertir en mm."""
    cm = random.randint(2, 11)
    mm = random.choice([0, random.randint(1, 9)])
    total_mm = cm * 10 + mm
    if mm == 0:
        enonce = "Quelle est la longueur du segment, en cm ?"
        valeur = cm
        steps = ["On place le 0 de la règle au début du segment.", f"Le segment s'arrête sur la graduation {cm} : il mesure {cm} cm."]
    else:
        enonce = "Quelle est la longueur du segment, en mm ?"
        valeur = total_mm
        steps = [
            f"On lit d'abord les centimètres entiers : {cm} cm, puis les petits traits : {mm} mm.",
            f"{cm} cm {mm} mm = {cm * 10} mm + {mm} mm = {total_mm} mm.",
        ]
    return _exo(niveau, "lecture_regle", enonce, valeur, {"forme": "regle", "longueur_mm": total_mm, "cm": cm, "mm": mm}, steps)


# ============================================================
#  CE3 -- masses : g et kg (وحدات قياس الكتل : تحويلات)
# ============================================================
def generer_masse_kg_g_mixte(niveau: str = "CE3") -> dict:
    kg = random.randint(1, 9)
    g = random.choice([random.randint(1, 9) * 100, random.randint(1, 99) * 10, random.randint(101, 999)])
    total = kg * 1000 + g
    return _exo(
        niveau, "masse_kg_g_mixte", f"Complète : {kg} kg {g} g = ... g", total, {"kg": kg, "g": g},
        [f"1 kg = 1 000 g, donc {kg} kg = {kg * 1000} g.", f"{kg * 1000} g + {g} g = {total} g."],
    )


# ============================================================
#  CE3/CE5 -- le cercle : rayon et diametre (الدائرة وعناصرها)
# ============================================================
def generer_rayon_diametre(niveau: str = "CE3") -> dict:
    r = random.randint(2, 15) if _rang(niveau) <= 3 else random.randint(3, 40)
    if random.random() < 0.5:
        return _exo(
            niveau, "rayon_diametre", f"Le rayon d'un cercle mesure {r} cm. Combien mesure son diamètre, en cm ?", 2 * r,
            {"rayon": r, "cible": "diametre"}, ["Le diamètre vaut deux rayons : d = 2 × r.", f"2 × {r} = {2 * r} cm."],
        )
    return _exo(
        niveau, "rayon_diametre", f"Le diamètre d'un cercle mesure {2 * r} cm. Combien mesure son rayon, en cm ?", r,
        {"rayon": r, "cible": "rayon"}, ["Le rayon est la moitié du diamètre : r = d ÷ 2.", f"{2 * r} ÷ 2 = {r} cm."],
    )


# ============================================================
#  CE3/CE4 -- symetrie : lettres symetriques (التماثل)
# ============================================================
_LETTRES_SYMETRIQUES = "AHMOTUVWXY" + "BCDEK"
_LETTRES_NON_SYMETRIQUES = "FGJLNPQRSZ"


def generer_symetrie_lettre(niveau: str = "CE3") -> dict:
    if random.random() < 0.5:
        bonne = random.choice(_LETTRES_SYMETRIQUES)
        autres = random.sample(_LETTRES_NON_SYMETRIQUES, 2)
        enonce = "Quelle lettre a un axe de symétrie ?"
        explication = f"En pliant la lettre {bonne} le long d'un axe, les deux moitiés se superposent."
    else:
        bonne = random.choice(_LETTRES_NON_SYMETRIQUES)
        autres = random.sample(_LETTRES_SYMETRIQUES, 2)
        enonce = "Quelle lettre n'a AUCUN axe de symétrie ?"
        explication = f"Quel que soit le pli, les deux moitiés de {bonne} ne se superposent pas."
    return _qcm(
        niveau, "symetrie_lettre", enonce, bonne, autres, {},
        ["Une figure a un axe de symétrie si on peut la plier pour que les deux moitiés se superposent.", explication],
    )


# ============================================================
#  CE3 -- trouver le tout (parts egales) (البحث عن الكل : أجزاء متساوية)
# ============================================================
def generer_tout_parts_egales(niveau: str = "CE3") -> dict:
    parts = random.randint(3, 8)
    part = random.randint(4, 25)
    tout = parts * part
    debut, verbe, unite = random.choice([
        ("Un ruban est coupé", "mesure", "cm"),
        ("Un champ est partagé", "mesure", "m"),
        ("Une somme d'argent est partagée", "vaut", "DH"),
    ])
    question = "Combien mesure le ruban entier" if unite == "cm" else (
        "Combien mesure le champ entier" if unite == "m" else "Combien vaut la somme entière")
    return _exo(
        niveau, "tout_parts_egales",
        f"{debut} en {parts} parts égales. Chaque part {verbe} {part} {unite}. {question}, en {unite} ?",
        tout, {"parts": parts, "part": part},
        [f"Le tout est fait de {parts} parts égales de {part} {unite}.", f"{parts} × {part} = {tout} {unite}."],
    )


# ============================================================
#  CE4/CE5 -- angles : nature par la mesure, rotations (قياس الزوايا, دوران)
# ============================================================
def generer_angle_nature_mesure(niveau: str = "CE4") -> dict:
    nature = random.choice(["aigu", "droit", "obtus"])
    mesure = {"aigu": random.randint(10, 85), "droit": 90, "obtus": random.randint(95, 175)}[nature]
    return _qcm(
        niveau, "angle_nature_mesure", f"Un angle mesure {mesure}°. Quel est son type ?", nature,
        [n for n in ("aigu", "droit", "obtus") if n != nature], {"mesure": mesure},
        ["Aigu : moins de 90°. Droit : exactement 90°. Obtus : entre 90° et 180°.", f"{mesure}° : l'angle est {nature}."],
    )


_TOURS = [("un quart de tour", 90), ("un demi-tour", 180), ("trois quarts de tour", 270), ("un tour complet", 360)]


def generer_rotation_fraction_tour(niveau: str = "CE4") -> dict:
    nom, degres = random.choice(_TOURS)
    if random.random() < 0.5:
        return _exo(
            niveau, "rotation_fraction_tour", f"Une figure fait {nom}. De combien de degrés a-t-elle tourné ?",
            degres, {"tour": nom},
            ["Un tour complet = 360° ; un demi-tour = 180° ; un quart de tour = 90°.", f"{nom.capitalize()} = {degres}°."],
        )
    autres = [n for n, _ in _TOURS if n != nom]
    return _qcm(
        niveau, "rotation_fraction_tour", f"Une rotation de {degres}°, c'est :", nom, random.sample(autres, 2),
        {"degres": degres},
        ["Un tour complet = 360° ; un demi-tour = 180° ; un quart de tour = 90°.", f"{degres}° = {nom}."],
    )


# ============================================================
#  CE4 -- nombres decimaux (4), (5), (6) : composer, ranger, arrondir
# ============================================================
def generer_decimal_composer(niveau: str = "CE4") -> dict:
    """10 + 9 + 0,6 + 0,07 = 19,67, ou « 7 unites et 3 dixiemes » = 7,3."""
    if random.random() < 0.5:
        d, u, di, c = random.randint(1, 9), random.randint(0, 9), random.randint(1, 9), random.randint(1, 9)
        termes = [str(d * 10), str(u)] if u else [str(d * 10)]
        termes += [f"0,{di}", f"0,0{c}"]
        cent = d * 1000 + u * 100 + di * 10 + c
        enonce = "Écris le nombre décimal : " + " + ".join(termes) + " = ..."
        steps = ["On place chaque terme à son rang : dizaines, unités, dixièmes, centièmes.", " + ".join(termes) + f" = {s._fmt_dec(cent)}."]
    else:
        u, di = random.randint(1, 30), random.randint(1, 9)
        cent = u * 100 + di * 10
        enonce = f"Écris le nombre : {u} unité{'s' if u > 1 else ''} et {di} dixième{'s' if di > 1 else ''} = ..."
        steps = ["Les dixièmes s'écrivent juste après la virgule.", f"{u} unités et {di} dixièmes = {s._fmt_dec(cent)}."]
    return _decimal(niveau, "decimal_composer", enonce, cent, {"centiemes": cent}, steps)


def generer_decimal_ranger(niveau: str = "CE4") -> dict:
    """Le plus petit / le plus grand de trois decimaux de meme partie
    entiere (corpus : 9,2 ; 9,02 ; 9,13)."""
    entier = random.randint(1, 30)
    decs = set()
    while len(decs) < 3:
        decs.add(random.choice([random.randint(1, 9) * 10, random.randint(1, 99)]))
    valeurs = [entier * 100 + d for d in decs]
    cherche = random.choice(["petit", "grand"])
    cible = min(valeurs) if cherche == "petit" else max(valeurs)
    textes = [s._fmt_dec(v) for v in valeurs]
    bonne = s._fmt_dec(cible)
    return _qcm(
        niveau, "decimal_ranger", f"Quel est le plus {cherche} nombre : {' ; '.join(textes)} ?", bonne,
        [t for t in textes if t != bonne], {},
        [
            f"La partie entière est la même ({entier}) : on compare les dixièmes, puis les centièmes.",
            "Rangés : " + " < ".join(s._fmt_dec(v) for v in sorted(valeurs)) + f". Le plus {cherche} est {bonne}.",
        ],
    )


def generer_arrondi_decimal(niveau: str = "CE4") -> dict:
    """Arrondi a l'unite ou au dixieme le plus proche (et, comme le
    rappel du corpus, a la dizaine ou centaine d'un entier)."""
    forme = random.choice(["unite", "dixieme", "dizaine"])
    if forme == "dizaine":
        n = random.randint(11, 989)
        while n % 10 == 5 or n % 10 == 0:
            n = random.randint(11, 989)
        arr = round(n / 10) * 10
        return _exo(
            niveau, "arrondi_decimal", f"Quelle est la dizaine la plus proche de {n} ?", arr, {"nombre": n, "forme": forme},
            [f"{n} est entre {n // 10 * 10} et {n // 10 * 10 + 10}.", f"Le plus proche est {arr}."],
        )
    while True:
        cent = random.randint(110, 9989)
        if forme == "unite" and cent % 100 != 50 and cent % 100:
            break
        if forme == "dixieme" and cent % 10 not in (0, 5):
            break
    if forme == "unite":
        arr = (cent + 50) // 100
        return _exo(
            niveau, "arrondi_decimal", f"Arrondis {s._fmt_dec(cent)} à l'unité la plus proche.", arr,
            {"centiemes": cent, "forme": forme},
            [f"{s._fmt_dec(cent)} est entre {cent // 100} et {cent // 100 + 1}.", f"Le dixième est {cent // 10 % 10} : l'unité la plus proche est {arr}."],
        )
    arr_cent = (cent + 5) // 10 * 10
    return _decimal(
        niveau, "arrondi_decimal", f"Arrondis {s._fmt_dec(cent)} au dixième le plus proche.", arr_cent,
        {"centiemes": cent, "forme": forme},
        [f"{s._fmt_dec(cent)} est entre {s._fmt_dec(cent // 10 * 10)} et {s._fmt_dec(cent // 10 * 10 + 10)}.", f"Le plus proche est {s._fmt_dec(arr_cent)}."],
    )


# ============================================================
#  CE4 -> CE6 -- proportionnalite (حل مسائل التناسبية, القاعدة الثلاثية)
# ============================================================
_ARTICLES_PRIX = [("cahiers", "cahier"), ("stylos", "stylo"), ("baguettes", "baguette"), ("livres", "livre"), ("bouteilles d'eau", "bouteille d'eau")]


def generer_proportionnalite_prix(niveau: str = "CE4") -> dict:
    prix = random.randint(2, 15)
    n = random.randint(2, 6)
    m = random.choice([k for k in range(2, 13) if k != n])
    articles, _ = random.choice(_ARTICLES_PRIX)
    return _exo(
        niveau, "proportionnalite_prix", f"{n} {articles} coûtent {n * prix} DH. Combien coûtent {m} {articles}, en DH ?",
        m * prix, {"n": n, "m": m, "prix": prix},
        [f"On cherche d'abord le prix d'un seul : {n * prix} ÷ {n} = {prix} DH.", f"Puis {m} × {prix} = {m * prix} DH."],
    )


def generer_regle_de_trois(niveau: str = "CE6") -> dict:
    """Quatrieme proportionnelle par passage a l'unite (corpus N6 S2.1 :
    copies d'une imprimante, pieces produites en n heures)."""
    contexte = random.choice([
        ("Une imprimante fait {a} copies en {x} secondes.", "Combien de copies fait-elle en {y} secondes ?", "copies"),
        ("Une machine fabrique {a} pièces en {x} heures.", "Combien de pièces fabrique-t-elle en {y} heures ?", "pièces"),
        ("Un robinet remplit {a} litres en {x} minutes.", "Combien de litres remplit-il en {y} minutes ?", "litres"),
    ])
    unite = random.randint(3, 25)
    x = random.randint(2, 9)
    y = random.choice([k for k in range(2, 15) if k != x])
    a = unite * x
    debut, question, nom = contexte
    return _exo(
        niveau, "regle_de_trois", debut.format(a=a, x=x) + " " + question.format(y=y), unite * y,
        {"a": a, "x": x, "y": y},
        [f"Pour 1 : {a} ÷ {x} = {unite} {nom}.", f"Pour {y} : {unite} × {y} = {unite * y} {nom}."],
    )


def generer_proportionnalite_reconnaitre(niveau: str = "CE6") -> dict:
    coef = random.randint(2, 9)
    xs = sorted(random.sample(range(1, 11), 3))
    ys = [x * coef for x in xs]
    proportionnel = random.random() < 0.5
    if not proportionnel:
        i = random.randrange(3)
        ys[i] += random.choice([1, 2, 3] if ys[i] <= 3 else [-2, -1, 1, 2, 3])
    paires = " ; ".join(f"{x} → {y}" for x, y in zip(xs, ys))
    bonne = "oui" if proportionnel else "non"
    rapports = ", ".join(f"{y} ÷ {x}" + (f" = {y // x}" if y % x == 0 else " (pas entier)") for x, y in zip(xs, ys))
    return _qcm(
        niveau, "proportionnalite_reconnaitre", f"Ce tableau est-il un tableau de proportionnalité ? {paires}", bonne,
        ["non" if proportionnel else "oui"], {"x": xs, "y": ys},
        ["Un tableau est proportionnel si on passe de chaque nombre au suivant en multipliant toujours par le même nombre.", f"{rapports} : {'oui, toujours ×' + str(coef) if proportionnel else 'le coefficient change, donc non'}."],
    )


# ============================================================
#  CE4/CE5 -- perimetre : retrouver le cote (المحيط)
# ============================================================
_POLYGONES = {3: "triangle équilatéral", 4: "carré", 5: "pentagone régulier", 6: "hexagone régulier", 8: "octogone régulier"}


def generer_cote_manquant_perimetre(niveau: str = "CE4") -> dict:
    n = 4 if _rang(niveau) == 4 and random.random() < 0.7 else random.choice(list(_POLYGONES))
    cote = random.randint(3, 15)
    nom = _POLYGONES[n]
    return _exo(
        niveau, "cote_manquant_perimetre", f"Le périmètre d'un {nom} est {n * cote} cm. Combien mesure un côté, en cm ?",
        cote, {"n_cotes": n, "perimetre": n * cote},
        [f"Un {nom} a {n} côtés égaux : périmètre = {n} × côté.", f"Côté = {n * cote} ÷ {n} = {cote} cm."],
    )


# ============================================================
#  CE4 -- fraction d'une quantite : retrouver le tout (كسر كمية)
# ============================================================
_FRACTIONS_UNITAIRES = {2: "La moitié", 3: "Le tiers", 4: "Le quart", 5: "Le cinquième", 10: "Le dixième"}


def generer_fraction_quantite_inverse(niveau: str = "CE4") -> dict:
    d = random.choice(list(_FRACTIONS_UNITAIRES))
    part = random.randint(3, 25)
    return _exo(
        niveau, "fraction_quantite_inverse",
        f"{_FRACTIONS_UNITAIRES[d]} d'une somme vaut {part} DH. Combien vaut la somme entière, en DH ?",
        d * part, {"d": d, "part": part},
        [f"{_FRACTIONS_UNITAIRES[d]}, c'est 1 part sur {d} parts égales.", f"La somme entière = {d} × {part} = {d * part} DH."],
    )


def generer_fraction_addition_meme_denominateur(niveau: str = "CE6") -> dict:
    """3/7 + 2/7 (calcul mental du corpus N6 S5.3)."""
    d = random.randint(3, 12)
    a = random.randint(1, d - 2)
    b = random.randint(1, d - a - 1)
    soustraire = random.random() < 0.4
    if soustraire:
        a, b = a + b, b
        n = a - b
        signe = "-"
    else:
        n = a + b
        signe = "+"
    bonne = f"{n}/{d}"
    fausses = {f"{n}/{2 * d}", f"{a * b if signe == '+' else n + 1}/{d}", f"{n + 1}/{d}", f"{n}/{d + 1}"}
    fausses.discard(bonne)
    return _qcm(
        niveau, "fraction_addition_meme_denominateur", f"Calcule : {a}/{d} {signe} {b}/{d} = ...", bonne,
        random.sample(sorted(fausses), 2), {"a": a, "b": b, "d": d},
        ["Même dénominateur : on garde le dénominateur et on calcule les numérateurs.", f"{a} {signe} {b} = {n}, donc {bonne}."],
    )


# ============================================================
#  CE5/CE6 -- pourcentages : prix apres remise, diagramme circulaire
# ============================================================
_ARTICLES_SOLDES = ["un vélo", "un cartable", "une veste", "un ballon", "une montre", "un jeu"]


def generer_pourcentage_prix_final(niveau: str = "CE5") -> dict:
    remise = random.choice([10, 20, 25, 50])
    prix = random.choice([k for k in range(40, 801, 20) if (k * remise) % 100 == 0])
    final = prix - prix * remise // 100
    return _exo(
        niveau, "pourcentage_prix_final",
        f"{random.choice(_ARTICLES_SOLDES).capitalize()} coûte {prix} DH. Il est soldé de {remise} %. Combien coûte-t-il maintenant, en DH ?",
        final, {"prix": prix, "remise": remise},
        [f"La remise : {remise} % de {prix} = {prix * remise // 100} DH.", f"Nouveau prix : {prix} - {prix * remise // 100} = {final} DH."],
    )


def generer_camembert_angle(niveau: str = "CE5") -> dict:
    """Diagramme circulaire : pourcentage <-> angle du secteur (360° = 100 %)."""
    pct = random.choice([5, 10, 20, 25, 30, 40, 50, 75])
    angle = pct * 360 // 100
    if random.random() < 0.6:
        return _exo(
            niveau, "camembert_angle", f"Dans un diagramme circulaire, quel angle correspond à {pct} %, en degrés ?", angle,
            {"pct": pct, "cible": "angle"}, ["Le disque entier (360°) représente 100 %.", f"{pct} % de 360° = {angle}°."],
        )
    return _exo(
        niveau, "camembert_angle", f"Dans un diagramme circulaire, un secteur mesure {angle}°. Quel pourcentage représente-t-il ?",
        pct, {"pct": pct, "cible": "pct"}, ["Le disque entier (360°) représente 100 %.", f"{angle} ÷ 360 × 100 = {pct} %."],
    )


def generer_agrandissement_pourcentage(niveau: str = "CE6") -> dict:
    """Pourcentage d'agrandissement -> coefficient (corpus N6 S4.3)."""
    pct = random.choice([150, 200, 300, 400, 50, 25])
    if pct >= 100:
        coef = s._fmt_dec(pct)
        enonce = f"Agrandir une figure à {pct} %, c'est multiplier ses longueurs par combien ?"
        steps = ["100 % = la taille d'origine (× 1).", f"{pct} % = {pct} ÷ 100 = × {coef}."]
    else:
        coef = s._fmt_dec(pct)
        enonce = f"Réduire une figure à {pct} %, c'est multiplier ses longueurs par combien ?"
        steps = ["100 % = la taille d'origine (× 1) ; en dessous, la figure rétrécit.", f"{pct} % = {pct} ÷ 100 = × {coef}."]
    return _decimal(niveau, "agrandissement_pourcentage", enonce, pct, {"pct": pct}, steps)


# ============================================================
#  CE6 -- vitesse moyenne a partir des horaires, echelle inverse
# ============================================================
def generer_vitesse_horaires(niveau: str = "CE6") -> dict:
    """Le corpus (N6 S3.1) fait d'abord trouver la DUREE a partir des heures
    de depart et d'arrivee, puis la vitesse moyenne."""
    depart = random.randint(6, 14)
    duree = random.randint(2, 5)
    vitesse = random.choice([40, 50, 60, 70, 80, 90, 100, 120])
    distance = vitesse * duree
    vehicule = random.choice(["Un car", "Un train", "Une voiture"])
    return _exo(
        niveau, "vitesse_horaires",
        f"{vehicule} part à {depart} h et arrive à {depart + duree} h. Le trajet fait {distance} km. Quelle est la vitesse moyenne, en km/h ?",
        vitesse, {"depart": depart, "duree": duree, "distance": distance},
        [f"Durée du trajet : {depart + duree} h - {depart} h = {duree} h.", f"Vitesse = distance ÷ durée = {distance} ÷ {duree} = {vitesse} km/h."],
    )


def generer_echelle_distance_plan(niveau: str = "CE6") -> dict:
    """Sens inverse d'echelle_plan : distance reelle -> distance sur le plan."""
    k = random.choice([10, 20, 50, 100, 200, 500])
    cm = random.randint(2, 12)
    reel = k * cm
    lieu = random.choice(["deux villages", "l'école et le parc", "deux fermes", "la gare et le marché"])
    return _exo(
        niveau, "echelle_distance_plan",
        f"Sur un plan, 1 cm représente {k} m. En vrai, {lieu} sont à {reel} m de distance. Combien de cm les séparent sur le plan ?",
        cm, {"k": k, "reel": reel},
        [f"Chaque centimètre du plan représente {k} m.", f"{reel} ÷ {k} = {cm} cm."],
    )


GENERATEURS_P4 = {
    "monnaie_valeur": generer_monnaie_valeur,
    "monnaie_echange": generer_monnaie_echange,
    "addition_repetee_somme": generer_addition_repetee_somme,
    "partage_equitable": generer_partage_equitable,
    "groupement_egal": generer_groupement_egal,
    "addition_posee": generer_addition_posee,
    "soustraction_passage_dizaine": generer_soustraction_passage_dizaine,
    "soustraction_posee": generer_soustraction_posee,
    "ecart_entre_nombres": generer_ecart_entre_nombres,
    "addition_ligne_decomposee": generer_addition_ligne_decomposee,
    "completer_suite_pas": generer_completer_suite_pas,
    "classer_compter": generer_classer_compter,
    "heure_ecrite": generer_heure_ecrite,
    "lecture_regle": generer_lecture_regle,
    "masse_kg_g_mixte": generer_masse_kg_g_mixte,
    "rayon_diametre": generer_rayon_diametre,
    "symetrie_lettre": generer_symetrie_lettre,
    "tout_parts_egales": generer_tout_parts_egales,
    "angle_nature_mesure": generer_angle_nature_mesure,
    "rotation_fraction_tour": generer_rotation_fraction_tour,
    "decimal_composer": generer_decimal_composer,
    "decimal_ranger": generer_decimal_ranger,
    "arrondi_decimal": generer_arrondi_decimal,
    "proportionnalite_prix": generer_proportionnalite_prix,
    "regle_de_trois": generer_regle_de_trois,
    "proportionnalite_reconnaitre": generer_proportionnalite_reconnaitre,
    "cote_manquant_perimetre": generer_cote_manquant_perimetre,
    "fraction_quantite_inverse": generer_fraction_quantite_inverse,
    "fraction_addition_meme_denominateur": generer_fraction_addition_meme_denominateur,
    "pourcentage_prix_final": generer_pourcentage_prix_final,
    "camembert_angle": generer_camembert_angle,
    "agrandissement_pourcentage": generer_agrandissement_pourcentage,
    "vitesse_horaires": generer_vitesse_horaires,
    "echelle_distance_plan": generer_echelle_distance_plan,
}
