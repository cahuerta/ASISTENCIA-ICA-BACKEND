// emailOrden.js — ENVÍO DE ORDEN POR EMAIL (ESM)
import nodemailer from "nodemailer";
import { memoria } from "./index.js";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import path from "path";

// Para rutas internas
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   SMTP transporter desde variables de entorno
   ============================================================ */
function crearTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.error("❌ [EMAIL] Faltan variables SMTP");
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: false, // 587 STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/* ============================================================
   Detectar módulo DESDE memoria (NO por prefijo idPago)
   ============================================================ */
function detectarModuloDesdeMemoria(idPago) {
  const spaces = ["trauma", "preop", "generales", "ia"];
  for (const s of spaces) {
    if (memoria.has(`${s}:${idPago}`)) return s;
  }
  return null;
}

/* ============================================================
   EXTRAER EMAIL — FUENTE REAL: datos.email (fallback traumaJSON)
   ============================================================ */
function extraerEmail(datos) {
  if (!datos) return null;

  // 🔹 Caso REAL (backend): email plano
  if (datos.email) {
    return String(datos.email).trim();
  }

  // 🔹 Fallback legacy / debug
  if (datos.traumaJSON?.paciente?.email) {
    return String(datos.traumaJSON.paciente.email).trim();
  }

  return null;
}

function emailValido(e) {
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

/* ============================================================
   Generar PDF en memoria (buffer)
   ============================================================ */
async function generarPDFBuffer(modulo, datos, generador) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    generador(doc, datos);
    doc.end();
  });
}

/* ============================================================
   ENVIAR ORDEN POR CORREO
   ============================================================ */
export async function enviarOrdenPorCorreo({ idPago, generadorPDF }) {
  try {
    console.log("📨 [EMAIL] Iniciando envío. idPago:", idPago);

    const modulo = detectarModuloDesdeMemoria(idPago);
    if (!modulo) {
      console.error("❌ [EMAIL] No se pudo detectar módulo en memoria:", idPago);
      return false;
    }

    // Leer memoria (exactamente lo mismo que usa el PDF)
    const key = `${modulo}:${idPago}`;
    const datos = memoria.get(key);
    if (!datos) {
      console.error("❌ [EMAIL] No se encontraron datos en memoria:", key);
      return false;
    }

    // Email (datos.email → fallback traumaJSON)
    const email = extraerEmail(datos);
    if (!emailValido(email)) {
      console.error("❌ [EMAIL] Email inválido o no encontrado:", email);
      return false;
    }

    console.log("📨 [EMAIL] Destinatario:", email);
    console.log("📨 [EMAIL] SMTP_USER:", process.env.SMTP_USER);

    // Generar PDF en buffer
    const bufferPDF = await generarPDFBuffer(modulo, datos, generadorPDF);

    // Transporter SMTP
    const transporter = crearTransporter();
    if (!transporter) {
      console.error("❌ [EMAIL] Transporter SMTP no creado");
      throw new Error("SMTP transporter no creado");
    }

    const asunto =
      modulo === "trauma"
        ? "Orden de imagenología – ICA"
        : modulo === "preop"
        ? "Orden preoperatoria – ICA"
        : modulo === "generales"
        ? "Orden de exámenes generales – ICA"
        : "Orden IA – ICA";

    console.log("📨 [EMAIL] Enviando correo…");

    const info = await transporter.sendMail({
      from: `"Asistencia ICA" <${process.env.SMTP_USER}>`,
      to: email,
      subject: asunto,
      text:
        "Estimado(a),\n\nAdjuntamos su orden médica generada por Asistencia ICA.\n\nSaludos cordiales,\nInstituto de Cirugía Articular",
      attachments: [
        {
          filename: "orden_medica.pdf",
          content: bufferPDF,
          contentType: "application/pdf",
        },
      ],
    });

    console.log("📧 [EMAIL] Envío OK:", info?.messageId);
    return true;
  } catch (e) {
    console.error("❌ [EMAIL] Error enviarOrdenPorCorreo");
    console.error("mensaje:", e?.message);
    console.error("respuesta:", e?.response);
    console.error(e);
    return false;
  }
}
