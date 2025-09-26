// traumaIA.js — IA para módulo TRAUMA (imagenología) con lectura de puntos dolorosos
// Node >= 18 (fetch disponible). ESM.
// Cambios mínimos: se añaden helpers para marcadores y se integran al prompt.
// Retro-compatible con front actual: sigue aceptando `rodillaMarcadores`.
// Futuro: acepta `hombroMarcadores`, etc., y también `marcadores:{ region:{ frente/lateral/posterior:[] } }`.

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ============================================================
   === MARCADORES (puntos dolorosos) — helpers retro-compat ===
   ============================================================ */

/** Lee marcadores desde body en formatos:
 *  - moderno:  body.marcadores = { rodilla:{frente:[],lateral:[],posterior:[]}, hombro:{...}, ... }
 *  - legacy:   body.<region>Marcadores (ej: rodillaMarcadores, hombroMarcadores, …)
 */
function _leerMarcadoresDesdeBody(body = {}) {
  const out = {};

  // 1) estándar recomendado (moderno)
  if (body.marcadores && typeof body.marcadores === "object") {
    for (const [region, obj] of Object.entries(body.marcadores)) {
      if (obj && typeof obj === "object") out[_slug(region)] = _sanVista(obj);
    }
  }

  // 2) retro-compatibilidad: <region>Marcadores (rodillaMarcadores, hombroMarcadores, …)
  for (const [k, v] of Object.entries(body)) {
    const m = /^([a-zA-ZñÑ]+)Marcadores$/.exec(k);
    if (m && v && typeof v === "object") {
      out[_slug(m[1])] = _sanVista(v);
    }
  }
  return out;
}

function _slug(s = "") { return String(s).trim().toLowerCase(); }
function _sanVista(obj = {}) {
  const norm = {};
  for (const vista of ["frente", "lateral", "posterior"]) {
    const arr = Array.isArray(obj[vista]) ? obj[vista] : [];
    norm[vista] = arr.map(x => String(x||"").trim()).filter(Boolean);
  }
  // copiar vistas extra si un front las define
  for (const [k, v] of Object.entries(obj)) {
    if (!norm[k] && Array.isArray(v)) {
      norm[k] = v.map(x => String(x||"").trim()).filter(Boolean);
    }
  }
  return norm;
}

/** Si `dolor` menciona “rodilla/hombro/…”, prioriza esas regiones; si no, devuelve todas. */
function _filtrarRegionesRelevantes(marcadores = {}, dolor = "") {
  const regiones = Object.keys(marcadores);
  if (!regiones.length) return {};
  const d = String(dolor || "").toLowerCase();
  const hits = regiones.filter(r => d.includes(r));
  if (hits.length) {
    const out = {}; for (const r of hits) out[r] = marcadores[r];
    return out;
  }
  return marcadores;
}

/** Texto legible para el prompt, multi-región y multi-vista. */
function _marcadoresATexto(mReg = {}) {
  const bloques = [];
  for (const [region, vistas] of Object.entries(mReg)) {
    const sub = [];
    for (const [vista, arr] of Object.entries(vistas)) {
      if (Array.isArray(arr) && arr.length) {
        sub.push(`${_uc(vista)}:\n• ${arr.join("\n• ")}`);
      }
    }
    if (sub.length) bloques.push(`${_uc(region)} — Puntos marcados\n${sub.join("\n\n")}`);
  }
  return bloques.length ? bloques.join("\n\n") : "Sin puntos dolorosos marcados.";
}
function _uc(s=""){ return s ? s[0].toUpperCase()+s.slice(1) : s; }

