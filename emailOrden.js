// emailOrden.js — ENVÍO DE ORDEN POR EMAIL (ESM)
import nodemailer from "nodemailer";
import { memoria } from "./index.js";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

// Para rutas internas
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   SMTP transporter desde variables de entorno
   ============================================================ */
function crearTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.error("❌ Faltan variables SMTP");
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/* ============================================================
   Detectar módulo por idPago
   ============================================================ */
function detectarModulo(id) {
  if (id.startsWith("trauma_")) return "trauma";
  if (id.startsWith("preop_")) return "preop";
  if (id.startsWith("generales_")) return "generales";
  if (id.startsWith("ia_")) return "ia";
  return null;
}

/* ============================================================
   Extraer email desde memoria
   ============================================================ */
function extraerEmail(d) {
  if (!d) return null;
  if (d.emailPaciente) return d.emailPaciente.trim();
  if (d.email) return d.email.trim();
  if (d.datos && d.datos.emailPaciente) return d.datos.emailPaciente.trim();
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
    const modulo = detectarModulo(idPago);
    if (!modulo) {
      console.error("❌ idPago sin prefijo válido:", idPago);
      return false;
    }

    // leer memoria
    const key = `${modulo}:${idPago}`;
    const datos = memoria.get(key);
    if (!datos) {
      console.error("❌ No se encontraron datos en memoria:", key);
      return false;
    }

    // email
    const email = extraerEmail(datos);
    if (!emailValido(email)) {
      console.error("❌ Email inválido:", email);
      return false;
    }

    // generar PDF en buffer
    const bufferPDF = await generarPDFBuffer(modulo, datos, generadorPDF);

    // transporter SMTP
    const transporter = crearTransporter();
    if (!transporter) return false;

    const asunto =
      modulo === "trauma"
        ? "Orden de imagenología – ICA"
        : modulo === "preop"
        ? "Orden preoperatoria – ICA"
        : modulo === "generales"
        ? "Orden de exámenes generales – ICA"
        : "Orden IA – ICA";

    await transporter.sendMail({
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

    console.log("📧 Email enviado a", email);
    return true;
  } catch (e) {
    console.error("❌ Error enviarOrdenPorCorreo:", e);
    return false;
  }
}
