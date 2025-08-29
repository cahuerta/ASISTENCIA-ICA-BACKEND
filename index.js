// index.js — ESM puro (Node >=18)
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;
const RETURN_BASE = process.env.RETURN_BASE || 'https://asistencia-ica.vercel.app';

// ===== Memoria simple
const memoria = new Map();
const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || '').replace(/[^a-zA-Z0-9_-]+/g, '_');

// ===== Helpers (lógica imagenología coherente con preview)
function sugerirExamenImagenologia(dolor = '', lado = '', edad = null) {
  const d = String(dolor || '').toLowerCase();
  const L = String(lado || '').trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : '';
  const edadNum = Number(edad);
  const mayor60 = Number.isFinite(edadNum) ? edadNum > 60 : false;

  if (d.includes('columna')) return ['RESONANCIA DE COLUMNA LUMBAR.'];

  if (d.includes('rodilla')) {
    if (mayor60) {
      return [
        `RX DE RODILLA${ladoTxt} — AP, LATERAL, AXIAL PATELA.`,
        'TELERADIOGRAFIA DE EEII.',
      ];
    } else {
      return [
        `RESONANCIA MAGNETICA DE RODILLA${ladoTxt}.`,
        'TELERADIOGRAFIA DE EEII.',
      ];
    }
  }

  if (d.includes('cadera')) {
    if (mayor60) return ['RX DE PELVIS AP, Y LOWESTAIN.'];
    return [`RESONANCIA MAGNETICA DE CADERA${ladoTxt}.`];
  }

  return ['Evaluación imagenológica según clínica.'];
}

function notaAsistencia(dolor = '') {
  const d = String(dolor || '').toLowerCase();
  const base = 'Presentarse con esta orden. Ayuno NO requerido salvo indicación.';
  if (d.includes('rodilla')) return `${base}\nConsultar con nuestro especialista en rodilla Dr Jaime Espinoza.`;
  if (d.includes('cadera')) return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  return base;
}

// ===== Cargas dinámicas de generadores PDF
let _genTrauma = null;
async function loadOrdenImagenologia() {
  if (_genTrauma) return _genTrauma;
  const m = await import('./ordenImagenologia.js');
  _genTrauma = m.generarOrdenImagenologia;
  return _genTrauma;
}

let _genPreopLab = null, _genPreopOdonto = null;
async function loadPreop() {
  if (!_genPreopLab) {
    const mLab = await import('./preopOrdenLab.js');
    _genPreopLab = mLab.generarOrdenPreopLab;
  }
  if (!_genPreopOdonto) {
    const mOd = await import('./preopOdonto.js');
    _genPreopOdonto = mOd.generarPreopOdonto;
  }
  return { _genPreopLab, _genPreopOdonto };
}

let _genGenerales = null;
async function loadGenerales() {
  if (_genGenerales) return _genGenerales;
  const m = await import('./generalesOrden.js');
  _genGenerales = m.generarOrdenGenerales;
  return _genGenerales;
}

// ===== Salud
app.get('/health', (_req, res) => res.json({ ok: true }));

// ===== Preview coherente con PDF
app.get('/sugerir-imagenologia', (req, res) => {
  const { dolor = '', lado = '', edad = '' } = req.query || {};
  try {
    const lines = sugerirExamenImagenologia(dolor, lado, edad);
    const nota = notaAsistencia(dolor);
    res.json({ ok: true, examLines: lines, examen: lines.join('\n'), nota });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'No se pudo sugerir el examen' });
  }
});

