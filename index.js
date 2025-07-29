const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

app.post('/generar-pdf', async (req, res) => {
  try {
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

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4

    // Cargar logo ica.jpg
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');

    if (!fs.existsSync(logoPath)) {
      console.error('Logo no encontrado en:', logoPath);
      return res.status(500).send('Logo no encontrado en el servidor.');
    }

    const logoBytes = fs.readFileSync(logoPath);
    const logoImage = await pdfDoc.embedJpg(logoBytes);
    const logoDims = logoImage.scale(0.25);

    // Posicionar logo arriba a la izquierda
    page.drawImage(logoImage, {
      x: 50,
      y: 780,
      width: logoDims.width,
      height: logoDims.height,
    });

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = 780 - logoDims.height - 15;

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

    for (const line of lines) {
      page.drawText(line, {
        x: 50,
        y,
        size: 12,
        font,
      });
      y -= 25;
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Disposition', 'attachment; filename=orden.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error generando PDF:', error);
    res.status(500).send('Error al generar PDF');
  }
});
