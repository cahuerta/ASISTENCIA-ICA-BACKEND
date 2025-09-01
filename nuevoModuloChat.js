// nuevoModuloChat.js
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { generarInformeIA } from "./informeIA.js";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Preview IA (antes de pagar) =====
router.post("/preview-informe", async (req, res) => {
  try {
    const { idPago, consulta, nombre, edad, rut } = req.body;
    if (!consulta || !idPago) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres un asistente médico especializado en traumatología." },
        { role: "user", content: consulta },
      ],
    });

    const respuesta = completion.choices[0].message.content;

    // Guardar en memoria provisional (sin pago confirmado)
    const memoria = req.app.get("memoria");
    memoria.set(`ia:${idPago}`, {
      nombre,
      edad,
      rut,
      consulta,
      respuesta,
      pagoConfirmado: false,
    });

    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("Error GPT:", err);
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
