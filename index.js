const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', async (req, res) => {
  const { nombre, edad, dolor } = req.body;

  const derivado = dolor.toLowerCase().includes("rodilla")
    ? "Dr. Jaime Espinoza, Traumatólogo de Rodilla"
    : "Dr. Cristóbal Huerta, Traumatólogo de Cadera";

  const examen = dolor.toLowerCase().includes("rodilla")
    ? "Resonancia Magnética de Rodilla"
    : "Resonancia Magnética de Cadera";

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const logoPath = path.join(__dirname, 'logo.png');
  const logoBytes = fs.readFileSync(logoPath);
  const image = await doc.embedPng(logoBytes);
  const imageDims = image.scale(0.25);
  page.drawImage(image, {
    x: 50,
    y: 770,
    width: imageDims.width,
    height: imageDims.height,
  });

  const text = `
Instituto de Cirugía Articular
Nombre del paciente: ${nombre}
Edad: ${edad} años

Se solicita: ${examen}
Motivo: Dolor en ${dolor}

Favor realizar el examen en centro radiológico de confianza.

Derivar posteriormente con resultados al especialista correspondiente:

${derivado}


______________________
Firma y Timbre Médico
`;

  const lines = text.trim().split('\n');
  let y = 730;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 22;
  }

  const pdfBytes = await doc.save();

  res.setHeader('Content-Disposition', 'attachment; filename=orden.pdf');
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(pdfBytes));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
