// flowClient.js
// Cliente simple para crear pagos en Flow desde tu backend (Node ESM)

import crypto from "crypto";

// ====== ENV ======
// Debes tener definidas en Render (o donde sea tu backend):
//
// FLOW_API_KEY      → la API Key que ves en el panel de Flow
// FLOW_SECRET_KEY   → la Secret Key que ves en el panel de Flow
// FLOW_ENV          → "sandbox" o "production" (opcional, por defecto sandbox)

const FLOW_API_KEY = process.env.FLOW_API_KEY || "";
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY || "";
const FLOW_ENV = process.env.FLOW_ENV || "sandbox";

const FLOW_BASE_URL =
  FLOW_ENV === "production"
    ? "https://www.flow.cl/api"
    : "https://sandbox.flow.cl/api";

// Pequeña validación de entorno
function assertEnv() {
  if (!FLOW_API_KEY || !FLOW_SECRET_KEY) {
    throw new Error(
      "Faltan variables de entorno de Flow (FLOW_API_KEY / FLOW_SECRET_KEY)."
    );
  }
}

// Construye la firma HMAC-SHA256 según la documentación de Flow.
// IMPORTANTE: la firma se hace sobre los parámetros ordenados por nombre,
// sin incluir el campo `s`.
function makeSignature(params) {
  const orderedKeys = Object.keys(params).sort();
  const queryString = orderedKeys
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  return crypto
    .createHmac("sha256", FLOW_SECRET_KEY)
    .update(queryString)
    .digest("hex");
}

// Helper para construir URLSearchParams (Flow espera application/x-www-form-urlencoded)
function toFormBody(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

/**
 * Crear pago en Flow.
 *
 * @param {Object} opts
 * @param {string} opts.idPago        - identificador interno (lo usamos como commerceOrder)
 * @param {number} opts.amount        - monto en CLP (ej: 1000)
 * @param {string} opts.subject       - texto corto, ejemplo: "Orden Asistencia ICA"
 * @param {string} opts.email         - correo del paciente (o tuyo si no tienes)
 * @param {string} opts.modulo        - "trauma" | "preop" | "generales" | "ia"
 * @param {string} opts.urlConfirmation - URL de confirmación en tu backend
 * @param {string} opts.urlReturn       - URL de retorno al frontend (?pago=...)
 * @param {Object} [opts.optionalData]  - datos adicionales para guardar en Flow (se serializan a JSON)
 *
 * @returns {Promise<{url:string, token:string|null}>}
 */
export async function crearPagoFlowBackend({
  idPago,
  amount,
  subject,
  email,
  modulo = "trauma",
  urlConfirmation,
  urlReturn,
  optionalData = {},
}) {
  assertEnv();

  if (!idPago) throw new Error("crearPagoFlowBackend requiere idPago");
  if (!amount || Number(amount) <= 0)
    throw new Error("crearPagoFlowBackend requiere amount > 0");
  if (!subject) subject = `Orden ${modulo.toUpperCase()} Asistencia ICA`;
  if (!email) email = "sin-correo@icarticular.cl";
  if (!urlConfirmation || !urlReturn) {
    throw new Error(
      "crearPagoFlowBackend requiere urlConfirmation y urlReturn configuradas."
    );
  }

  const baseParams = {
    apiKey: FLOW_API_KEY,
    commerceOrder: idPago,
    subject,
    currency: "CLP",
    amount: Number(amount),
    email,
    urlConfirmation,
    urlReturn,
    // Puedes pasar datos adicionales en `optional` (string JSON)
    optional:
      optionalData && Object.keys(optionalData).length
        ? JSON.stringify({ modulo, ...optionalData })
        : JSON.stringify({ modulo }),
  };

  // Firmamos
  const s = makeSignature(baseParams);
  const payload = { ...baseParams, s };

  const url = `${FLOW_BASE_URL}/payment/create`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormBody(payload),
  });

  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    // Flow a veces devuelve texto plano en errores
  }

  if (!res.ok || !data || data.status !== 1 || !data.url) {
    const msg =
      data?.message ||
      data?.error ||
      `Error HTTP ${res.status} al crear pago en Flow`;
    throw new Error(`${msg} — Respuesta: ${raw}`);
  }

  return {
    url: data.url,
    token: data.token ?? null,
    flowOrder: data.flowOrder ?? null,
  };
}
