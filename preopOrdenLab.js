// preopOrdenLab.js
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function generarPreopLab(doc, datos) {
  const {
    nombre, edad, rut, lado,
    tipoCirugia, fechaCirugia, comorbilidades = '', nota
  } = datos || {};

  // --------- ENCABEZADO ---------
  try {
    const logoPath = path.join(__dirname, 'assets', 'ica.jpg');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 120 });
  } catch (err) { console.error('Logo error:', err.message); }

  doc.moveDown(1.5);
  doc.font('Helvetica-Bold').fontSize(18).text('INSTITUTO DE CIRUGÍA ARTICULAR', 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16).text('Orden Preoperatoria – Laboratorio y ECG', 180, undefined, { underline: true });
  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // --------- DATOS PACIENTE ---------
  doc.font('Helvetica').fontSize(14);
  doc.text(`Nombre: ${nombre ?? ''}`);      doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ''}`);          doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ''}`);            doc.moveDown(0.5);
  if (lado)        { doc.text(`Lado: ${lado}`); doc.moveDown(0.5); }
  if (tipoCirugia) { doc.text(`Tipo de cirugía: ${tipoCirugia}`); doc.moveDown(0.5); }
  if (fechaCirugia){ doc.text(`Fecha estimada cirugía: ${fechaCirugia}`); doc.moveDown(0.5); }
  if (comorbilidades) { doc.text(`Comorbilidades: ${comorbilidades}`); doc.moveDown(2); } else { doc.moveDown(2); }

  // --------- LÓGICA DE EXÁMENES ---------
  const edadNum = Number(edad) || 0;
  const pedirRxTorax = edadNum >= 45 || /cardio|pulmon|epoc|fum/i.test(comorbilidades);
  const pedirCoagulacion = /anticoag|warfar|aceno|rivarox|apix|hepar/i.test(comorbilidades) || /prótesis|protesis|artroplastia/i.test(tipoCirugia || '');
  const pedirPerfilLipidico = /dislip|colest|triglic/i.test(comorbilidades);
  const pedirOrina = /itu|urin|diabet/i.test(comorbilidades);
  const pedirHbA1c = /diabet/i.test(comorbilidades);

  const examenes = [
    'Hemograma completo',
    'PCR y VSG',
    'Glicemia en ayunas',
    'Creatinina y BUN',
    'Electrolitos (Na, K)',
    'Perfil hepático (AST/TGO, ALT/TGP, FA, BT)',
    'Grupo y Rh',
    'ECG en reposo (12 derivaciones)'
  ];
  if (pedirCoagulacion)   examenes.push('Coagulograma (TP/INR, TTPa)');
  if (pedirPerfilLipidico)examenes.push('Perfil lipídico (CT, HDL, LDL, TG)');
  if (pedirOrina)         examenes.push('Uroanálisis');
  if (pedirHbA1c)         examenes.push('HbA1c');

  doc.font('Helvetica-Bold').text('Solicito los siguientes exámenes:');
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12);
  examenes.forEach(e => doc.text(`• ${e}`));

  if (pedirRxTorax) {
    doc.moveDown(1);
    doc.text('Nota: se solicitará también Rx de Tórax PA y Lateral (ver Orden Preoperatoria – Imagenología).');
  }

  doc.moveDown(2);
  doc.text('Indicaciones:');
  doc.text('• Ayuno 8 horas para los exámenes que lo requieran.');
  doc.text('• Presentar esta orden y documento de identidad.');
  doc.moveDown(3);

  // --------- PIE DE PÁGINA: FIRMA + TIMBRE ---------
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font('Helvetica').fontSize(12);
  doc.text('_________________________', marginL, baseY, { align: 'center', width: pageW - marginL - marginR });
  doc.text('Firma y Timbre Médico',   marginL, baseY + 18, { align: 'center', width: pageW - marginL - marginR });

  const firmaW = 250;
  const firmaX = (pageW - firmaW) / 2;
  const firmaY = baseY - 45;

  try {
    const firmaPath = path.join(__dirname, 'assets', 'FIRMA.png');
    if (fs.existsSync(firmaPath)) doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
  } catch (err) { console.error('Firma error:', err.message); }

  try {
    const timbrePath = path.join(__dirname, 'assets', 'timbre.jpg');
    if (fs.existsSync(timbrePath)) {
      const timbreW = 110;
      const timbreX = firmaX + firmaW;
      const timbreY = firmaY - 20;
      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch (err) { console.error('Timbre error:', err.message); }

  doc.font('Helvetica').fontSize(12);
  doc.text('Dr. Cristóbal Huerta Cortés', marginL, baseY + 52, { align: 'center', width: pageW - marginL - marginR });
  doc.text('RUT: 14.015.125-4',          { align: 'center', width: pageW - marginL - marginR });
  doc.text('Cirujano de Reconstrucción Articular', { align: 'center', width: pageW - marginL - marginR });
  doc.text('INSTITUTO DE CIRUGÍA ARTICULAR',       { align: 'center', width: pageW - marginL - marginR });

  // Nota libre opcional al final
  if (nota) {
    doc.moveDown(1.5);
    doc.fontSize(11).text(nota);
  }
}
