import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

app.post('/generar-pdf', (req, res) => {
  const { nombre, rut, edad, dolor, lado } = req.body;

  if (!nombre || !rut || !edad || !dolor) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  let orden = '';
  if (dolor === 'Rodilla') {
    orden =
      edad < 50
        ? `Resonancia magnética de rodilla ${lado.toLowerCase()}`
        : `Radiografía de rodilla ${lado.toLowerCase()} AP y lateral de pie`;
  } else if (dolor === 'Cadera') {
    orden =
      edad < 50
        ? `Resonancia magnética de cadera ${lado.toLower
