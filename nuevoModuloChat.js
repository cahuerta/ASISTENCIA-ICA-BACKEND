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
- Español claro. Máximo 120 palabras.
- No es diagnóstico ni tratamiento. No prescribas fármacos.
- No generes alarmismo ni diagnósticos.
- Prioriza IMAGENOLOGÍA y, si corresponde, LABORATORIO.
- Si hay lateralidad (Derecha/Izquierda), indícala en el examen.
- Evita repetir identificadores del paciente.
Formato EXACTO:
Resumen: (1 frase breve)
Exámenes sugeridos:
• ...
• ...
Indicaciones:
• Presentarse con la orden; ayuno solo si el examen lo solicita.
• Acudir a evaluación presencial con el/la especialista sugerido/a.
Devuelve solo el texto en este formato.
`.trim();

function recortar(str, max = 900) {
  if (!str) return "";
  return str.length > max ? (str.slice(0, max).trim() + "…") : str;
}

// ===== Preview IA (antes de pagar) =====
router.post("/preview-informe", async (req, res) => {
  try {
    // Se aceptan campos adicionales (p. ej. dolor/lado) si el front los envía
    const { idPago, consulta, nombre, edad, rut, dolor, lado } = req.body || {};
    if (!consulta || !idPago) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",       // si habilitas gpt-5-mini, puedes cambiarlo aquí
      temperature: 0.3,
      max_tokens: 350,            // ~120–150 palabras aprox
      messages: [
        { role: "system", content: SYSTEM_PROMPT_IA },
        {
          role: "user",
          content:
            `Edad: ${edad ?? "—"}\n` +
            (dolor ? `Región de dolor: ${dolor}${lado ? ` (${lado})` : ""}\n` : "") +
            `Consulta/Indicación (texto libre):\n${consulta}\n\n` +
            `Redacta la nota siguiendo el formato EXACTO y el límite de palabras.`,
        },
      ],
    });

    const respuesta = recortar(completion.choices?.[0]?.message?.content || "", 900);

    // Guardar en memoria provisional (sin pago confirmado)
    const memoria = req.app.get("memoria");
    memoria.set(`ia:${idPago}`, {
      nombre,
      edad,
      rut,
      dolor,
      lado,
      consulta,
      respuesta,
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
