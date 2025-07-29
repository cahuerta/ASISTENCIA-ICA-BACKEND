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

    // Validación de campos
    if (!nombre || !rut || !edad || !dolor || !lado) {
      return res.status(400).send('Faltan datos en la solicitud');
    }

    const fecha = new Date().toLocaleDateString('es-CL');

    const esRodilla = dolor.toLowerCase().includes('rodilla');
    const examen = esRodilla
      ? `Resonancia Magnética de Rodilla ${lado}`
      : `Resonancia Magnética de
