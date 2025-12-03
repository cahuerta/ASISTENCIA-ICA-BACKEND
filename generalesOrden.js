// generalesOrden.js  (ESM) — VERSIÓN LIMPIA QUE SOLO USA LO QUE LE ENTREGAN
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { memoria } from './index.js'; // ← acceso a memoria

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ======================================================
   ========== HELPERS PARA DEBUG Y NORMALIZACIÓN =========
   ====================================================== */

function safeJson(obj, maxLen = 1000) {
  try {
    const s = JSON.stringify(obj ?? null, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen) + "...[truncado]" : s;
  } catch {
    return "[no se pudo serializar]";
  }
}

function drawBulletList(doc, items = [], opts = {}) {
  const {
    bulletRadius = 2.2,
    bulletIndent = 10,
    textIndent   = 6,
    lineGap      = 2,
    font         = 'Helvetica',
    fontSize     = 13,
    width,
  } = opts;

  const W = width || (doc.page.width - doc.page.margins.left - doc.page.margins.right);

  doc.font(font).fontSize(fontSize);
  doc.list(items, {
    bulletRadius,
    bulletIndent,
    textIndent,
    lineGap,
    width: W,
  });

  doc.x = doc.page.margins.left;
}

function dibujarFirmaTimbre(doc) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, {
    align: 'center',
    width: pageW - marginL - marginR,
  });
  doc.text('Firma y Timbre Médico', marginL, baseY + 18, {
    align: 'center',
    width: pageW - marginL - marginR,
  });

  const firmaW = 250;
  const firmaX = (pageW - firmaW) / 2;
  const firmaY = baseY - 45;

  try {
    const firmaPath = path.join(__dirname, 'assets', 'FIRMA.png');
    if (fs.existsSync(firmaPath)) doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
  } catch {}

  try {
    const timbrePath = path.join(__dirname, 'assets', 'timbre.jpg');
    if (fs.existsSync(timbrePath)) {
      const timbreW = 110;
      const timbreX = firmaX + firmaW;
      const timbreY = firmaY - 20;

      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch {}

  doc.font('Helvetica').fontSize(12);
  doc.text("Dr. Cristóbal Huerta Cortés", marginL, baseY + 52, {
    align: 'center', width: pageW - marginL - marginR
  });
  doc.text("RUT: 14.015.125-4", { align: 'center', width: pageW - marginL - marginR });
  doc.text("Cirujano de Reconstrucción Articular", { align: 'center', width: pageW - marginL - marginR });
  doc.text("INSTITUTO DE CIRUGIA ARTICULAR", { align: 'center', width: pageW - marginL - marginR });
}

/* ======================================================
   ==================== ORDEN GENERALES =================
   ====================================================== */

/**
 * ⚠️ ESTA VERSIÓN:
 * - NO genera base de exámenes
 * - NO usa PREOP_BASE
 * - NO inventa exámenes según género
 * - SOLO imprime examenesIA tal como vienen desde el backend
 */
export function generarOrdenGenerales(doc, datos = {}) {
  const { nombre, edad, rut, genero, examenesIA, informeIA, idPago } = datos;

  /* ================= ENCABEZADO ================= */
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 120 });
  } catch {}

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16).text('Orden de Exámenes Generales', 180, undefined, { underline: true });
  doc.moveDown(4);

  doc.x = doc.page.margins.left;

  /* ========= DATOS PACIENTE ========== */
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`); doc.moveDown(0.6);
  doc.text(`RUT: ${rut ?? ''}`);       doc.moveDown(0.6);
  doc.text(`Edad: ${edad ?? ''}`);     doc.moveDown(0.6);
  doc.text(`Género: ${genero ?? ''}`); doc.moveDown(1.6);

  /* ========= LISTA DE EXÁMENES (SOLO LOS RECIBIDOS) ========= */
  const lista = Array.isArray(examenesIA) ? examenesIA.filter(Boolean) : [];

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(14).text('Exámenes solicitados:');
  doc.moveDown(0.8);
  drawBulletList(doc, lista, { width: W, fontSize: 13 });

  doc.moveDown(1.6);

  /* ========= PIE PÁGINA 1 ========= */
  dibujarFirmaTimbre(doc);

  /* ======================================================
     =============== DEBUG FOOTER PÁGINA 1 =================
     ====================================================== */
  try {
    let memGen = null;
    if (idPago && memoria?.get) {
      memGen = memoria.get(`generales:${idPago}`) || null;
    }

    const exFront = (examenesIA || []).join(" | ");
    const exMem = (memGen?.examenesIA || []).join(" | ");

    console.log("DEBUG_PDF_GENERALES", {
      idPago,
      examenesFront: examenesIA,
      examenesMem: memGen?.examenesIA,
      memoria: memGen
    });

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor("#666");
    doc.text(`DEBUG(1/2): id=${idPago || "-"} | front=[${exFront}]`);
    doc.text(`DEBUG_MEM: ${String(exMem || "").slice(0,150)}`);
    doc.fillColor("black");
  } catch {}

  /* ======================================================
     ===================== PÁGINA 2 DEBUG ==================
     ====================================================== */
  try {
    doc.addPage();

    doc.font("Helvetica-Bold").fontSize(14)
      .text("DEBUG ORDEN GENERALES / IA", { align: "left" });

    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(10);

    /* 1) Payload front */
    const debugFront = {
      idPago,
      nombre, edad, rut, genero,
      examenesIA, informeIA
    };

    doc.text("1) PAYLOAD DESDE INDEX:");
    doc.moveDown(0.2);
    doc.text(safeJson(debugFront));

    /* 2) MEMORIA generales:idPago */
    let snapGen = null;
    if (idPago && memoria?.get) snapGen = memoria.get(`generales:${idPago}`) || null;

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text("2) MEMORIA generales:idPago:");
    doc.moveDown(0.2);
    doc.font("Helvetica").text(safeJson(snapGen));

    /* 3) IA debug */
    const snapIA =
      (snapGen && snapGen.debugIA) ||
      (memoria.get(`ia:${idPago}`) || null);

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text("3) DEBUG IA:");
    doc.moveDown(0.2);
    doc.font("Helvetica").text(
      safeJson(
        snapIA || { info: "No se encontró debugIA. Revisa generalesIA.js." }
      )
    );
  } catch {}
}
