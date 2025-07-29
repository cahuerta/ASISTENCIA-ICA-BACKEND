const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', async (req, res) => {
  const { nombre, edad, dolor, lado } = req.body;

  const esRodilla = dolor.toLowerCase().includes('rodilla');
  const examen = esRodilla ? 'Resonancia Magnética de Rodilla' : 'Resonancia Magnética de Cadera';
  const derivado = esRodilla
    ? 'Dr. Jaime Espinoza, Traumatólogo de Rodilla'
    : 'Dr. Cristóbal Huerta, Traumatólogo de Cadera';

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // Tamaño A4
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const lines = [
    'Instituto de Cirugía Articular',
    '',
    `Nombre del paciente: ${nombre}`,
    `Edad: ${edad} años`,
    '',
    `Se solicita: ${examen}`,
    `Motivo: Dolor en ${dolor} (${lado})`,
    '',
    'Favor realizar el examen en centro radiológico de confianza.',
    '',
    'Derivar posteriormente con resultados al especialista correspondiente:',
    '',
    derivado,
    '',
    '',
    '',
    '__________________________',
    'Firma y Timbre Médico',
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
