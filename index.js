import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', (req, res) => {
  try {
    const { nombre, rut, edad, dolor, lado } = req.body;

    if (!nombre || !rut || !edad || !dolor) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    // Crear documento PDF en memoria
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Configurar headers para descarga PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=orden_resonancia.pdf');

    // Pipe del PDF directo a la respuesta HTTP
    doc.pipe(res);

    // Encabezado
    doc
      .fontSize(20)
      .fillColor('#0072CE')
      .text('Instituto de Cirugía Articular', { align: 'center' });

    doc.moveDown(0.5);
    doc
      .fontSize(16)
      .fillColor('black')
      .text('Orden Médica', { align: 'center' });

    doc.moveDown(1);

    // Datos paciente
    doc
      .fontSize(12)
      .text(`Nombre: ${nombre}`)
      .text(`RUT: ${rut}`)
      .text(`Edad: ${edad} años`);

    doc.moveDown(1);

    // Determinar orden a solicitar
    let orden = '';

    if (dolor.toLowerCase() === 'rodilla') {
      orden = parseInt(edad) < 50
        ? `Resonancia magnética de rodilla ${lado.toLowerCase()}`
        : `Radiografía de rodilla ${lado.toLowerCase()} AP y lateral de pie`;
    } else if (dolor.toLowerCase() === 'cadera') {
      orden = parseInt(edad) < 50
        ? `Resonancia magnética de cadera ${lado.toLowerCase()}`
        : `Radiografía de pelvis AP de pie`;
    } else if (dolor.toLowerCase() === 'columna lumbar') {
      orden = 'Resonancia magnética de columna lumbar';
    } else {
      orden = `Examen imagenológico no especificado`;
    }

    doc
      .fontSize(14)
      .fillColor('#000')
      .text('Se solicita:', { underline: true });

    doc.moveDown(0.5);

    doc
      .fontSize(14)
      .fillColor('#0072CE')
      .text(orden);

    doc.moveDown(4);

    // Firma médica
    doc
      .fontSize(12)
      .fillColor('black')
      .text('_____________________________', { align: 'center' })
      .text('Médico tratante', { align: 'center' });

    doc.end();

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
