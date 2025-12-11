// emailOrden.js — Helper para enviar la ORDEN por correo (ESM)

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import { memoria } from "./index.js"; // ← aquí tienes todos los datos por idPago

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   Helper: crear transporter SMTP desde variables de entorno
   ============================================================ */
function crearTransporter() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.error("❌ Faltan variables SMTP en process.env (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)");
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: false, // STARTTLS
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

/* ============================================================
   Helper: intenta extraer el email del objeto guardado en memoria
   Estructuras posibles:
   - memoria[idPago].datos.emailPaciente
   - memoria[idPago].datos.email
   - memoria[idPago].emailPaciente
   ============================================================ */
function extraerEmail(mem) {
  if (!mem || typeof mem !== "object") return null;

  // Caso típico: { datos: { ..., emailPaciente: "x@y.cl" } }
  if (mem.datos && typeof mem.datos === "object") {
    if (mem.datos.emailPaciente) return String(mem.datos.emailPaciente).trim();
    if (mem.datos.email) return String(mem.datos.email).trim();
  }

  // Alternativas directas
  if (mem.emailPaciente) return String(mem.emailPaciente).trim();
  if (mem.email) return String(mem.email).trim();

  return null;
}

/* ============================================================
   Helper: validación simple de email
   ============================================================ */
function emailValido(email) {
  if (!email) return false;
  const s = String(email).trim();
  // Regex simple, suficiente para validación básica
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* ============================================================
   FUNCIÓN PRINCIPAL
   - Lee memoria[idPago]
   - Valida idPago, email y existencia del PDF
   - Envía correo con el PDF adjunto
   ============================================================ */

/**
 * Envía la orden PDF al correo del paciente asociado al idPago.
 *
 * @param {Object} params
 * @param {string} params.idPago  - ID del pago/orden (ej: "trauma_...", "preop_...", "generales_...", "ia_...")
 * @param {string} params.pdfPath - Ruta al PDF generado (absoluta o relativa)
 * @returns {Promise<boolean>} true si se envió, false si hubo error o faltan datos
 */
export async function enviarOrdenPorCorreo({ idPago, pdfPath }) {
  try {
    if (!idPago || typeof idPago !== "string") {
      console.error("❌ enviarOrdenPorCorreo: idPago inválido:", idPago);
      return false;
    }

    // Opcional: validar prefijo del idPago (puedes ajustar según tus módulos)
    const prefijosValidos = ["trauma_", "preop_", "generales_", "ia_"];
    const tienePrefijoValido = prefijosValidos.some((p) => idPago.startsWith(p));
    if (!tienePrefijoValido) {
      console.warn(`⚠️ enviarOrdenPorCorreo: idPago sin prefijo reconocido (${idPago}). Se continúa igual.`);
    }

    const mem = memoria[idPago];

    if (!mem) {
      console.error(`❌ enviarOrdenPorCorreo: no se encontró memoria para idPago=${idPago}`);
      return false;
    }

    const email = extraerEmail(mem);

    if (!emailValido(email)) {
      console.error(
        `❌ enviarOrdenPorCorreo: email inválido o ausente para idPago=${idPago}. valor=`,
        email
      );
      return false;
    }

    // Normalizar ruta al PDF
    const pdfAbsoluto = path.isAbsolute(pdfPath)
      ? pdfPath
      : path.join(__dirname, pdfPath);

    if (!fs.existsSync(pdfAbsoluto)) {
      console.error(`❌ enviarOrdenPorCorreo: PDF no existe en ruta=${pdfAbsoluto}`);
      return false;
    }

    const transporter = crearTransporter();
    if (!transporter) {
      console.error("❌ enviarOrdenPorCorreo: no se pudo crear transporter SMTP.");
      return false;
    }

    // Asunto según prefijo
    let modulo = "Orden médica";
    if (idPago.startsWith("trauma_")) modulo = "Orden de exámenes TRAUMA";
    else if (idPago.startsWith("preop_")) modulo = "Orden de exámenes PREOPERATORIOS";
    else if (idPago.startsWith("generales_")) modulo = "Orden de exámenes GENERALES";
    else if (idPago.startsWith("ia_")) modulo = "Informe IA / Orden de exámenes";

    const subject = `Su ${modulo} – Instituto de Cirugía Articular`;
    const text = [
      "Estimado(a),",
      "",
      "Adjuntamos su orden médica generada por Asistencia ICA.",
      "",
      "Saludos cordiales,",
      "Instituto de Cirugía Articular",
    ].join("\n");

    const info = await transporter.sendMail({
      from: `"Asistencia ICA" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      text,
      attachments: [
        {
          filename: "orden_medica.pdf",
          path: pdfAbsoluto,
          contentType: "application/pdf",
        },
      ],
    });

    console.log(`📧 Correo enviado correctamente a ${email}. messageId=${info.messageId}`);
    return true;
  } catch (err) {
    console.error("❌ Error en enviarOrdenPorCorreo:", err);
    return false;
  }
}
