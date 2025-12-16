// emailOrden.js — ENVÍO DE ORDEN POR EMAIL CON ZOHO MAIL API (ESM)
import { memoria } from "./index.js";
import PDFDocument from "pdfkit";

/* ============================================================
   CONFIG ZOHO
   ============================================================ */
const {
  ZOHO_ACCESS_TOKEN,
  ZOHO_REFRESH_TOKEN,
  ZOHO_CLIENT_ID,
  ZOHO_CLIENT_SECRET,
  ZOHO_ACCOUNT_ID,
  ZOHO_FROM_EMAIL,
} = process.env;

if (!ZOHO_ACCESS_TOKEN || !ZOHO_ACCOUNT_ID || !ZOHO_FROM_EMAIL) {
  console.warn("⚠️ [EMAIL] Variables Zoho incompletas");
}

/* ============================================================
   Detectar módulo DESDE memoria
   ============================================================ */
function detectarModuloDesdeMemoria(idPago) {
  const spaces = ["trauma", "preop", "generales", "ia"];
  for (const s of spaces) {
    if (memoria.has(`${s}:${idPago}`)) return s;
  }
  return null;
}

/* ============================================================
   EXTRAER EMAIL
   ============================================================ */
function extraerEmail(datos) {
  if (!datos) return null;

  if (datos.email) return String(datos.email).trim();
  if (datos.traumaJSON?.paciente?.email)
    return String(datos.traumaJSON.paciente.email).trim();

  return null;
}

function emailValido(e) {
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ============================================================
   Generar PDF en memoria
   ============================================================ */
async function generarPDFBuffer(datos, generador) {
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
   Enviar correo vía ZOHO MAIL API
   ============================================================ */
async function enviarZohoMail({ to, subject, text, pdfBuffer }) {
  const url = `https://mail.zoho.com/api/accounts/${ZOHO_ACCOUNT_ID}/messages`;

  const payload = {
    fromAddress: ZOHO_FROM_EMAIL,
    toAddress: to,
    subject,
    content: text,
    askReceipt: "no",
    attachments: [
      {
        fileName: "orden_medica.pdf",
        content: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
      },
    ],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${ZOHO_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({}));

  if (!r.ok) {
    console.error("❌ [ZOHO] Error envío:", j);
    throw new Error("Zoho Mail API error");
  }

  return j;
}

/* ============================================================
   FUNCIÓN PRINCIPAL
   ============================================================ */
export async function enviarOrdenPorCorreo({ idPago, generadorPDF }) {
  try {
    console.log("📨 [EMAIL] Envío Zoho iniciado:", idPago);

    const modulo = detectarModuloDesdeMemoria(idPago);
    if (!modulo) {
      console.error("❌ [EMAIL] Módulo no encontrado");
      return false;
    }

    const datos = memoria.get(`${modulo}:${idPago}`);
    if (!datos) {
      console.error("❌ [EMAIL] Datos no encontrados");
      return false;
    }

    const email = extraerEmail(datos);
    if (!emailValido(email)) {
      console.error("❌ [EMAIL] Email inválido:", email);
      return false;
    }

    const bufferPDF = await generarPDFBuffer(datos, generadorPDF);

    const subject =
      modulo === "trauma"
        ? "Orden de imagenología – ICA"
        : modulo === "preop"
        ? "Orden preoperatoria – ICA"
        : modulo === "generales"
        ? "Orden de exámenes generales – ICA"
        : "Orden médica – ICA";

    await enviarZohoMail({
      to: email,
      subject,
      text:
        "Estimado(a),\n\nAdjuntamos su orden médica generada por Asistencia ICA.\n\nSaludos cordiales,\nInstituto de Cirugía Articular",
      pdfBuffer: bufferPDF,
    });

    console.log("📧 [EMAIL] Envío Zoho OK");
    return true;
  } catch (e) {
    console.error("❌ [EMAIL] Error Zoho:", e.message);
    return false;
  }
}
