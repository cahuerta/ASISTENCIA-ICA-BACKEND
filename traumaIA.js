// traumaIA.js — TRAUMA con prompt estilo "nota breve" (estricto: 1 diagnóstico y 1 examen)
// Mantiene API de respuesta original: diagnostico, examenes[0], justificacion, informeIA
// Node >= 18 (fetch). ESM.

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
   === Normalización de examen y fallback                    ===
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
   === Prompt tipo chat (estricto: 1 Dx y 1 Examen)          ===
   ============================================================ */

const SYSTEM_PROMPT_TXT = `
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA BREVE centrada en EXÁMENES a solicitar.

Reglas (ESTRICTAS):
- Español claro. Extensión total: 140–170 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales (“podría sugerir”, “compatible con”).
- Prioriza IMAGENOLOGÍA. Si corresponde, sugiere ECOGRAFÍA en lesiones de partes blandas (p. ej., hombro/codo/mano en pacientes jóvenes).
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en el examen.
- Integra PUNTOS DOLOROSOS si existen; la explicación debe referirse a ellos cuando estén presentes.
- **EXACTAMENTE 1** diagnóstico presuntivo.
- **EXACTAMENTE 1** examen sugerido.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (una sola entidad clínica específica a la zona)

Explicación breve:
• (≈60–100 palabras, 1–3 frases que justifiquen el enfoque y el porqué del examen; referencia a los puntos dolorosos si existen)

Exámenes sugeridos:
• (UN SOLO EXAMEN — incluir lateralidad si aplica)

Indicaciones:
• Presentarse con la orden; ayuno solo si el examen lo solicita.
• Acudir a evaluación presencial con el/la especialista sugerido/a.

Devuelve SOLO el texto en este formato (sin comentarios adicionales).
`.trim();

function construirMensajeUsuarioTXT(p) {
  const info = {
    nombre: p?.nombre || "",
    rut: p?.rut || "",
    edad: p?.edad || "",
    genero: p?.genero || "",
    dolor: p?.dolor || "",
    lado: p?.lado || "",
  };

  const marc = p?.detalles?.marcadores || {};
  const puntosTxt = _marcadoresATexto(marc);
  const tipsArr   = _tipsDesdeMarcadores(marc);
  const tipsTxt   = tipsArr.length ? `\n\nTips clínicos:\n• ${tipsArr.join("\n• ")}` : "";

  return (
    `Edad: ${info.edad || "—"}\n` +
    (info.genero ? `Género: ${info.genero}\n` : "") +
    (info.dolor ? `Región de dolor: ${info.dolor}${info.lado ? ` (${info.lado})` : ""}\n` : "") +
    `Puntos dolorosos marcados:\n${puntosTxt}${tipsTxt}\n\n` +
    `Redacta EXACTAMENTE con el formato solicitado y el carácter ESTRICTO de 1 diagnóstico y 1 examen.`
  );
}

/* ============================================================
   === Llamada a la IA y parsing del texto                   ===
   ============================================================ */

async function llamarIA_Texto(messages) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY no configurada");

  const r = await fetch(OPENAI_API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.35, max_tokens: 520, messages }),
  });
  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    throw new Error(`OpenAI ${r.status}: ${raw}`);
  }
  const j = await r.json();
  return (j?.choices?.[0]?.message?.content || "").trim();
}

/** Extrae secciones del texto estructurado; devuelve 1 Dx y 1 Examen (si hay más, toma el primero) */
function parseSecciones(text = "") {
  const out = { diagnostico: "", explicacion: "", examen: "" };
  if (!text) return out;

  // Diagnóstico presuntivo (primer bullet)
  const secDx = /Diagn[oó]stico presuntivo:\s*([\s\S]*?)(?:\n\s*Explicaci[oó]n breve:|$)/i.exec(text);
  if (secDx) {
    const block = secDx[1] || "";
    const bullets = block
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => (/^[•\-\*]\s*(.+)$/.exec(l)?.[1] || l).trim())
      .filter(Boolean);
    out.diagnostico = bullets[0] || "";
  }

  // Explicación breve (consolidada)
  const secExp = /Explicaci[oó]n breve:\s*([\s\S]*?)(?:\n\s*Ex[aá]menes sugeridos:|$)/i.exec(text);
  if (secExp) {
    const block = secExp[1] || "";
    const bullets = block
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => (/^[•\-\*]\s*(.+)$/.exec(l)?.[1] || l).trim())
      .filter(Boolean);
    out.explicacion = bullets.join(" ").replace(/\s+/g, " ").trim();
  }

  // Exámenes sugeridos (primer bullet)
  const secEx = /Ex[aá]men(?:es)? sugeridos?:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)/i.exec(text);
  if (secEx) {
    const block = secEx[1] || "";
    const bullets = block
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => (/^[•\-\*]\s*(.+)$/.exec(l)?.[1] || l).trim())
      .map(l => l.replace(/\s*\.\s*$/, ".")) // normaliza punto final
      .filter(Boolean);
    out.examen = bullets[0] || "";
  }

  return out;
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

      // Marcadores: leer del body (actual y futuro) y filtrar por dolor
      const marcadoresAll = _leerMarcadoresDesdeBody(req.body);
      const marcadoresRelev = _filtrarRegionesRelevantes(marcadoresAll, paciente?.dolor);
      const detallesAll = { ...(detalles || {}), marcadores: marcadoresRelev };
      const p = { ...paciente, detalles: detallesAll };

      // ===== IA con prompt estricto (texto)
      let out;
      try {
        const messages = [
          { role: "system", content: SYSTEM_PROMPT_TXT },
          { role: "user", content: construirMensajeUsuarioTXT(p) },
        ];
        const texto = await llamarIA_Texto(messages);
        const { diagnostico, explicacion, examen } = parseSecciones(texto);

        const diagnosticoOk = String(diagnostico || "").trim();
        const examenOk = normalizarExamen(String(examen || "").trim(), p?.dolor, p?.lado);
        const justificacion = explicacion || "Justificación clínica basada en región y puntos dolorosos.";

        if (!diagnosticoOk || !examenOk) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico: diagnosticoOk, examen: examenOk, justificacion };
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
        examenes: [out.examen],          // ← exactamente 1 examen
        justificacion: out.justificacion,
        informeIA: out.justificacion,    // compat (algunos flujos lo usan)
      });
    } catch (e) {
      console.error("ia-trauma error:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
