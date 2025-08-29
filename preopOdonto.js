// preopOdonto.js (ESM)
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * { nombre, rut, edad, dolor, lado, observaciones?, conclusion? }
 * - conclusion: 'APTO' | 'APTO CON RESERVAS' | 'NO APTO'
 */
export function generarPreopOdonto(doc, datos = {}) {
  const { nombre, rut, edad, dolor, lado, observaciones, conclusion } = datos;

  // ----- ENCABEZADO -----
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 120 });
  } catch {}
  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16).text('Evaluación Preoperatoria por Odontología', 180, undefined, { underline: true });
  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // ----- PACIENTE -----
  const sintomas = `${datos?.dolor ?? ''} ${datos?.lado ?? ''}`.trim();
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);     doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ''}`);         doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ''}`);           doc.moveDown(0.5);
  doc.text(`Motivo/Clínica: Dolor en ${sintomas || '—'}`);
  doc.moveDown(2);

  // ----- EVALUACIÓN -----
  doc.font('Helvetica-Bold').text('Evaluación Clínica:');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12);
  [
    '• Caries activas: _______________________________',
    '• Enfermedad periodontal: _______________________',
    '• Piezas en mal estado/focos infecciosos: _______',
    '• Lesiones mucosas: _____________________________',
    '• Recomendaciones de higiene: ___________________',
  ].forEach(l => doc.text(l));

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').text('Observaciones:');
  doc.font('Helvetica').fontSize(12).text(
    observaciones || '_____________________________________________________________\n_____________________________________________________________\n_____________________________________________________________'
  );

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').text('Conclusión:');
  const concl = (conclusion || '').toUpperCase();
  ['APTO', 'APTO CON RESERVAS', 'NO APTO'].forEach(opt => {
    const mark = (concl === opt) ? '☑' : '☐';
    doc.font('Helvetica').fontSize(12).text(`${mark} ${opt}`);
  });

  // ================== PIE: IZQUIERDA (tu firma+timbre+4 líneas) / DERECHA (firma odonto) ==================
  const pageW   = doc.page.width;
  const pageH   = doc.page.height;
  const marginL = doc.page.margins.left  ?? 50;
  const marginR = doc.page.margins.right ?? 50;
  const marginB = doc.page.margins.bottom ?? 50;

  // Colocamos las líneas de firma con colchón seguro sobre el margen inferior
  // (110pt por debajo nos da espacio para las leyendas y no choca con el borde)
  const lineY = pageH - marginB - 110;

  // Dos columnas
  const gap    = 40; // espacio entre columnas
  const availW = pageW - marginL - marginR;
  const colW   = (availW - gap) / 2;
  const leftX  = marginL;
  const rightX = marginL + colW + gap;

  // -------- Columna IZQUIERDA: tu firma + timbre, línea, y 4 líneas de autoría --------
  // Firma imagen (encaja dentro de la columna y sobre la línea)
  const firmaW = Math.min(200, colW - 10);
  const firmaHApprox = 60; // altura estimada para separar del timbre/línea
  const firmaX = leftX + (colW - firmaW) / 2;
  const firmaY = Math.max(doc.y, lineY - (firmaHApprox + 28)); // subimos un poco para que quepa todo

  try {
    const firmaPath = path.join(__dirname, 'assets', 'FIRMA.png');
    if (fs.existsSync(firmaPath)) {
      doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
    }
  } catch {}

  // Timbre (rotado) dentro de la misma columna (no invadir márgenes)
  try {
    const timbrePath = path.join(__dirname, 'assets', 'timbre.jpg');
    if (fs.existsSync(timbrePath)) {
      const timbreW = Math.min(85, colW * 0.42);
      const rawTX   = firmaX + firmaW - (timbreW * 0.2);
      const timbreX = Math.min(rawTX, leftX + colW - timbreW);
      const timbreY = Math.max(marginB + 60, firmaY - 18); // evita pasar el borde inferior
      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch {}

  // Línea de firma (izquierda)
  doc.save();
  doc.strokeColor('#000').lineWidth(1);
  doc.moveTo(leftX, lineY).lineTo(leftX + colW, lineY).stroke();
  doc.restore();

  // Bloque de 4 líneas (autoría) — dentro de la columna izquierda
  // Usamos posiciones Y explícitas para evitar y=undefined
  let yTxt = lineY + 10;
  const lineStep = 14;
  doc.font('Helvetica').fontSize(12);
  doc.text('Dr. Cristóbal Huerta Cortés', leftX, yTxt, { width: colW, align: 'center' }); yTxt += lineStep;
  doc.text('RUT: 14.015.125-4',           leftX, yTxt, { width: colW, align: 'center' }); yTxt += lineStep;
  doc.text('Cirujano de Reconstrucción Articular', leftX, yTxt, { width: colW, align: 'center' }); yTxt += lineStep;
  doc.text('INSTITUTO DE CIRUGÍA ARTICULAR',        leftX, yTxt, { width: colW, align: 'center' });

  // -------- Columna DERECHA: línea + leyenda "Firma Odontólogo(a)" --------
  doc.save();
  doc.strokeColor('#000').lineWidth(1);
  doc.moveTo(rightX, lineY).lineTo(rightX + colW, lineY).stroke();
  doc.restore();

  doc.font('Helvetica').fontSize(12)
     .text('Firma Odontólogo(a)', rightX, lineY + 10, { width: colW, align: 'center' });

  // (Sin leyenda centrada inferior)
}
