// marcadores-utils.js — utilidades genéricas para puntos dolorosos por región (multi-vista)

/** Normaliza la entrada del request a un objeto genérico:
 * {
 *   marcadores: {
 *     rodilla: { frente:[], lateral:[], posterior:[] },
 *     hombro:  { ... },
 *     ...
 *   }
 * }
 * Acepta:
 * - body.marcadores (recomendado, múltiples regiones)
 * - body.<region>Marcadores (legacy: rodillaMarcadores, hombroMarcadores, etc.)
 */
export function normalizarMarcadoresDesdeBody(body = {}) {
  const out = {};

  // 1) Estándar recomendado
  if (body.marcadores && typeof body.marcadores === "object") {
    for (const [region, obj] of Object.entries(body.marcadores)) {
      if (obj && typeof obj === "object") out[aSlug(region)] = sanitizarPorVistas(obj);
    }
  }

  // 2) Compatibilidad legacy: <region>Marcadores (rodillaMarcadores, hombroMarcadores,…)
  for (const [k, v] of Object.entries(body)) {
    const m = /^([a-zA-ZñÑ]+)Marcadores$/.exec(k);
    if (m && v && typeof v === "object") {
      out[aSlug(m[1])] = sanitizarPorVistas(v);
    }
  }

  return out;
}

function aSlug(s = "") {
  return String(s).trim().toLowerCase();
}

// Devuelve { frente:[], lateral:[], posterior:[] } y copia vistas adicionales si existen.
function sanitizarPorVistas(obj = {}) {
  const norm = {};
  for (const vista of ["frente", "lateral", "posterior"]) {
    const arr = Array.isArray(obj[vista]) ? obj[vista] : [];
    norm[vista] = arr.map((x) => String(x || "").trim()).filter(Boolean);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!norm[k] && Array.isArray(v)) {
      norm[k] = v.map((x) => String(x || "").trim()).filter(Boolean);
    }
  }
  return norm;
}

/** Devuelve solo las regiones relevantes:
 * - si `dolor` menciona “rodilla/hombro/…”, prioriza esas regiones
 * - si no reconoce, devuelve todas las regiones presentes
 */
export function seleccionarRegionesRelevantes(marcadores = {}, dolor = "") {
  const regiones = Object.keys(marcadores);
  if (!regiones.length) return {};
  const d = String(dolor || "").toLowerCase();
  const hits = regiones.filter((r) => d.includes(r));
  if (hits.length) {
    const out = {};
    for (const r of hits) out[r] = marcadores[r];
    return out;
  }
  return marcadores;
}

/** Texto legible para prompt, multi-región y multi-vista */
export function marcadoresATextoPrompt(marcadoresRegional = {}) {
  const bloques = [];
  for (const [region, vistas] of Object.entries(marcadoresRegional)) {
    const sub = [];
    for (const [vista, arr] of Object.entries(vistas)) {
      if (Array.isArray(arr) && arr.length) {
        sub.push(`${ucfirst(vista)}:\n• ${arr.join("\n• ")}`);
      }
    }
    if (sub.length) bloques.push(`${ucfirst(region)} — Puntos marcados\n${sub.join("\n\n")}`);
  }
  return bloques.length ? bloques.join("\n\n") : "Sin puntos dolorosos marcados.";
}

function ucfirst(s = "") {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Registro opcional de mapeos clínicos por región (tips).
 * Si no existe mapeo para una región, simplemente no añade tips.
 */
const MAPEADORES_POR_REGION = {
  rodilla: (obj = {}) => tipsDesdeListado(aplanarVistas(obj), [
    [/\binterl[ií]nea?\s+medial\b/, "Interlínea medial → sospecha menisco medial."],
    [/\binterl[ií]nea?\s+lateral\b/, "Interlínea lateral → sospecha menisco lateral."],
    [/\b(r[óo]tula|patelar|patelofemoral|ap(e|é)x)\b/, "Dolor patelofemoral → síndrome PF/condropatía."],
    [/\btuberosidad\s+tibial\b/, "Tuberosidad tibial → Osgood–Schlatter / tendón rotuliano."],
    [/\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b/, "Pes anserino → tendinopatía/bursitis anserina."],
    [/\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b/, "Banda iliotibial/Gerdy → síndrome banda ITB."],
    [/\bpopl[ií]tea?\b/, "Fosa poplítea → evaluar quiste de Baker."],
  ]),
  hombro: (obj = {}) => tipsDesdeListado(aplanarVistas(obj), [
    [/\b(subacromial|acromion|bursa\s*subacromial)\b/, "Dolor subacromial → síndrome subacromial / supraespinoso."],
    [/\b(tub[eé]rculo\s*mayor|footprint|troquiter)\b/, "Tubérculo mayor → tendinopatía del manguito (supra/infra)."],
    [/\b(surco\s*bicipital|bicipital|porci[oó]n\s*larga\s*del\s*b[ií]ceps)\b/, "Surco bicipital → tendinopatía de la porción larga del bíceps."],
    [/\b(acromioclavicular|acromio\-?clavicular|ac)\b/, "Dolor AC → artropatía acromioclavicular."],
    [/\b(posterosuperior|labrum\s*superior|slap)\b/, "Dolor posterosuperior → considerar lesión labral (SLAP)."],
  ]),
  // Agrega aquí más regiones en el futuro (codo, tobillo, etc.).
};

function aplanarVistas(obj = {}) {
  const out = [];
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) out.push(...v);
  }
  return out.map((s) => String(s || "").toLowerCase());
}

function tipsDesdeListado(tokens = [], reglas = []) {
  const tips = [];
  const hay = (rx) => tokens.some((t) => rx.test(t));
  for (const [rx, txt] of reglas) if (hay(rx)) tips.push(txt);
  return tips;
}

export function marcadoresATips(marcadoresRegional = {}) {
  const tips = [];
  for (const [region, obj] of Object.entries(marcadoresRegional)) {
    const fn = MAPEADORES_POR_REGION[region];
    if (typeof fn === "function") tips.push(...fn(obj));
  }
  return tips;
}
