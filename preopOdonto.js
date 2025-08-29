// preopOdonto.js (ESM)
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * datos esperados (los mismos básicos):
 * { nombre, rut, edad, dolor, lado, observaciones?, conclusion? }
 * - conclusion: 'APTO' | 'APTO CON RESERVAS' | 'NO APTO' (opcional)
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
  const opciones = ['APTO', 'APTO CON RESERVAS', 'NO APTO'];
  opciones.forEach(opt => {
    const mark = (concl === opt) ? '☑' : '☐';
    doc.font('Helvetica').fontSize(12).text(`${mark} ${opt}`);
  });

  doc.moveDown(3);
  // ----- PIE: FIRMA + TIMBRE -----
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, { align: 'center', width: pageW - marginL - marginR });
  doc.text('Firma y Timbre Odontólogo(a)', marginL, baseY + 18, { align: 'center', width: pageW - marginL - marginR });

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
  doc.text('Odontología – Evaluación Preoperatoria', marginL, baseY + 52, { align: 'center', width: pageW - marginL - marginR });
}
