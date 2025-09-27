// src/server/rmPdfRoutes.js
// Rutas para guardar datos del Formulario RM y generar el PDF.
// ESM (import ... from) compatible. Requiere: express, pdfkit.

import express from "express";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ====== almacenamiento simple en memoria (por idPago) ======
// En producción, reemplaza por DB persistente.
const RM_STORE = Object.create(null);

// ====== Utiles ======
const ALL_QUESTIONS = [
  "marcapasos",
  "coclear_o_neuro",
  "clips_aneurisma",
  "valvula_cardiaca_metal",
  "fragmentos_metalicos",
];

const LABELS = {
  marcapasos: "Marcapasos",
  coclear_o_neuro: "Implante coclear / neuroestimulador",
  clips_aneurisma: "Clips de aneurisma",
  valvula_cardiaca_metal: "Válvula cardíaca metálica",
  fragmentos_metalicos: "Fragmentos metálicos (ocular/corporal)",
};

function boolToText(v) {
  return v === true ? "Sí" : v === false ? "No" : "No informado";
}

function safeStr(v, fallback = "—") {
  if (v === 0) return "0";
  return (v ?? "").toString().trim() || fallback;
}

function findAsset(...names) {
  for (const n of names) {
    const p = path.join(__dirname, "assets", n);
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function formatDateCL(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("es-CL", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

// ====== POST /rm-save  → guarda/actualiza datos ======
router.post("/rm-save", express.json(), (req, res) => {
  try {
    const { idPago, paciente, checklist, resumen } = req.body || {};
    if (!idPago || typeof idPago !== "string") {
      return res.status(400).json({ ok: false, error: "idPago requerido (string)" });
    }
    RM_STORE[idPago] = {
      paciente: paciente || {},
      checklist: checklist || null, // puede venir null → "No informado"
      resumen: typeof resumen === "string" ? resumen : "",
      updatedAt: new Date().toISOString(),
    };
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ====== GET /pdf-rm/:idPago  → genera PDF ======
router.get("/pdf-rm/:idPago", (req, res) => {
  const { idPago } = req.params || {};
  if (!idPago || !RM_STORE[idPago]) {
    return res.status(404).send("No hay datos del Formulario RM para ese idPago.");
  }

  const { paciente = {}, checklist = null, resumen = "", updatedAt } = RM_STORE[idPago];

  // Cabeceras
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="Formulario_RM_${idPago}.pdf"`
  );

  // PDF
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  // Encabezado (logo + título)
  const logoPath = findAsset("ica.png", "ica.jpg", "logo.png", "logo.jpg");
  if (logoPath) {
    doc.image(logoPath, 50, 35, { width: 120 });
  }

  doc
    .fontSize(16)
    .text("INSTITUTO DE CIRUGÍA ARTICULAR", 200, 40, { align: "right" })
    .moveDown(1);

  doc
    .fontSize(13)
    .text("FORMULARIO DE SEGURIDAD PARA RESONANCIA MAGNÉTICA", {
      align: "center",
      underline: true,
    })
    .moveDown(0.8);

  // Datos del paciente
  const drawLine = (label, value) =>
    doc.fontSize(11).text(`${label}: ${safeStr(value)}`);

  drawLine("Nombre", paciente?.nombre);
  drawLine("RUT", paciente?.rut);
  drawLine("Edad", paciente?.edad);
  drawLine("Género", paciente?.genero);
  drawLine(
    "Dolor / Lado",
    [safeStr(paciente?.dolor, "—"), paciente?.lado ? `— ${paciente.lado}` : ""].join(" ").trim()
  );
  drawLine("ID Pago", idPago);
  drawLine("Fecha registro", formatDateCL(updatedAt ? new Date(updatedAt) : new Date()));
  doc.moveDown(0.6);

  // Checklist (todas las preguntas, siempre)
  doc.fontSize(12).text("Respuestas del checklist:", { underline: true }).moveDown(0.5);

  ALL_QUESTIONS.forEach((k) => {
    const etiqueta = LABELS[k] || k;
    const val = boolToText(checklist?.[k]);
    doc.fontSize(11).text(`• ${etiqueta}: ${val}`);
  });

  doc.moveDown(0.8);

  // Resumen libre (opcional)
  if (resumen && resumen.trim()) {
    doc.fontSize(12).text("Resumen:", { underline: true }).moveDown(0.2);
    doc.fontSize(11).text(resumen, { align: "left" }).moveDown(0.6);
  }

  // Firma / timbre
  const yBase = 730;
  doc
    .fontSize(11)
    .text("Firma Paciente: ________________________________", 50, yBase)
    .text("RUT: ____________________", 340, yBase)
    .moveDown(0.5)
    .text("Fecha: ____/____/______", 50, yBase + 22);

  const timbrePath = findAsset("timbre.png", "timbre.jpg", "stamp.png", "stamp.jpg");
  if (timbrePath) {
    doc.image(timbrePath, 460, yBase - 10, { width: 90, opacity: 0.9 });
  }

  doc.end();
});

// ====== helper opcional para montar en la app ======
export function registerRmPdfRoutes(app, basePath = "") {
  // Asegura body parser JSON en /rm-save (si tu app no lo tiene global)
  app.use(basePath, router);
}

export default router;
