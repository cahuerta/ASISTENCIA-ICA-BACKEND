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

// ✅ NUEVO: crear link de pago Khipu con return_url dinámico
app.post('/crear-pago-khipu', (req, res) => {
  const { idPago } = req.body;

  if (!idPago) {
    return res.status(400).json({ ok: false, error: 'Falta idPago' });
  }

  // ⚠️ Reemplaza esta URL con tu real paymentId generado por Khipu
  const khipuBaseUrl = 'https://khipu.com/payment/process/zZMWd';

  // Redirección al frontend con el ID de pago
  const returnUrl = `https://asistencia-ica.vercel.app/?pago=ok&idPago=${idPago}`;
  const khipuFinalUrl = `${khipuBaseUrl}?return_url=${encodeURIComponent(returnUrl)}`;

  console.log(`🔗 Link de Khipu generado: ${khipuFinalUrl}`);
  res.json({ ok: true, url: khipuFinalUrl });
});

// Endpoint para generar PDF por idPago
app.get('/pdf/:idPago', (req, res) => {
  const { idPago } = req.params;
  const datosPaciente = datosTemporales[idPago];

  if (!datosPaciente) {
    return res.status(404).json({ ok: false, error: 'Datos no encontrados para ese ID de pago' });
  }

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${datosPaciente.nombre.replace(/ /g, '_')}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);
  generarOrdenImagenologia(doc, datosPaciente);
  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
