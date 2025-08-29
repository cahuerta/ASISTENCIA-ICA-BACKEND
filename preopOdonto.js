// preopOdonto.js (ESM)
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * { nombre, rut, edad, dolor, lado, observaciones?, conclusion? }
 * - conclusion: 'APTO' | 'APTO CON RESERVAS' | 'NO APTO'
 */
export function generarPreopOdonto(doc, datos = {}) {
  const { nombre, rut, edad, dolor, lado, observaciones, conclusion } = datos;

  // ----- ENCABEZADO -----
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 120 });
  } catch {}
  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16).text('Evaluación Preoperatoria por Odontología', 180, undefined, { underline: true });
  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // ----- PACIENTE -----
  const sintomas = `${datos?.dolor ?? ''} ${datos?.lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);     doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ''}`);         doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ''}`);           doc.moveDown(0.5);
  doc.text(`Motivo/Clínica: Dolor en ${sintomas || '—'}`);
  doc.moveDown(2);

  // ----- EVALUACIÓN -----
  doc.font('Helvetica-Bold').text('Evaluación Clínica:');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12);
  [
    '• Caries activas: _______________________________',
    '• Enfermedad periodontal: _______________________',
    '• Piezas en mal estado/focos infecciosos: _______',
    '• Lesiones mucosas: _____________________________',
    '• Recomendaciones de higiene: ___________________',
  ].forEach(l => doc.text(l));

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').text('Observaciones:');
  doc.font('Helvetica').fontSize(12).text(
    observaciones || '_____________________________________________________________\n_____________________________________________________________\n_____________________________________________________________'
  );

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').text('Conclusión:');
  const concl = (conclusion || '').toUpperCase();
  ['APTO', 'APTO CON RESERVAS', 'NO APTO'].forEach(opt => {
    const mark = (concl === opt) ? '☑' : '☐';
    doc.font('Helvetica').fontSize(12).text(`${mark} ${opt}`);
  });

  // ================== PIE: IZQUIERDA (tu firma+timbre+texto) / DERECHA (firma odonto) ==================
  const pageW   = doc.page.width;
  const pageH   = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;

  // Nivel de las líneas de firma
  const lineY = pageH - 150;

  // Dos columnas
  const gap    = 40; // espacio entre columnas
  const availW = pageW - marginL - marginR;
  const colW   = (availW - gap) / 2;
  const leftX  = marginL;
  const rightX = marginL + colW + gap;

  // -------- Colu
