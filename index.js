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

app.post('/generar-pdf', (req, res) => {
  const { nombre, edad, rut, dolor, lado } = req.body;

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

  const firmaWidth = 120;
  const timbreWidth = 100;
  const espacioEntre = 20;

  const totalWidth = firmaWidth + timbreWidth + espacioEntre;
  const startX = (doc.page.width - totalWidth) / 2;
  const firmaY = 680;

  if (fs.existsSync(firmaPath)) {
    try {
      doc.image(firmaPath, startX, firmaY - 40, { width: firmaWidth });
    } catch (err) {
      console.error('Error al insertar firma:', err.message);
    }
  }

  if (fs.existsSync(timbrePath)) {
    try {
      const timbreX = startX + firmaWidth + espacioEntre;
      const timbreY = firmaY - 30;

      doc.save();
      doc.rotate(15, { origin: [timbreX + timbreWidth / 2, timbreY + timbreWidth / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreWidth });
      doc.restore();
    } catch (err) {
      console.error('Error al insertar timbre:', err.message);
    }
  }

  const lineaY = firmaY + 20;

  doc.font('Helvetica').fontSize(13).text('_________________________', startX, lineaY, {
    width: totalWidth,
    align: 'center',
  });
  doc.text('Firma y Timbre Médico', startX, lineaY + 18, {
    width: totalWidth,
    align: 'center',
  });

  const textoY = lineaY + 40;

  doc.font('Helvetica-Bold').fontSize(12).text('Dr. Cristóbal Huerta Cortés', startX, textoY, {
    width: totalWidth,
    align: 'center',
  });
  doc.font('Helvetica').fontSize(12).text('RUT: 14.015.125-4', startX, textoY + 18, {
    width: totalWidth,
    align: 'center',
  });
  doc.font('Helvetica-Oblique').fontSize(12).text('Cirujano de Reconstrucción Articular', startX, textoY + 36, {
    width: totalWidth,
    align: 'center',
  });

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
