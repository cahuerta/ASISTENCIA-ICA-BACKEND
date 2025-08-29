// index.js — PREOP: 1 PDF (2 páginas: LAB/ECG + ODONTO)
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const path = require('path');
const { pathToFileURL } = require('url');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;

// ===== Memoria simple (reemplazar por DB si quieres persistencia)
const memoria = new Map();
const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || '').replace(/[^a-zA-Z0-9_-]+/g, '_');

// ===== Carga dinámica (ESM) de los generadores
async function loadPreopLab() {
  const url = pathToFileURL(path.resolve(__dirname, 'preopOrdenLab.js')).href;
  const m = await import(url);
  return m.generarOrdenPreopLab;
}
async function loadPreopOdonto() {
  const url = pathToFileURL(path.resolve(__dirname, 'preopOdonto.js')).href;
  const m = await import(url);
  return m.generarPreopOdonto;
}

// ===== Salud
app.get('/health', (_req, res) => res.json({ ok: true }));

// ===== PREOP: guardar / obtener (para tu flujo antes/después de pagar)
app.post('/guardar-datos-preop', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) {
    return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  }
  // Espera: { nombre, rut, edad, dolor, lado, nota?, observaciones?, conclusion? }
  // Si luego integras pago real, cambia pagoConfirmado a false y márcalo en un webhook.
  memoria.set(ns('preop', idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

app.get('/obtener-datos-preop/:idPago', (req, res) => {
  const d = memoria.get(ns('preop', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// ===== PREOP: descarga — UN SOLO PDF con 2 páginas
app.get('/pdf-preop/:idPago', async (req, res) => {
  try {
    const d = memoria.get(ns('preop', req.params.idPago));
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402); // habilita si integras pago real

    const generarLab = await loadPreopLab();
    const generarOdonto = await loadPreopOdonto();

    const filename = `preop_${sanitize(d.nombre || 'paciente')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Página 1: LAB/ECG (tu lista exacta)
    generarLab(doc, d);

    // Página 2: Odontología
    doc.addPage();
    generarOdonto(doc, d);

    doc.end();
  } catch (e) {
    console.error('pdf-preop error:', e);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`API PREOP escuchando en puerto ${PORT}`);
});
