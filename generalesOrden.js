// generalesOrden.js  (ESM) — VERSIÓN LIMPIA QUE SOLO USA LO QUE LE ENTREGAN + MEMORIA
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
 * - Usa examenesIA del payload o, si viene vacío,
 *   examenesIA desde memoria generales:idPago.
 */
export function generarOrdenGenerales(doc, datos = {}) {
  const { nombre, edad, rut, genero, examenesIA, informeIA, idPago } = datos;

  /* ====== LEER MEMORIA GENERALES:idPago UNA SOLA VEZ ====== */
  let memGen = null;
  try {
    if (idPago && memoria?.get) {
      memGen = memoria.get(`generales:${idPago}`) || null;
    }
  } catch (e) {
    console.error("ERROR_LECTURA_MEM_GENERALES", { idPago, error: e?.message });
  }

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

  /* ========= LISTA DE EXÁMENES =========
     1) Primero examenesIA del payload
     2) Si viene vacío, usar memGen.examenesIA
  */
  const listaBruta =
    (Array.isArray(examenesIA) && examenesIA.length > 0)
      ? examenesIA
      : (Array.isArray(memGen?.examenesIA) ? memGen.examenesIA : []);

  const lista = listaBruta
    .map((it) => (typeof it === 'string' ? it : it?.nombre || ''))
    .map((s) => String(s).trim())
    .filter(Boolean);

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(14).text('Exámenes solicitados:');
  doc.moveDown(0.8);

  if (lista.length === 0) {
    doc.font('Helvetica').fontSize(12).text('• (Sin exámenes registrados en este flujo)');
  } else {
    drawBulletList(doc, lista, { width: W, fontSize: 13 });
  }

  doc.moveDown(1.6);

  /* ========= PIE PÁGINA 1 ========= */
  dibujarFirmaTimbre(doc);

  
