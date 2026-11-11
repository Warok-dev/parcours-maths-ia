/* Verifie le decoupage de l'ancien map.js (carte/) et de l'ancien style.css
   (styles/).
   0. index.html charge styles/* dans l'ordre de styles/ordre.json (l'ordre
      des feuilles EST la cascade CSS) ;
   1. index.html charge carte/* exactement dans l'ordre de carte/ordre.json ;
   2. dans chaque fichier, tout identifiant evalue AU CHARGEMENT (hors corps de
      fonction) est declare dans ce fichier ou dans un fichier PRECEDENT : un
      appel a une fonction d'un fichier charge plus tard planterait au
      demarrage (les declarations de fonction ne remontent que dans leur propre
      script).
   Lancer depuis prototype/frontend : npm install --no-save acorn@8.14.0 acorn-walk@8.3.4
   puis node outils/verifier_decoupage.js */
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const walk = require("acorn-walk");
const dossier = path.join(__dirname, "..", "carte");
const ordre = JSON.parse(fs.readFileSync(path.join(dossier, "ordre.json")));
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const charges = [...html.matchAll(/<script src="carte\/([^"]+)"/g)].map((m) => m[1]);
const feuilles = [...html.matchAll(/<link rel="stylesheet" href="styles\/([^"]+)"/g)].map((m) => m[1]);
const ordreStyles = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "styles", "ordre.json")));
if (JSON.stringify(feuilles) !== JSON.stringify(ordreStyles)) {
  console.log("index.html ne charge pas styles/ dans l'ordre de styles/ordre.json :", feuilles);
  process.exit(1);
}
if (JSON.stringify(charges) !== JSON.stringify(ordre)) {
  console.log("index.html ne charge pas carte/ dans l'ordre de carte/ordre.json :", charges);
  process.exit(1);
}
const declare = new Map(); // nom -> index du fichier
const asts = ordre.map((nom, i) => {
  const ast = acorn.parse(fs.readFileSync(path.join(dossier, nom), "utf8"), { ecmaVersion: "latest", locations: true });
  for (const n of ast.body) {
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") declare.set(n.id.name, i);
    if (n.type === "VariableDeclaration") for (const d of n.declarations) walk.simple(d.id, { Identifier(x) { declare.set(x.name, i); } }, walk.base, null);
  }
  return ast;
});
let problemes = 0;
asts.forEach((ast, i) => {
  for (const n of ast.body) {
    if (n.type === "FunctionDeclaration") continue;
    // Parcours en sautant les corps de fonctions (evalues plus tard).
    const visiter = (noeud) => {
      walk.recursive(noeud, null, {
        Function() {},
        ArrowFunctionExpression() {},
        Identifier(x) {
          const j = declare.get(x.name);
          if (j !== undefined && j > i) {
            problemes += 1;
            console.log(`${ordre[i]}:${x.loc.start.line} utilise au chargement ${x.name}, declare dans ${ordre[j]}`);
          }
        },
      });
    };
    visiter(n);
  }
});
console.log(problemes ? `${problemes} probleme(s)` : "decoupage correct : ordre des styles et des scripts respecte");
process.exit(problemes ? 1 : 0);
