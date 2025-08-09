// ordenImagenologia.js
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function generarOrdenImagenologia(doc, datos) {
  const { nombre, edad, rut, dolor, lado, examen } = datos;

  // --------- ENCABEZADO ---------
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 120 });
    }
  } catch (err) {
    console.error('Logo error:', err.message);
  }

  // ✅ Texto a la derecha del logo, sin cambiar espacios originales
  doc.moveDown(1.5);
  doc.font('Helvetica-Bold')
     .fontSize(18)
     .text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16)
     .text('Orden Médica de Imagenología', 180, undefined, { underline: true });
  doc.moveDown(4);
  
  // 🔧 Resetear X para que el resto parta en el margen izquierdo
  doc.x = doc.page.margins.left;

  // --------- DATOS PACIENTE ---------
  const sintomas = `${dolor ?? ''} ${lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);
  doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ''}`);
  doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ''}`);
  doc.moveDown(0.5);
  doc.text(`Descripción de síntomas: Dolor en ${sintomas}`);
  doc.moveDown(2);

  // --------- EXAMEN (viene desde index.js) ---------
  doc.font('Helvetica-Bold').text('Examen sugerido:');
  doc.moveDown(4);
  doc.font('Helvetica-Bold').fontSize(18).text(examen || 'Evaluación imagenológica según clínica.');
  doc.moveDown(5);

  // --------- NOTA (solo diseño, viene desde index) ---------
  doc.font('Helvetica').fontSize(12).text(
    datos.nota || 'Nota:\n\nSe recomienda coordinar evaluación con la especialidad correspondiente, presentándose con el estudio realizado.',
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
