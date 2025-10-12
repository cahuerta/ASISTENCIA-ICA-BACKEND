// fallbackTrauma.js — Fallback por zona (1 examen, con lateralidad)
// ESM compatible

/** Devuelve { diagnostico, examen, justificacion } sin IA */
export default function fallbackTrauma(p = {}) {
  const zona = String(p.dolor || "").toLowerCase();
  const L = (p.lado || "").toUpperCase();             // "IZQUIERDA" / "DERECHA"
  const lat = L ? ` ${L}` : "";

  // —— mapa zona → examen (1 por región)
  const rules = [
    { test: /mano|muñeca/,                exam: `ECOGRAFÍA DE MANO${lat}.`,                             dx: `Dolor de mano/muñeca${lat ? ` ${L.toLowerCase()}` : ""}` },
    { test: /codo/,                       exam: `ECOGRAFÍA DE CODO${lat}.`,                             dx: `Dolor de codo${lat ? ` ${L.toLowerCase()}` : ""}` },
    { test: /rodilla/,                    exam: `RESONANCIA MAGNÉTICA DE RODILLA${lat}.`,               dx: `Gonalgia${lat ? ` ${L.toLowerCase()}` : ""}` },
    { test: /cadera/,                     exam: `RESONANCIA MAGNÉTICA DE CADERA${lat}.`,                dx: `Dolor de cadera${lat ? ` ${L.toLowerCase()}` : ""}` },
    { test: /hombro/,                     exam: `RESONANCIA MAGNÉTICA DE HOMBRO${lat}.`,                dx: `Dolor de hombro${lat ? ` ${L.toLowerCase()}` : ""}` },
    { test: /columna\s*cervical/,         exam: `RESONANCIA MAGNÉTICA DE COLUMNA CERVICAL.`,            dx: `Dolor de columna cervical` },
    { test: /columna\s*(dorsal|torácica)/,exam: `RESONANCIA MAGNÉTICA DE COLUMNA DORSAL.`,              dx: `Dolor de columna dorsal` },
    { test: /columna|lumbar/,             exam: `RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR.`,              dx: `Dolor de columna lumbar` },
    { test: /tobillo|pie/,                exam: `RESONANCIA MAGNÉTICA DE PIE/TOBILLO${lat}.`,           dx: `Dolor de pie/tobillo${lat ? ` ${L.toLowerCase()}` : ""}` },
    { test: /pierna|brazo/,               exam: `RESONANCIA MAGNÉTICA DE ${zona.includes("pierna") ? "PIERNA" : "BRAZO"}${lat}.`,
                                           dx: `Dolor de ${zona.includes("pierna") ? "pierna" : "brazo"}${lat ? ` ${L.toLowerCase()}` : ""}` },
  ];

  let examen = "";
  let diagnostico = "";
  for (const r of rules) {
    if (r.test.test(zona)) { examen = r.exam; diagnostico = r.dx; break; }
  }

  if (!examen) {
    const Z = (p.dolor || "REGIÓN COMPROMETIDA").toUpperCase();
    examen = `RESONANCIA MAGNÉTICA DE ${Z}${lat}.`;
    diagnostico = "Dolor osteoarticular localizado";
  }

  const justificacion =
    "Selección basada en la región y la lateralidad para estudiar con precisión estructuras internas y tejidos blandos. Ajustar según examen físico y evolución clínica.";

  return { diagnostico, examen, justificacion };
}