/* === Helper para crear pago Khipu con ENV (backend) === */
async function crearCobroKhipuReal({ idPago, modulo = 'trauma' }) {
  const endpoint = (process.env.KHIPU_ENDPOINT || 'https://khipu.com/api/2.0').replace(/\/+$/, '');
  const receiverId = process.env.KHIPU_RECEIVER_ID;
  const secret = process.env.KHIPU_SECRET;
  if (!receiverId || !secret) throw new Error('Faltan KHIPU_RECEIVER_ID o KHIPU_SECRET en ENV');

  const amounts = {
    trauma: Number(process.env.KHIPU_AMOUNT_TRAUMA || 0),
    preop: Number(process.env.KHIPU_AMOUNT_PREOP || 0),
    generales: Number(process.env.KHIPU_AMOUNT_GENERALES || 0),
  };
  const amount = amounts[modulo] > 0 ? amounts[modulo] : Number(process.env.KHIPU_AMOUNT_DEFAULT || 1) || 1;

  const subjects = {
    trauma: 'Pago Orden Médica Imagenológica',
    preop: 'Pago Exámenes Preoperatorios',
    generales: 'Pago Exámenes Generales',
  };
  const subject = subjects[modulo] || 'Pago Servicios Médicos';

  const return_url = `${RETURN_BASE}?pago=ok&idPago=${encodeURIComponent(idPago)}`;
  const cancel_url = `${RETURN_BASE}?pago=cancelado&idPago=${encodeURIComponent(idPago)}`;
  const notify_url = process.env.KHIPU_NOTIFY_URL || undefined;

  const auth = Buffer.from(`${receiverId}:${secret}`).toString('base64');

  const r = await fetch(`${endpoint}/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      amount,
      currency: 'CLP',
      transaction_id: idPago,
      custom: modulo,
      return_url,
      cancel_url,
      ...(notify_url ? { notify_url } : {}),
    }),
  });

  if (!r.ok) throw new Error(`Khipu HTTP ${r.status} ${await r.text().catch(() => '')}`);
  const data = await r.json();
  return data.payment_url || data.app_url || data.paymentURL || null;
}

// =====================================================
// ===============   TRAUMA (IMAGENOLOGÍA)  ============
// =====================================================

app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('trauma', idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

app.get('/obtener-datos/:idPago', (req, res) => {
  const d = memoria.get(ns('trauma', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// ⬇️ Esta ruta devuelve SIEMPRE la URL REAL de Khipu (sin modo invitado)
app.post('/crear-pago-khipu', async (req, res) => {
  const { idPago, datosPaciente, modulo } = req.body || {};
  if (!idPago) return res.status(400).json({ ok: false, error: 'Falta idPago' });

  const space =
    (modulo === 'preop' || String(idPago).startsWith('preop_')) ? 'preop' :
    (modulo === 'generales' || String(idPago).startsWith('generales_')) ? 'generales' :
    'trauma';

  // Guarda/actualiza (sin tocar pagoConfirmado)
  if (datosPaciente) {
    const prev = memoria.get(ns(space, idPago)) || {};
    memoria.set(ns(space, idPago), { ...prev, ...datosPaciente, pagoConfirmado: prev.pagoConfirmado ?? false });
  }

  try {
    const urlKhipu = await crearCobroKhipuReal({ idPago, modulo: space });
    if (!urlKhipu) return res.status(500).json({ ok: false, error: 'Khipu no devolvió URL' });
    return res.json({ ok: true, url: urlKhipu });
  } catch (e) {
    console.error('Error creando cobro Khipu:', e);
    return res.status(500).json({ ok: false, error: 'Error creando cobro Khipu' });
  }
});

// Descargar PDF TRAUMA
app.get('/pdf/:idPago', async (req, res) => {
  try {
    const d = memoria.get(ns('trauma', req.params.idPago));
    if (!d) return res.sendStatus(404);

    const generar = await loadOrdenImagenologia();

    const lines = sugerirExamenImagenologia(d.dolor, d.lado, d.edad);
    const examen = (d.examen && typeof d.examen === 'string')
      ? d.examen
      : Array.isArray(lines) ? lines.join('\n') : String(lines || '');

    const nota = d.nota || notaAsistencia(d.dolor);

    const datos = { ...d, examen, nota };

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

// =====================================================
// ===============   PREOP (2 páginas)  ================
// =====================================================

app.post('/guardar-datos-preop', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('preop', idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

app.get('/obtener-datos-preop/:idPago', (req, res) => {
  const d = memoria.get(ns('preop', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

app.get('/pdf-preop/:idPago', async (req, res) => {
  try {
    const d = memoria.get(ns('preop', req.params.idPago));
    if (!d) return res.sendStatus(404);

    const { _genPreopLab, _genPreopOdonto } = await loadPreop();

    const filename = `preop_${sanitize(d.nombre || 'paciente')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    _genPreopLab(doc, d);
    doc.addPage();
    _genPreopOdonto(doc, d);

    doc.end();
  } catch (e) {
    console.error('pdf-preop/:idPago error:', e);
    res.sendStatus(500);
  }
});

// =====================================================
// ============   GENERALES (1 página)  =================
// =====================================================

app.post('/guardar-datos-generales', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('generales', idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

app.get('/obtener-datos-generales/:idPago', (req, res) => {
  const d = memoria.get(ns('generales', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

app.get('/pdf-generales/:idPago', async (req, res) => {
  try {
    const d = memoria.get(ns('generales', req.params.idPago));
    if (!d) return res.sendStatus(404);

    const generar = await loadGenerales();

    const filename = `generales_${sanitize(d.nombre || 'paciente')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    generar(doc, d);
    doc.end();
  } catch (e) {
    console.error('pdf-generales/:idPago error:', e);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});
