const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', async (req, res) => {
  try {
    const { nombre, rut, edad, dolor, lado } = req.body;

    if (!nombre || !rut || !edad || !dolor || !lado) {
      return res.status(400).send('Faltan datos en la solicitud');
    }

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

    // Crear documento PDF
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]); // tamaño A4 en pts

    // Cargar logo JPG desde carpeta assets
    const logoPath = path.join(__dirname, 'assets', 'logo.jpg');
    if (!fs.existsSync(logoPath)) {
