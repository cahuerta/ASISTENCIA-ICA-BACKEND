// nuevoModuloChat.js
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { generarInformeIA } from "./informeIA.js";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Preview: genera respuesta IA pero sin PDF =====
router.post("/preview-informe", async (req, res) => {
  try {
    const { consulta } = req.body;
    if (!consulta) return res.status(400).json({ ok: false, error: "Falta consulta" });

    const completion = await client.chat.completions.create({
      model: "gpt-5.0",
      messages: [
        { role: "system", content: "Eres un asistente médico especializado en traumatología." },
        { role: "user", content: consulta },
      ],
    });

    const respuesta = completion.choices[0].message.content;
    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("Error GPT:", err);
    res.status(500).json({ ok: false, error: "Error al generar preview" });
  }
});

// ===== PDF final: requiere pago confirmado =====
router.get("/pdf-informe/:idPago", async (req, res) => {
  try {
    const idPago = req.params.idPago;
    const datos = req.app.get("memoria").get(`ia:${idPago}`);
    if (!datos) return res.sendStatus(404);

    const filename = `informeIA_${idPago}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generarInformeIA(doc, datos);
    doc.end();
  } catch (err) {
    console.error("pdf-informe error:", err);
    res.sendStatus(500);
  }
});

export default router;