/** Tips clínicos simples por región (opcional). Amplía aquí para nuevas regiones sin tocar el resto. */
function _tipsDesdeMarcadores(mReg = {}) {
  const tips = [];
  for (const [region, obj] of Object.entries(mReg)) {
    if (region === "rodilla") tips.push(..._tipsRodilla(obj));
    if (region === "hombro")  tips.push(..._tipsHombro(obj));
    // if (region === "codo") tips.push(..._tipsCodo(obj)); // futuro
  }
  return tips;
}
function _flat(obj = {}) {
  const out = [];
  for (const v of Object.values(obj)) if (Array.isArray(v)) out.push(...v);
  return out.map(s => String(s||"").toLowerCase());
}
function _tipsRodilla(obj = {}) {
  const t = _flat(obj), has = (rx) => t.some(x => rx.test(x));
  const arr = [];
  if (has(/\binterl[ií]nea?\s+medial\b/)) arr.push("Interlínea medial → sospecha menisco medial.");
  if (has(/\binterl[ií]nea?\s+lateral\b/)) arr.push("Interlínea lateral → sospecha menisco lateral.");
  if (has(/\b(r[óo]tula|patelar|patelofemoral|ap(e|é)x)\b/)) arr.push("Dolor patelofemoral → síndrome PF/condropatía.");
  if (has(/\btuberosidad\s+tibial\b/)) arr.push("Tuberosidad tibial → Osgood–Schlatter / tendón rotuliano.");
  if (has(/\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b/)) arr.push("Pes anserino → tendinopatía/bursitis anserina.");
  if (has(/\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b/)) arr.push("Banda ITB/Gerdy → síndrome banda ITB.");
  if (has(/\bpopl[ií]tea?\b/)) arr.push("Fosa poplítea → evaluar quiste de Baker.");
  return arr;
}
function _tipsHombro(obj = {}) {
  const t = _flat(obj), has = (rx) => t.some(x => rx.test(x));
  const arr = [];
  if (has(/\b(subacromial|acromion|bursa\s*subacromial)\b/)) arr.push("Dolor subacromial → síndrome subacromial / supraespinoso.");
  if (has(/\b(tub[eé]rculo\s*mayor|footprint|troquiter)\b/)) arr.push("Tubérculo mayor → tendinopatía del manguito (supra/infra).");
  if (has(/\b(surco\s*bicipital|bicipital|porci[oó]n\s*larga\s*del\s*b[ií]ceps)\b/)) arr.push("Surco bicipital → tendinopatía de la porción larga del bíceps.");
  if (has(/\b(acromioclavicular|acromio\-?clavicular|ac)\b/)) arr.push("Dolor AC → artropatía acromioclavicular.");
  if (has(/\b(posterosuperior|labrum\s*superior|slap)\b/)) arr.push("Dolor posterosuperior → considerar lesión labral (SLAP).");
  return arr;
}

/* ============================================================
   === Utilidades previas: normalización examen y fallback  ===
   ============================================================ */

