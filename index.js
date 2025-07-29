const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

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

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let y = 780;

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
      'Ind
