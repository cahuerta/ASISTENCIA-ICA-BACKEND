// emailOrden.js — ENVÍO DE ORDEN POR EMAIL (RESEND, NO BLOQUEANTE)
import { memoria } from "./index.js";
import PDFDocument from "pdfkit";
import { Resend } from "resend";

/* ============================================================
   Resend client
   ============================================================ */
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || "contacto@icarticular.cl";

/* ============================================================
   Helpers memoria
   ============================================================ */
function detectarModuloDesdeMemoria(idPago) {
  const spaces = ["trauma", "preop", "generales", "ia"];
  for (const s of spaces) {
    if (memoria.has(`${s}:${idPago}`)) return s;
  }
  return null;
}

function extraerEmail(datos) {
  if (!datos) return null;
  if (datos.email) return String(datos.email).trim();
  if (datos.traumaJSON?.paciente?.email)
    return String(datos.traumaJSON.paciente.email).trim();
  return null;
}

function emailValido(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}

/* ============================================================
   PDF → Buffer (en memoria)
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
   ENVÍO DE CORREO — JAMÁS BLOQUEANTE
   ============================================================ */
export async function enviarOrdenPorCorreo({ idPago, generadorPDF }) {
  try {
    console.log("📨 [RESEND] Intento envío email. idPago:", idPago);

    const modulo = detectarModuloDesdeMemoria(idPago);
    if (!modulo) {
      console.warn("⚠️ [RESEND] Módulo no detectado");
      return;
    }

    const datos = memoria.get(`${modulo}:${idPago}`);
    if (!datos) {
      console.warn("⚠️ [RESEND] Datos no encontrados");
      return;
    }

    const email = extraerEmail(datos);
    if (!emailValido(email)) {
      console.warn("⚠️ [RESEND] Email inválido:", email);
      return;
    }

    // ===== Generar PDF en memoria
    const pdfBuffer = await generarPDFBuffer(datos, generadorPDF);

    const asunto =
      modulo === "trauma"
        ? "Orden de imagenología – ICA"
        : modulo === "preop"
        ? "Orden preoperatoria – ICA"
        : modulo === "generales"
        ? "Orden de exámenes – ICA"
        : "Orden médica – ICA";

    await resend.emails.send({
      from: `Instituto de Cirugía Articular <${FROM}>`,
      to: [email],
      subject: asunto,
      text:
        "Estimado(a),\n\nAdjuntamos su orden médica generada por Asistencia ICA.\n\nInstituto de Cirugía Articular",
      attachments: [
        {
          filename: "orden_medica.pdf",
          content: pdfBuffer,
        },
      ],
    });

    console.log("📧 [RESEND] Email enviado OK a:", email);
  } catch (e) {
    // 🔴 NUNCA romper flujo PDF
    console.error("❌ [RESEND] Error email (IGNORADO):", e?.message);
  }
}
