import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', (req, res) => {
  const { nombre, rut, edad, dolor, lado } = req.body;

  if (!nombre || !rut || !edad || !dolor) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  // Determinar orden médica según dolor, lado y edad
  let orden = '';
  if (dolor === 'Rodilla') {
    orden =
      edad < 50
        ? `Resonancia magnética de rodilla ${lado.toLowerCase()}`
        : `Radiografía de rodilla ${lado.toLowerCase()} AP y lateral de pie`;
  } else if (dolor === 'Cadera') {
    orden =
      edad < 50
        ? `Resonancia magnética de cadera ${lado.toLowerCase()}`
        : `Radiografía de pelvis AP de pie`;
  } else if (dolor === 'Columna lumbar') {
    orden = 'Resonancia magnética de columna lumbar';
  } else {
    orden = 'Examen imagenológico no especificado';
  }

  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Preparar respuesta para descarga
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=orden_resonancia.pdf');

  doc.pipe(res);

  // Título
  doc
    .fontSize(20)
    .fillColor('#0072CE')
    .text('Instituto de Cirugía Articular', { align: 'center' })
    .moveDown(1);

  doc
    .fontSize(16)
    .fillColor('black')
    .text('Orden Médica de Examen Imagenológico', { align: 'center' })
    .moveDown(2);

  // Datos paciente
  doc
    .fontSize(12)
    .text(`Nombre: ${nombre}`)
    .text(`RUT: ${rut}`)
    .text(`Edad: ${edad} años`)
    .moveDown(1);

  // Motivo y orden
  doc
    .fontSize(14)
    .fillColor('#333')
    .text(`Motivo / Diagnóstico: Dolor de ${dolor} ${lado}`, { continued: false })
    .moveDown(1);

  doc
    .fontSize(14)
    .fillColor('#0072CE')
    .text(`Orden médica solicitada:`)
    .moveDown(0.5);

  doc
    .fontSize(13)
    .fillColor('black')
    .text(orden)
    .moveDown(3);

  // Firma
  doc
    .fontSize(12)
    .text('_____________________________', { align: 'center' })
    .text('Firma médico tratante', { align: 'center' });

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en puerto ${PORT}`);
});
