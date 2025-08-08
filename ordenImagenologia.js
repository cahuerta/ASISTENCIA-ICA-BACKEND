// ordenImagenologia.js
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export function generarOrdenImagenologia(doc, datos) {
  const { nombre, edad, rut, dolor, lado } = datos;

  const sintomas = `${dolor} ${lado || ''}`.trim();

  const examen =
    sintomas.toLowerCase().includes('rodilla') || sintomas.toLowerCase().includes('cadera') || sintomas.toLowerCase().includes('ingle')
      ? 'Evaluación pendiente según examen físico.'
      : 'Evaluación imagenológica según clínica.';

  // LOGO
  const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 40, { width: 100 });
  }

  // TITULO
  doc.font('Helvetica-Bold').fontSize(16).text('INSTITUTO DE CIRUGÍA ARTICULAR', {
    align: 'center'
  });
  doc.moveDown(0.5);
  doc.fontSize(14).text('Orden Médica de Imagenología', {
    align: 'center',
    underline: true
  });

  doc.moveDown(2);

  // DATOS PACIENTE
  doc.font('Helvetica').fontSize(12).text(`Nombre: ${nombre}`);
  doc.text(`Edad: ${edad}`);
  doc.text(`RUT: ${rut}`);
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown();

  // EXAMEN
  doc.font('Helvetica-Bold').text('Examen sugerido:');
  doc.font('Helvetica').text(examen);
  doc.moveDown();

  // NOTA FINAL
  doc.font('Helvetica').text(
    'Nota:\n\nDado sus motivos y molestias, le sugerimos agendar una hora con nuestro \nespecialista en cadera o rodilla, Huerta o Espinoza, con el examen realizado.',
    {
      align: 'left'
    }
  );
  doc.moveDown(4);

  // FIRMA Y TIMBRE
  doc.text('_________________________', { align: 'center' });
  doc.text('Firma y Timbre Médico', { align: 'center' });
  doc.moveDown();
  doc.text('Dr. Cristóbal Huerta Cortés', { align: 'center' });
  doc.text('RUT: 14.015.125-4', { align: 'center' });
  doc.text('Cirujano de Reconstrucción Articular', { align: 'center' });
}
