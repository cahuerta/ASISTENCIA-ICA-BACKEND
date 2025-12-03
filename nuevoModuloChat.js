// nuevoModuloChat.js — Chat IA (nota breve + orden) con marcadores multi-región (retro-compatible)
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { generarInformeIA } from "./informeIA.js";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ============================================================
   === MARCADORES (puntos dolorosos) — helpers retro-compat ===
   ============================================================ */

/** Lee marcadores desde body en formatos:
 *  - moderno:  body.marcadores = { rodilla:{frente:[],lateral:[],posterior:[]}, hombro:{...}, ... }
 *  - legacy:   body.<region>Marcadores (ej: rodillaMarcadores, hombroMarcadores, …)
 */
function leerMarcadoresDesdeBody(body = {}) {
  const out = {};

  // 1) estándar recomendado (moderno)
  if (body.marcadores && typeof body.marcadores === "object") {
    for (const [region, obj] of Object.entries(body.marcadores)) {
      if (obj && typeof obj === "object") out[slug(region)] = sanVista(obj);
    }
  }

  // 2) retro-compatibilidad: <region>Marcadores (rodillaMarcadores, hombroMarcadores, …)
  for (const [k, v] of Object.entries(body)) {
    const m = /^([a-zA-ZñÑ]+)Marcadores$/.exec(k);
    if (m && v && typeof v === "object") {
      out[slug(m[1])] = sanVista(v);
    }
  }
  return out;
}

function slug(s = "") {
  return String(s).trim().toLowerCase();
}
function sanVista(obj = {}) {
  const norm = {};
  for (const vista of ["frente", "lateral", "posterior"]) {
    const arr = Array.isArray(obj[vista]) ? obj[vista] : [];
    norm[vista] = arr.map((x) => String(x || "").trim()).filter(Boolean);
  }
  // copiar vistas extra si un front las define
  for (const [k, v] of Object.entries(obj)) {
    if (!norm[k] && Array.isArray(v)) {
      norm[k] = v.map((x) => String(x || "").trim()).filter(Boolean);
    }
  }
  return norm;
}

