/* ============================================================
   CONTENU DES MINI-JEUX : tire de la lecon qui vient de finir
   ------------------------------------------------------------
   Le mini-jeu de fin de lecon est une recompense facultative, mais il
   parle de CE QU'ON VIENT D'APPRENDRE : apres une lecon sur les
   doubles, le memory associe « double de 7 » et « 14 » ; apres les
   solides, « cube » et « 6 faces ».

   Une seule fonction publique : itemsPourConcepts(concepts, niveau,
   random, combien) renvoie des cartes { question, reponse, valeur,
   leurres } :
     - question : texte court (tient sur une carte de memory) ;
     - reponse  : la bonne reponse, en texte ;
     - valeur   : la meme reponse en nombre ENTIER quand c'en est un
                  (la chasse aux bulles n'utilise que celles-la), sinon
                  null ;
     - leurres  : 2 a 4 mauvaises reponses plausibles, en texte (pour
                  le jeu du vrai ou faux) ;
     - liaison  : comment lier question et reponse dans une phrase
                  (« 47 + 8 = 55 », « 3 côtés égaux → équilatéral »).
   Les concepts sont les pattern_name de la lecon (session.concepts). Un
   pattern inconnu retombe sur un calcul adapte au niveau : le module
   ne plante jamais et renvoie toujours des cartes.

   Pur (hasard injecte, aucun DOM) : teste par test_minijeux_contenu.js.
   ============================================================ */
