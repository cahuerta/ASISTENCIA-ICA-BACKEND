// informeIA.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function generarInformeIA(doc, datos) {
  const { nombre, edad, rut, consulta, respuesta } = datos;

  // -------- ENCABEZADO --------
  try {
    const logoPath = path.join(__dirname, "assets", "ica.jpg");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 120 });
    }
  } catch {}

  doc.font("Helvetica-Bold")
     .fontSize(18)
     .text("INSTITUTO DE CIRUGÍA ARTICULAR", 180, 50);

  doc.fontSize(16)
     .text("Informe Automático IA", 180, 80, { underline: true });

  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // -------- DATOS PACIENTE --------
  doc.font("Helvetica").fontSize(14);
  doc.text(`Nombre: ${nombre ?? ""}`);
  doc.text(`Edad: ${edad ?? ""}`);
  doc.text(`RUT: ${rut ?? ""}`);
  doc.moveDown(1);

  // -------- CONSULTA --------
  doc.font("Helvetica-Bold").text("Consulta realizada:");
  doc.font("Helvetica").text(consulta ?? "");
  doc.moveDown(2);

  // -------- RESPUESTA IA --------
  doc.font("Helvetica-Bold").text("Informe / Sugerencia IA:");
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(12).text(respuesta ?? "Sin respuesta", {
    align: "left",
  });

  // -------- PIE DE PÁGINA --------
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

  try {
    const firmaPath = path.join(__dirname, "assets", "FIRMA.png");
    if (fs.existsSync(firmaPath)) {
      doc.image(firmaPath, (pageW - 250) / 2, baseY - 45, { width: 250 });
    }
  } catch {}

  try {
    const timbrePath = path.join(__dirname, "assets", "timbre.jpg");
    if (fs.existsSync(timbrePath)) {
      doc.image(timbrePath, pageW / 2 + 80, baseY - 60, { width: 110 });
    }
  } catch {}

  doc.text("Dr. Cristóbal Huerta Cortés", marginL, baseY + 52, {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("RUT: 14.015.125-4", { align: "center", width: pageW - marginL - marginR });
  doc.text("Cirujano de Reconstrucción Articular", {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("INSTITUTO DE CIRUGIA ARTICULAR", {
    align: "center",
    width: pageW - marginL - marginR,
  });
}
