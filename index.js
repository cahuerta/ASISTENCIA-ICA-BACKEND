import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { generarOrdenImagenologia } from './ordenImagenologia.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// --- Memoria temporal para guardar datos antes del pago ---
const datosTemporales = {};

// Guardar datos temporales (marcamos pagado:false)
app.post('/guardar-datos', (req, res) => {
  const { idPago, datosPaciente } = req.body;
  if (!idPago || !datosPaciente) {
    return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
  }
  datosTemporales[idPago] = { ...datosPaciente, pagado: false };
  console.log(`💾 Datos guardados para idPago ${idPago}:`, datosTemporales[idPago]);
  res.json({ ok: true });
});

// Recuperar datos temporales (exponemos flag pagado)
app.get('/obtener-datos/:idPago', (req, res) => {
  const { idPago } = req.params;
  const datos = datosTemporales[idPago];
  if (!datos) {
    return res.status(404).json({ ok: false, error: 'No encontrado' });
  }
  res.json({ ok: true, datos, pagado: !!datos.pagado });
});

// ✅ Crear link de pago Khipu con API Key v3 + modo prueba (guest)
app.post('/crear-pago-khipu', async (req, res) => {
  const { idPago, modoGuest = false, datosPaciente } = req.body;

  if (!idPago) {
    return res.status(400).json({ ok: false, error: 'Falta idPago' });
  }

  // 🧪 MODO GUEST (sin ir a Khipu)
  if (modoGuest === true) {
    if (datosPaciente && typeof datosPaciente === 'object') {
      datosTemporales[idPago] = { ...datosPaciente, pagado: false };
      console.log(`💾 [GUEST] Datos guardados para idPago ${idPago}:`, datosTemporales[idPago]);
    }
    const returnUrl = `${process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app'}?pago=ok&idPago=${encodeURIComponent(idPago)}`;
    console.log(`🧪 [GUEST] Redirección simulada a: ${returnUrl}`);
    return res.json({ ok: true, url: returnUrl });
  }

  // 🚀 PAGO REAL CON KHIPU v3 (API Key en header x-api-key)
  try {
    if (datosPaciente && typeof datosPaciente === 'object') {
      datosTemporales[idPago] = { ...datosPaciente, pagado: false };
      console.log(`💾 [REAL] Datos guardados para idPago ${idPago}:`, datosTemporales[idPago]);
    }

    const apiKey   = process.env.KHIPU_API_KEY; // 👈 API Key v3
    const backend  = process.env.BACKEND_BASE  || 'https://asistencia-ica-backend.onrender.com';
    const frontend = process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';

    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'Falta KHIPU_API_KEY (v3) en variables de entorno' });
    }

    const baseUrl = 'https://payment-api.khipu.com';

    // 🔒 Monto y metadatos
    const amount     = Number(process.env.KHIPU_AMOUNT || 1000); // CLP
    const subject    = 'Orden de Imagenología';
    // 👉 Fuerza idPago en el retorno/cancelación para que el front SIEMPRE lo reciba
    const return_url = `${backend}/retorno-khipu?idPago=${encodeURIComponent(idPago)}`;
    const cancel_url = `${backend}/retorno-khipu-cancelado?idPago=${encodeURIComponent(idPago)}`;
    const notify_url = `${backend}/webhook-khipu`;

    const body = {
      transaction_id: idPago,
      amount,
      currency: 'CLP',
      subject,
      return_url,
      cancel_url,
      notify_url,
      // description, payer, etc. si lo necesitas
    };

    console.log(`➡️  Creando pago Khipu v3 tx=${idPago} amount=${amount}`);
    const resp = await fetch(`${baseUrl}/v3/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error('❌ Error Khipu v3:', resp.status, errTxt);
      return res.status(502).json({
        ok: false,
        error: `Khipu v3 respondió ${resp.status}`,
        detail: errTxt.slice(0, 2000),
      });
    }

    const json = await resp.json();

    // v3 devuelve una URL para redirigir al usuario
    const paymentUrl =
      json.payment_url ||
      json.app_url ||
      json.simplified_transfer_url ||
      json.transfer_url;

    if (!paymentUrl) {
      console.error('❌ Respuesta Khipu v3 sin payment_url:', json);
      return res.status(502).json({
        ok: false,
        error: 'Khipu v3 no retornó payment_url',
        detail: JSON.stringify(json).slice(0, 2000),
      });
    }

    console.log(`🔗 Khipu v3 payment_url: ${paymentUrl}`);
    return res.json({ ok: true, url: paymentUrl });
  } catch (e) {
    console.error('❌ Excepción creando pago Khipu v3:', e);
    return res.status(500).json({ ok: false, error: 'Error interno creando pago' });
  }
});

// ✅ Webhook Khipu: marca pagado=true
app.post('/webhook-khipu', (req, res) => {
  try {
    const noti = req.body;
    console.log('🔔 Webhook Khipu:', JSON.stringify(noti));

    // Intenta extraer transaction_id desde rutas comunes
    const tx =
      noti?.transaction_id ||
      noti?.payment?.transaction_id ||
      noti?.data?.transaction_id ||
      noti?.payment_id ||
      null;

    if (tx && datosTemporales[tx]) {
      datosTemporales[tx].pagado = true;
      console.log(`✅ Marcado como pagado idPago=${tx}`);
    } else {
      console.warn('⚠️ No se pudo marcar pagado; tx no encontrado en memoria:', tx);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('❌ Error en webhook-khipu:', e);
    res.sendStatus(500);
  }
});

// ✅ Puente de retorno Khipu -> Frontend (sin auto-descarga; muestra botón en el front)
app.get('/retorno-khipu', (req, res) => {
  // Acepta varios nombres por robustez
  const { idPago, transaction_id, payment_id, tx } = req.query;
  const finalId = idPago || transaction_id || payment_id || tx || '';
  console.log('↩️ retorno-khipu query:', req.query, 'finalId=', finalId);

  const frontend = process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';
  const target = `${frontend}?pago=ok&idPago=${encodeURIComponent(finalId)}`;
  return res.redirect(302, target);
});

app.get('/retorno-khipu-cancelado', (req, res) => {
  const { idPago, transaction_id, payment_id, tx } = req.query;
  const finalId = idPago || transaction_id || payment_id || tx || '';
  console.log('↩️ retorno-khipu-cancelado query:', req.query, 'finalId=', finalId);

  const frontend = process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';
  const target = `${frontend}?pago=cancelado&idPago=${encodeURIComponent(finalId)}`;
  return res.redirect(302, target);
});

// ✅ Generar PDF por idPago (se descarga manualmente desde el botón)
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
  let nota = '';

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

  const datosConExamen = { ...datosPaciente, examen, derivacion, nota };
  // === FIN LÓGICA CLÍNICA ===

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${(nombre || 'paciente').replace(/ /g, '_')}.pdf`;

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
