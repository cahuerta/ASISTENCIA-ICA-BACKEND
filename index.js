import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// Endpoint para generar el PDF
app.post('/generar-pdf', (req, res) => {
  const { nombre, edad, rut, sintomas, enfermedadesPrevias, cirugiasPrevias, alergias } = req.body;

  const doc = new PDFDocument();
  const filename = `orden_${nombre.replace(/ /g, '_')}.pdf`;

  // Seteo cabeceras para la respuesta
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.setHeader('Content-Type', 'application/pdf');

  // Enviar los datos PDF directamente en la respuesta
  doc.pipe(res);

  // Logo alineado arriba a la izquierda
  const logoPath = path.resolve('assets/ica.jpg');
  doc.image(logoPath, 40, 40, { width: 80 });

  // Texto al lado derecho del logo
  const textStartX = 130;
  const textStartY = 50;
  doc.fontSize(16).text('INSTITUTO DE CIRUGIA ARTICULAR', textStartX, textStartY);
  doc.fontSize(12).text('Orden Médica de Imagenología', textStartX, textStartY + 20);

  // Bajar el cursor manualmente (en lugar de moveDown)
  doc.y = 140;

  // Datos paciente
  doc.fontSize(10).text(`Nombre: ${nombre}`);
  doc.text(`Edad: ${edad}`);
  doc.text(`RUT: ${rut}`);
  doc.text(`Enfermedades previas: ${enfermedadesPrevias || '-'}`);
  doc.text(`Cirugías previas: ${cirugiasPrevias || '-'}`);
  doc.text(`Alergias: ${alergias || '-'}`);
  doc.moveDown();

  // Descripción de síntomas
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown();

  // Lógica para orden según síntomas y edad
  let orden = '';
  let derivado = '';

  const sintomasMinus = sintomas.toLowerCase();

  if (sintomasMinus.includes('rodilla')) {
    orden = edad < 50
      ? 'Resonancia Magnética de Rodilla.'
      : 'Radiografía de Rodilla AP y Lateral.';
    derivado = 'Derivado a: Dr. Jaime Espinoza (Rodilla)';
  } else if (
    sintomasMinus.includes('cadera') ||
    sintomasMinus.includes('ingle') ||
    sintomasMinus.includes('inguinal')
  ) {
    orden = edad < 50
      ? 'Resonancia Magnética de Cadera.'
      : 'Radiografía de Pelvis AP de pie.';
    derivado = 'Derivado a: Dr. Cristóbal Huerta (Cadera)';
  } else {
    orden = 'Evaluación pendiente según examen físico.';
    derivado = 'Especialidad a definir.';
  }

  doc.fontSize(12).text(`Examen sugerido: ${orden}`);
  doc.text(derivado);
  doc.moveDown();

  // Firma
  doc.moveDown(4);
  doc.text('_________________________', 50);
  doc.text('Firma y Timbre Médico', 50);

  doc.end();
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

