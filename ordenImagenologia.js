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
      doc.image(logoPath, 50, 40, { width: 100 });
    }
  } catch (err) {
    console.error('Logo error:', err.message);
  }

  doc.font('Helvetica-Bold').fontSize(16).text('INSTITUTO DE CIRUGÍA ARTICULAR', { align: 'center' });
  doc.moveDown(1.5);
  doc.fontSize(14).text('Orden Médica de Imagenología', { align: 'center', underline: true });
  doc.moveDown(5);

  // --------- DATOS PACIENTE ---------
  const sintomas = `${dolor ?? ''} ${lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(12);
  doc.text(`Nombre: ${nombre ?? ''}`);
  doc.text(`Edad: ${edad ?? ''}`);
  doc.text(`RUT: ${rut ?? ''}`);
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown(2);

  // --------- EXAMEN (viene desde index.js) ---------
  doc.font('Helvetica-Bold').text('Examen sugerido:');
  doc.font('Helvetica').fontSize(13).text(examen || 'Evaluación imagenológica según clínica.');
  doc.moveDown(2);

  // --------- NOTA ---------
  doc.font('Helvetica').fontSize(12).text(
    'Nota:\n\nDado sus motivos y molestias, le sugerimos agendar una hora con nuestro \nespecialista en cadera o rodilla, Huerta o Espinoza, con el examen realizado.',
    { align: 'left' }
  );

  // --------- PIE DE PÁGINA: FIRMA + TIMBRE (al final de la hoja) ---------
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;

  // Base cerca del final de la página (sin crear otra hoja)
  const baseY = pageH - 170;

  // Línea y texto
  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, { align: 'center', width: pageW - marginL - marginR });
  doc.text('Firma y Timbre Médico', marginL, baseY + 18, { align: 'center', width: pageW - marginL - marginR });

  // Firma centrada encima de la línea
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

  // Timbre rotado 20°
  try {
    const timbrePath = path.join(__dirname, 'assets', 'timbre.jpg');
    if (fs.existsSync(timbrePath)) {
      const timbreW = 110;
      const timbreX = firmaX + firmaW + 40;
      const timbreY = firmaY - 20;

      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch (err) {
    console.error('Timbre error:', err.message);
  }

  // Datos del médico
  doc.font('Helvetica').fontSize(10);
  doc.text('Dr. Cristóbal Huerta Cortés', marginL, baseY + 52, { align: 'center', width: pageW - marginL - marginR });
  doc.text('RUT: 14.015.125-4', { align: 'center', width: pageW - marginL - marginR });
  doc.text('Cirujano de Reconstrucción Articular', { align: 'center', width: pageW - marginL - marginR });
}
