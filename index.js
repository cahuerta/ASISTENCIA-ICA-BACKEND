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

// ===== Memoria simple (cámbialo a Redis/DB si necesitas persistencia)
const memoria = new Map();
const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || '').replace(/[^a-zA-Z0-9_-]+/g, '_');

// ===== Helpers (ACTUALIZADAS)
// Devuelve un ARREGLO de líneas con los exámenes a solicitar (sin paréntesis del lado)
function sugerirExamenImagenologia(dolor = '', lado = '', edad = null) {
  const d = String(dolor || '').toLowerCase();
  const L = String(lado || '').trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : ''; // ← SIN paréntesis
  const edadNum = Number(edad);
  const mayor60 = Number.isFinite(edadNum) ? edadNum > 60 : false;

  // Columna: resonancia (sin lado)
  if (d.includes('columna')) {
    return ['RESONANCIA DE COLUMNA LUMBAR.'];
  }

  // Rodilla
  if (d.includes('rodilla')) {
    if (mayor60) {
      // TELERADIOGRAFIA en línea separada
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

  // Cadera
  if (d.includes('cadera')) {
    if (mayor60) {
      // Mantener en una sola línea como pediste
      return ['RX DE PELVIS AP, Y LOWESTAIN.'];
    } else {
      return [`RESONANCIA MAGNETICA DE CADERA${ladoTxt}.`];
    }
  }

  // Fallback explícito
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
    const mLab = await import('./preopOrdenLab.js');     // ESM
    _genPreopLab = mLab.generarOrdenPreopLab;
  }
  if (!_genPreopOdonto) {
    const mOd = await import('./preopOdonto.js');        // ESM
    _genPreopOdonto = mOd.generarPreopOdonto;
  }
  return { _genPreopLab, _genPreopOdonto };
}

// Generales
let _genGenerales = null;
async function loadGenerales() {
  if (_genGenerales) return _genGenerales;
  const m = await import('./generalesOrden.js'); // ESM
  _genGenerales = m.generarOrdenGenerales;
  return _genGenerales;
}

// ===== Salud
app.get('/health', (_req, res) => res.json({ ok: true }));

// ===== Endpoint para PREVIEW (usa la MISMA lógica que el PDF)
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

/* === Helper mínimo para crear pago Khipu con ENV (backend) ===
   No altera tu frontend. El botón "Pagar ahora" seguirá llamando
   a /crear-pago-khipu, que ahora devuelve la URL real de Khipu.
   ENV requeridas en Render:
     - KHIPU_RECEIVER_ID
     - KHIPU_SECRET
   Opcionales:
     - KHIPU_ENDPOINT         (default: https://khipu.com/api/2.0)
     - KHIPU_NOTIFY_URL
     - KHIPU_AMOUNT_TRAUMA / KHIPU_AMOUNT_PREOP / KHIPU_AMOUNT_GENERALES
     - KHIPU_AMOUNT_DEFAULT   (fallback si no defines los anteriores)
*/
async function crearCobroKhipuReal({ idPago, modulo = 'trauma', datosPaciente }) {
  const endpoint = (process.env.KHIPU_ENDPOINT || 'https://khipu.com/api/2.0').replace(/\/+$/, '');
  const receiverId = process.env.KHIPU_RECEIVER_ID;
  const secret = process.env.KHIPU_SECRET;
  if (!receiverId || !secret) {
    throw new Error('Faltan KHIPU_RECEIVER_ID o KHIPU_SECRET en ENV');
  }

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

  const body = {
    subject,
    amount,
    currency: 'CLP',
    transaction_id: idPago,
    custom: modulo,
    return_url,
    cancel_url,
    ...(notify_url ? { notify_url } : {}),
  };

  const r = await fetch(`${endpoint}/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Khipu HTTP ${r.status} ${txt || ''}`);
  }
  const data = await r.json();
  const url = data.payment_url || data.app_url || data.paymentURL || null;
  if (!url) throw new Error('Khipu no devolvió payment_url');
  return url;
}

// =====================================================
// ===============   TRAUMA (IMAGENOLOGÍA)  ============
// =====================================================

// Guarda datos de TRAUMA
app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('trauma', idPago), { ...datosPaciente, pagoConfirmado: true }); // pon false si validarás pago real
  res.json({ ok: true });
});

// Obtener datos de TRAUMA
app.get('/obtener-datos/:idPago', (req, res) => {
  const d = memoria.get(ns('trauma', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Crear pago (guest opcional; real: URL Khipu)
app.post('/crear-pago-khipu', async (req, res) => {
  const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
  if (!idPago) return res.status(400).json({ ok: false, error: 'Falta idPago' });

  const space =
    (modulo === 'preop' || String(idPago).startsWith('preop_')) ? 'preop' :
    (modulo === 'generales' || String(idPago).startsWith('generales_')) ? 'generales' :
    'trauma';

  // Guarda/actualiza sin alterar tu bandera
  if (datosPaciente) {
    const prev = memoria.get(ns(space, idPago)) || {};
    memoria.set(ns(space, idPago), { ...prev, ...datosPaciente, pagoConfirmado: prev.pagoConfirmado ?? false });
  }

  // === MODO INVITADO (igual que antes)
  if (modoGuest === true) {
    const d = memoria.get(ns(space, idPago)) || {};
    memoria.set(ns(space, idPago), { ...d, pagoConfirmado: true });

    const url = new URL(RETURN_BASE);
    url.searchParams.set('pago', 'ok');
    url.searchParams.set('idPago', idPago);
    url.searchParams.set('guest', '1');
    return res.json({ ok: true, url: url.toString() });
  }

  // === MODO REAL: generar URL de Khipu usando tus ENV
  try {
    const urlKhipu = await crearCobroKhipuReal({ idPago, modulo: space, datosPaciente });
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
    // if (!d.pagoConfirmado) return res.sendStatus(402);

    const generar = await loadOrdenImagenologia();

    // Usa la lógica de líneas y las une con saltos para el PDF
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

// Guarda datos PREOP
app.post('/guardar-datos-preop', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('preop', idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

// Obtener datos PREOP
app.get('/obtener-datos-preop/:idPago', (req, res) => {
  const d = memoria.get(ns('preop', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Descargar PREOP (1 PDF con 2 páginas: LAB/ECG + Odonto)
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

// Guarda datos GENERALES
app.post('/guardar-datos-generales', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('generales', idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

// Obtener datos GENERALES (para warm-up)
app.get('/obtener-datos-generales/:idPago', (req, res) => {
  const d = memoria.get(ns('generales', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Descargar PDF GENERALES (lista depende de género)
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
