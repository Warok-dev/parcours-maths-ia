/* Tests de la logique d'ambiance (ambiance.js).
   Lancer avec : node test_ambiance.js
   Couvre : la probabilite d'apparition des ramassables et la teinte selon
   l'heure. (Le compagnon animal a ete retire du jeu.) */
const A = require("./ambiance.js");

let failures = 0;
let total = 0;
function check(cond, label) {
  total += 1;
  console.log(`${cond ? "ok " : "KO "} ${label}`);
  if (!cond) failures += 1;
}

/* ================= 1. Ramassables : probabilite d'apparition ================= */
function segments(n) {
  return Array.from({ length: n }, (_, i) => ({ a: { x: i * 100, y: 0 }, b: { x: i * 100 + 100, y: 0 } }));
}

{
  /* rng toujours sous le seuil -> chaque segment produit un ramassable. */
  const tous = A.semerCollectibles(segments(8), () => 0.05);
  check(tous.length === 8, "rng < seuil : un ramassable par segment");
  /* rng toujours au-dessus du seuil -> aucun. */
  const aucun = A.semerCollectibles(segments(8), () => 0.9);
  check(aucun.length === 0, "rng >= seuil : aucun ramassable");
}

{
  /* Chaque ramassable tombe dans son segment, avec un type valide et une cle. */
  const items = A.semerCollectibles(segments(6), () => 0.1);
  const okPlacement = items.every((it) => {
    const seg = segments(6)[it.index];
    return it.x > seg.a.x && it.x < seg.b.x && ["piece", "fleur"].includes(it.type) && typeof it.cle === "string";
  });
  check(okPlacement, "chaque ramassable est place dans son segment, type et cle valides");
}

{
  /* Taux empirique proche de PROBA_PAR_SEGMENT sur un grand echantillon. */
  const N = 40000;
  const items = A.semerCollectibles(segments(N)); /* Math.random */
  const taux = items.length / N;
  check(
    Math.abs(taux - A.PROBA_PAR_SEGMENT) < 0.01,
    `taux d'apparition ~ ${(A.PROBA_PAR_SEGMENT * 100).toFixed(0)}% (mesure ${(taux * 100).toFixed(2)}%)`,
  );
}

{
  /* Segments derives d'un trace, et rayon de ramassage. */
  const segs = A.segmentsDepuisTrace([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  check(segs.length === 2, "segmentsDepuisTrace : n-1 segments");
  check(A.estRamassable(A.RAYON_RAMASSAGE) && !A.estRamassable(A.RAYON_RAMASSAGE + 1), "estRamassable borne au rayon");
}

/* ================= 2. Teinte selon l'heure ================= */
{
  check(A.tintePourHeure(7).opacite > 0 && A.tintePourHeure(7).moment === "matin", "matin (7h) : teinte chaude visible");
  check(A.tintePourHeure(18).opacite > 0 && A.tintePourHeure(18).moment === "soir", "soir (18h) : teinte chaude visible");
  check(A.tintePourHeure(13).opacite === 0 && A.tintePourHeure(13).moment === "jour", "jour (13h) : teinte neutre (invisible)");
  check(A.tintePourHeure(23).moment === "nuit", "nuit (23h) : moment nuit");
  const midi = new Date(2024, 0, 1, 13, 0, 0);
  check(A.tinteMaintenant(midi).moment === "jour", "tinteMaintenant lit l'heure de la date fournie");
}

console.log(`\n${total - failures}/${total} cas passent`);
process.exit(failures === 0 ? 0 : 1);
