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

    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // A4

    // ✅ Leer e insertar logo
    const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
    if (!fs.existsSync(logoPath)) {
      return res.status(500).send('Logo no encontrado');
    }

    const logoBytes = fs.readFileSync(logoPath);
    const logoImage = await doc.embedJpg(logoBytes);
    const logoDims = logoImage.scale(0.25);

    // Posicionar logo arriba izquierda
    page.drawImage(logoImage, {
      x: 50,
      y: 780,
      width: logoDims.width,
      height: logoDims.height,
    });

    const font = await doc.embedFont(StandardFonts.Helvetica);
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

    const pdfBytes = await doc.save();
    res.setHeader('Content-Disposition', 'attachment; filename=orden.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Error generando PDF:', error);
    res.status(500).send('Error al generar PDF');
  }
});
