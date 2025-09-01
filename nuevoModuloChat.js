// nuevoModuloChat.js
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { generarInformeIA } from "./informeIA.js";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Prompt y utilidades ----------
const SYSTEM_PROMPT_IA = `
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA MUY BREVE centrada en EXÁMENES a solicitar.

Reglas:
- Español claro. Extensión total: máx. 120–140 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales (“podría sugerir”, “compatible con”).
- Prioriza IMAGENOLOGÍA y, si corresponde, LABORATORIO complementario.
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en los exámenes.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (1–2 entidades clínicas probables)

Explicación breve:
• (1–2 frases muy concisas que justifiquen lo anterior)

Exámenes sugeridos:
• ...
• ...

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

// --- NUEVO: parser de la sección “Exámenes sugeridos” ---
function parseExamenesSugeridos(text = "") {
  if (!text) return { all: [], rm: [], rx: [], otros: [] };

  // Captura la sección entre "Exámenes sugeridos:" y "Indicaciones:" (o fin)
  const sec = /Ex[aá]menes sugeridos:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)/i.exec(text);
  if (!sec) return { all: [], rm: [], rx: [], otros: [] };

  const bloque = sec[1] || "";
  // Separar por líneas con viñetas típicas
  const rawLines = bloque
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bullets = [];
  for (const line of rawLines) {
    // Acepta viñetas "•", "-", "*" o líneas no vacías
    const m = /^[•\-\*]\s*(.+)$/.exec(line);
    const clean = (m ? m[1] : line).trim();
    if (!clean) continue;

    // Normaliza espacios y punto final opcional
    const norm = clean.replace(/\s+/g, " ").replace(/\s*\.\s*$/, ".");
    bullets.push(norm);
  }

  const rm = [];
  const rx = [];
  const otros = [];

  for (const b of bullets) {
    const l = b.toLowerCase();
    const isRM =
      l.includes("resonancia") ||
      l.includes("resonáncia") || // por si hay tildes raras
      /\brm\b/.test(l) ||
      l.includes("resonancia magn");

    const isRX =
      /\brx\b/.test(l) ||
      l.includes("radiografía") ||
      l.includes("radiografías") ||
      l.includes("rayos x") ||
      l.includes("teleradiografía") ||
      l.includes("teleradiograf");

    if (isRM) rm.push(b);
    else if (isRX) rx.push(b);
    else otros.push(b);
  }

  return { all: bullets, rm, rx, otros };
}

// ===== Preview IA (antes de pagar) =====
router.post("/preview-informe", async (req, res) => {
  try {
    // Del body pueden venir algunos campos; si faltan, los completamos desde memoria
    const { idPago, consulta } = req.body || {};
    if (!consulta || !idPago) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    const memoria = req.app.get("memoria");
    const prev = leerPacienteDeMemoria(memoria, idPago) || {};

    // Body tiene prioridad sobre lo guardado previamente
    const merged = {
      nombre: req.body?.nombre ?? prev?.nombre,
      edad: req.body?.edad ?? prev?.edad,
      rut: req.body?.rut ?? prev?.rut,
      genero: req.body?.genero ?? prev?.genero,
      dolor: req.body?.dolor ?? prev?.dolor,
      lado: req.body?.lado ?? prev?.lado,
      consulta, // viene del body
    };

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",     // si luego habilitas gpt-5-mini, cámbialo aquí
      temperature: 0.3,
      max_tokens: 320,          // tamaño suficiente para 120–140 palabras con estructura
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

    // --- NUEVO: extraer y guardar exámenes sugeridos para uso posterior (PDF de orden IA) ---
    const parsed = parseExamenesSugeridos(respuesta);

    // Guardar en memoria provisional (sin pago confirmado) con los datos consolidados
    memoria.set(`ia:${idPago}`, {
      ...prev,
      ...merged,
      respuesta,
      // NUEVO: guardar listas normalizadas para reusar en el generador existente
      examenesIA: parsed.all,
      examenesIA_rm: parsed.rm,
      examenesIA_rx: parsed.rx,
      examenesIA_otros: parsed.otros,
      pagoConfirmado: false,
    });

    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("Error GPT (preview-informe):", err);
    res.status(500).json({ ok: false, error: "Error al generar preview" });
  }
});

// ===== Guardar datos IA tras pago confirmado =====
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

// ===== Obtener datos IA (para frontend) =====
router.get("/obtener-datos-ia/:idPago", (req, res) => {
  const memoria = req.app.get("memoria");
  const d = memoria.get(`ia:${req.params.idPago}`);
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// ===== PDF IA (descarga final tras pago) =====
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

export default router;
