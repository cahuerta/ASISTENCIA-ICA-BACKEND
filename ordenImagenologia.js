// ordenImagenologia.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolverDerivacion } from "./resolver.js"; 
// ⬆️ OJO: quitamos import { memoria } from "./index.js" para evitar ciclo

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function generarOrdenImagenologia(doc, datos) {
  // EL INDEX GARANTIZA QUE "examen" VIENE COMO STRING FINAL
  // buildExamenTextoStrict() → index.js
  const {
    nombre,
    edad,
    rut,
    dolor,
    lado,
    examen,   // ← EXAMEN STRING YA PROCESADO EN INDEX
    nota,     // ← nota final construida en index (si la usas)
    idPago,
  } = datos || {};

  // --------- ENCABEZADO ---------
  try {
    const logoPath = path.join(__dirname, "assets", "ica.jpg");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 120 });
    }
  } catch {}

  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(18)
    .text("INSTITUTO DE CIRUGÍA ARTICULAR", 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16)
    .text("Orden Médica de Imagenología", 180, undefined, { underline: true });

  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // --------- DATOS PACIENTE ---------
  const sintomas = `${dolor ?? ""} ${lado ?? ""}`.trim();
  doc.font("Helvetica").fontSize(14);
  doc.text(`Nombre: ${nombre ?? ""}`);
  doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ""}`);
  doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ""}`);
  doc.moveDown(0.5);
  doc.text(`Descripción de síntomas: Dolor en ${sintomas}`);
  doc.moveDown(2);

  // --------- EXAMEN (LO QUE ENVÍA EL INDEX) ---------
  doc.font("Helvetica-Bold").text("Examen sugerido:");
  doc.moveDown(4);

  // TEXTO EXACTO QUE ENVÍA EL INDEX
  doc.font("Helvetica-Bold")
    .fontSize(18)
    .text(examen || "");  // ← SIN FALLBACK AQUÍ

  doc.moveDown(5);

  // --------- NOTA (resolver derivación) ---------
  let bloqueNota = "";
  try {
    const deriv =
      resolverDerivacion && typeof resolverDerivacion === "function"
        ? resolverDerivacion({ ...datos, examen, dolor }) || {}
        : {};

    const notaDeriv = typeof deriv.nota === "string" ? deriv.nota.trim() : "";
    bloqueNota = notaDeriv ? `Nota:\n\n${notaDeriv}` : "";
  } catch {}

  if (bloqueNota) {
    doc.font("Helvetica").fontSize(12).text(bloqueNota, { align: "left" });
  }

  // --------- FIRMA Y TIMBRE ---------
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font("Helvetica").fontSize(12);
  doc.text("_________________________", marginL, baseY, {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("Firma y Timbre Médico", marginL, baseY + 18, {
    align: "center",
    width: pageW - marginL - marginR,
  });

  // Firma
  try {
    const firmaPath = path.join(__dirname, "assets", "FIRMA.png");
    if (fs.existsSync(firmaPath)) {
      const firmaW = 250;
      const firmaX = (pageW - firmaW) / 2;
      const firmaY = baseY - 45;
      doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
    }
  } catch {}

  // Timbre
  try {
    const timbrePath = path.join(__dirname, "assets", "timbre.jpg");
    if (fs.existsSync(timbrePath)) {
      const firmaW = 250;
      const firmaX = (pageW - firmaW) / 2;
      const timbreW = 110;
      const timbreX = firmaX + firmaW;
      const timbreY = (baseY - 45) - 20;

      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch {}

  // --------- PIE ---------
  doc.font("Helvetica").fontSize(12);
  doc.text("Dr. Cristóbal Huerta Cortés", marginL, baseY + 52, {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("RUT: 14.015.125-4", {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("Cirujano de Reconstrucción Articular", {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("INSTITUTO DE CIRUGIA ARTICULAR", {
    align: "center",
    width: pageW - marginL - marginR,
  });

  // --------- DEBUG SIMPLE (SIN MEMORIA) ---------
  try {
    const examPreview = (examen || "").slice(0, 120);
    console.log("DEBUG_PDF_TRAUMA", {
      idPago,
      rut,
      examenFromIndex: examen,
      examenPreview: examPreview,
    });

    doc.moveDown(1);
    doc
      .fontSize(8)
      .fillColor("#666")
      .text(
        `DEBUG: id=${idPago || "-"} | rut=${rut || "-"} | examenIDX=${examPreview}`
      );
    doc.fillColor("black");
  } catch {}
}
