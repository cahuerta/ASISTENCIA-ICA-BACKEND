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

// ✅ Crear link de pago Khipu con API Key (Bearer) + modo prueba (guest)
app.post('/crear-pago-khipu', async (req, res) => {
  const { idPago, modoGuest = false, datosPaciente } = req.body;

  if (!idPago) {
    return res.status(400).json({ ok: false, error: 'Falta idPago' });
  }

  // 🧪 MODO GUEST (sin ir a Khipu)
  if (modoGuest === true) {
    if (datosPaciente && typeof datosPaciente === 'object') {
      datosTemporales[idPago] = datosPaciente;
      console.log(`💾 [GUEST] Datos guardados para idPago ${idPago}:`, datosPaciente);
    }
    const returnUrl = `${process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app'}?pago=ok&idPago=${encodeURIComponent(idPago)}`;
    console.log(`🧪 [GUEST] Redirección simulada a: ${returnUrl}`);
    return res.json({ ok: true, url: returnUrl });
  }

  // 🚀 PAGO REAL CON API DE KHIPU (API KEY)
  try {
    if (datosPaciente && typeof datosPaciente === 'object') {
      datosTemporales[idPago] = datosPaciente;
      console.log(`💾 [REAL] Datos guardados para idPago ${idPago}:`, datosPaciente);
    }

    const apiKey   = process.env.KHIPU_API_KEY;
    const backend  = process.env.BACKEND_BASE  || 'https://asistencia-ica-backend.onrender.com';
    const frontend = process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';

    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'Falta KHIPU_API_KEY en variables de entorno' });
    }

    // Selección de ambiente
    const env = (process.env.KHIPU_ENV || 'production').toLowerCase();
    const baseUrl = env === 'integration'
      ? 'https://integracion.khipu.com/api/2.0'
      : 'https://khipu.com/api/2.0';

    const amount     = 10000; // CLP (ajusta si corresponde)
    const currency   = 'CLP';
    const subject    = 'Orden de Imagenología';
    const return_url = `${backend}/retorno-khipu`;              // HTTPS público
    const cancel_url = `${backend}/retorno-khipu-cancelado`;
    const notify_url = `${backend}/webhook-khipu`;              // servidor-a-servidor

    console.log(`➡️  Creando pago Khipu [env=${env}] tx=${idPago}`);
    const resp = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,    // ← API KEY
        'Content-Type': 'application/json',
        'X-Khipu-Api-Version': '2.0',
        'X-Khipu-Client-Id': 'ICA-Backend',
      },
      body: JSON.stringify({
        transaction_id: idPago,      // único por comercio
        amount,
        currency,
        subject,
        return_url,
        cancel_url,
        notify_url,
        body: 'Pago de orden de imagenología',
      }),
    });

    // Log detallado si falla
    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error('❌ Error Khipu:', resp.status, errTxt);
      return res.status(502).json({
        ok: false,
        error: `Khipu respondió ${resp.status}`,
        detail: errTxt.slice(0, 2000),
      });
    }

    const json = await resp.json();
    const paymentUrl = json.payment_url || json.app_url || json.mobile_url;

    if (!paymentUrl) {
      console.error('❌ Respuesta Khipu sin payment_url:', json);
      return res.status(502).json({ ok: false, error: 'Khipu no retornó payment_url', detail: JSON.stringify(json).slice(0,2000) });
    }

    console.log(`🔗 Khipu payment_url: ${paymentUrl}`);
    return res.json({ ok: true, url: paymentUrl });
  } catch (e) {
    console.error('❌ Excepción creando pago Khipu:', e);
    return res.status(500).json({ ok: false, error: 'Error interno creando pago' });
  }
});

// ✅ Webhook Khipu (básico)
app.post('/webhook-khipu', (req, res) => {
  try {
    console.log('🔔 Webhook Khipu:', req.body);
    // TODO: (opcional) Validar firma si la configuras y marcar pago como confirmado.
    res.sendStatus(200);
  } catch (e) {
    console.error('❌ Error en webhook-khipu:', e);
    res.sendStatus(500);
  }
});

// ✅ Puente de retorno Khipu -> Frontend con parámetros de tu app
app.get('/retorno-khipu', (req, res) => {
  const { transaction_id } = req.query; // Khipu reenvía este id si lo enviaste al crear el pago
  const frontend = process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';
  const target = `${frontend}?pago=ok&idPago=${encodeURIComponent(transaction_id || '')}`;
  return res.redirect(302, target);
});

app.get('/retorno-khipu-cancelado', (req, res) => {
  const { transaction_id } = req.query;
  const frontend = process.env.FRONTEND_BASE || 'https://asistencia-ica.vercel.app';
  const target = `${frontend}?pago=cancelado&idPago=${encodeURIComponent(transaction_id || '')}`;
  return res.redirect(302, target);
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
