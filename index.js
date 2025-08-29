// index.js — ESM (Node >=18)
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
const RETURN_BASE = process.env.RETURN_BASE || process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';

// === Khipu (real o guest, controlado por env/flag)
const KHIPU_ENV = (process.env.KHIPU_ENV || 'prod').toLowerCase(); // 'prod' | 'guest'
const KHIPU_API_KEY = process.env.KHIPU_API_KEY || '';             // API Key real (Render)
const KHIPU_API_BASE = 'https://khipu.com/api/3.0';
const KHIPU_AMOUNT = Number(process.env.KHIPU_AMOUNT || 4990);     // 💰 monto por defecto (CLP)
const KHIPU_SUBJECT = process.env.KHIPU_SUBJECT || 'Orden médica ICA';
const CURRENCY = 'CLP';

// ===== Memoria simple
const memoria = new Map();
const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || '').replace(/[^a-zA-Z0-9_-]+/g, '_');

// ===== Helpers  (para TRAUMA)
function sugerirExamenImagenologia(dolor = '', lado = '', edad = null) {
  const d = String(dolor || '').toLowerCase();
  const L = String(lado || '').trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : ''; // SIN paréntesis
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
  if (d.includes('cadera'))  return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  return base;
}

// ===== Carga de generadores PDF (ESM dinámico)
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

// ===== Preview consistente con PDF
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

app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente) return res.status(400).json({ ok: false, error: 'Faltan idPago o datosPaciente' });
  memoria.set(ns('trauma', idPago), { ...datosPaciente, pagoConfirmado: true }); // pon false si validarás post-notify
  res.json({ ok: true });
});

// 🔴 AQUÍ: crea pago Khipu real (o guest si lo pides)
app.post('/crear-pago-khipu', async (req, res) => {
  try {
    const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
    if (!idPago) return res.status(400).json({ ok: false, error: 'Falta idPago' });

    // Espacio (no cambia nada de tu lógica)
    const space =
      (modulo === 'preop' || String(idPago).startsWith('preop_')) ? 'preop' :
      (modulo === 'generales' || String(idPago).startsWith('generales_')) ? 'generales' :
      'trauma';

    // Guardado rápido para warm-up/cache
    if (datosPaciente) memoria.set(ns(space, idPago), { ...datosPaciente });

    // Guest explícito o forzado por env
    if (modoGuest === true || KHIPU_ENV === 'guest') {
      const url = new URL(RETURN_BASE);
      url.searchParams.set('pago', 'ok');
      url.searchParams.set('idPago', idPago);
      return res.json({ ok: true, url: url.toString(), guest: true });
    }

    // ===== Khipu real con x-api-key (sin firmas HMAC extra)
    if (!KHIPU_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Falta KHIPU_API_KEY en el backend' });
    }

    const payload = {
      amount: KHIPU_AMOUNT,
      currency: CURRENCY,
      subject: KHIPU_SUBJECT,
      transaction_id: idPago,
      return_url: `${RETURN_BASE}?pago=ok&idPago=${encodeURIComponent(idPago)}`,
      cancel_url: `${RETURN_BASE}?pago=cancelado&idPago=${encodeURIComponent(idPago)}`
      // Puedes agregar notify_url si quieres confirmar server-to-server
    };

    const r = await fetch(`${KHIPU_API_BASE}/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': KHIPU_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Evita 403 por firmas erróneas: NO mandamos headers de firma.
      const msg = j?.message || `Error Khipu (${r.status})`;
      return res.status(502).json({ ok: false, error: msg, detail: j || null });
    }

    // Campos posibles según versión: payment_url o url
    const urlPago = j?.payment_url || j?.url;
    if (!urlPago) {
      return res.status(502).json({ ok: false, error: 'Khipu no entregó payment_url', detail: j || null });
    }

    return res.json({ ok: true, url: urlPago });
  } catch (e) {
    console.error('crear-pago-khipu error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Obtener datos TRAUMA
app.get('/obtener-datos/:idPago', (req, res) => {
  const d = memoria.get(ns('trauma', req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
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
