const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', async (req, res) => {
  const { nombre, rut, edad, dolor, lado } = req.body;

  const fecha = new Date().toLocaleDateString('es-CL');
  const esRodilla = dolor.toLowerCase().includes('rodilla');
  const examen = esRodilla
    ? `Resonancia Magnética de Rodilla ${lado}`
    : `Resonancia Magnética de Cadera ${lado}`;
  const motivo = `Dolor persistente en ${dolor.toLowerCase()} ${lado.toLowerCase()}`;
  const indicaciones = esRodilla
    ? 'Acudir a control con nuestro especialista Dr. Jaime Espinoza.'
    : 'Acudir a control con nuestro especialista Dr. Cristóbal Huerta.';

  const firmaNombre = esRodilla
    ? 'Dr. Jaime Espinoza'
    : 'Dr. Cristóbal Huerta';

  const firmaTitulo = esRodilla
    ? 'Cirujano de Rodilla'
    : 'Cirujano de Cadera';

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const lines = [
    'INSTITUTO DE CIRUGÍA ARTICULAR',
    'ORDEN MÉDICA - RESONANCIA',
    '',
    `Paciente: ${nombre}`,
    `RUT: ${rut}`,
    `Edad: ${edad} años`,
    `Fecha: ${fecha}`,
    '',
    'Examen solicitado:',
    examen,
    '',
    'Motivo:',
    motivo,
    '',
    'Indicaciones:',
    indicaciones,
    '',
    '',
    'Firma:',
    firmaNombre,
    firmaTitulo,
    'Instituto de Cirugía Articular'
  ];

  let y = 780;
  for (const line of lines) {
    page.drawText(line, {
      x: 50,
      y,
      size: 12,
      font,
    });
    y -= 25;
  }

  const pdfBytes = await doc.save();
  res.setHeader('Content-Disposition', 'attachment; filename=orden.pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(pdfBytes));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
