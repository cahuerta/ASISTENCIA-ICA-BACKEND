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

// === Khipu (lee TUS 4 variables en Render)
const FRONTEND_BASE =
  process.env.FRONTEND_BASE ||
  process.env.frontend_base || // por si estuviera en minúsculas
  process.env.fronted_base ||  // typo histórico
  'https://asistencia-ica.vercel.app';

const KHIPU_ENV = (process.env.KHIPU_ENV || process.env.khipu_env || 'production').toLowerCase();
const KHIPU_ENDPOINT = (KHIPU_ENV === 'sandbox'
  ? 'https://khipu.com/apiSandbox/2.0'
  : 'https://khipu.com/api/2.0').replace(/\/+$/, '');

const KHIPU_API_KEY = process.env.KHIPU_API_KEY || process.env.khipu_api_key || '';

const AMOUNTS = {
  trauma: Number(process.env.KHIPU_AMOUNT_TRAUMA || 0),
  preop: Number(process.env.KHIPU_AMOUNT_PREOP || 0),
  generales: Number(process.env.KHIPU_AMOUNT_GENERALES || 0),
};
const DEFAULT_AMOUNT = Number(process.env.KHIPU_AMOUNT_DEFAULT || 1) || 1;

function khipuAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (!KHIPU_API_KEY) return h;
  if (KHIPU_API_KEY.includes(':')) {
    // Formato "receiver_id:secret" -> Basic
    h.Authorization = 'Basic ' + Buffer.from(KHIPU_API_KEY).toString('base64');
  } else {
    // Token único -> Bearer
    h.Authorization = 'Bearer ' + KHIPU_API_KEY;
  }
  return h;
}

// ===== Memoria simple (cámbialo a Redis/DB si necesitas persistencia)
const memoria = new Map();
const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || '').replace(/[^a-zA-Z0-9_-]+/g, '_');

// ===== Helpers (misma lógica para PREVIEW y PDF)
function sugerirExamenImagenologia(dolor = '', lado = '', edad = null) {
  const d = String(dolor || '').toLowerCase();
  const L = String(lado || '').trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : ''; // SIN paréntesis
  const edadNum = Number(edad);
  const mayor60 = Number.isFinite(edadNum) ? edadNum > 60 : false;

  if (d.includes('columna')) {
    return ['RESONANCIA DE COLUMNA LUMBAR.'];
  }

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
    if (mayor60) {
      return ['RX DE PELVIS AP, Y LOWESTAIN.'];
    } else {
      return [`RESONANCIA MAGNETICA DE CADERA${ladoTxt}.`];
    }
  }

  return ['Evaluación imagenológica según clínica.'];
}

function notaAsistencia(dolor = '') {
  const d = String(dolor || '').toLowerCase();
  const base = 'Presentarse con esta orden. Ayuno NO requerido salvo indicación.';
  if (d.includes('rodilla')) {
    return `${base}\nConsultar con nuestro especialista en rodilla Dr Jaime Espinoza.`;
  }
  if (d.includes('cadera')) {
    return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  }
  return base;
}

// ===== Cargas dinámicas (ESM) de generadores PDF
let _genTrauma = null;
async function loadOrdenImagenologia() {
  if (_genTrauma) return _genTrauma;
  const m = await import('./ordenImagenologia.js'); // ESM
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

// ===== Preview (misma lógica que PDF)
app.get('/sugerir-imagenologia', (req, res) => {
  const { dolor = '', lado = '', edad = '' } = req.query || {};
  try {
    const lines = sugerirExamenImagenologia(dolor, lado, edad);
    const nota = notaAsistencia(dolor);
    res.json({ ok: true, examLines: lines, examen: lines.join('\n'), nota });
  } catch (e) {
    console.error('sugerir-imagenologia error:', e);
    res.status(500).json({ ok: false, error: 'No se pudo sugerir el examen' });
  }
});

// =====================================================
// ===============   TRAUMA (IMAGENOLOGÍA)  ============
// =====================================================

// Guarda datos de TRAUMA
app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('trauma', idPago), { ...datosPaciente, pagoConfirmado: true }); // (ajusta a false si validas notificación)
  res.json({ ok: true });
});

// Obtener datos de TRAUMA
app.get('/obtener-datos/:idPago', (req, res) => {
  const d = memoria.get(ns('trauma', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Crear pago Khipu (REAL desde backend) + guest opcional
app.post('/crear-pago-khipu', async (req, res) => {
  try {
    const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
    if (!idPago) return res.status(400).json({ ok: false, error: 'Falta idPago' });

    const space =
      (modulo === 'preop' || String(idPago).startsWith('preop_')) ? 'preop' :
      (modulo === 'generales' || String(idPago).startsWith('generales_')) ? 'generales' :
      'trauma';

    if (datosPaciente) {
      const prev = memoria.get(ns(space, idPago)) || {};
      memoria.set(ns(space, idPago), { ...prev, ...datosPaciente, pagoConfirmado: prev.pagoConfirmado ?? false });
    }

    // Modo invitado (simula OK)
    if (modoGuest === true) {
      const url = new URL(FRONTEND_BASE);
      url.searchParams.set('pago', 'ok');
      url.searchParams.set('idPago', idPago);
      url.searchParams.set('guest', '1');
      return res.json({ ok: true, url: url.toString() });
    }

    // Pago real
    if (!KHIPU_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Falta KHIPU_API_KEY en backend' });
    }

    const subject =
      space === 'preop' ? 'Pago Exámenes Preoperatorios' :
      space === 'generales' ? 'Pago Exámenes Generales' :
      'Pago Orden Médica Imagenológica';

    const amount = AMOUNTS[space] > 0 ? AMOUNTS[space] : DEFAULT_AMOUNT;

    const return_url = `${FRONTEND_BASE}?pago=ok&idPago=${encodeURIComponent(idPago)}`;
    const cancel_url = `${FRONTEND_BASE}?pago=cancelado&idPago=${encodeURIComponent(idPago)}`;

    const r = await fetch(`${KHIPU_ENDPOINT}/payments`, {
      method: 'POST',
      headers: khipuAuthHeaders(),
      body: JSON.stringify({
        subject,
        amount,
        currency: 'CLP',
        transaction_id: idPago,
        custom: space,
        return_url,
        cancel_url,
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `Khipu HTTP ${r.status}`, detail: txt });
    }

    const data = await r.json().catch(() => ({}));
    const url = data.payment_url || data.app_url || data.paymentURL || null;
    if (!url) return res.status(502).json({ ok: false, error: 'Khipu no devolvió payment_url' });

    res.json({ ok: true, url });
  } catch (e) {
    console.error('crear-pago-khipu error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Descargar PDF TRAUMA
app.get('/pdf/:idPago', async (req, res) => {
  try {
    const d = memoria.get(ns('trauma', req.params.idPago));
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402);

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
// ===============   PREOP (PDF 2 PÁGINAS)  ============
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

// 1 PDF con 2 páginas (Lab/ECG + Odonto)
app.get('/pdf-preop/:idPago', async (req, res) => {
  try {
    const d = memoria.get(ns('preop', req.params.idPago));
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402);

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
// ============   GENERALES (1 PDF)  ===================
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
    // if (!d.pagoConfirmado) return res.sendStatus(402);

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
