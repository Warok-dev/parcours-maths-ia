/* Tests du contenu des mini-jeux de fin de lecon (minijeux_contenu.js).
   Lancer avec : node test_minijeux_contenu.js
   Regles : chaque concept du jeu donne des cartes valides, aux reponses
   distinctes, avec des leurres qui ne sont jamais la bonne reponse ; les
   calculs sont justes. */
const fs = require("fs");
const path = require("path");
const contenu = require("./minijeux_contenu.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  if (!cond) console.log(`KO  ${label}`);
  if (!cond) failures += 1;
}

function graine(n) {
  let x = n;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const lecons = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "backend", "data", "lessons.json"), "utf8"),
).lessons;
const patterns = [...new Set(lecons.flatMap((l) => l.patterns))];

/* --- 1. Tout concept du jeu est rattache a une famille (sauf les
       graphiques, qui retombent volontairement sur un calcul d'age) --- */
for (const p of patterns) {
  if (/^graphique_/.test(p)) continue;
  check(contenu.familleDe(p) !== null, `${p} : famille de cartes connue`);
}
check(contenu.familleDe("regle_de_trois") === "proportionnalite", "regle de trois : pas confondue avec la regle graduee");
check(contenu.familleDe("fraction_decimal_pourcentage") === "fractionEquivalente", "fraction/decimal/% : equivalences");
check(contenu.familleDe("arrondi_decimal") === "arrondi", "arrondi d'un decimal : famille arrondi");
check(contenu.familleDe("triangle_classer_angles") === "triangle", "triangles classes par angles : vocabulaire triangle");
check(contenu.familleDe("inconnu_xyz") === null, "pattern inconnu : null (repli gere par itemsPourConcepts)");

/* --- 2. Cartes valides pour chaque lecon, a chaque niveau --- */
for (const lecon of lecons) {
  for (const niveau of ["CE1", "CE2", "CE3", "CE4", "CE5", "CE6"]) {
    for (let s = 1; s <= 5; s += 1) {
      const items = contenu.itemsPourConcepts(lecon.patterns, niveau, graine(s * 31 + niveau.length), 6);
      const label = `${lecon.lecon_id}/${niveau}/graine ${s}`;
      check(items.length === 6, `${label} : 6 cartes`);
      check(new Set(items.map((i) => i.reponse)).size === items.length, `${label} : reponses distinctes`);
      for (const i of items) {
        check(typeof i.question === "string" && i.question.length > 0, `${label} : question non vide`);
        check(i.question.length <= 40, `${label} : question courte (« ${i.question} »)`);
        check(Array.isArray(i.leurres) && i.leurres.length >= 1, `${label} : au moins un leurre`);
        check(!i.leurres.includes(i.reponse), `${label} : un leurre n'est jamais la bonne reponse (« ${i.question} »)`);
        check(i.valeur === null || Number.isInteger(i.valeur), `${label} : valeur entiere ou nulle`);
        check(typeof i.liaison === "string" && i.liaison.trim().length > 0, `${label} : liaison definie`);
      }
    }
  }
}

/* --- 3. Les calculs sont justes --- */
{
  const G = contenu.GENERATEURS;
  const outils = (s) => {
    const rnd = graine(s);
    return {
      rnd,
      ri: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
      un: (l) => l[Math.floor(rnd() * l.length)],
    };
  };
  const lire = (t) => Number(String(t).replace(/\s/g, "").replace(",", ".").replace(/[^\d.]/g, ""));
  for (let s = 1; s <= 60; s += 1) {
    const add = G.addition(outils(s), 2);
    const [a, b] = add.question.split(" + ").map(Number);
    check(a + b === add.valeur && a + b <= 100, `addition CE2 juste et bornee (${add.question} = ${add.reponse})`);

    const sous = G.soustraction(outils(s), 1);
    const [x, y] = sous.question.split(" − ").map(Number);
    check(x - y === sous.valeur && sous.valeur > 0, `soustraction juste et positive (${sous.question})`);

    const moitie = G.moitie(outils(s));
    check(Number(moitie.question.split(" ").pop()) / 2 === moitie.valeur, `moitie juste (${moitie.question})`);

    const div = G.division(outils(s));
    const [n, d] = div.question.split(" ÷ ").map(Number);
    check(n / d === div.valeur, `division exacte (${div.question})`);

    const dec = G.decimaux(outils(s));
    const [p, q] = dec.question.split(/ [+−] /).map(lire);
    const attendu = dec.question.includes("+") ? p + q : p - q;
    check(Math.abs(attendu - lire(dec.reponse)) < 1e-9, `decimaux justes (${dec.question} = ${dec.reponse})`);

    const pct = G.pourcentage(outils(s));
    const [pp, base] = pct.question.split(" % de ").map(Number);
    check((pp * base) / 100 === lire(pct.reponse), `pourcentage juste (${pct.question})`);
  }
  check(contenu.nombre(3000) === "3 000", "ecriture des milliers : 3 000");
  check(contenu.nombre(3.7) === "3,7", "virgule decimale : 3,7");
}

/* --- 4. Repli : lecon vide ou inconnue -> calcul de l'age, jamais vide --- */
{
  const ce1 = contenu.itemsPourConcepts([], "CE1", graine(3), 6);
  check(ce1.length === 6 && ce1.every((i) => i.question.includes("+")), "lecon vide en CE1 : additions");
  const ce5 = contenu.itemsPourConcepts(["graphique_circulaire"], "CE5", graine(3), 6);
  check(ce5.length === 6 && ce5.every((i) => i.question.includes("×")), "lecon de graphiques en CE5 : tables");
}

console.log(`\n${total - failures}/${total} cas passent`);
if (failures > 0) {
  process.exit(1);
}