function normalizarExamen(examen = "", dolor = "", lado = "") {
  let x = String(examen || "").trim();
  if (!x) return "";
  x = x.toUpperCase();
  if (!x.endsWith(".")) x += ".";

  // Lateralidad cuando aplica
  const L = (lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  if (/\b(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE)\b/.test(x) &&
      lat && !/\b(IZQUIERDA|DERECHA)\b/.test(x)) {
    x = x.replace(/\.$/, "") + lat + ".";
  }

  // Estandariza ECO partes blandas con zona
  if (/ECOGRAF[ÍI]A.*PARTES\s+BLANDAS/.test(x) && !/\bDE\b/.test(x)) {
    const zona = (dolor || "").toUpperCase();
    if (zona && !/COLUMNA/.test(zona)) {
      x = `ECOGRAFÍA DE PARTES BLANDAS DE ${zona}${lat}.`.toUpperCase();
    }
  }
  return x;
}

function fallbackHeuristico(p = {}) {
  const d = String(p.dolor || "").toLowerCase();
  const L = (p.lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const mayor60 = Number(p.edad) > 60;

  if (d.includes("rodilla")) {
    const diagnostico = `Gonalgia${lat ? ` ${L.toLowerCase()}` : ""}`;
    const examen = mayor60
      ? `RX DE RODILLA${lat} AP/LATERAL/AXIAL.`
      : `RESONANCIA MAGNÉTICA DE RODILLA${lat}.`;
    const justificacion =
      "Estudio dirigido a estructuras intraarticulares y periarticulares de la rodilla. Se prioriza RX para óseo/degenerativo y RM para meniscos/ligamentos. Los puntos dolorosos orientan la sospecha específica.";
    return { diagnostico, examen, justificacion };
  }

  const diagnostico = "Dolor osteoarticular localizado";
  const examen = "EVALUACIÓN IMAGENOLÓGICA SEGÚN CLÍNICA.";
  const justificacion =
    "Se inicia estudio de la región comprometida, priorizando seguridad y costo-efectividad. La selección del examen se ajusta a la sospecha clínica y hallazgos dirigidos.";
  return { diagnostico, examen, justificacion };
}

/* ============================================================
   === Prompt a la IA (agrega puntos marcados al contexto)   ===
   ============================================================ */

function construirMensajesIA(p) {
  const info = {
    nombre: p?.nombre || "",
    rut: p?.rut || "",
    edad: p?.edad || "",
    genero: p?.genero || "",
    dolor: p?.dolor || "",
    lado: p?.lado || "",
    detalles: p?.detalles || null,
  };

  // NUEVO: puntos dolorosos y “tips” clínicos a partir de los puntos
  const marc = p?.detalles?.marcadores || {};
  const txtMarcadores = _marcadoresATexto(marc);
  const tips = _tipsDesdeMarcadores(marc);
  const tipsTxt = tips.length ? `\n\nTips clínicos:\n• ${tips.join("\n• ")}` : "";

  const system = [
    "Eres un asistente clínico de traumatología e imagenología.",
    "Responde SIEMPRE en JSON válido, sin texto adicional.",
    "Selecciona UN diagnóstico presuntivo y UN examen imagenológico inicial.",
    "La justificación clínica DEBE referenciar explícitamente los puntos dolorosos cuando existan.",
    "Incluye lateralidad (izquierda/derecha) si aplica.",
    "Evita sobreestudio: prioriza RX o ecografía si resuelven la pregunta clínica.",
  ].join(" ");

  const user = `
PACIENTE
${JSON.stringify(info, null, 2)}

PUNTOS DOLOROSOS (multi-región)
${txtMarcadores}${tipsTxt}

SALIDA (SOLO JSON VÁLIDO)
{
  "diagnostico_presuntivo": "3–8 palabras, específico, con lateralidad si aplica",
  "examen": "UN SOLO EXAMEN, EN MAYÚSCULAS",
  "justificacion_clinica": "60–120 palabras, referenciando los puntos y su correlato anatómico/patológico"
}
`.trim();

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ============================================================
   === Llamada a la IA                                       ===
   ============================================================ */

async function llamarIA(mensajes) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY no configurada");

  const r = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    throw new Error(`OpenAI ${r.status}: ${raw}`);
  }
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

/* ============================================================
   === Handler principal (export)                             ===
   ============================================================ */

export default function traumaIAHandler(memoria) {
  const ns = (s, id) => `${s}:${id}`;

  return async (req, res) => {
    try {
      const { idPago, paciente = {}, detalles = null } = req.body || {};
      if (!idPago) return res.status(400).json({ ok: false, error: "Falta idPago" });

      // === NUEVO: leer puntos dolorosos del body (actual y futuro) ===
      const marcadoresAll = _leerMarcadoresDesdeBody(req.body);
      const marcadoresRelev = _filtrarRegionesRelevantes(marcadoresAll, paciente?.dolor);

      // inyectar en detalles para el prompt (no rompe tus flujos)
      const detallesAll = { ...(detalles || {}), marcadores: marcadoresRelev };
      const p = { ...paciente, detalles: detallesAll };

      // ===== IA con puntos
      let out;
      try {
        const mensajes = construirMensajesIA(p);
        const ia = await llamarIA(mensajes);

        const diagnostico = String(ia?.diagnostico_presuntivo || "").trim();
        const examenRaw  = String(ia?.examen || "").trim();
        const justificacion = String(ia?.justificacion_clinica || "").trim();

        const examen = normalizarExamen(examenRaw, p?.dolor, p?.lado);

        if (!diagnostico || !examen) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico, examen, justificacion };
        }
      } catch {
        out = fallbackHeuristico(p);
      }

      // ===== Persistencia mínima (para PDF / retorno)
      const registro = {
        ...p,
        examenesIA: [out.examen],
        respuesta: `Diagnóstico presuntivo: ${out.diagnostico}\n\n${out.justificacion}`,
        pagoConfirmado: true,
      };
      try {
        memoria?.set?.(ns("ia", idPago), registro);
        memoria?.set?.(ns("meta", idPago), { moduloAutorizado: "ia" });
      } catch {}

      // ===== Respuesta compatible con tu frontend
      return res.json({
        ok: true,
        diagnostico: out.diagnostico,
        examenes: [out.examen],
        justificacion: out.justificacion,
        informeIA: out.justificacion, // compat extra, por si algún flujo lo usa
      });
    } catch (e) {
      console.error("ia-trauma error:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
