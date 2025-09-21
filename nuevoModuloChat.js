// nuevoModuloChat.js
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { generarInformeIA } from "./informeIA.js";
// ⬇️ Reusar tu generador de órdenes de imagenología
import { generarOrdenImagenologia } from "./ordenImagenologia.js";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- Prompt y utilidades ---------- */
const SYSTEM_PROMPT_IA = `
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA MUY BREVE centrada en EXÁMENES a solicitar.

Reglas:
- Español claro. Extensión total: máx. 120–140 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales (“podría sugerir”, “compatible con”).
- Prioriza IMAGENOLOGÍA. Si corresponde, sugiere ECOGRAFÍA en lesiones de partes blandas (frecuente en hombro/codo/mano).
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en el examen.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (1 entidad clínica probable)

Explicación breve:
• (≈50 palabras, 1–2 frases muy concisas que justifiquen lo anterior)

Examen sugerido:
• (SOLO 1 examen de imagen, con lateralidad si aplica)

Indicaciones:
• Presentarse con la orden; ayuno solo si el examen lo solicita.
• Acudir a evaluación presencial con el/la especialista sugerido/a.

Devuelve SOLO el texto en este formato (sin comentarios adicionales).
`.trim();

function recortar(str, max = 900) {
  if (!str) return "";
  return str.length > max ? (str.slice(0, max).trim() + "…") : str;
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

/* --- Parser de “Examen sugerido” (singular; también acepta plural legacy) --- */
function parseExamenesSugeridos(text = "") {
  if (!text) return { all: [], first: "", rm: [], rx: [], eco: [], otros: [] };

  // Captura la sección entre "Examen sugerido:" (o "Exámenes sugeridos:") e "Indicaciones:" (o fin)
  const sec =
    /Examen(?:es)? sugeridos?:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)/i.exec(text);
  if (!sec) return { all: [], first: "", rm: [], rx: [], eco: [], otros: [] };

  const bloque = sec[1] || "";
  const bullets = bloque
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[•\-\*]\s*(.+)$/.exec(l)?.[1] || l).trim())
    .map((l) => l.replace(/\s+/g, " ").replace(/\s*\.\s*$/, ".")) // normaliza y asegura punto final
    .filter(Boolean);

  // Tomar SOLO el primero
  const first = bullets[0] || "";
  const one = first ? [first] : [];

  // Clasificación simple
  const rm = [], rx = [], eco = [], otros = [];
  for (const b of one) {
    const l = b.toLowerCase();
    const isRM  = l.includes("resonancia") || /\brm\b/.test(l) || l.includes("resonancia magn");
    const isRX  = /\brx\b/.test(l) || l.includes("radiografía") || l.includes("rayos x") || l.includes("teleradiograf");
    const isECO = l.includes("ecografía") || l.includes("ecografia") || l.includes("ultrasonido") || /\beco\b/.test(l);
    if (isRM) rm.push(b);
    else if (isRX) rx.push(b);
    else if (isECO) eco.push(b);
    else otros.push(b);
  }

  return { all: one, first, rm, rx, eco, otros };
}

/* --- Helpers mínimos para la orden IA --- */
function notaAsistenciaIA(dolor = "") {
  const d = String(dolor || "").toLowerCase();
  const base = "Presentarse con esta orden. Ayuno NO requerido salvo indicación.";
  if (d.includes("rodilla")) return `${base}\nConsultar con nuestro especialista en rodilla Dr Jaime Espinoza.`;
  if (d.includes("cadera"))  return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  return base;
}

/* --- Fallback de 1 examen según clínica (mantiene cadera/rodilla/columna lumbar) ---
   Además: para hombro/codo/mano en menores de 40 años, usar Ecografía preferente. */
function sugerirFallbackSegunClinica(dolor = "", lado = "", edad = null) {
  const d = String(dolor || "").toLowerCase();
  const L = String(lado || "").trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : "";
  const edadNum = Number(edad);
  const joven = Number.isFinite(edadNum) ? edadNum < 40 : false;
  const mayor60 = Number.isFinite(edadNum) ? edadNum > 60 : false;

  // Mantener tu lógica existente (NO tocar estos)
  if (d.includes("columna")) return ["RESONANCIA DE COLUMNA LUMBAR."];

  if (d.includes("rodilla")) {
    return mayor60
      ? [`RX DE RODILLA${ladoTxt} AP/LATERAL/AXIAL.`]
      : [`RESONANCIA MAGNÉTICA DE RODILLA${ladoTxt}.`];
  }

  if (d.includes("cadera")) {
    return mayor60
      ? ["RX DE PELVIS AP Y LÖWENSTEIN."]
      : [`RESONANCIA MAGNÉTICA DE CADERA${ladoTxt}.`];
  }

  // Nuevas zonas con ECOGRAFÍA cuando sea razonable (partes blandas)
  if (d.includes("hombro")) {
    return joven
      ? [`ECOGRAFÍA DE HOMBRO${ladoTxt}.`]
      : [`RX DE HOMBRO${ladoTxt} AP/LATERAL.`];
  }
  if (d.includes("codo")) {
    return joven
      ? [`ECOGRAFÍA DE CODO${ladoTxt}.`]
      : [`RX DE CODO${ladoTxt} AP/LATERAL.`];
  }
  if (d.includes("mano")) {
    return joven
      ? [`ECOGRAFÍA DE MANO${ladoTxt}.`]
      : [`RX DE MANO${ladoTxt} AP/OBLICUA.`];
  }
  if (d.includes("tobillo")) {
    // Tobillo suele iniciar con RX; ecografía puede ser útil en tendinopatías,
    // pero por simplicidad mantenemos RX como fallback general.
    return [`RX DE TOBILLO${ladoTxt} AP/LATERAL.`];
  }

  return ["Evaluación imagenológica según clínica."];
}

