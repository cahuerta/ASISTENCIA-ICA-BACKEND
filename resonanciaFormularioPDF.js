// resonanciaFormularioPDF.js — ESM
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Genera el PDF del Formulario de Seguridad para Resonancia Magnética.
 * No cierra el documento (doc.end lo hace el caller).
 *
 * @param {PDFKit.PDFDocument} doc  Documento PDFKit ya piped.
 * @param {Object} datos            { nombre, rut, edad, rmForm? , observaciones? }
 *   - rmForm: objeto de claves booleanas (true/false) tal como guarda el front.
 *             Si falta alguna clave, se asume "No" (false) para imprimir.
 *   - observaciones: string opcional para notas al final.
 */
export function generarFormularioResonancia(doc, datos = {}) {
  const {
    nombre = "",
    rut = "",
    edad = "",
    rmForm = {},
    observaciones = "",
  } = datos || {};

  // ====== ENCABEZADO ======
  try {
    const logoPath = path.join(__dirname, "assets", "ica.jpg");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 120 });
    }
  } catch (err) {
    console.error("Logo error (RM):", err.message);
  }

  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(18)
    .text("INSTITUTO DE CIRUGÍA ARTICULAR", 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16)
    .text("Formulario de Seguridad — Resonancia Magnética", 180, undefined, { underline: true });
  doc.moveDown(4);

  // Reset al margen izquierdo
  doc.x = doc.page.margins.left;

  // ====== DATOS PACIENTE ======
  doc.font("Helvetica").fontSize(14);
  doc.text(`Nombre: ${nombre || "—"}`);
  doc.moveDown(0.6);
  doc.text(`RUT: ${rut || "—"}`);
  doc.moveDown(0.6);
  doc.text(`Edad: ${edad || "—"} años`);
  doc.moveDown(1.2);

  // Fecha/Hora de emisión (simple)
  const ahora = new Date();
  const f = (n) => String(n).padStart(2, "0");
  const stamp = `${f(ahora.getDate())}-${f(ahora.getMonth() + 1)}-${ahora.getFullYear()} ${f(ahora.getHours())}:${f(ahora.getMinutes())}`;
  doc.fontSize(12).fillColor("#555").text(`Emisión: ${stamp}`);
  doc.fillColor("black");
  doc.moveDown(1.2);

  // ====== CHECKLIST ======
  doc.font("Helvetica-Bold").fontSize(14).text("Cuestionario de seguridad (marcar Sí/No):");
  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(12);

  // Mapa de claves -> etiquetas (coinciden con el front)
  const ITEMS = [
    // Dispositivos y metales
    { key: "marcapasos", label: "¿Tiene marcapasos o desfibrilador implantado (DAI)?" },
    { key: "coclear_o_neuro", label: "¿Tiene implante coclear o neuroestimulador?" },
    { key: "clips_aneurisma", label: "¿Tiene clips de aneurisma cerebral?" },
    { key: "valvula_cardiaca_metal", label: "¿Tiene válvula cardíaca u otro implante metálico intracraneal?" },
    { key: "fragmentos_metalicos", label: "¿Tiene fragmentos metálicos/balas (en ojos o cuerpo)?" },

    // Cirugías / prótesis
    { key: "protesis_placas_tornillos", label: "¿Tiene prótesis, placas o tornillos metálicos?" },
    { key: "cirugia_reciente_3m", label: "¿Cirugía reciente (< 3 meses) con implante?" },

    // Situaciones clínicas
    { key: "embarazo", label: "¿Embarazo o sospecha de embarazo?" },
    { key: "claustrofobia", label: "¿Claustrofobia importante?" },
    { key: "peso_mayor_150", label: "¿Peso mayor a 150 kg (límite equipo)?" },
    { key: "no_permanece_inmovil", label: "¿Dificultad para permanecer inmóvil 20–30 min?" },

    // Piel / perforaciones
    { key: "tatuajes_recientes", label: "¿Tatuajes o maquillaje permanente hechos hace < 6 semanas?" },
    { key: "piercings_no_removibles", label: "¿Piercings que no puede retirar?" },

    // Dispositivos externos
    { key: "bomba_insulina_u_otro", label: "¿Usa bomba de insulina u otro dispositivo externo?" },

    // Contraste
    { key: "requiere_contraste", label: "¿Este examen requiere contraste (gadolinio)?" },
    { key: "erc_o_egfr_bajo", label: "¿Insuficiencia renal conocida o eGFR < 30?" },
    { key: "alergia_gadolinio", label: "¿Alergia previa a gadolinio?" },
    { key: "reaccion_contrastes", label: "¿Reacción alérgica grave previa a otros contrastes?" },

    // Sedación / ayuno
    { key: "requiere_sedacion", label: "¿Requiere sedación para poder realizar el examen?" },
    { key: "ayuno_6h", label: "¿Ha cumplido ayuno de 6 horas? (si habrá sedación)" },
  ];

  // Render util — línea con casillas Sí/No
  const drawItem = (label, val) => {
    // val: true = Sí, false = No, null/undefined = sin respuesta → se imprime “No” por defecto visual
    const v = (val === true) ? "Sí" : (val === false) ? "No" : "No";
    doc.text(`• ${label}`);
    doc.moveUp(1);
    const y = doc.y;
    const pageW = doc.page.width;
    const marginR = doc.page.margins.right || 50;

    // Etiqueta Sí/No al costado derecho
    const txt = `Respuesta: ${v}`;
    const width = doc.widthOfString(txt);
    doc.text(txt, pageW - marginR - width, y, { continued: false });
    doc.moveDown(0.2);
  };

  ITEMS.forEach(({ key, label }) => {
    drawItem(label, rmForm?.[key]);
  });

  doc.moveDown(0.8);

  // ====== OBSERVACIONES (opcional) ======
  const obs = typeof observaciones === "string" && observaciones.trim()
    ? observaciones.trim()
    : (typeof rmForm?.observaciones === "string" ? rmForm.observaciones.trim() : "");

  doc.font("Helvetica-Bold").text("Observaciones:");
  doc.font("Helvetica");
  doc.moveDown(0.3);
  if (obs) {
    doc.text(obs, { align: "left" });
  } else {
    doc.fillColor("#777").text("—", { align: "left" });
    doc.fillColor("black");
  }

  // ====== PIE DE PÁGINA: FIRMA + TIMBRE ======
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font("Helvetica").fontSize(12);
  doc.text("_________________________", marginL, baseY, { align: "center", width: pageW - marginL - marginR });
  doc.text("Firma Paciente / Responsable", marginL, baseY + 18, { align: "center", width: pageW - marginL - marginR });

  // Firma del médico (imagen y leyenda, igual lógica que ordenImagenologia)
  const firmaW = 250;
  const firmaX = (pageW - firmaW) / 2;
  const firmaY = baseY - 45;

  try {
    const firmaPath = path.join(__dirname, "assets", "FIRMA.png");
    if (fs.existsSync(firmaPath)) {
      doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
    }
  } catch (err) {
    console.error("Firma error (RM):", err.message);
  }

  try {
    const timbrePath = path.join(__dirname, "assets", "timbre.jpg");
    if (fs.existsSync(timbrePath)) {
      const timbreW = 110;
      const timbreX = firmaX + firmaW;
      const timbreY = firmaY - 20;

      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch (err) {
    console.error("Timbre error (RM):", err.message);
  }

  doc.font("Helvetica").fontSize(12);
  doc.text("Dr. Cristóbal Huerta Cortés", marginL, baseY + 52, { align: "center", width: pageW - marginL - marginR });
  doc.text("RUT: 14.015.125-4", { align: "center", width: pageW - marginL - marginR });
  doc.text("Cirujano de Reconstrucción Articular", { align: "center", width: pageW - marginL - marginR });
  doc.text("INSTITUTO DE CIRUGIA ARTICULAR", { align: "center", width: pageW - marginL - marginR });
}
