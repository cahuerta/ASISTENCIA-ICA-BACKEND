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

app.get('/', (req, res) => {
  res.send('Servidor backend del Asistente ICA operativo ✅');
});

app.post('/generar-pdf', (req, res) => {
  const datos = req.body;

  const doc = new PDFDocument({ margin: 60 });
  const nombreArchivo = `orden-${Date.now()}.pdf`;
  const stream = fs.createWriteStream(nombreArchivo);
  doc.pipe(stream);

  // Fecha actual y lugar
  const hoy = new Date();
  const opcionesFecha = { year: 'numeric', month: 'long', day: 'numeric' };
  const fechaFormateada = hoy.toLocaleDateString('es-ES', opcionesFecha);
  const lugar = 'Talca, Chile'; // Puedes cambiar el lugar aquí

  // Logo y encabezado
  const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 45, { width: 80 });
  }

  doc
    .fontSize(18)
    .fillColor('#0072CE')
    .text('Instituto de Cirugía Articular', 150, 50, { align: 'left' });

  // Fecha y lugar arriba a la derecha
  doc
    .fontSize(12)
    .fillColor('black')
    .text(`${lugar}`, 400, 50, { align: 'right' });
  doc.text(`${fechaFormateada}`, 400, 65, { align: 'right' });

  doc
    .fontSize(14)
    .fillColor('black')
    .text('ORDEN DE EXAMEN IMAGENOLÓGICO', 50, 110, { align: 'center', underline: true });

  // Línea separadora
  doc.moveTo(50, 140).lineTo(545, 140).stroke();

  // Datos paciente
  doc.moveDown(2);
  doc.fontSize(12).font('Helvetica-Bold').text('Datos del Paciente:', 50);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12);
  doc.text(`Nombre: ${datos.nombre}`, { indent: 20 });
  doc.text(`Edad: ${datos.edad} años`, { indent: 20 });
  doc.text(`Motivo de consulta: ${datos.motivo}`, { indent: 20 });
  doc.moveDown();

  // Examen solicitado
  doc.font('Helvetica-Bold').fontSize(12).text('Examen Solicitado:', { underline: true });
  doc.font('Helvetica').fontSize(12);

  const edadPaciente = parseInt(datos.edad);
  const motivo = datos.motivo.toLowerCase();

  if (motivo.includes('rodilla')) {
    if (edadPaciente < 50) {
      doc.text('→ Resonancia Magnética de Rodilla', { indent: 20 });
      doc.text('Justificación: Evaluación de lesiones ligamentarias y meniscales en paciente joven.', { indent: 20 });
    } else {
      doc.text('→ Radiografía de Rodilla (proyección AP y lateral)', { indent: 20 });
      doc.text('→ Considerar Resonancia según hallazgos clínicos', { indent: 20 });
      doc.text('Justificación: Estudio de artrosis o lesiones degenerativas en paciente mayor.', { indent: 20 });
    }
    doc.moveDown(0.5);
    doc.text('Recomendación: Evaluación por Dr. Jaime Espinoza', { indent: 20 });
  }
  else if (motivo.includes('cadera') || motivo.includes('inguinal')) {
    if (edadPaciente < 50) {
      doc.text('→ Resonancia Magnética de Cadera', { indent: 20 });
      doc.text('Justificación: Evaluación de lesiones intraarticulares y choque femoroacetabular en paciente joven.', { indent: 20 });
    } else {
      doc.text('→ Radiografía de Pelvis AP de pie', { indent: 20 });
      doc.text('Justificación: Evaluación de artrosis u otras patologías degenerativas.', { indent: 20 });
    }
    doc.moveDown(0.5);
    doc.text('Recomendación: Evaluación por Dr. Cristóbal Huerta', { indent: 20 });
  }
  else {
    doc.text('→ Evaluación imagenológica a definir según criterio clínico.', { indent: 20 });
    doc.text('→ Recomendación: Derivación a especialidad según hallazgos.', { indent: 20 });
  }

  doc.moveDown(4);

  // Firma y sello con líneas
  const firmaY = doc.y;
  doc.text('_____________________________', 50, firmaY);
  doc.text('Firma del médico tratante', 50, firmaY + 15);

  doc.text('_____________________________', 350, firmaY);
  doc.text('Sello', 350, firmaY + 15);

  // Marco alrededor del contenido
  doc
    .rect(45, 40, 510, doc.y + 20 - 40)
    .lineWidth(1)
    .strokeColor('#0072CE')
    .stroke();

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
