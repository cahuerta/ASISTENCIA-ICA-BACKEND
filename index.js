// index.js — Backend ajustado a este proyecto (SIN Google Sheets)
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const PDFDocument = require('pdfkit');
const path = require('path');
const { pathToFileURL } = require('url');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;
const RETURN_BASE = process.env.RETURN_BASE || 'https://asistencia-ica.vercel.app';

// ===================== Memoria / Utils =====================
const memoria = new Map(); // Reemplaza por Redis/DB si quieres persistencia real
const ns = (space, id) => `${space}:${id}`;
const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]+/g, '_');

function sugerirExamenImagenologia(dolor = '', lado = '') {
  const l = (lado || '').trim();
  if (/rodilla/i.test(dolor)) return `Radiografías de Rodilla${l ? ` (${l})` : ''} — AP/Lateral y patela (Merchant)`;
  if (/cadera/i.test(dolor))  return `Radiografías de Cadera${l ? ` (${l})` : ''} — AP/Lateral y pelvis AP`;
  if (/columna/i.test(dolor)) return `Radiografías de Columna lumbar — AP y Lateral`;
  return `Evaluación imagenológica según clínica`;
}

// Carga dinámica del módulo ESM para la orden de imagenología (trauma)
let generarOrdenImagenologia = null;
async function loadOrdenImagenologia() {
  if (generarOrdenImagenologia) return generarOrdenImagenologia;
  const url = pathToFileURL(path.resolve(__dirname, 'ordenImagenologia.js')).href;
  const m = await import(url);
  generarOrdenImagenologia = m.generarOrdenImagenologia;
  return generarOrdenImagenologia;
}

// Módulos PREOP (en CommonJS)
let generarPreopLabPDF, generarPreopImagenPDF;
try {
  ({ generarPreopLabPDF } = require('./preopOrdenLab.cjs'));
  ({ generarPreopImagenPDF } = require('./preopOrdenImagen.cjs'));
} catch {
  // Si aún no están, créalos con el código que te pasé
}

// ===================== Salud =====================
app.get('/health', (_req, res) => res.json({ ok: true }));

// ===================== TRAUMA / IMAGENOLOGÍA =====================
// Guarda datos (App.jsx)
app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('trauma', idPago), { ...datosPaciente, pagoConfirmado: false });
  res.json({ ok: true });
});

// Obtener datos (warm-up / verificación en App.jsx)
app.get('/obtener-datos/:idPago', (req, res) => {
  const k = ns('trauma', req.params.idPago);
  if (!memoria.has(k)) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: memoria.get(k) });
});

// Crear pago (mock/guest o integra Khipu real dentro)
app.post('/crear-pago-khipu', (req, res) => {
  const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
  if (!idPago) return res.status(400).json({ ok: false, error: 'Falta idPago' });

  // Decide espacio (trauma/preop) por 'modulo' o por prefijo del idPago
  const space = modulo
    ? String(modulo)
    : String(idPago).startsWith('preop_') || String(idPago).includes('preop')
      ? 'preop'
      : 'trauma';

  if (modoGuest && datosPaciente) {
    // Marca como pagado para flujo invitado
    memoria.set(ns(space, idPago), { ...datosPaciente, pagoConfirmado: true });
  }

  // Retorno al frontend con ?pago=ok&idPago=...
  const urlOk = new URL(RETURN_BASE);
  urlOk.searchParams.set('pago', 'ok');
  urlOk.searchParams.set('idPago', idPago);
  res.json({ ok: true, url: urlOk.toString() });
});

// Generar PDF de imagenología (trauma)
app.get('/pdf/:idPago', async (req, res) => {
  try {
    const k = ns('trauma', req.params.idPago);
    const d = memoria.get(k);
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402); // habilítalo cuando uses webhook real

    const generar = await loadOrdenImagenologia();
    const examen = d.examen || sugerirExamenImagenologia(d.dolor, d.lado);
    const datos = {
      ...d,
      examen,
      nota: d.nota || 'Presentarse con esta orden. Ayuno NO requerido salvo indicación.'
    };

    const filename = `orden_${sanitize(d.nombre || 'paciente')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    generar(doc, datos);
    doc.end();
  } catch (e) {
    console.error('pdf/:idPago error:', e);
    res.sendStatus(500);
  }
});

// ===================== PREOP (módulo separado) =====================
// Guarda datos PREOP (PreopModulo.jsx)
app.post('/guardar-datos-preop', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('preop', idPago), { ...datosPaciente, pagoConfirmado: false });
  res.json({ ok: true });
});

// Obtener datos PREOP (warm-up)
app.get('/obtener-datos-preop/:idPago', (req, res) => {
  const k = ns('preop', req.params.idPago);
  if (!memoria.has(k)) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: memoria.get(k) });
});

// PDFs PREOP: tipo=lab | imagen
app.get('/pdf-preop/:idPago', (req, res) => {
  try {
    const { idPago } = req.params;
    const tipo = String(req.query.tipo || 'lab').toLowerCase();
    const k = ns('preop', idPago);
    const d = memoria.get(k);
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402);

    const nombre = sanitize(d.nombre || 'paciente');
    const filename = tipo === 'imagen' ? `preop_imagen_${nombre}.pdf` : `preop_lab_${nombre}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (tipo === 'imagen') {
      if (!generarPreopImagenPDF) throw new Error('Falta preopOrdenImagen.cjs');
      generarPreopImagenPDF(res, d);
    } else {
      if (!generarPreopLabPDF) throw new Error('Falta preopOrdenLab.cjs');
      generarPreopLabPDF(res, d);
    }
  } catch (e) {
    console.error('pdf-preop/:idPago error:', e);
    res.sendStatus(500);
  }
});

// ===================== Start =====================
app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});
