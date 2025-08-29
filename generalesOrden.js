// generalesOrden.js  (ESM)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base PRE-OP (exacta, en mayúsculas)
const PREOP_BASE = [
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

// Construye lista de “Exámenes generales” según género
function buildGeneralesList(generoRaw = '') {
  const genero = String(generoRaw || '').trim().toLowerCase();

  if (genero === 'hombre') {
    // Hombre: mismos PREOP, quitar UROCULTIVO, + PERFIL HEPÁTICO, ANTÍGENO PROSTÁTICO, CEA
    const base = PREOP_BASE.filter((x) => x !== 'UROCULTIVO');
    return [
      ...base,
      'PERFIL HEPÁTICO',
      'ANTÍGENO PROSTÁTICO',
      'CEA',
    ];
  }

  if (genero === 'mujer') {
    // Mujer: mismos PREOP, + PERFIL HEPÁTICO, MAMOGRAFÍA, TSHm y T4 LIBRE, CALCIO, PAPANICOLAO (según edad)
    return [
      ...PREOP_BASE,
      'PERFIL HEPÁTICO',
      'MAMOGRAFÍA',
      'TSHm y T4 LIBRE',
      'CALCIO',
      'PAPANICOLAO (según edad)',
    ];
  }

  // Sin género → muestra base PREOP (neutral)
  return PREOP_BASE;
}

function drawBulletList(doc, items = [], opts = {}) {
  const { indent = 18, lineGap = 4, font = 'Helvetica', fontSize = 13 } = opts;
  doc.font(font).fontSize(fontSize);
  items.forEach((txt) => {
    doc.text(`• ${txt}`, { indent, lineGap });
  });
}

export function generarOrdenGenerales(doc, datos = {}) {
  const { nombre, edad, rut, genero } = datos;

  // --------- ENCABEZADO ---------
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 120 });
    }
  } catch (err) {
    console.error('Logo error:', err.message);
  }

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold')
     .fontSize(18)
     .text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16)
     .text('Orden de Exámenes Generales', 180, undefined, { underline: true });
  doc.moveDown(4);

  // Reset X para partir en margen izquierdo
  doc.x = doc.page.margins.left;

  // --------- DATOS PACIENTE ---------
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);
  doc.moveDown(0.6);
  doc.text(`RUT: ${rut ?? ''}`);
  doc.moveDown(0.6);
  doc.text(`Edad: ${edad ?? ''}`);
  doc.moveDown(0.6);
  doc.text(`Género: ${genero ?? ''}`);
  doc.moveDown(1.6);

  // --------- EXÁMENES ---------
  const lista = buildGeneralesList(genero);
  doc.font('Helvetica-Bold').fontSize(14).text('Exámenes solicitados:');
  doc.moveDown(0.8);
  drawBulletList(doc, lista, { fontSize: 13, indent: 14, lineGap: 2 });
  doc.moveDown(2);

  // --------- NOTA ---------
  doc.font('Helvetica').fontSize(12).text(
    datos.nota ||
    'Nota:\n\nSe solicita realizar los exámenes indicados y presentar resultados en control.',
    { align: 'left' }
  );

  // --------- PIE DE PÁGINA: FIRMA + TIMBRE ---------
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, { align: 'center', width: pageW - marginL - marginR });
  doc.text('Firma y Timbre Médico', marginL, baseY + 18, { align: 'center', width: pageW - marginL - marginR });

  const firmaW = 250;
  const firmaX = (pageW - firmaW) / 2;
  const firmaY = baseY - 45;

  try {
    const firmaPath = path.join(__dirname, 'assets', 'FIRMA.png');
    if (fs.existsSync(firmaPath)) {
      doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
    }
  } catch (err) {
    console.error('Firma error:', err.message);
  }

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
  } catch (err) {
    console.error('Timbre error:', err.message);
  }

  doc.font('Helvetica').fontSize(12);
  doc.text('Dr. Cristóbal Huerta Cortés', marginL, baseY + 52, { align: 'center', width: pageW - marginL - marginR });
  doc.text('RUT: 14.015.125-4', { align: 'center', width: pageW - marginL - marginR });
  doc.text('Cirujano de Reconstrucción Articular', { align: 'center', width: pageW - marginL - marginR });
  doc.text('INSTITUTO DE CIRUGIA ARTICULAR', { align: 'center', width: pageW - marginL - marginR });
}
