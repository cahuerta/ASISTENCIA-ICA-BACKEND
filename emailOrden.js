// emailOrden.js — ENVÍO DE ORDEN POR EMAIL CON ZOHO MAIL API (ESM)
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import { memoria } from "./index.js";

/* ============================================================
   Helpers
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
   PDF en memoria
   ============================================================ */
async function generarPDFBuffer(datos, generadorPDF) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    generadorPDF(doc, datos);
    doc.end();
  });
}

/* ============================================================
   Refresh token Zoho
   ============================================================ */
async function refreshZohoToken() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_MAIL_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  const r = await fetch(
    "https://accounts.zoho.com/oauth/v2/token",
    { method: "POST", body: params }
  );

  const j = await r.json();
  if (!j.access_token) {
    console.error("❌ [ZOHO] No se pudo refrescar token", j);
    throw new Error("Zoho refresh token falló");
  }

  process.env.ZOHO_MAIL_ACCESS_TOKEN = j.access_token;
  return j.access_token;
}

/* ============================================================
   Envío por Zoho Mail API
   ============================================================ */
export async function enviarOrdenPorCorreo({ idPago, generadorPDF }) {
  try {
    console.log("📨 [ZOHO] Envío iniciado. idPago:", idPago);

    const modulo = detectarModuloDesdeMemoria(idPago);
    if (!modulo) {
      console.error("❌ [ZOHO] Módulo no detectado");
      return false;
    }

    const datos = memoria.get(`${modulo}:${idPago}`);
    if (!datos) {
      console.error("❌ [ZOHO] Datos no encontrados en memoria");
      return false;
    }

    const email = extraerEmail(datos);
    if (!emailValido(email)) {
      console.error("❌ [ZOHO] Email inválido:", email);
      return false;
    }

    const pdfBuffer = await generarPDFBuffer(datos, generadorPDF);
    const pdfBase64 = pdfBuffer.toString("base64");

    let accessToken = process.env.ZOHO_MAIL_ACCESS_TOKEN;
    if (!accessToken) {
      accessToken = await refreshZohoToken();
    }

    const payload = {
      fromAddress: process.env.SMTP_USER || "contacto@icarticular.cl",
      toAddress: email,
      subject: "Orden médica – Instituto de Cirugía Articular",
      content: "Adjuntamos su orden médica generada por Asistencia ICA.",
      attachments: [
        {
          fileName: "orden_medica.pdf",
          content: pdfBase64,
          contentType: "application/pdf",
        },
      ],
    };

    let r = await fetch(
      `${process.env.ZOHO_MAIL_API_DOMAIN}/mail/v1/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (r.status === 401) {
      accessToken = await refreshZohoToken();
      r = await fetch(
        `${process.env.ZOHO_MAIL_API_DOMAIN}/mail/v1/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
    }

    const res = await r.json();
    if (!r.ok) {
      console.error("❌ [ZOHO] Error envío:", res);
      return false;
    }

    console.log("📧 [ZOHO] Email enviado OK");
    return true;
  } catch (e) {
    console.error("❌ [ZOHO] Error fatal envío correo");
    console.error(e);
    return false;
  }
}
