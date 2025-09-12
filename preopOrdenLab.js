// preopOrdenLab.js (ESM)
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Catálogo EXACTO (coincide con el frontend).
 * Importante: “HEMOGRAMA MAS VHS” en una sola línea.
 */
const CATALOGO_EXAMENES = [
  'HEMOGRAMA MAS VHS',
  'PCR',
  'ELECTROLITOS PLASMATICOS',
  'PERFIL BIOQUIMICO',
  'PERFIL LIPIDICO',
  'PERFIL HEPATICO',
  'CREATININA',
  'TTPK',
  'HEMOGLOBINA GLICOSILADA',
  'VITAMINA D',
  'GRUPO Y RH',
  'VIH',
  'ORINA',
  'UROCULTIVO',
  'ECG DE REPOSO',
];

/** Fallback si la IA no entregó nada o viene vacío */
const EXAMENES_FIJOS = [...CATALOGO_EXAMENES];

/**
 * Normaliza y valida la lista que viene del backend (IA) contra el catálogo.
 * Acepta array de strings o de objetos { nombre } y devuelve solo los válidos
 * con la capitalización EXACTA del catálogo.
 */
function normalizarExamenesIA(lista) {
  if (!Array.isArray(lista)) return null;
  const catUpper = new Map(
    CATALOGO_EXAMENES.map((n) => [n.trim().toUpperCase(), n])
  );

  const out = [];
  for (const it of lista) {
    const raw = typeof it === 'string' ? it : (it && it.nombre) || '';
    const key = String(raw).trim().toUpperCase();
    if (catUpper.has(key)) out.push(catUpper.get(key));
  }
  return out.length ? out : null;
}

export function generarOrdenPreopLab(doc, datos = {}) {
  const {
    nombre,
    rut,
    edad,
    dolor,
    lado,
    nota,
    tipoCirugia,       // <-- puede venir del flujo nuevo
    examenesIA,        // <-- lista devuelta por IA (opcional)
  } = datos || {};

  // —— ENCABEZADO ——
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 120 });
  } catch {}
  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16).text('Orden Preoperatoria – Laboratorio y ECG', 180, undefined, { underline: true });
  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // —— PACIENTE ——
  const sintomas = `${dolor ?? ''} ${lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);      doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ''}`);          doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ''}`);            doc.moveDown(0.5);
  // Se explicita el contexto de cirugía si está disponible
  if (tipoCirugia) {
    doc.text(`Tipo de cirugía: ${tipoCirugia}`);
    doc.moveDown(0.5);
  }
  doc.text(`Descripción de síntomas: ${sintomas || '—'}`);
  doc.moveDown(2);

  // —— EXÁMENES (IA o fallback) ——
  const listaExamenes = normalizarExamenesIA(examenesIA) || EXAMENES_FIJOS;

  doc.font('Helvetica-Bold').text('Solicito los siguientes exámenes:');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12);
  listaExamenes.forEach((e) => doc.text(`• ${e}`));

  doc.moveDown(3);

  // Nota opcional
  if (nota) {
    doc.font('Helvetica-Oblique').fontSize(11).text(nota);
    doc.moveDown(2);
  }

  // —— PIE: FIRMA + TIMBRE ——
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, { align: 'center', width: pageW - marginL - marginR });
  doc.text('Firma y Timbre Médico',   marginL, baseY + 18, { align: 'center', width: pageW - marginL - marginR });

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
      const timbreW = 110, timbreX = firmaX + firmaW, timbreY = firmaY - 20;
      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch {}

  doc.font('Helvetica').fontSize(12);
  doc.text('Dr. Cristóbal Huerta Cortés', marginL, baseY + 52, { align: 'center', width: pageW - marginL - marginR });
  doc.text('RUT: 14.015.125-4',          { align: 'center', width: pageW - marginL - marginR });
  doc.text('Cirujano de Reconstrucción Articular', { align: 'center', width: pageW - marginL - marginR });
  doc.text('INSTITUTO DE CIRUGÍA ARTICULAR',       { align: 'center', width: pageW - marginL - marginR });
}