/** Si `dolor` menciona “rodilla/hombro/…”, prioriza esas regiones; si no, devuelve todas. */
function filtrarRegionesRelevantes(marcadores = {}, dolor = "") {
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

/** Texto legible para el prompt, multi-región y multi-vista. */
function marcadoresATextoPrompt(mReg = {}) {
  const bloques = [];
  for (const [region, vistas] of Object.entries(mReg)) {
    const sub = [];
    for (const [vista, arr] of Object.entries(vistas)) {
      if (Array.isArray(arr) && arr.length) {
        sub.push(`${uc(vista)}:\n• ${arr.join("\n• ")}`);
      }
    }
    if (sub.length)
      bloques.push(`${uc(region)} — Puntos marcados\n${sub.join("\n\n")}`);
  }
  return bloques.length ? bloques.join("\n\n") : "Sin puntos dolorosos marcados.";
}
function uc(s = "") {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Tips clínicos simples por región (opcional). Amplía aquí para nuevas regiones sin tocar el resto. */
function marcadoresATips(mReg = {}) {
  const tips = [];
  for (const [region, obj] of Object.entries(mReg)) {
    if (region === "rodilla") tips.push(...tipsRodilla(obj));
    if (region === "hombro") tips.push(...tipsHombro(obj));
    // if (region === "codo") tips.push(...tipsCodo(obj)); // futuro
  }
  return tips;
}
function flatVistas(obj = {}) {
  const out = [];
  for (const v of Object.values(obj)) if (Array.isArray(v)) out.push(...v);
  return out.map((s) => String(s || "").toLowerCase());
}
function tipsRodilla(obj = {}) {
  const t = flatVistas(obj),
    has = (rx) => t.some((x) => rx.test(x));
  const arr = [];
  if (has(/\binterl[ií]nea?\s+medial\b/))
    arr.push("Interlínea medial → sospecha menisco medial.");
  if (has(/\binterl[ií]nea?\s+lateral\b/))
    arr.push("Interlínea lateral → sospecha menisco lateral.");
  if (has(/\b(r[óo]tula|patelar|patelofemoral|ap(e|é)x)\b/))
    arr.push("Dolor patelofemoral → síndrome PF/condropatía.");
  if (has(/\btuberosidad\s+tibial\b/))
    arr.push("Tuberosidad tibial → Osgood–Schlatter / tendón rotuliano.");
  if (has(/\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b/))
    arr.push("Pes anserino → tendinopatía/bursitis anserina.");
  if (has(/\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b/))
    arr.push("Banda ITB/Gerdy → síndrome banda ITB.");
  if (has(/\bpopl[ií]tea?\b/))
    arr.push("Fosa poplítea → evaluar quiste de Baker.");
  return arr;
}
function tipsHombro(obj = {}) {
  const t = flatVistas(obj),
    has = (rx) => t.some((x) => rx.test(x));
  const arr = [];
  if (has(/\b(subacromial|acromion|bursa\s*subacromial)\b/))
    arr.push("Dolor subacromial → síndrome subacromial / supraespinoso.");
  if (has(/\b(tub[eé]rculo\s*mayor|footprint|troquiter)\b/))
    arr.push(
      "Tubérculo mayor → tendinopatía del manguito (supra/infra)."
    );
  if (has(/\b(surco\s*bicipital|bicipital|porci[oó]n\s*larga\s*del\s*b[ií]ceps)\b/))
    arr.push(
      "Surco bicipital → tendinopatía de la porción larga del bíceps."
    );
  if (has(/\b(acromioclavicular|acromio\-?clavicular|ac)\b/))
    arr.push("Dolor AC → artropatía acromioclavicular.");
  if (has(/\b(posterosuperior|labrum\s*superior|slap)\b/))
    arr.push(
      "Dolor posterosuperior → considerar lesión labral (SLAP)."
    );
  return arr;
}

/* ============================================================
   === Prompt y utilidades de texto ===
   ============================================================ */

const SYSTEM_PROMPT_IA = `
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA BREVE centrada en EXÁMENES a solicitar.

Reglas:
- Español claro. Extensión total: máx. 140–170 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales (“podría sugerir”, “compatible con”).
- Prioriza IMAGENOLOGÍA. Si corresponde, sugiere ECOGRAFÍA en lesiones de partes blandas (frecuente en hombro/codo/mano).
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en los exámenes.
- Integra PUNTOS DOLOROSOS si existen; la explicación debe referirse a ellos cuando estén presentes.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (1 entidad clínica probable específica a la zona)
• (2ª entidad diferencial, si procede)

Explicación breve:
• (≈60–100 palabras, 1–3 frases que justifiquen el enfoque y el porqué de los exámenes; referencia a los puntos dolorosos si existen)

Exámenes sugeridos:
• (EXAMEN 1 — incluir lateralidad si aplica)
• (EXAMEN 2 — complementario o alternativa razonable; incluir lateralidad si aplica)

Indicaciones:
• Presentarse con la orden; ayuno solo si el examen lo solicita.
• Acudir a evaluación presencial con el/la especialista sugerido/a.

Devuelve SOLO el texto en este formato (sin comentarios adicionales).
`.trim();

function recortar(str, max = 1200) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max).trim() + "…" : str;
}

// Lee datos previos del paciente desde la "memoria" del backend
function leerPacienteDeMemoria(memoria, idPago) {
  const spaces = ["ia", "trauma", "preop", "generales"];
  for (const s of spaces) {
    const v = memoria.get(`${s}:${idPago}`);
    if (v) return v;
  }
  return null;
}

/* --- Parser de “Exámenes sugeridos” (toma hasta 2) --- */
function parseExamenesSugeridos(text = "") {
  if (!text)
    return { all: [], firstTwo: [], rm: [], rx: [], eco: [], otros: [] };

  // Captura la sección entre "Examen(es) sugeridos:" e "Indicaciones:" (o fin)
  const sec =
    /Examen(?:es)? sugeridos?:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)/i.exec(
      text
    );
  if (!sec)
    return { all: [], firstTwo: [], rm: [], rx: [], eco: [], otros: [] };

  const bloque = sec[1] || "";
  const bullets = bloque
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[•\-\*]\s*(.+)$/.exec(l)?.[1] || l).trim())
    .map((l) => l.replace(/\s+/g, " ").replace(/\s*\.\s*$/, "."))
    .filter(Boolean);

  const firstTwo = bullets.slice(0, 2);

  // Clasificación simple (sobre los 2 primeros)
  const rm = [],
    rx = [],
    eco = [],
    otros = [];
  for (const b of firstTwo) {
    const l = b.toLowerCase();
    const isRM =
      l.includes("resonancia") ||
      /\brm\b/.test(l) ||
      l.includes("resonancia magn");
    const isRX =
      /\brx\b/.test(l) ||
      l.includes("radiografía") ||
      l.includes("rayos x") ||
      l.includes("teleradiograf");
    const isECO =
      l.includes("ecografía") ||
      l.includes("ecografia") ||
      l.includes("ultrasonido") ||
      /\beco\b/.test(l);
    if (isRM) rm.push(b);
    else if (isRX) rx.push(b);
    else if (isECO) eco.push(b);
    else otros.push(b);
  }

  return { all: bullets, firstTwo, rm, rx, eco, otros };
}

