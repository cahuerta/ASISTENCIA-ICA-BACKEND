// ordenImagenologia.js
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Asegura __dirname en ES Modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function generarOrdenImagenologia(doc, datos) {
  const { nombre, edad, rut, dolor, lado, examen } = datos;

  // --------- ENCABEZADO ---------
  // Logo (opcional, si existe)
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 100 });
    }
  } catch (err) {
    console.error('Logo error:', err.message);
  }

  // Títulos
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('INSTITUTO DE CIRUGÍA ARTICULAR', { align: 'center' });
  doc.moveDown(0.5);
  doc
    .fontSize(14)
    .text('Orden Médica de Imagenología', { align: 'center', underline: true });

  doc.moveDown(2);

  // --------- DATOS PACIENTE ---------
  doc.font('Helvetica').fontSize(12);
  doc.text(`Nombre: ${nombre ?? ''}`);
  doc.text(`Edad: ${edad ?? ''}`);
  doc.text(`RUT: ${rut ?? ''}`);
  const sintomas = `${dolor ?? ''} ${lado ?? ''}`.trim();
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown();

  // --------- EXAMEN (viene desde index.js) ---------
  doc.font('Helvetica-Bold').text('Examen sugerido:');
  doc.font('Helvetica').fontSize(13).text(examen || 'Evaluación imagenológica según clínica.');
  doc.moveDown();

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

  // Altura base para el pie (ajustado para no crear nueva página)
  const baseY = pageH - 170; // más espacio como pediste

  // Línea de firma y texto "Firma y Timbre"
  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, { align: 'center', width: pageW - marginL - margi_
