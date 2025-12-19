// emailOrden.js — ENVÍO DE ORDEN POR EMAIL (Zoho Mail API, NO BLOQUEANTE)
import { memoria } from "./index.js";
import PDFDocument from "pdfkit";
import fetch from "node-fetch";

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
   PDF → Buffer
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
   Zoho config
   ============================================================ */
const ZOHO_API = process.env.ZOHO_MAIL_API_DOMAIN;
const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.ZOHO_MAIL_REFRESH_TOKEN;

/* ============================================================
   Token refresh (interno, silencioso)
   ============================================================ */
async function refreshZohoToken() {
  try {
    const url =
      `https://accounts.zoho.com/oauth/v2/token` +
      `?grant_type=refresh_token` +
      `&client_id=${CLIENT_ID}` +
      `&client_secret=${CLIENT_SECRET}` +
      `&refresh_token=${REFRESH_TOKEN}`;

    const r = await fetch(url, { method: "POST" });
    const j = await r.json();

    if (!j.access_token) {
      console.error("❌ [ZOHO] No se pudo refrescar token:", j);
      return null;
    }

    process.env.ZOHO_MAIL_ACCESS_TOKEN = j.access_token;
    return j.access_token;
  } catch (e) {
    console.error("❌ [ZOHO] Error refresh token:", e?.message);
    return null;
  }
}

async function zohoFetch(url, options = {}) {
  let token = process.env.ZOHO_MAIL_ACCESS_TOKEN;

  let r = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Zoho-oauthtoken ${token}`,
    },
  });

  if (r.status !== 401) return r;

  token = await refreshZohoToken();
  if (!token) return r;

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Zoho-oauthtoken ${token}`,
    },
  });
}

/* ============================================================
   ENVÍO DE CORREO — NUNCA BLOQUEANTE
   ============================================================ */
export async function enviarOrdenPorCorreo({ idPago, generadorPDF }) {
  try {
    console.log("📨 [ZOHO] Intento envío email. idPago:", idPago);

    const modulo = detectarModuloDesdeMemoria(idPago);
    if (!modulo) {
      console.warn("⚠️ [ZOHO] Módulo no detectado, se omite email");
      return;
    }

    const datos = memoria.get(`${modulo}:${idPago}`);
    if (!datos) {
      console.warn("⚠️ [ZOHO] Datos no encontrados, se omite email");
      return;
    }

    const email = extraerEmail(datos);
    if (!emailValido(email)) {
      console.warn("⚠️ [ZOHO] Email inválido, se omite:", email);
      return;
    }

    const pdfBuffer = await generarPDFBuffer(datos, generadorPDF);
    const pdfBase64 = pdfBuffer.toString("base64");

    // Obtener accountId
    const accResp = await zohoFetch(`${ZOHO_API}/mail/v1/accounts`);
    const accJson = await accResp.json();

    const accountId = accJson?.data?.[0]?.accountId;
    if (!accountId) {
      console.error("❌ [ZOHO] accountId no encontrado", accJson);
      return;
    }

    const asunto =
      modulo === "trauma"
        ? "Orden de imagenología – ICA"
        : modulo === "preop"
        ? "Orden preoperatoria – ICA"
        : modulo === "generales"
        ? "Orden de exámenes generales – ICA"
        : "Orden médica – ICA";

    const payload = {
      fromAddress: "contacto@icarticular.cl",
      toAddress: email,
      subject: asunto,
      content:
        "Estimado(a),\n\nAdjuntamos su orden médica generada por Asistencia ICA.\n\nInstituto de Cirugía Articular",
      attachments: [
        {
          fileName: "orden_medica.pdf",
          content: pdfBase64,
        },
      ],
    };

    const sendResp = await zohoFetch(
      `${ZOHO_API}/mail/v1/accounts/${accountId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const sendJson = await sendResp.json();

    if (!sendResp.ok) {
      console.error("❌ [ZOHO] Error envío:", sendJson);
      return;
    }

    console.log("📧 [ZOHO] Email enviado OK a:", email);
  } catch (e) {
    // 🔴 JAMÁS romper flujo PDF
    console.error("❌ [ZOHO] Error email (IGNORADO):", e?.message);
  }
}
