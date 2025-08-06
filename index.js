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

app.post('/generar-pdf', (req, res) => {
  const { nombre, edad, rut, dolor, lado } = req.body;

  const sintomas = `${dolor} ${lado || ''}`.trim();
  const sintomasLower = sintomas.toLowerCase();

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const filename = `orden_${nombre.replace(/ /g, '_')}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');

  doc.pipe(res);

  // Insertar logo y medir su altura exacta para separar datos
  const logoPath = path.resolve('assets/ica.jpg');
  let logoHeight = 0;
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 50, 40, { width: 120 });
      const img = doc._image;
      if (img) {
        logoHeight = (120 / img.width) * img.height;
      } else {
        logoHeight = 60; // fallback si no se detecta imagen
      }
    } catch (err) {
      console.error('Error al insertar imagen:', err.message);
    }
  }

  // Espacio arriba del título (posición fija)
  const titleY = 70;

  // Títulos a la derecha del logo, en negrita
  doc.font('Helvetica-Bold').fontSize(16).text('INSTITUTO DE CIRUGÍA ARTICULAR', 190, titleY);
  doc.font('Helvetica-Bold').fontSize(12).text('Orden Médica de Imagenología', 190, titleY + 20);

  // Datos del paciente debajo del logo, sin superponer
  let currentY = 150 + logoHeight + 15;
  doc.font('Helvetica').fontSize(13).text(`Nombre: ${nombre}`, 50, currentY);
  currentY += 22;
  doc.text(`Edad: ${edad}`, 50, currentY);
  currentY += 22;
  doc.text(`RUT: ${rut}`, 50, currentY);
  currentY += 30;

  // Descripción de síntomas con texto "Dolor ..." en la misma línea
  const descX = 50;
  const valorX = 200;
  doc.fontSize(13).text('Descripción de síntomas:', descX, currentY);
  doc.text(`Dolor ${sintomas}`, valorX, currentY);
  currentY += 40;

  // Formatear lado para orden
  const ladoFormatted = lado
    ? lado.charAt(0).toUpperCase() + lado.slice(1).toLowerCase()
    : '';

  // Construcción de orden con lado
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
        : `Radiografía de Pelvis AP de pie.`; // No lado en pelvis
  } else {
    orden = 'Evaluación pendiente según examen físico.';
  }

  // Examen sugerido: texto normal + orden en negrita y tamaño mayor
  doc.font('Helvetica').fontSize(13).text('Examen sugerido:', 50, currentY);
  currentY += 22;
  doc.font('Helvetica-Bold').fontSize(14).text(orden, 50, currentY);
  currentY += 40;

  // Nota personalizada
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

  // Firma con imagen y texto al pie en posición fija
  const firmaPath = path.resolve('assets/FIRMA.png');
  const firmaWidth = 120;
  const firmaX = (doc.page.width - firmaWidth) / 2;
  const firmaY = 680; // posición fija para evitar salto de página

  if (fs.existsSync(firmaPath)) {
    try {
      doc.image(firmaPath, firmaX, firmaY, { width: firmaWidth });
    } catch (err) {
      console.error('Error al insertar firma:', err.message);
    }
  }

  // Línea de firma justo debajo de la imagen
  const lineaY = firmaY + 60;

  doc.font('Helvetica').fontSize(13).text('_________________________', 0, lineaY, {
    align: 'center',
  });
  doc.text('Firma y Timbre Médico', { align: 'center' });

  // Textos debajo con separación fija
  const textoY = lineaY + 20;

  doc.font('Helvetica-Bold').fontSize(12).text('Dr. Cristóbal Huerta Cortés', 0, textoY, {
    align: 'center',
  });
  doc.font('Helvetica').fontSize(12).text('RUT: 14.015.125-4', 0, textoY + 18, {
    align: 'center',
  });
  doc.font('Helvetica-Oblique').fontSize(12).text(
    'Cirujano de Reconstrucción Articular',
    0,
    textoY + 36,
    {
      align: 'center',
    }
  );

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