/* --- Helpers mínimos para la orden IA (solo usados en fallback PDF-orden viejo; ahora la orden vive en index.js) --- */
function notaAsistenciaIA(dolor = "") {
  const d = String(dolor || "").toLowerCase();
  const base =
    "Presentarse con esta orden. Ayuno NO requerido salvo indicación.";
  if (d.includes("rodilla"))
    return `${base}\nConsultar con nuestro especialista en rodilla Dr Jaime Espinoza.`;
  if (d.includes("cadera"))
    return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  return base;
}

/* ===== Preview IA (antes de pagar) ===== */
router.post("/preview-informe", async (req, res) => {
  try {
    const { idPago, consulta } = req.body || {};
    if (!consulta || !idPago) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan datos obligatorios" });
    }

    const memoria = req.app.get("memoria");
    const prev = leerPacienteDeMemoria(memoria, idPago) || {};

    // === NUEVO: marcadores entrantes (acepta moderno y legacy)
    const entrantes = leerMarcadoresDesdeBody(req.body);

    // Mezcla con lo previo y filtra por región de dolor
    const prevMarc = prev?.marcadores || {};
    const mergedMarc = { ...prevMarc, ...entrantes };
    const relevantes = filtrarRegionesRelevantes(
      mergedMarc,
      req.body?.dolor ?? prev?.dolor
    );

    const merged = {
      nombre: req.body?.nombre ?? prev?.nombre,
      edad: req.body?.edad ?? prev?.edad,
      rut: req.body?.rut ?? prev?.rut,
      genero: req.body?.genero ?? prev?.genero,
      dolor: req.body?.dolor ?? prev?.dolor,
      lado: req.body?.lado ?? prev?.lado,
      consulta,
      marcadores: relevantes, // guardamos para uso posterior/PDF
    };

    const puntosTxt = marcadoresATextoPrompt(relevantes);
    const tipsArr = marcadoresATips(relevantes);
    const tipsTxt = tipsArr.length
      ? `\n\nTips clínicos:\n• ${tipsArr.join("\n• ")}`
      : "";

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 520,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_IA },
        {
          role: "user",
          content:
            `Edad: ${merged.edad ?? "—"}\n` +
            (merged.genero ? `Género: ${merged.genero}\n` : "") +
            (merged.dolor
              ? `Región de dolor: ${merged.dolor}${
                  merged.lado ? ` (${merged.lado})` : ""
                }\n`
              : "") +
            `Consulta/Indicación (texto libre):\n${merged.consulta}\n\n` +
            `Puntos dolorosos marcados:\n${puntosTxt}${tipsTxt}\n\n` +
            `Redacta EXACTAMENTE con el formato solicitado y dentro del límite de palabras.`,
        },
      ],
    });

    const respuesta = recortar(
      completion.choices?.[0]?.message?.content || "",
      1200
    );

    // Extrae y guarda HASTA 2 exámenes sugeridos (los dos primeros)
    const parsed = parseExamenesSugeridos(respuesta);

    memoria.set(`ia:${idPago}`, {
      ...prev,
      ...merged,
      respuesta,
      examenesIA: parsed.firstTwo, // ← arreglo (1–2)
      examenesIA_rm: parsed.rm,
      examenesIA_rx: parsed.rx,
      examenesIA_eco: parsed.eco,
      examenesIA_otros: parsed.otros,
      pagoConfirmado: false,
    });

    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("Error GPT (preview-informe):", err);
    res
      .status(500)
      .json({ ok: false, error: "Error al generar preview" });
  }
});

/* ===== PDF IA (informe de texto) ===== */
router.get("/pdf-ia/:idPago", (req, res) => {
  try {
    const memoria = req.app.get("memoria");
    const meta = memoria.get(`meta:${req.params.idPago}`);
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(`ia:${req.params.idPago}`);
    if (!d) return res.sendStatus(404);
    if (!d.pagoConfirmado) return res.sendStatus(402);

    const filename = `informeIA_${req.params.idPago}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generarInformeIA(doc, d);
    doc.end();
  } catch (err) {
    console.error("pdf-ia error:", err);
    res.sendStatus(500);
  }
});

export default router;
