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
      doc.image(logoPath, 50, 40, { width: 120 }); // logo a la izquierda
    }
  } catch (err) {
    console.error('Logo error:', err.message);
  }

  // Títulos a la derecha del logo
  const titleX = 180; // comienza a la derecha del logo
  doc.font('Helvetica-Bold').fontSize(18).text('INSTITUTO DE CIRUGÍA ARTICULAR', titleX, 50, { align: 'left' });
  doc.moveDown(1);
  doc.fontSize(16).text('Orden Médica de Imagenología', titleX, doc.y, { align: 'left', underline: true });
  doc.moveDown(3);

  // --------- DATOS PACIENTE ---------
  const sintomas = `Dolor en ${dolor ?? ''} ${lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);
  doc.moveDown(0.6);
  doc.text(`Edad: ${edad ?? ''}`);
  doc.moveDown(0.4);
  doc.text(`RUT: ${rut ?? ''}`);
  doc.moveDown(0.4);
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown(1.6);

  // --------- EXAMEN (viene desde index.js) ---------
  doc.font('Helvetica-Bold').fontSize(13).text('Examen sugerido:');
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(18).text(examen || 'Evaluación imagenológica según clínica.');
  doc.moveDown(2.4);

  // --------- NOTA ---------
  doc.font('Helvetica').fontSize(12).text(
    'Nota:\n\nDado sus motivos y molestias, le sugerimos agendar una hora con nuestro ' +
      'especialista en cadera o rodilla, Huerta o Espinoza, con el examen realizado.',
    { align: 'left' }
  );

  // --------- PIE DE PÁGINA: FIRMA + TIMBRE (al final de la hoja) ---------
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;

  // Base cercana al final (sin crear nueva página)
  const baseY = pageH - 170;

  // Línea y texto
  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, {
    align: 'center',
    width: pageW - marginL - marginR
  });
  doc.text('Firma y Timbre Médico', marginL, baseY + 18, {
    align: 'center',
    width: pageW - marginL - marginR
  });

  // Firma centrada encima de la línea
  const firmaW = 250;
  const firmaX = (pageW - firmaW) / 2;
  const firmaY = baseY - 50;

  try {
    const firmaPath = path.join(__dirname, 'assets', 'FIRMA.png');
    if (fs.existsSync(firmaPath)) {
      doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
    }
  } catch (err) {
    console.error('Firma error:', err.message);
  }

  // Timbre rotado 20° (a la derecha de la firma)
  try {
    const timbrePath = path.join(__dirname, 'assets', 'timbre.jpg');
    if (fs.existsSync(timbrePath)) {
      const timbreW = 110;
      const timbreX = firmaX + firmaW + 20; // un poco a la derecha de la firma
      const timbreY = firmaY - 10;

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
  doc.text('Dr. Cristóbal Huerta Cortés', marginL, baseY + 52, {
    align: 'center',
    width: pageW - marginL - marginR
  });
  doc.text('RUT: 14.015.125-4', {
    align: 'center',
    width: pageW - marginL - marginR
  });
  doc.text('Cirujano de Reconstrucción Articular', {
    align: 'center',
    width: pageW - marginL - marginR
  });
}
