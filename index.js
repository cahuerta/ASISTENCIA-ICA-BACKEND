const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', (req, res) => {
  const datos = req.body;

  const doc = new PDFDocument({ margin: 50 });
  const nombreArchivo = `orden-${Date.now()}.pdf`;
  const stream = fs.createWriteStream(nombreArchivo);
  doc.pipe(stream);

  // Ruta del logo
  const logoPath = path.join(__dirname, 'assets', 'ica.jpg');

  // Logo
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 40, { width: 100 });
  } else {
    console.warn('No se encontró el logo en assets/ica.jpg');
  }

  // Encabezado
  doc.fontSize(16).text('Instituto de Cirugía Articular', 160, 50, { align: 'left' });
  doc.fontSize(12).text('ORDEN DE EXAMEN IMAGENOLÓGICO', { align: 'center' });
  doc.moveDown(2);

  // Datos del paciente
  doc.fontSize(12);
  doc.text(`Nombre del paciente: ${datos.nombre}`);
  doc.text(`Edad: ${datos.edad}`);
  doc.text(`Motivo de consulta: ${datos.motivo}`);
  doc.text(`Antecedentes médicos: ${datos.enfermedades}`);
  doc.text(`Alergias: ${datos.alergias}`);
  doc.moveDown();

  // Examen y derivación sugerida
  doc.font('Helvetica-Bold').text('Examen solicitado:', { underline: true });
  doc.font('Helvetica');

  if (datos.motivo.toLowerCase().includes('rodilla')) {
    doc.text('→ Resonancia Magnética de Rodilla');
    doc.text('→ Recomendación: Evaluación por Dr. Jaime Espinoza');
  } else if (
    datos.motivo.toLowerCase().includes('cadera') ||
    datos.motivo.toLowerCase().includes('inguinal')
  ) {
    doc.text('→ Resonancia Magnética de Cadera');
    doc.text('→ Recomendación: Evaluación por Dr. Cristóbal Huerta');
  } else {
    doc.text('→ Evaluación imagenológica a definir según criterio clínico.');
    doc.text('→ Recomendación: Derivación a especialidad según hallazgos.');
  }

  doc.moveDown(3);

  // Firma
  doc.text('_____________________________', { align: 'left' });
  doc.text('Firma del médico tratante', { align: 'left' });

  doc.end();

  stream.on('finish', () => {
    res.download(nombreArchivo, () => {
      fs.unlinkSync(nombreArchivo);
    });
  });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en puerto ${port}`);
});
