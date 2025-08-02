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

// Endpoint para generar el PDF
app.post('/generar-pdf', (req, res) => {
  const { nombre, edad, rut, dolor, lado } = req.body;

  const sintomas = `${dolor} ${lado || ''}`.trim();

  const doc = new PDFDocument();
  const filename = `orden_${nombre.replace(/ /g, '_')}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);

  // Logo arriba a la izquierda
  const logoPath = path.resolve('assets/ica.jpg');
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 50, 40, { width: 80 });
    } catch (err) {
      console.error('Error al insertar imagen:', err.message);
    }
  }

  // Texto al lado del logo
  doc.fontSize(16).text('INSTITUTO DE CIRUGIA ARTICULAR', 150, 45);
  doc.fontSize(12).text('Orden Médica de Imagenología', 150, 65);
  doc.moveDown(3);

  // Datos del paciente
  doc.fontSize(10).text(`Nombre: ${nombre}`);
  doc.text(`Edad: ${edad}`);
  doc.text(`RUT: ${rut}`);
  doc.moveDown();

  // Descripción del síntoma
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown();

  // Lógica de orden médica
  let orden = '';
  let derivado = '';
  const sintomasLower = sintomas.toLowerCase();

  if (sintomasLower.includes('rodilla')) {
    orden = edad < 50 ? 'Resonancia Magnética de Rodilla.' : 'Radiografía de Rodilla AP y Lateral.';
    derivado = 'Derivado a: Dr. Jaime Espinoza (Rodilla)';
  } else if (
    sintomasLower.includes('cadera') ||
    sintomasLower.includes('ingle') ||
    sintomasLower.includes('inguinal')
  ) {
    orden = edad < 50 ? 'Resonancia Magnética de Cadera.' : 'Radiografía de Pelvis AP de pie.';
    derivado = 'Derivado a: Dr. Cristóbal Huerta (Cadera)';
  } else {
    orden = 'Evaluación pendiente según examen físico.';
    derivado = 'Especialidad a definir.';
  }

  doc.fontSize(12).text(`Examen sugerido: ${orden}`);
  doc.text(derivado);
  doc.moveDown(4);
  doc.text('_________________________', 50);
  doc.text('Firma y Timbre Médico', 50);

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
