// preopOrdenLab.js (ESM)
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lista EXACTA entregada por ti
const EXAMENES_FIJOS = [
  'HEMOGRAMA',
  'VHS',
  'PCR',
  'ELECTROLITOS PLASMATICOS',
  'PERFIL BIOQUIMICO',
  'PERFIL LIPIDICO',
  'CREATININA',
  'TTPK',
  'HEMOGLOBINA GLICOSILADA',
  'VITAMINA D',
  'ORINA',
  'UROCULTIVO',
  'ECG DE REPOSO',
];

export function generarOrdenPreopLab(doc, datos = {}) {
  const { nombre, rut, edad, dolor, lado, nota } = datos;

  // ----- ENCABEZADO -----
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

  // ----- PACIENTE -----
  const sintomas = `${datos?.dolor ?? ''} ${datos?.lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);      doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ''}`);          doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ''}`);            doc.moveDown(0.5);
  doc.text(`Descripción de síntomas: Dolor en ${sintomas || '—'}`);
  doc.moveDown(2);

  // ----- EXÁMENES (fijos)
  doc.font('Helvetica-Bold').text('Solicito los siguientes exámenes:');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12);
  EXAMENES_FIJOS.forEach(e => doc.text(`• ${e}`));

  doc.moveDown(2);
  doc.text('Indicaciones:');
  doc.text('• Presentar esta orden y documento de identidad.');
  doc.text('• Seguir instrucciones del laboratorio según corresponda.');
  doc.moveDown(3);

  // Nota opcional
  if (nota) {
    doc.font('Helvetica-Oblique').fontSize(11).text(nota);
    doc.moveDown(2);
  }

  // ----- PIE: FIRMA + TIMBRE -----
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
