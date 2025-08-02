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
app.post('/pdf', (req, res) => {
  const { nombre, edad, rut, sintomas, enfermedadesPrevias, cirugiasPrevias, alergias } = req.body;

  const doc = new PDFDocument();
  const filename = `orden_${nombre.replace(/ /g, '_')}.pdf`;

  // Seteo cabeceras para la respuesta
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.setHeader('Content-Type', 'application/pdf');

  // Enviar los datos PDF directamente en la respuesta
  doc.pipe(res);

  // Logo alineado a la izquierda arriba (asegúrate que el path sea correcto)
  const logoPath = path.resolve('assets/ica.jpg');
  doc.image(logoPath, 10, 40, { width: 100 });

  // Títulos
  doc.fontSize(20).text('INSTITUTO DE CIRUGIA ARTICULAR', 160, 60);
  doc.fontSize(16).text('Orden Médica de Imagenología', 160, 130);
  doc.moveDown(2);

  // Datos paciente
  doc.fontSize(10).text(`Nombre: ${nombre}`);
  doc.text(`Edad: ${edad}`);
  doc.text(`RUT: ${rut}`);
  doc.text(`Enfermedades previas: ${enfermedadesPrevias}`);
  doc.text(`Cirugías previas: ${cirugiasPrevias}`);
  doc.text(`Alergias: ${alergias}`);
  doc.moveDown();

  // Descripción de síntomas
  doc.text(`Descripción de síntomas: ${sintomas}`);
  doc.moveDown();

  // Lógica para orden según síntomas y edad
  let orden = '';
  let derivado = '';

  const sintomasMinus = sintomas.toLowerCase();

  if (sintomasMinus.includes('rodilla')) {
    if (edad < 50) {
      orden = 'Resonancia Magnética de Rodilla.';
    } else {
      orden = 'Radiografía de Rodilla AP y Lateral.';
    }
    derivado = 'Derivado a: Dr. Jaime Espinoza (Rodilla)';
  } else if (
    sintomasMinus.includes('cadera') ||
    sintomasMinus.includes('ingle') ||
    sintomasMinus.includes('inguinal')
  ) {
    if (edad < 50) {
      orden = 'Resonancia Magnética de Cadera.';
    } else {
      orden = 'Radiografía de Pelvis AP de pie.';
    }
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

// Iniciar serv