/* ===== Preview IA (antes de pagar) ===== */
router.post("/preview-informe", async (req, res) => {
  try {
    const { idPago, consulta } = req.body || {};
    if (!consulta || !idPago) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    const memoria = req.app.get("memoria");
    const prev = leerPacienteDeMemoria(memoria, idPago) || {};

    const merged = {
      nombre:  req.body?.nombre  ?? prev?.nombre,
      edad:    req.body?.edad    ?? prev?.edad,
      rut:     req.body?.rut     ?? prev?.rut,
      genero:  req.body?.genero  ?? prev?.genero,
      dolor:   req.body?.dolor   ?? prev?.dolor,
      lado:    req.body?.lado    ?? prev?.lado,
      consulta,
    };

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 320,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_IA },
        {
          role: "user",
          content:
            `Edad: ${merged.edad ?? "—"}\n` +
            (merged.genero ? `Género: ${merged.genero}\n` : "") +
            (merged.dolor ? `Región de dolor: ${merged.dolor}${merged.lado ? ` (${merged.lado})` : ""}\n` : "") +
            `Consulta/Indicación (texto libre):\n${merged.consulta}\n\n` +
            `Redacta EXACTAMENTE con el formato solicitado y dentro del límite de palabras.`,
        },
      ],
    });

    const respuesta = recortar(completion.choices?.[0]?.message?.content || "", 900);

    // Extrae y guarda SOLO 1 examen sugerido
    const parsed = parseExamenesSugeridos(respuesta);

    memoria.set(`ia:${idPago}`, {
      ...prev,
      ...merged,
      respuesta,
      examenesIA: parsed.all,     // ← como arreglo de 1
      examenesIA_rm: parsed.rm,
      examenesIA_rx: parsed.rx,
      examenesIA_eco: parsed.eco, // ← ecografía si la IA la propuso
      examenesIA_otros: parsed.otros,
      pagoConfirmado: false,
    });

    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("Error GPT (preview-informe):", err);
    res.status(500).json({ ok: false, error: "Error al generar preview" });
  }
});

/* ===== Guardar datos IA tras pago confirmado ===== */
router.post("/guardar-datos-ia", (req, res) => {
  const { idPago } = req.body || {};
  if (!idPago) return res.status(400).json({ ok: false, error: "Falta idPago" });

  const memoria = req.app.get("memoria");
  const d = memoria.get(`ia:${idPago}`);
  if (!d) return res.status(404).json({ ok: false, error: "No hay datos previos" });

  memoria.set(`ia:${idPago}`, { ...d, pagoConfirmado: true });
  memoria.set(`meta:${idPago}`, { moduloAutorizado: "ia" });

  res.json({ ok: true });
});

/* ===== Obtener datos IA (para frontend) ===== */
router.get("/obtener-datos-ia/:idPago", (req, res) => {
  const memoria = req.app.get("memoria");
  const d = memoria.get(`ia:${req.params.idPago}`);
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
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
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generarInformeIA(doc, d);
    doc.end();
  } catch (err) {
    console.error("pdf-ia error:", err);
    res.sendStatus(500);
  }
});

/* ===== PDF IA (Orden de Exámenes) — SOLO 1 EXAMEN ===== */
router.get("/pdf-ia-orden/:idPago", async (req, res) => {
  try {
    const memoria = req.app.get("memoria");
    const meta = memoria.get(`meta:${req.params.idPago}`);
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(`ia:${req.params.idPago}`);
    if (!d) return res.sendStatus(404);
    if (!d.pagoConfirmado) return res.sendStatus(402);

    // Toma el primer examen de la IA; si no hay, usa fallback (1 examen).
    const lineas =
      Array.isArray(d.examenesIA) && d.examenesIA.length > 0
        ? d.examenesIA.slice(0, 1) // ← SOLO 1
        : sugerirFallbackSegunClinica(d.dolor, d.lado, d.edad).slice(0, 1);

    const examenStr = lineas[0] || ""; // una sola línea
    const nota = notaAsistenciaIA(d.dolor);

    const filename = `ordenIA_${req.params.idPago}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    // Reusar generador de orden (recibe string con saltos de línea; aquí es 1)
    generarOrdenImagenologia(doc, {
      ...d,
      examen: examenStr,
      nota,
    });

    doc.end();
  } catch (err) {
    console.error("pdf-ia-orden error:", err);
    res.sendStatus(500);
  }
});

export default router;
