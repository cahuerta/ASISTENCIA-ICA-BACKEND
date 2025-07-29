const express = require('express');
const cors = require('cors');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json()); // <- Middleware importante para parsear JSON

app.post('/ordenes', async (req, res) => {
  try {
    const { nombre, rut, edad, dolor, lado } = req.body;

    if (!nombre || !rut || !edad || !dolor || !lado) {
      return res.status(400).send('Faltan datos obligatorios');
    }

    // Crear PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // Tamaño A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let y = 800;

    const lines = [
      'INSTITUTO DE CIRUGÍA ARTICULAR',
      'ORDEN MÉDICA - RESONANCIA',
      '',
      `Paciente: ${nombre}`,
      `RUT: ${rut}`,
      `Edad: ${edad} años`,
      `Fecha: ${new Date().toLocaleDateString('es-CL')}`,
      '',
      'Examen solicitado:',
      dolor.toLowerCase().includes('rodilla')
        ? `Resonancia Magnética de Rodilla ${lado}`
        : `Resonancia Magnética de Cadera ${lado}`,
      '',
      'Motivo:',
      `Dolor persistente en ${dolor.toLowerCase()} ${lado.toLowerCase()}`,
      '',
      'Indicaciones:',
      dolor.toLowerCase().includes('rodilla')
        ? 'Acudir a control con nuestro especialista Dr. Jaime Espinoza.'
        : 'Acudir a control con nuestro especialista Dr. Cristóbal Huerta.',
      '',
      '',
      'Firma:',
      dolor.toLowerCase().includes('rodilla')
        ? 'Dr. Jaime Espinoza'
        : 'Dr. Cristóbal Huerta',
      dolor.toLowerCase().includes('rodilla')
        ? 'Cirujano de Rodilla'
        : 'Cirujano de Cadera',
      'Instituto de Cirugía Articular'
    ];

    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 25;
    }

    const pdfBytes = await pdfDoc.save();

    // Enviar respuesta con headers correctos
    res.setHeader('Content-Disposition', 'attachment; filename=orden.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generando PDF:', error);
    res.status(500).send('Error al generar PDF');
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});
