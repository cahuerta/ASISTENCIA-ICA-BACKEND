import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', (req, res) => {
  const { nombre, edad, rut, dolor, lado } = req.body;

  const sintomas = `${dolor} ${lado || ''}`.trim();
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${nombre.replace(/ /g, '_')}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);

  // === LOGO ===
  const logoPath = path.resolve('assets/ica.jpg');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 50, 40, { width: 120 });
    } catch (err) {
      console.error('Error al insertar imagen:', err.message);
    }
  }

  // === TÍTULOS ===
  doc.font('Helvetica-Bold').fontSize(16).text('INSTITUTO DE CIRUGIA ARTICULAR', 190, 50);
  doc.font('Helvetica-Bold').fontSize(12).text('Orden Médica de Imagenología', 190, 70);

  // === DATOS PERSONALES ===
  let currentY = 110;
  doc.font('Helvetica').fontSize(11).text(`Nombre: ${nombre}`, 190, currentY);
  currentY += 18;
  doc.text(`Edad: ${edad}`, 190, currentY);
  currentY += 18;
  doc.text(`RUT: ${rut}`, 190, currentY);
  currentY += 30;

  // === SÍNTOMAS ===
  doc.fontSize(12).text('Diagnostico:', 50, currentY);
  currentY += 20;
  doc.fontSize(11).text(sintomas, 50, currentY);
  currentY += 40;

  // === LÓGICA DE DERIVACIÓN ===
  let orden = '';
  let derivado = '';
  const sintomasLower = sintomas.toLowerCase();

  if (sintomasLower.includes('rodilla')) {
    orden = edad < 50 ? 'Resonancia Magnética de Rodilla.' : 'Radiografía de Rodilla AP y Lateral.';
    derivado = 'Dr. Jaime Espinoza (Rodilla)';
  } else if (
    sintomasLower.includes('cadera') ||
    sintomasLower.includes('ingle') ||
    sintomasLower.includes('inguinal')
  ) {
    orden = edad < 50 ? 'Resonancia Magnética de Cadera.' : 'Radiografía de Pelvis AP de pie.';
    derivado = 'Dr. Cristóbal Huerta (Cadera)';
  } else {
    orden = 'Evaluación pendiente según examen físico.';
    derivado = 'Especialidad a definir.';
  }

  // === EXAMEN SUGERIDO ===
  doc.fontSize(12).text('Examen sugerido:', 50, currentY);
  currentY += 18;
  doc.fontSize(11).text(orden, 50, currentY);
  currentY += 30;

  // ✅ DERIVACIÓN QUE FALTABA MOSTRAR
  doc.fontSize(12).text('Derivación:', 50, currentY);
  currentY += 18;
  doc.fontSize(11).text(derivado, 50, currentY);
  currentY += 60;

  // === FIRMA ===
  doc.text('_________________________', 50, currentY);
  doc.text('Firma y Timbre Médico', 50, currentY + 15);

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
