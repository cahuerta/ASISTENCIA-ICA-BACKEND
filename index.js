import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

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

// 🔔 Nuevo endpoint para recibir confirmación de pago de Mercado Pago
app.post('/webhook', (req, res) => {
  const payment = req.body;

  console.log('🔔 Notificación de Mercado Pago recibida:', payment);

  if (payment?.type === 'payment') {
    const paymentId = payment.data?.id;
    console.log(`✅ Pago confirmado con ID: ${paymentId}`);

    // Aquí podrías activar lógica para habilitar descarga, marcar pagado, etc.

    return res.sendStatus(200);
  }

  res.sendStatus(400);
});

// Endpoint para generar PDF usando idPago
app.get('/pdf/:idPago', (req, res) => {
  const { idPago } = req.params;
  const datosPaciente = datosTemporales[idPago];

  if (!datosPaciente) {
    return res.status(404).json({ ok: false, error: 'Datos no encontrados para ese ID de pago' });
  }

  const { nombre, edad, rut, dolor, lado } = datosPaciente;
  const sintomas = `${dolor} ${lado || ''}`.trim();
  const sintomasLower = sintomas.toLowerCase();

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${nombre.replace(/ /g, '_')}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);

  const logoPath = path.resolve('assets/ica.jpg');
  let logoHeight = 0;
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 50, 40, { width: 120 });
      const img = doc._image;
      if (img) {
        logoHeight = (120 / img.width) * img.height;
      } else {
        logoHeight = 60;
      }
    } catch (err) {
      console.error('Error al insertar imagen:', err.message);
    }
  }

  const titleY = 70;

  doc.font('Helvetica-Bold').fontSize(16).text('INSTITUTO DE CIRUGÍA ARTICULAR', 190, titleY);
  doc.font('Helvetica-Bold').fontSize(12).text('Orden Médica de Imagenología', 190, titleY + 20);

  let currentY = 150 + logoHeight + 15;
  doc.font('Helvetica').fontSize(13).text(`Nombre: ${nombre}`, 50, currentY);
  currentY += 22;
  doc.text(`Edad: ${edad}`, 50, currentY);
  currentY += 22;
  doc.text(`RUT: ${rut}`, 50, currentY);
  currentY += 30;

  const descX = 50;
  const valorX = 200;
  doc.fontSize(13).text('Descripción de síntomas:', descX, currentY);
  doc.text(`Dolor ${sintomas}`, valorX, currentY);
  currentY += 40;

  const ladoFormatted = lado
    ? lado.charAt(0).toUpperCase() + lado.slice(1).toLowerCase()
    : '';

  let orden = '';
  if (sintomasLower.includes('rodilla')) {
    orden =
      edad < 50
        ? `Resonancia Magnética de Rodilla ${ladoFormatted}.`
        : `Radiografía de Rodilla ${ladoFormatted} AP y Lateral.`;
  } else if (
    sintomasLower.includes('cadera') ||
    sintomasLower.includes('ingle') ||
    sintomasLower.includes('inguinal')
  ) {
    orden =
      edad < 50
        ? `Resonancia Magnética de Cadera ${ladoFormatted}.`
        : `Radiografía de Pelvis AP de pie.`;
  } else {
    orden = 'Evaluación pendiente según examen físico.';
  }

  doc.font('Helvetica').fontSize(13).text('Examen sugerido:', 50, currentY);
  currentY += 22;
  doc.font('Helvetica-Bold').fontSize(14).text(orden, 50, currentY);
  currentY += 40;

  let notaEspecialista = '';
  if (
    sintomasLower.includes('cadera') ||
    sintomasLower.includes('ingle') ||
    sintomasLower.includes('inguinal')
  ) {
    notaEspecialista = 'cadera, Dr. Cristóbal Huerta';
  } else if (sintomasLower.includes('rodilla')) {
    notaEspecialista = 'rodilla, Dr. Jaime Espinoza';
  } else {
    notaEspecialista = 'cadera o rodilla, Huerta o Espinoza';
  }

  doc.font('Helvetica').fontSize(13).text('Nota:', 50, currentY);
  currentY += 22;
  doc.text(
    `Dado sus motivos y molestias, le sugerimos agendar una hora con nuestro especialista en ${notaEspecialista}, con el examen realizado.`,
    50,
    currentY
  );

  const firmaPath = path.resolve('assets/FIRMA.png');
  const timbrePath = path.resolve('assets/timbre.jpg');

  const firmaWidth = 250;
  const timbreWidth = 100;
  const espacioEntre = 20;

  let yPosFirma = currentY + 80;

  if (fs.existsSync(firmaPath)) {
    doc.image(firmaPath, 50, yPosFirma, { width: firmaWidth });
  }
  if (fs.existsSync(timbrePath)) {
    doc.image(timbrePath, 50 + firmaWidth + espacioEntre, yPosFirma, { width: timbreWidth });
  }

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
