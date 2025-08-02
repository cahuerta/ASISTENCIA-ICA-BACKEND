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

  // Logo arriba izquierda (120 px ancho), mantener ratio
  const logoPath = path.resolve('assets/ica.jpg');
  let logoHeight = 0;
  if (fs.existsSync(logoPath)) {
    try {
      // Sólo especificamos ancho para mantener proporción
      doc.image(logoPath, 50, 40, { width: 120 });
      // Para estimar la altura del logo, asumimos aprox 50% del ancho
      logoHeight = 120 * 0.5; // 60px alto estimado, ajusta si es necesario
    } catch (err) {
      console.error('Error al insertar imagen:', err.message);
    }
  }

  // Espacio arriba del título: simplemente empezamos el título más abajo
  // Así que sumamos 20px para separar del borde superior (40 + 20 = 60)
  const titleY = 60;

  // Títulos a la derecha del logo, en negrita
  doc.font('Helvetica-Bold').fontSize(16).text('INSTITUTO DE CIRUGÍA ARTICULAR', 190, titleY);
  doc.font('Helvetica-Bold').fontSize(12).text('Orden Médica de Imagenología', 190, titleY + 20);

  // Datos del paciente debajo del logo, sin superponer (logo en Y=40 con altura estimada)
  let currentY = 40 + logoHeight + 15; // 40 + 60 + 15 = 115 aprox
  doc.font('Helvetica').fontSize(13).text(`Nombre: ${nombre}`, 50, currentY);
  currentY += 22;
  doc.text(`Edad: ${edad}`, 50, currentY);
  currentY += 22;
  doc.text(`RUT: ${rut}`, 50, currentY);
  currentY += 30;

  // Descripción de síntomas: título a la izquierda y texto a la derecha, misma línea
  const descX = 50;
  const valorX = 200;
  doc.fontSize(13).text('Descripción de síntomas:', descX, currentY);
  doc.text(`Dolor ${sintomas}`, valorX, currentY);
  currentY += 40;

  // Lógica para examen sugerido
  let orden = '';
  if (sintomasLower.includes('rodilla')) {
    orden = edad < 50
      ? 'Resonancia Magnética de Rodilla.'
      : 'Radiografía de Rodilla AP y Lateral.';
  } else if (
    sintomasLower.includes('cadera') ||
    sintomasLower.includes('ingle') ||
    sintomasLower.includes('inguinal')
  ) {
    orden = edad < 50
      ? 'Resonancia Magnética de Cadera.'
      : 'Radiografía de Pelvis AP de pie.';
  } else {
    orden = 'Evaluación pendiente según examen físico.';
  }

  // "Examen sugerido:" normal y orden en negrita y tamaño mayor
  doc.font('Helvetica').fontSize(13).text('Examen sugerido:', 50, currentY);
  currentY += 22;
  doc.font('Helvetica-Bold').fontSize(14).text(orden, 50, currentY);
  currentY += 40;

  // Nota personalizada en lugar de derivación
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

  // Firma centrada al pie de página
  const footerY = doc.page.height - 100;
  doc.font('Helvetica').fontSize(13).text('_________________________', 0, footerY, {
    align: 'center',
  });
  doc.text('Firma y Timbre Médico', { align: 'center' });

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
Si quieres, te prep