(function () {
  function rang(niveau) {
    const m = String(niveau || "").match(/(\d+)/);
    return m ? Math.min(6, Math.max(1, Number(m[1]))) : 3;
  }

  function outils(random) {
    const rnd = typeof random === "function" ? random : Math.random;
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const un = (liste) => liste[Math.floor(rnd() * liste.length)];
    return { rnd, ri, un };
  }

  /* Ecriture francaise : virgule decimale, espace des milliers. */
  function nombre(n) {
    const arrondi = Math.round(n * 100) / 100;
    const [ent, dec] = String(arrondi).split(".");
    const entier = ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? `${entier},${dec}` : entier;
  }

  /* Leurres numeriques : erreurs typiques (±1, ±10, ±pas), distincts,
     positifs, jamais egaux a la bonne reponse. */
  function leurresNombres(bon, pas = 1, unite = "") {
    const candidats = [bon + pas, bon - pas, bon + 10 * pas, bon - 10 * pas, bon + 2 * pas, bon + 1];
    const vus = new Set([String(bon)]);
    const sortie = [];
    for (const c of candidats) {
      const v = Math.round(c * 100) / 100;
      if (v > 0 && !vus.has(String(v))) {
        vus.add(String(v));
        sortie.push(`${nombre(v)}${unite}`);
      }
      if (sortie.length >= 3) break;
    }
    return sortie;
  }

  function carte(question, bon, { unite = "", pas = 1, leurres, liaison = " = " } = {}) {
    const entier = Number.isInteger(bon) ? bon : null;
    return {
      question,
      reponse: `${nombre(bon)}${unite}`,
      valeur: unite ? null : entier,
      leurres: leurres || leurresNombres(bon, pas, unite),
      liaison,
    };
  }

  function carteTexte(question, reponse, leurres) {
    return { question, reponse, valeur: null, leurres, liaison: " → " };
  }

  const FLECHE = { liaison: " → " };

  /* ---------- Generateurs par famille de concepts ---------- */
  const G = {
    addition(o, r) {
      const max = [0, 20, 100, 1000, 1000, 1000, 1000][r];
      const a = o.ri(2, Math.floor(max * 0.6));
      const b = o.ri(2, max - a);
      return carte(`${a} + ${b}`, a + b);
    },
    soustraction(o, r) {
      const max = [0, 20, 100, 1000, 1000, 1000, 1000][r];
      const a = o.ri(Math.floor(max / 3), max);
      const b = o.ri(1, a - 1);
      return carte(`${a} − ${b}`, a - b);
    },
    table(o) {
      const a = o.ri(2, 9);
      const b = o.ri(2, 9);
      return carte(`${a} × ${b}`, a * b, { pas: a });
    },
    fois10(o) {
      const a = o.ri(2, 99);
      return carte(`${a} × 10`, a * 10, { pas: 10 });
    },
    foisMultiple10(o) {
      const a = o.ri(2, 9);
      const b = o.ri(2, 9) * 10;
      return carte(`${a} × ${b}`, a * b, { pas: 10 });
    },
    division(o) {
      const b = o.ri(2, 9);
      const q = o.ri(2, 9);
      return carte(`${b * q} ÷ ${b}`, q);
    },
    moitie(o) {
      const n = o.ri(2, 30) * 2;
      return carte(`moitié de ${n}`, n / 2);
    },
    double(o) {
      const n = o.ri(2, 40);
      return carte(`double de ${n}`, n * 2);
    },
    facteurDe2(o) {
      const n = o.ri(2, 10);
      return carte(`2 × ? = ${2 * n}`, n, { liaison: " ; ? = " });
    },
    decomposition(o) {
      const c = o.ri(1, 9);
      const d = o.ri(1, 9);
      const u = o.ri(1, 9);
      return carte(`${c * 100} + ${d * 10} + ${u}`, c * 100 + d * 10 + u, { pas: 10 });
    },
    suite(o) {
      const pas = o.un([2, 5, 10]);
      const depart = o.ri(1, 9) * pas;
      return carte(`${depart}, ${depart + pas}, ${depart + 2 * pas}, ?`, depart + 3 * pas, { pas, liaison: " ; ? = " });
    },
    cmMm(o) {
      const cm = o.ri(2, 15);
      return carte(`${cm} cm en mm`, cm * 10, { unite: " mm", pas: 10 });
    },
    kgG(o) {
      const kg = o.ri(2, 9);
      return carte(`${kg} kg en g`, kg * 1000, { unite: " g", pas: 100 });
    },
    heuresMin(o) {
      const h = o.ri(1, 5);
      return carte(`${h} h en min`, h * 60, { unite: " min", pas: 10 });
    },
    minSec(o) {
      const m = o.ri(1, 5);
      return carte(`${m} min en s`, m * 60, { unite: " s", pas: 10 });
    },
    heure(o) {
      return o.un([
        carteTexte("une heure", "60 min", ["30 min", "100 min", "15 min"]),
        carteTexte("une demi-heure", "30 min", ["50 min", "15 min", "60 min"]),
        carteTexte("un quart d'heure", "15 min", ["25 min", "30 min", "10 min"]),
        carteTexte("trois quarts d'heure", "45 min", ["75 min", "30 min", "34 min"]),
      ]);
    },
    dureeMin(o) {
      const a = o.ri(10, 40);
      const b = o.ri(5, 60 - a);
      return carte(`${a} min + ${b} min`, a + b, { unite: " min" });
    },
    decimaux(o) {
      const a = o.ri(11, 89) / 10;
      const b = o.ri(11, 89) / 10;
      return o.rnd() < 0.5
        ? carte(`${nombre(a)} + ${nombre(b)}`, Math.round((a + b) * 10) / 10, { pas: 0.1 })
        : carte(`${nombre(Math.max(a, b))} − ${nombre(Math.min(a, b))}`, Math.round(Math.abs(a - b) * 10) / 10, { pas: 0.1 });
    },
    fractionQuantite(o) {
      const d = o.un([2, 3, 4, 5, 10]);
      const k = o.ri(1, 9);
      return carte(`1/${d} de ${d * k}`, k);
    },
    fractionEquivalente(o) {
      return o.un([
        carteTexte("1/2", "50 %", ["20 %", "12 %", "25 %"]),
        carteTexte("1/4", "25 %", ["40 %", "14 %", "50 %"]),
        carteTexte("3/4", "75 %", ["34 %", "70 %", "60 %"]),
        carteTexte("1/10", "10 %", ["1 %", "110 %", "20 %"]),
        carteTexte("0,5", "1/2", ["1/5", "5/1", "1/4"]),
        carteTexte("0,25", "1/4", ["2/5", "1/25", "1/2"]),
      ]);
    },
    pourcentage(o) {
      const p = o.un([10, 20, 25, 50]);
      const base = o.un([20, 40, 60, 80, 100, 200]);
      return carte(`${p} % de ${base}`, (p * base) / 100);
    },
    proportionnalite(o) {
      const prix = o.ri(2, 9);
      const n = o.ri(2, 6);
      const m = o.ri(2, 9);
      return carte(`${n} cahiers : ${n * prix} DH. ${m} cahiers ?`, m * prix, { unite: " DH", pas: prix, ...FLECHE });
    },
    vitesse(o) {
      const v = o.un([40, 50, 60, 80, 90]);
      const h = o.ri(2, 4);
      return carte(`${v} km/h pendant ${h} h`, v * h, { unite: " km", pas: 10, ...FLECHE });
    },
    echelle(o) {
      const k = o.un([10, 50, 100]);
      const cm = o.ri(2, 9);
      return carte(`1 cm = ${k} m. ${cm} cm sur le plan ?`, k * cm, { unite: " m", pas: k, ...FLECHE });
    },
    perimetre(o) {
      const c = o.ri(3, 12);
      return o.rnd() < 0.5
        ? carte(`périmètre d'un carré de côté ${c} cm`, 4 * c, { unite: " cm", pas: c })
        : carte(`aire d'un carré de côté ${c} cm`, c * c, { unite: " cm²", pas: c });
    },
    cercle(o) {
      const r = o.ri(2, 15);
      return o.rnd() < 0.5
        ? carte(`rayon ${r} cm, diamètre ?`, 2 * r, { unite: " cm", ...FLECHE })
        : carte(`diamètre ${2 * r} cm, rayon ?`, r, { unite: " cm", ...FLECHE });
    },
    triangle(o) {
      return o.un([
        carteTexte("3 côtés égaux", "équilatéral", ["isocèle", "scalène", "rectangle"]),
        carteTexte("2 côtés égaux", "isocèle", ["équilatéral", "scalène", "carré"]),
        carteTexte("3 côtés différents", "scalène", ["isocèle", "équilatéral", "losange"]),
        carteTexte("un angle droit", "triangle rectangle", ["triangle obtus", "triangle aigu", "carré"]),
      ]);
    },
    angle(o) {
      return o.un([
        carteTexte("90°", "angle droit", ["angle aigu", "angle obtus", "angle plat"]),
        carteTexte("40°", "angle aigu", ["angle droit", "angle obtus", "angle plat"]),
        carteTexte("130°", "angle obtus", ["angle aigu", "angle droit", "angle plat"]),
        carteTexte("un quart de tour", "90°", ["45°", "180°", "360°"]),
        carteTexte("un demi-tour", "180°", ["90°", "360°", "100°"]),
      ]);
    },
    solide(o) {
      return o.un([
        carteTexte("faces d'un cube", "6", ["4", "8", "12"]),
        carteTexte("arêtes d'un cube", "12", ["6", "8", "10"]),
        carteTexte("sommets d'un cube", "8", ["6", "4", "12"]),
        carteTexte("faces d'une pyramide carrée", "5", ["4", "6", "8"]),
        carteTexte("6 faces carrées", "cube", ["pavé droit", "pyramide", "cylindre"]),
        carteTexte("2 disques et une face courbe", "cylindre", ["cube", "cône", "pyramide"]),
      ]);
    },
    symetrie(o) {
      return o.un([
        carteTexte("axes de symétrie d'un carré", "4", ["2", "1", "8"]),
        carteTexte("axes de symétrie d'un rectangle", "2", ["4", "1", "0"]),
        carteTexte("axes d'un triangle équilatéral", "3", ["1", "2", "6"]),
        carteTexte("axes de symétrie d'un cercle", "une infinité", ["2", "4", "1"]),
      ]);
    },
    prisme(o) {
      const a = o.ri(2, 9);
      const b = o.ri(2, 9);
      return carte(`aire d'un rectangle ${a} cm × ${b} cm`, a * b, { unite: " cm²", pas: a });
    },
    monnaie(o) {
      const billets = o.ri(1, 4);
      const pieces = o.ri(1, 9);
      return carte(`${billets} × 10 DH + ${pieces} × 1 DH`, billets * 10 + pieces, { unite: " DH" });
    },
    arrondi(o) {
      const n = o.ri(11, 99) + o.ri(1, 9) / 10;
      return carte(`${nombre(n)} arrondi à l'unité`, Math.round(n), FLECHE);
    },
  };

  /* Pattern -> famille, par mots-cles (ordre = priorite). Un pattern ajoute
     plus tard est couvert des qu'il porte un de ces mots dans son nom. */
  const REGLES = [
    [/monnaie/, "monnaie"],
    [/moitie/, "moitie"],
    [/double/, "double"],
    [/facteur_manquant/, "facteurDe2"],
    [/decomposition_entiers/, "decomposition"],
    [/multiplication_par_10/, "fois10"],
    [/multiple_de_10|chiffre_x_multiple/, "foisMultiple10"],
    [/suite|ligne_graduee|completer_suite/, "suite"],
    [/cm_mm|lecture_regle|longueur/, "cmMm"],
    [/kg_g|masse/, "kgG"],
    [/temps_secondes/, "minSec"],
    [/conversion_duree|duree_entre/, "heuresMin"],
    [/lecture_heure/, "heure"],
    [/durees_min/, "dureeMin"],
    [/arrondi/, "arrondi"],
    [/fraction_decimal_pourcentage/, "fractionEquivalente"],
    [/decima/, "decimaux"],
    [/fraction/, "fractionQuantite"],
    [/pourcentage/, "pourcentage"],
    [/vitesse/, "vitesse"],
    [/echelle/, "echelle"],
    [/proportionnalite|regle_de_trois|agrandissement/, "proportionnalite"],
    [/cercle|disque|circonference|rayon/, "cercle"],
    [/triangle/, "triangle"],
    [/angle|rotation/, "angle"],
    [/solide/, "solide"],
    [/symetrie/, "symetrie"],
    [/prisme/, "prisme"],
    [/figure_cotee|perimetre|cote_manquant/, "perimetre"],
    [/division|quotient|partage|groupement/, "division"],
    [/multiplication|groupes_egaux|addition_repetee/, "table"],
    [/soustraction|reste|comparaison|difference/, "soustraction"],
    [/addition|total/, "addition"],
  ];

  function familleDe(pattern) {
    const nom = String(pattern || "");
    for (const [motif, famille] of REGLES) {
      if (motif.test(nom)) return famille;
    }
    return null;
  }

  /* Famille de repli quand la lecon n'a aucun concept reconnu (graphiques,
     pictogrammes...) : un calcul de l'age de l'eleve. */
  function familleParDefaut(r) {
    return r <= 2 ? "addition" : "table";
  }

  /* Renvoie `combien` cartes aux REPONSES DISTINCTES (un memory ne doit
     jamais avoir deux cartes reponse identiques), en alternant les concepts
     de la lecon pour que chacun soit represente. */
  function itemsPourConcepts(concepts, niveau, random, combien = 6) {
    const o = outils(random);
    const r = rang(niveau);
    let familles = (Array.isArray(concepts) ? concepts : []).map(familleDe).filter(Boolean);
    if (!familles.length) {
      familles = [familleParDefaut(r)];
    }
    const items = [];
    const reponses = new Set();
    let garde = 0;
    let tour = 0;
    while (items.length < combien && garde < 400) {
      garde += 1;
      const famille = familles[tour % familles.length];
      const item = G[famille](o, r);
      if (reponses.has(item.reponse) || items.some((i) => i.question === item.question)) {
        /* Famille a petit catalogue (vocabulaire) epuisee : on passe a la
           suivante, puis au calcul de repli. */
        if (garde % 8 === 0) tour += 1;
        if (garde > 200) familles = familles.concat(familleParDefaut(r));
        continue;
      }
      reponses.add(item.reponse);
      items.push(item);
      tour += 1;
    }
    return items;
  }

  const api = { itemsPourConcepts, familleDe, nombre, REGLES, GENERATEURS: G };

  if (typeof window !== "undefined") {
    window.ParcoursContenuMiniJeux = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
