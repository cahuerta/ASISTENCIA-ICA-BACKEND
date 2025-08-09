import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { generarOrdenImagenologia } from './ordenImagenologia.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// --- Memoria temporal para guardar datos antes del pago ---
const datosTemporales = {};

// Guardar datos temporales
app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body;
  if (!idPago || !datosPaciente) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
  }
  datosTemporales[idPago] = datosPaciente;
  console.log(`💾 Datos guardados para idPago ${idPago}:`, datosPaciente);
  res.json({ ok: true });
});

// Recuperar datos temporales
app.get('/obtener-datos/:idPago', (req, res) => {
  const { idPago } = req.params;
  const datos = datosTemporales[idPago];
  if (!datos) {
    return res.status(404).json({ ok: false, error: 'No encontrado' });
  }
  res.json({ ok: true, datos });
});

// ✅ NUEVO: crear link de pago Khipu con return_url dinámico + modo prueba (guest)
app.post('/crear-pago-khipu', (req, res) => {
  const { idPago, modoGuest = false, datosPaciente } = req.body;

  if (!idPago) {
    return res.status(400).json({ ok: false, error: 'Falta idPago' });
  }

  // 🧪 MODO GUEST (simulación sin ir a Khipu)
  if (modoGuest === true) {
    // opcional: guardar datos si vienen en esta misma llamada
    if (datosPaciente && typeof datosPaciente === 'object') {
      datosTemporales[idPago] = datosPaciente;
      console.log(`💾 [GUEST] Datos guardados para idPago ${idPago}:`, datosPaciente);
    }

    const returnUrl = `https://asistencia-ica.vercel.app/?pago=ok&idPago=${idPago}`;
    console.log(`🧪 [GUEST] Redirección simulada a: ${returnUrl}`);
    return res.json({ ok: true, url: returnUrl });
  }

  // ⚠️ Reemplaza esta URL con tu real paymentId generado por Khipu
  const khipuBaseUrl = 'https://khipu.com/payment/process/SbBes';

  // Redirección al frontend con el ID de pago
  const returnUrl = `https://asistencia-ica.vercel.app/?pago=ok&idPago=${idPago}`;
  const khipuFinalUrl = `${khipuBaseUrl}?return_url=${encodeURIComponent(returnUrl)}`;

  console.log(`🔗 Link de Khipu generado: ${khipuFinalUrl}`);
  res.json({ ok: true, url: khipuFinalUrl });
});

// ✅ Generar PDF por idPago
app.get('/pdf/:idPago', (req, res) => {
  const { idPago } = req.params;
  const datosPaciente = datosTemporales[idPago];

  if (!datosPaciente) {
    return res.status(404).json({ ok: false, error: 'Datos no encontrados para ese ID de pago' });
  }

  // === LÓGICA CLÍNICA: definir EXAMEN y DERIVACIÓN ===
  const { nombre, edad, rut, dolor, lado } = datosPaciente;

  const edadNum = parseInt(edad, 10);
  const sintomas = `${(dolor || '')} ${(lado || '')}`.toLowerCase();
  const ladoFmt = lado ? lado[0].toUpperCase() + lado.slice(1).toLowerCase() : '';

  let examen = 'Evaluación imagenológica según clínica.';
  let derivacion = '';
  let nota = ''; // <- añadido: el PDF usa datos.nota

  if (sintomas.includes('rodilla')) {
    examen = !isNaN(edadNum) && edadNum < 50
      ? `Resonancia Magnética de Rodilla ${ladoFmt}.`
      : `Radiografía de Rodilla ${ladoFmt} AP y Lateral.`;
    derivacion = 'Derivar a Dr. Jaime Espinoza (especialista en rodilla).';
    nota = 'Nota: Se recomienda una evaluación con nuestro especialista en rodilla, Dr. Jaime Espinoza, presentando el informe e imágenes del examen realizado.';
  } 
  else if (sintomas.includes('cadera') || sintomas.includes('ingle') || sintomas.includes('inguinal')) {
    examen = !isNaN(edadNum) && edadNum < 50
      ? `Resonancia Magnética de Cadera ${ladoFmt}.`
      : `Radiografía de Pelvis AP de pie.`;
    derivacion = 'Derivar a Dr. Cristóbal Huerta (especialista en cadera).';
    nota = 'Nota: Se recomienda una evaluación con nuestro especialista en cadera, Dr. Cristóbal Huerta, presentando el informe e imágenes del examen realizado.';
  }
  else if (sintomas.includes('columna')) {
    examen = 'Resonancia Magnética o Radiografía de Columna lumbar según criterio médico.';
    derivacion = 'Derivar a equipo de columna.';
    nota = 'Nota: Se recomienda una evaluación con nuestro equipo de columna, presentando el informe e imágenes del examen realizado.';
  }

  const datosConExamen = { ...datosPaciente, examen, derivacion, nota }; // <- añadido: nota
  // === FIN LÓGICA CLÍNICA ===

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${nombre?.replace(/ /g, '_') || 'paciente'}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);

  try {
    generarOrdenImagenologia(doc, datosConExamen);
  } catch (error) {
    console.error('❌ Error al generar contenido del PDF:', error.message);
    doc.font('Helvetica').fontSize(14).fillColor('red').text('Error al generar el documento PDF.', 100, 100);
  }

  doc.end();
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
