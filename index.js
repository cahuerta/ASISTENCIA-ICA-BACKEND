// index.js — ESM (Node >= 18)
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ===== GEO (infraestructura)
import { detectarGeo } from "./geo.js";

// ===== Módulos
import chatRouter from "./nuevoModuloChat.js";
import iaPreopHandler from "./preopIA.js"; // ← PREOP IA
import generalesIAHandler from "./generalesIA.js"; // ← GENERALES IA
import traumaIAHandler from "./traumaIA.js"; // ← TRAUMA IA
import fallbackTrauma from "./fallbackTrauma.js"; // ← Fallback TRAUMA
import { enviarOrdenPorCorreo } from "./emailOrden.js";
import { generarInformeIA } from "./informeIA.js";


// ===== Flow client (NUEVO)
import { crearPagoFlowBackend } from "./flowClient.js";

// ===== Paths útiles
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== App base
const app = express();

// CORS: permite tus frontends (Vercel + dominio icarticular.cl)
const FRONTEND_BASE =
  process.env.FRONTEND_BASE ||
  process.env.RETURN_BASE ||
  "https://icarticular.cl";

// Dominio alterno/preview + dominio propio
const FRONTENDS = [
  FRONTEND_BASE,
  "https://asistencia-ica-fggf.vercel.app",
  "https://icarticular.cl",
  "https://www.icarticular.cl",
];

// --- CORS actualizado (misma whitelist en use y en OPTIONS)
const ALLOWED = [
  ...FRONTENDS,
  /^https:\/\/.*\.vercel\.app$/,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL/WebView sin Origin
    const ok = ALLOWED.some((rule) =>
      typeof rule === "string" ? origin === rule : rule.test(origin)
    );
    if (!ok) {
      console.warn("[CORS] origin NO permitido:", origin);
      // No lanzar error en preflight: responder sin Allow-Origin y que el navegador bloquee
      return cb(null, false);
    }
    return cb(null, true);
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(bodyParser.json());
// ================== ZOHO OAUTH CALLBACK ==================
app.get("/zoho/callback", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ ok: false, error: "Falta code" });
    }

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: "https://asistencia-ica-backend.onrender.com/zoho/callback",
      code,
    });

    const r = await fetch(
      "https://accounts.zoho.com/oauth/v2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    );

    const data = await r.json();

    return res.json({
      ok: true,
      zoho: data,
    });
  } catch (e) {
    console.error("Zoho callback error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== Puertos / bases
const PORT = process.env.PORT || 3001;
const BACKEND_BASE = process.env.BACKEND_BASE || ""; // si está vacío, lo deducimos por request
const RETURN_BASE = process.env.RETURN_BASE || FRONTEND_BASE;

// ===== Khipu config (v3)
const _ENV = (process.env.KHIPU_ENV || "integration").toLowerCase();
const KHIPU_MODE =
  _ENV === "guest"
    ? "guest"
    : _ENV === "prod" || _ENV === "production"
    ? "production"
    : "integration";

// v3 base + x-api-key
const KHIPU_API_KEY = process.env.KHIPU_API_KEY || "";
const KHIPU_API_BASE = "https://payment-api.khipu.com"; // v3 base
const KHIPU_AMOUNT = Number(process.env.KHIPU_AMOUNT || 1000); // CLP
const KHIPU_SUBJECT = process.env.KHIPU_SUBJECT || "Orden médica ICA";
const CURRENCY = "CLP";

// ===== Flow config (usa KHIPU_* como fallback) — NUEVO
const FLOW_AMOUNT = Number(process.env.FLOW_AMOUNT || KHIPU_AMOUNT || 1000);
const FLOW_SUBJECT =
  process.env.FLOW_SUBJECT || KHIPU_SUBJECT || "Orden médica ICA";

const memoria = new Map();
app.set("memoria", memoria);
export { memoria };


const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || "").replace(/[^a-zA-Z0-9_-]+/g, "_");

// ====== MODO GUEST GENERAL (nombre + RUT) ======
const GUEST_PERFIL = {
  nombre: "Guest",
  rut: "11.111.111-1",
};

function normRut(str) {
  return String(str || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

function esGuestPaciente(datos = {}) {
  const nombreOk =
    String(datos?.nombre || "")
      .trim()
      .toLowerCase() === "guest";
  const rutOk = normRut(datos?.rut) === normRut(GUEST_PERFIL.rut);
  return nombreOk && rutOk;
}

// ===== Carga perezosa de generadores PDF
let _genTrauma = null;
async function loadOrdenImagenologia() {
  if (_genTrauma) return _genTrauma;
  const m = await import("./ordenImagenologia.js");
  _genTrauma = m.generarOrdenImagenologia;
  return _genTrauma;
}

// *** NUEVO: generador de orden IA separado ***
let _genIAOrden = null;
async function loadIAOrdenImagenologia() {
  if (_genIAOrden) return _genIAOrden;
  const m = await import("./iaOrdenImagenologia.js");
  _genIAOrden = m.generarOrdenImagenologiaIA;
  return _genIAOrden;
}

let _genPreopLab = null,
  _genPreopOdonto = null;
async function loadPreop() {
  if (!_genPreopLab) {
    const mLab = await import("./preopOrdenLab.js");
    _genPreopLab = mLab.generarOrdenPreopLab;
  }
  if (!_genPreopOdonto) {
    const mOd = await import("./preopOdonto.js");
    _genPreopOdonto = mOd.generarPreopOdonto;
  }
  return { _genPreopLab, _genPreopOdonto };
}

let _genGenerales = null;
async function loadGenerales() {
  if (_genGenerales) return _genGenerales;
  const m = await import("./generalesOrden.js");
  _genGenerales = m.generarOrdenGenerales;
  return _genGenerales;
}

// NEW: Formulario de Resonancia (PDF)
let _genRM = null;
async function loadFormularioRM() {
  if (_genRM) return _genRM;
  const m = await import("./resonanciaFormularioPDF.js");
  _genRM = m.generarFormularioResonancia;
  return _genRM;
}

// ===== Utils
const getBackendBase = (req) =>
  BACKEND_BASE && BACKEND_BASE.startsWith("http")
    ? BACKEND_BASE
    : `${req.protocol}://${req.get("host")}`;

// ======== Helpers de orquestación/lectura (NO persisten, NO infieren, solo leen)
function pickFromSpaces(memoria, idPago) {
  const spaces = ["ia", "trauma", "preop", "generales"];
  for (const s of spaces) {
    const v = memoria.get(ns(s, idPago));
    if (v) return { space: s, data: { ...v } };
  }
  return { space: null, data: null };
}

function buildExamenTextoStrict(rec = {}) {
  // 1) TRAUMA + IA: usamos "examenes" (array)
  if (Array.isArray(rec.examenes) && rec.examenes.length > 0) {
    return rec.examenes
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  // 2) Compatibilidad: algunos flujos antiguos (preop/generales) usan "examenesIA"
  if (Array.isArray(rec.examenesIA) && rec.examenesIA.length > 0) {
    return rec.examenesIA
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  
  return ""; // sin fallback
}

// ==== ÚNICO CAMBIO: incluir justificacionIA antes de informeIA ====
function buildNotaStrict(rec = {}) {
  // Prioriza nota; luego observaciones; luego justificacionIA; luego informeIA; si nada, vacío
  if (typeof rec.nota === "string" && rec.nota.trim()) return rec.nota.trim();
  if (typeof rec.observaciones === "string" && rec.observaciones.trim())
    return rec.observaciones.trim();
  if (typeof rec.justificacionIA === "string" && rec.justificacionIA.trim())
    return rec.justificacionIA.trim();
  if (typeof rec.informeIA === "string" && rec.informeIA.trim())
    return rec.informeIA.trim();
  return "";
}

function contieneRM(texto = "") {
  const s = String(texto || "").toLowerCase();
  return (
    s.includes("resonancia") ||
    s.includes("resonancia magn") ||
    /\brm\b/i.test(texto)
  );
}

// ===== Salud / debug
app.get("/", (_req, res) => res.send("OK"));
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    mode: KHIPU_MODE,
    frontend: FRONTEND_BASE,
  })
);
// =====================================================
// ===============   GEO PING (PASIVO)  ================
// =====================================================
// - NO usa idPago
// - NO decide clínica
// - NO rompe UX
// - Sirve para:
//   • despertar Render
//   • capturar IP real
//   • calcular GEO en background
app.get("/geo-ping", async (req, res) => {
  try {
    const geoInfo = await detectarGeo(req);

    // Cache infraestructural (opcional, no clínica)
    app.set("geo_last", geoInfo);

    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false });
  }
});

// ===== DEBUG ZOHO: obtener accountId (TEMPORAL)
app.get("/debug/zoho/accounts", async (req, res) => {
  try {
    const token = process.env.ZOHO_MAIL_ACCESS_TOKEN;
    const apiDomain = process.env.ZOHO_MAIL_API_DOMAIN || "https://www.zohoapis.com";

    if (!token) {
      return res.status(500).json({
        ok: false,
        error: "Falta ZOHO_MAIL_ACCESS_TOKEN en variables de entorno",
      });
    }

    const r = await fetch(`https://mail.zoho.com/api/accounts`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await r.text();

    return res.status(r.status).send(text);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

// =====================================================
// ============   ZOHO OAUTH CALLBACK  =================
// =====================================================
app.get("/zoho/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ ok: false, error: "Falta code" });
  }

  // POR AHORA solo lo mostramos para copiarlo
  console.log("✅ ZOHO AUTH CODE:", code);

  return res.json({
    ok: true,
    message: "Zoho authorization code recibido",
    code,
  });
});

// =====================================================
// ===============   PREVIEW (solo lectura)  ===========
// =====================================================

// Preview consistente con LO GUARDADO (requiere idPago). Sin fallback.
app.get("/sugerir-imagenologia", (req, res) => {
  try {
    const { idPago } = req.query || {};
    if (!idPago)
      return res.status(400).json({ ok: false, error: "Falta idPago" });

    const { data } = pickFromSpaces(memoria, idPago);
    if (!data)
      return res.status(404).json({ ok: false, error: "No hay datos" });

    const texto = buildExamenTextoStrict(data);
    const nota = buildNotaStrict(data);

    return res.json({
      ok: true,
      examLines: texto ? texto.split("\n") : [],
      examen: texto,
      nota: nota || "",
      resonancia: contieneRM(texto),
    });
  } catch (e) {
    console.error("sugerir-imagenologia error:", e);
    res.status(500).json({ ok: false, error: "No se pudo leer los datos" });
  }
});

// Detectar RM usando exactamente el mismo texto que irá al PDF (sin fallback)
app.post("/detectar-resonancia", async (req, res) => {
  try {
    const { idPago, datosPaciente = {} } = req.body || {};

    let base = null;
    if (idPago) {
      const { data } = pickFromSpaces(memoria, idPago);
      base = data || null;
    } else {
      // Lectura directa si el front quiere testear sin memoria (sin inferir)
      base = datosPaciente || {};
    }

    if (!base)
      return res.status(404).json({ ok: false, error: "No hay datos" });

    const texto = buildExamenTextoStrict(base);
    const resonancia = contieneRM(texto);
    return res.json({ ok: true, resonancia, texto });
  } catch (e) {
    console.error("detectar-resonancia error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "No se pudo leer los datos" });
  }
});

// =====================================================
// ===============   TRAUMA (IMAGENOLOGÍA)  ============
// =====================================================

// Guardar (como ya lo tenías). Los módulos son los que definen los campos.
// AHORA soporta también traumaJSON desde el frontend nuevo.
app.post("/guardar-datos", (req, res) => {
  const {
    idPago,
    datosPaciente,
    traumaJSON,
    resonanciaChecklist,
    resonanciaResumenTexto,
    ordenAlternativa,
  } = req.body || {};

  if (!idPago || (!datosPaciente && !traumaJSON)) {
    return res.status(400).json({
      ok: false,
      error: "Faltan idPago o datosPaciente/traumaJSON",
    });
  }

  // ==== Construir "incoming" plano para memoria TRAUMA ====
  let incoming = datosPaciente || {};

  if (traumaJSON) {
    const { paciente = {}, ia = {}, resonancia = {}, marcadores = {} } =
      traumaJSON;

    incoming = {
      ...paciente,
      // IA
      examenesIA: Array.isArray(ia.examenes) ? ia.examenes : [],
      diagnosticoIA: ia.diagnostico || "",
      justificacionIA: ia.justificacion || "",
      // RM (desde traumaJSON)
      rmForm: resonancia.checklist || null,
      rmObservaciones: resonancia.resumenTexto || "",
      ordenAlternativa: resonancia.ordenAlternativa || "",
      // Además considerar los campos que pueda mandar la ruta como antes
      // (compatibilidad con TraumaModulo actual)
      ...(resonanciaChecklist ? { rmForm: resonanciaChecklist } : null),
      ...(resonanciaResumenTexto
        ? { rmObservaciones: resonanciaResumenTexto }
        : null),
      ...(ordenAlternativa ? { ordenAlternativa } : null),
      // Marcadores
      marcadores,
      rodillaMarcadores: marcadores.rodilla || null,
      manoMarcadores: marcadores.mano || null,
      hombroMarcadores: marcadores.hombro || null,
      codoMarcadores: marcadores.codo || null,
      tobilloMarcadores: marcadores.tobillo || null,
      caderaMarcadores: marcadores.cadera || null, // ← CADERA AQUÍ
    };

    // opcional: guardamos también el JSON crudo para debug
    incoming.traumaJSON = traumaJSON;
  }

  // ==== MERGE NO DESTRUCTIVO SOLO PARA TRAUMA ====
  const prev = memoria.get(ns("trauma", idPago)) || {};
  const next = { ...prev };

  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue; // no pisar con undefined
    if (Array.isArray(v) && v.length === 0) continue; // no pisar arrays no vacíos con vacíos
    if (typeof v === "string" && v.trim() === "") continue; // no pisar string con vacío
    next[k] = v;
  }

  // NUEVO: si vienen examenesIA desde el frontend (TraumaModulo),
  // los copiamos a "examenes" que es lo que usan buildExamenTextoStrict/PDF.
  if (Array.isArray(incoming.examenesIA) && incoming.examenesIA.length > 0) {
    next.examenes = incoming.examenesIA.slice();
  }

  // preservar campos críticos si incoming no aporta (TRAUMA → "examenes")
  if (
    Array.isArray(prev.examenes) &&
    (!Array.isArray(next.examenes) || next.examenes.length === 0)
  ) {
    next.examenes = prev.examenes;
  }
  if (prev.diagnosticoIA && !next.diagnosticoIA)
    next.diagnosticoIA = prev.diagnosticoIA;
  if (prev.justificacionIA && !next.justificacionIA)
    next.justificacionIA = prev.justificacionIA;

  if (prev.rmForm && !next.rmForm) next.rmForm = prev.rmForm;
  if (prev.rmObservaciones && !next.rmObservaciones)
    next.rmObservaciones = prev.rmObservaciones;

  next.pagoConfirmado = true;

  memoria.set(ns("trauma", idPago), next);
  // ===============================================

  res.json({ ok: true });
});

async function crearPagoHandler(req, res) {
  try {
    const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
    if (!idPago)
      return res.status(400).json({ ok: false, error: "Falta idPago" });

    // Soporta también el espacio "ia"
    const space =
      modulo === "preop" || String(idPago).startsWith("preop_")
        ? "preop"
        : modulo === "generales" || String(idPago).startsWith("generales_")
        ? "generales"
        : modulo === "ia" || String(idPago).startsWith("ia_")
        ? "ia"
        : "trauma";

    // ======= MERGE NO DESTRUCTIVO (evita perder preview IA / checklist RM) =======
    if (datosPaciente) {
      const prev = memoria.get(ns(space, idPago)) || {};
      const incoming = datosPaciente || {};
      const next = { ...prev };

      for (const [k, v] of Object.entries(incoming)) {
        if (v === undefined) continue; // no pisar con undefined
        if (Array.isArray(v) && v.length === 0) continue; // no pisar arrays no vacíos con vacíos
        if (typeof v === "string" && v.trim() === "") continue; // no pisar string con vacío
        next[k] = v;
      }

      // preservar campos críticos según módulo
      if (space === "trauma") {
        // TRAUMA → usa "examenes"
        if (
          Array.isArray(prev.examenes) &&
          (!Array.isArray(next.examenes) || next.examenes.length === 0)
        ) {
          next.examenes = prev.examenes;
        }
      } else {
        // PREOP / GENERALES → siguen usando examenesIA
        if (
          Array.isArray(prev.examenesIA) &&
          (!Array.isArray(next.examenesIA) || next.examenesIA.length === 0)
        ) {
          next.examenesIA = prev.examenesIA;
        }
      }

      if (prev.diagnosticoIA && !next.diagnosticoIA)
        next.diagnosticoIA = prev.diagnosticoIA;
      if (prev.justificacionIA && !next.justificacionIA)
        next.justificacionIA = prev.justificacionIA;

      if (prev.rmForm && !next.rmForm) next.rmForm = prev.rmForm;
      if (prev.rmObservaciones && !next.rmObservaciones)
        next.rmObservaciones = prev.rmObservaciones;

      memoria.set(ns(space, idPago), next);
    }
    // ============================================================================

    memoria.set(ns("meta", idPago), { moduloAutorizado: space });

    // ====== MODO GUEST GENERAL (Khipu): si el paciente es Guest, saltar pago ======
    if (datosPaciente && esGuestPaciente(datosPaciente)) {
      const url = new URL(RETURN_BASE);
      url.searchParams.set("pago", "ok");
      url.searchParams.set("idPago", idPago);
      url.searchParams.set("modulo", space);
      return res.json({ ok: true, url: url.toString(), guest: true });
    }

    if (!KHIPU_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: "Falta KHIPU_API_KEY en el backend" });
    }

    const backendBase = getBackendBase(req);
    const payload = {
      amount: KHIPU_AMOUNT,
      currency: CURRENCY,
      subject: KHIPU_SUBJECT,
      transaction_id: idPago,
      return_url: `${RETURN_BASE}?pago=ok&idPago=${encodeURIComponent(
        idPago
      )}&modulo=${space}`,
      cancel_url: `${RETURN_BASE}?pago=cancelado&idPago=${encodeURIComponent(
        idPago
      )}&modulo=${space}`,
      notify_url: `${backendBase}/webhook`,
    };

    const r = await fetch(`${KHIPU_API_BASE}/v3/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": KHIPU_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.message || `Error Khipu (${r.status})`;
      console.error("Respuesta de Khipu:", j);
      return res.status(502).json({ ok: false, error: msg, detail: j || null });
    }

    const urlPago = j?.payment_url || j?.simplified_transfer_url || j?.url;
    if (!urlPago) {
      return res
        .status(502)
        .json({ ok: false, error: "Khipu no entregó payment_url", detail: j });
    }

    return res.json({ ok: true, url: urlPago });
  } catch (e) {
    console.error("crear-pago-khipu error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
}

app.post("/crear-pago-khipu", crearPagoHandler);
app.post("/crear-pago", crearPagoHandler);

// ======== FLOW: crear pago (NUEVO) ==================
async function crearPagoFlowHandler(req, res) {
  try {
    const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
    if (!idPago)
      return res.status(400).json({ ok: false, error: "Falta idPago" });

    // Soporta también el espacio "ia"
    const space =
      modulo === "preop" || String(idPago).startsWith("preop_")
        ? "preop"
        : modulo === "generales" || String(idPago).startsWith("generales_")
        ? "generales"
        : modulo === "ia" || String(idPago).startsWith("ia_")
        ? "ia"
        : "trauma";

    // ======= MISMO MERGE NO DESTRUCTIVO QUE KHIPU =======
    if (datosPaciente) {
      const prev = memoria.get(ns(space, idPago)) || {};
      const incoming = datosPaciente || {};
      const next = { ...prev };

      for (const [k, v] of Object.entries(incoming)) {
        if (v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        next[k] = v;
      }

      if (space === "trauma") {
        if (
          Array.isArray(prev.examenes) &&
          (!Array.isArray(next.examenes) || next.examenes.length === 0)
        ) {
          next.examenes = prev.examenes;
        }
      } else {
        if (
          Array.isArray(prev.examenesIA) &&
          (!Array.isArray(next.examenesIA) || next.examenesIA.length === 0)
        ) {
          next.examenesIA = prev.examenesIA;
        }
      }

      if (prev.diagnosticoIA && !next.diagnosticoIA)
        next.diagnosticoIA = prev.diagnosticoIA;
      if (prev.justificacionIA && !next.justificacionIA)
        next.justificacionIA = prev.justificacionIA;

      if (prev.rmForm && !next.rmForm) next.rmForm = prev.rmForm;
      if (prev.rmObservaciones && !next.rmObservaciones)
        next.rmObservaciones = prev.rmObservaciones;

      memoria.set(ns(space, idPago), next);
    }
    // ====================================================

    memoria.set(ns("meta", idPago), { moduloAutorizado: space });

    // ====== MODO GUEST GENERAL (Flow): si el paciente es Guest, saltar Flow ======
    if (datosPaciente && esGuestPaciente(datosPaciente)) {
      const url = new URL(RETURN_BASE);
      url.searchParams.set("pago", "ok");
      url.searchParams.set("idPago", idPago);
      url.searchParams.set("modulo", space);
      return res.json({ ok: true, url: url.toString(), guest: true });
    }

    // Datos mínimos para Flow
    const amount = FLOW_AMOUNT;
    const subject = FLOW_SUBJECT;
    const email =
      datosPaciente?.email ||
      process.env.FLOW_FALLBACK_EMAIL ||
      "sin-correo@icarticular.cl";

    const backendBase = getBackendBase(req);

    // Flow vuelve al backend, que luego redirige al frontend
    const urlReturn = `${backendBase}/flow-return?modulo=${encodeURIComponent(
      space
    )}&idPago=${encodeURIComponent(idPago)}`;

    const urlConfirmation = `${backendBase}/flow-confirmation`;

    const resultadoFlow = await crearPagoFlowBackend({
      idPago,
      amount,
      subject,
      email,
      modulo: space,
      urlConfirmation,
      urlReturn,
      optionalData: {
        rut: datosPaciente?.rut || "",
        nombre: datosPaciente?.nombre || "",
        modoGuest: !!modoGuest,
      },
    });

    return res.json({
      ok: true,
      url: resultadoFlow.url,
      token: resultadoFlow.token,
      flowOrder: resultadoFlow.flowOrder,
    });
  } catch (e) {
    console.error("crear-pago-flow error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

app.post("/crear-pago-flow", crearPagoFlowHandler);

// ---- Webhook / confirmación externos
app.post("/webhook", express.json(), (req, res) => {
  try {
    console.log("Webhook Khipu:", req.body);
    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(200);
  }
});

// Confirmación de Flow (x-www-form-urlencoded)
app.post(
  "/flow-confirmation",
  express.urlencoded({ extended: false }),
  (req, res) => {
    try {
      console.log("Flow confirmation:", req.body);
      // Aquí podrías validar la firma de Flow y marcar pago en memoria/db
      res.status(200).send("OK");
    } catch (e) {
      console.error("flow-confirmation error:", e);
      res.status(200).send("OK");
    }
  }
);

// NUEVO: retorno de Flow → redirigir al frontend
app.all("/flow-return", (req, res) => {
  try {
    const idPago = req.query.idPago || "";
    const modulo = req.query.modulo || "trauma";

    const finalUrl = new URL(RETURN_BASE);
    finalUrl.searchParams.set("pago", "ok");
    if (idPago) finalUrl.searchParams.set("idPago", idPago);
    finalUrl.searchParams.set("modulo", modulo);

    return res.redirect(302, finalUrl.toString());
  } catch (e) {
    console.error("flow-return error:", e);
    return res.redirect(302, RETURN_BASE);
  }
});

// === CORREGIDO: ahora obtiene datos desde cualquier espacio (ia/trauma/preop/generales)
app.get("/obtener-datos/:idPago", (req, res) => {
  const { idPago } = req.params || {};
  const { space, data } = pickFromSpaces(memoria, idPago);
  if (!data) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: data, space });
});

// ===== RESET (borrado por idPago, usado por el botón Volver/Reiniciar)
app.delete("/reset/:idPago", (req, res) => {
  const { idPago } = req.params || {};
  if (!idPago)
    return res.status(400).json({ ok: false, error: "Falta idPago" });

  // sanity: aceptar solo id alfanumérico con _ y -
// ... RESTO DEL ARCHIVO SIGUE IGUAL ...

  // (copio todo el resto sin cambios:)
  const keys = [
    ns("ia", idPago),
    ns("trauma", idPago),
    ns("preop", idPago),
    ns("generales", idPago),
    ns("meta", idPago),
  ];

  let removed = 0;
  for (const k of keys) if (memoria.delete(k)) removed++;
  return res.json({ ok: true, removed });
});

// ===== PDF ORDEN (TRAUMA) — solo lee, sin fallback
app.get("/pdf/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "trauma") return res.sendStatus(402);

    const d = memoria.get(ns("trauma", req.params.idPago));
    if (!d) return res.sendStatus(404);

    const generar = await loadOrdenImagenologia();

    const examen = buildExamenTextoStrict(d);
    const nota = buildNotaStrict(d);

    const datos = { ...d, examen, nota, idPago: req.params.idPago };

    const filename = `orden_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generar(doc, datos);
    doc.end();

    // 🔹 Envío por correo (NO bloqueante)
    enviarOrdenPorCorreo({
      idPago: req.params.idPago,
      generadorPDF: generar,
    }).catch((e) => {
      console.error("Error enviando correo TRAUMA:", e);
    });

  } catch (e) {
    console.error("pdf/:idPago error:", e);
    res.sendStatus(500);
  }
});


// =====================================================
// ===============   PREOP (PDF 2 PÁGINAS)  ============
// =====================================================

app.post("/guardar-datos-preop", (req, res) => {
  const {
    idPago,
    datosPaciente = {},
    comorbilidades,
    tipoCirugia,
    examenesIA,
    informeIA,
    nota,
  } = req.body || {};

  if (!idPago || !datosPaciente) {
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });
  }

  const prev = memoria.get(ns("preop", idPago)) || {};
  const next = { ...prev };

  // ==== merge NO destructivo ====
  const mergeField = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "string" && value.trim() === "") return;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return;
    next[key] = value;
  };

  // datos del paciente
  Object.entries(datosPaciente).forEach(([k, v]) => mergeField(k, v));

  // comorbilidades
  if (typeof comorbilidades === "object") {
    next.comorbilidades = { ...(next.comorbilidades || {}), ...comorbilidades };
  }

  // tipo de cirugía
  mergeField("tipoCirugia", tipoCirugia);

  // **EXAMENES → SIEMPRE COMPLEMENTAR — NUNCA REEMPLAZAR**
  if (Array.isArray(examenesIA) && examenesIA.length > 0) {
    const prevList = Array.isArray(next.examenesIA) ? next.examenesIA : [];
    next.examenesIA = [...new Set([...prevList, ...examenesIA])];
  }

  // informe IA
  if (typeof informeIA === "string" && informeIA.trim()) {
    next.informeIA = informeIA.trim();
  }

  // nota
  if (typeof nota === "string" && nota.trim()) {
    next.nota = nota.trim();
  }

  next.pagoConfirmado = true;

  memoria.set(ns("preop", idPago), next);
  return res.json({ ok: true });
});

app.get("/obtener-datos-preop/:idPago", (req, res) => {
  const d = memoria.get(ns("preop", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

app.get("/pdf-preop/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "preop") return res.sendStatus(402);

    const d = memoria.get(ns("preop", req.params.idPago));
    if (!d) return res.sendStatus(404);

    const { _genPreopLab, _genPreopOdonto } = await loadPreop();

    const filename = `preop_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    _genPreopLab(doc, d);
    doc.addPage();
    _genPreopOdonto(doc, d);

    doc.end();
    
 // 🔹 Envío por correo (NO bloqueante)
enviarOrdenPorCorreo({
  idPago: req.params.idPago,
  generadorPDF: (doc, datos) => {
    _genPreopLab(doc, datos);
    doc.addPage();
    _genPreopOdonto(doc, datos);
  },
 } catch (e) {
    console.error("pdf-preop/:idPago error:", e);
    res.sendStatus(500);
  }
});

// ← PREOP IA (y alias de compatibilidad) + preflight explícito
app.options("/ia-preop", cors(corsOptions));
app.options("/preop-ia", cors(corsOptions));
app.post("/ia-preop", cors(corsOptions), iaPreopHandler(memoria));
app.post("/preop-ia", cors(corsOptions), iaPreopHandler(memoria));

// =====================================================
// ============   GENERALES (1 PDF)  ===================
// =====================================================

// IA de Generales (con preflight explícito)
app.options("/ia-generales", cors(corsOptions));
app.post("/ia-generales", cors(corsOptions), generalesIAHandler(memoria));

// Guardar / obtener / PDF Generales (solo lectura)
app.post("/guardar-datos-generales", (req, res) => {
  const {
    idPago,
    datosPaciente = {},
    comorbilidades,
    examenesIA,
    informeIA,
    nota,
  } = req.body || {};

  if (!idPago || !datosPaciente) {
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });
  }

  const prev = memoria.get(ns("generales", idPago)) || {};
  const next = { ...prev };

  // ===== merge NO destructivo =====
  const mergeField = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === "string" && value.trim() === "") return;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      return;
    next[key] = value;
  };

  // merge datos paciente
  Object.entries(datosPaciente).forEach(([k, v]) => mergeField(k, v));

  // merge comorbilidades
  if (typeof comorbilidades === "object") {
    next.comorbilidades = { ...(next.comorbilidades || {}), ...comorbilidades };
  }

  // merge examenes IA (SIEMPRE complementa)
  if (Array.isArray(examenesIA) && examenesIA.length > 0) {
    const prevList = Array.isArray(next.examenesIA) ? next.examenesIA : [];
    next.examenesIA = [...new Set([...prevList, ...examenesIA])];
  }

  // informe y nota
  if (typeof informeIA === "string" && informeIA.trim()) {
    next.informeIA = informeIA.trim();
  }
  if (typeof nota === "string" && nota.trim()) {
    next.nota = nota.trim();
  }

  next.pagoConfirmado = true;

  memoria.set(ns("generales", idPago), next);
  return res.json({ ok: true });
});

app.get("/obtener-datos-generales/:idPago", (req, res) => {
  const d = memoria.get(ns("generales", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

app.get("/pdf-generales/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "generales")
      return res.sendStatus(402);

    const d = memoria.get(ns("generales", req.params.idPago));
    if (!d) return res.sendStatus(404);

    const generar = await loadGenerales();

    const filename = `generales_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generar(doc, d);
    doc.end();
 // 🔹 Envío por correo (NO bloqueante)
enviarOrdenPorCorreo({
  idPago: req.params.idPago,
  generadorPDF: generar,
}).catch((e) => {
  console.error("Error enviando correo GENERALES:", e);
});


// =====================================================
// ============   IA MÓDULO PRINCIPAL  =================
// =====================================================

// Guarda IA (preview + marcadores + RM).
// Soporta tanto un JSON grande (iaJSON) como el formato plano actual de IAModulo.
app.post("/api/guardar-datos-ia", (req, res) => {
  try {
    const {
      idPago,
      iaJSON,
      datosPaciente,
      examen,
      marcadores,
      rodillaMarcadores,
      manoMarcadores,
      hombroMarcadores,
      codoMarcadores,
      tobilloMarcadores,
      caderaMarcadores,
      resonanciaChecklist,
      resonanciaResumenTexto,
      ordenAlternativa,
      pagoConfirmado,
    } = req.body || {};

    if (!idPago) {
      return res.status(400).json({ ok: false, error: "Falta idPago" });
    }

    const prev = memoria.get(ns("ia", idPago)) || {};
    const next = { ...prev };

    const mergeField = (key, value) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value) && value.length === 0) return;
      if (typeof value === "string" && value.trim() === "") return;
      if (
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      )
        return;
      next[key] = value;
    };

    // --- Forma JSON grande (similar a traumaJSON) ---
    if (iaJSON && typeof iaJSON === "object") {
      const {
        paciente = {},
        consulta,
        informeIA,
        examenes,
        examenesIA,
        nota,
        observaciones,
        marcadores: iaMarcadores = {},
        resonancia = {},
      } = iaJSON;

      if (paciente && typeof paciente === "object") {
        next.paciente = { ...(next.paciente || {}), ...paciente };
        mergeField("nombre", paciente.nombre);
        mergeField("rut", paciente.rut);
        mergeField("edad", paciente.edad);
        mergeField("genero", paciente.genero);
        mergeField("dolor", paciente.dolor);
        mergeField("lado", paciente.lado);
      }

      mergeField("consulta", consulta);
      mergeField("informeIA", informeIA);
      mergeField("nota", nota);
      mergeField("observaciones", observaciones);

      if (Array.isArray(examenes) && examenes.length > 0) {
        mergeField("examenes", examenes);
      }
      if (Array.isArray(examenesIA) && examenesIA.length > 0) {
        mergeField("examenesIA", examenesIA);
        if (!Array.isArray(next.examenes) || next.examenes.length === 0) {
          next.examenes = examenesIA.slice();
        }
      }

      if (iaMarcadores && typeof iaMarcadores === "object") {
        next.marcadores = { ...(next.marcadores || {}), ...iaMarcadores };
        mergeField("rodillaMarcadores", iaMarcadores.rodilla);
        mergeField("manoMarcadores", iaMarcadores.mano);
        mergeField("hombroMarcadores", iaMarcadores.hombro);
        mergeField("codoMarcadores", iaMarcadores.codo);
        mergeField("tobilloMarcadores", iaMarcadores.tobillo);
        mergeField("caderaMarcadores", iaMarcadores.cadera);
      }

      if (resonancia && typeof resonancia === "object") {
        if (resonancia.checklist) mergeField("rmForm", resonancia.checklist);
        if (resonancia.resumenTexto)
          mergeField("rmObservaciones", resonancia.resumenTexto);
        if (resonancia.ordenAlternativa)
          mergeField("ordenAlternativa", resonancia.ordenAlternativa);
      }

      next.iaJSON = iaJSON; // debug
    }

    // --- Forma plana actual de IAModulo ---
    if (datosPaciente && typeof datosPaciente === "object") {
      for (const [k, v] of Object.entries(datosPaciente)) {
        mergeField(k, v);
      }
    }

   
    if (marcadores && typeof marcadores === "object") {
      next.marcadores = { ...(next.marcadores || {}), ...marcadores };
      mergeField("rodillaMarcadores", marcadores.rodilla);
      mergeField("manoMarcadores", marcadores.mano);
      mergeField("hombroMarcadores", marcadores.hombro);
      mergeField("codoMarcadores", marcadores.codo);
      mergeField("tobilloMarcadores", marcadores.tobillo);
      mergeField("caderaMarcadores", marcadores.cadera);
    }

    mergeField("rodillaMarcadores", rodillaMarcadores);
    mergeField("manoMarcadores", manoMarcadores);
    mergeField("hombroMarcadores", hombroMarcadores);
    mergeField("codoMarcadores", codoMarcadores);
    mergeField("tobilloMarcadores", tobilloMarcadores);
    mergeField("caderaMarcadores", caderaMarcadores);

    if (resonanciaChecklist) mergeField("rmForm", resonanciaChecklist);
    if (typeof resonanciaResumenTexto === "string")
      mergeField("rmObservaciones", resonanciaResumenTexto);
    if (ordenAlternativa) mergeField("ordenAlternativa", ordenAlternativa);

    // Marcamos pagoConfirmado si viene explícito o si ya estaba
    if (pagoConfirmado === true || prev.pagoConfirmado) {
      next.pagoConfirmado = true;
    }

    memoria.set(ns("ia", idPago), next);
    return res.json({ ok: true });
  } catch (e) {
    console.error("api/guardar-datos-ia error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "No se pudo guardar datos IA" });
  }
});

app.get("/api/obtener-datos-ia/:idPago", (req, res) => {
  const d = memoria.get(ns("ia", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  return res.json({ ok: true, datos: d });
});

// =====================================================
// ============   ORDEN DESDE IA (solo lectura) ========
// =====================================================

// PDF IA (orden) — solo lee lo guardado por módulos IA.
app.get("/api/pdf-ia-orden/:idPago", async (req, res) => {
  try {
    const id = req.params.idPago;
    const meta = memoria.get(ns("meta", id));
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(ns("ia", id));
    if (!d) return res.sendStatus(404);

    // *** AHORA USAMOS EL GENERADOR ESPECÍFICO DE IA ***
    const generar = await loadIAOrdenImagenologia();

    const examen = buildExamenTextoStrict(d); // solo lo guardado
    const nota = buildNotaStrict(d); // solo lo guardado

    // incluimos idPago para debug en el PDF IA
    const datosParaOrden = { ...d, examen, nota, idPago: id };

    const filename = `ordenIA_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${filename}\"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generar(doc, datosParaOrden);
    doc.end();
 // 🔹 Envío por correo (NO bloqueante)
enviarOrdenPorCorreo({
  idPago: id,
  generadorPDF: generar,
}).catch((e) => {
  console.error("Error enviando correo IA:", e);
});


// =====================================================
// ============   INFORME IA (PDF)  ====================
// =====================================================
app.get("/api/pdf-ia/:idPago", async (req, res) => {
  try {
    const id = req.params.idPago;

    // 🔐 Validar que el flujo sea IA
    const meta = memoria.get(ns("meta", id));
    if (!meta || meta.moduloAutorizado !== "ia") {
      return res.sendStatus(402);
    }

    const d = memoria.get(ns("ia", id));
    if (!d) return res.sendStatus(404);

    // 🔓 PERMITIR guest Y pago normal
    // (si llegaste acá, ya vienes con pago=ok)
    // NO BLOQUEAR POR pagoConfirmado

    const filename = `informeIA_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    generarInformeIA(doc, {
      nombre: d.nombre,
      edad: d.edad,
      rut: d.rut,
      consulta: d.consulta || "",
      respuesta: d.informeIA || d.iaJSON?.informeIA || "",
    });

    doc.end();
  } catch (e) {
    console.error("api/pdf-ia error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// =========   FORMULARIO RM (guardar / pdf)  ==========
// =====================================================

// Guardar FORMULARIO RM — solo si los exámenes incluyen RM
app.post("/guardar-rm", (req, res) => {
  try {
    const { idPago, rmForm, observaciones } = req.body || {};
    if (!idPago) {
      return res.status(400).json({ ok: false, error: "Falta idPago" });
    }

    // Busca el espacio donde está el caso
    const spaces = ["ia", "trauma", "preop", "generales"];
    let foundSpace = null;
    let base = null;
    for (const s of spaces) {
      const v = memoria.get(ns(s, idPago));
      if (v) {
        foundSpace = s;
        base = v;
        break;
      }
    }
    if (!base) {
      return res
        .status(404)
        .json({ ok: false, error: "No hay datos base para ese idPago" });
    }

    // Debe contener RM en exámenes
    const texto = buildExamenTextoStrict(base);
    if (!contieneRM(texto)) {
      return res.status(409).json({
        ok: false,
        error:
          "El caso no contiene Resonancia. No corresponde guardar formulario RM.",
      });
    }

    // Construir cambios solo si vienen con contenido útil
    const patch = {};
    const hasRmForm =
      rmForm && typeof rmForm === "object" && Object.keys(rmForm).length > 0;
    const hasObs = typeof observaciones === "string";

    if (hasRmForm) patch.rmForm = rmForm;
    if (hasObs) patch.rmObservaciones = observaciones;

    // Si no vino nada útil, no sobreescribimos
    if (!hasRmForm && !hasObs) {
      return res.json({ ok: true, skipped: true });
    }

    memoria.set(ns(foundSpace, idPago), { ...base, ...patch });
    return res.json({ ok: true });
  } catch (e) {
    console.error("guardar-rm error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "No se pudo guardar formulario RM" });
  }
});

// PDF del Formulario RM — solo si los exámenes incluyen RM
app.get("/pdf-rm/:idPago", async (req, res) => {
  try {
    const id = req.params.idPago;

    // autoriza por cualquier espacio (el formulario es auxiliar)
    const d =
      memoria.get(ns("ia", id)) ||
      memoria.get(ns("trauma", id)) ||
      memoria.get(ns("preop", id)) ||
      memoria.get(ns("generales", id));

    if (!d) return res.sendStatus(404);

    // Debe contener RM en exámenes
    const examenTxt = buildExamenTextoStrict(d);
    if (!contieneRM(examenTxt)) {
      return res.status(404).json({
        ok: false,
        error:
          "No corresponde formulario RM: los exámenes no incluyen Resonancia.",
      });
    }

    const generarRM = await loadFormularioRM();

    const filename = `formularioRM_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    generarRM(doc, {
      nombre: d.nombre,
      rut: d.rut,
      edad: d.edad,
      rmForm: d.rmForm || {}, // ← lo guarda el front/módulo
      observaciones: d.rmObservaciones || d.observaciones || "",
    });

    doc.end();
  } catch (e) {
    console.error("pdf-rm error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// ============   TRAUMA IA (IA → fallback) ============
// =====================================================

// Handler IA base
const _traumaIA = traumaIAHandler(memoria);

/**
 * Envoltura para TRAUMA IA:
 * - Intenta usar la respuesta de IA.
 * - Si NO aporta exámenes, usa fallbackTrauma.
 * - Siempre persiste en memoria.trauma usando SOLO "examenes" (array).
 * - AHORA entiende body con { idPago, traumaJSON } desde el frontend nuevo.
 */
function traumaIAWithFallback(handler) {
  return async (req, res) => {
    const originalJson = res.json.bind(res);

    // 💡 Normalizar body para que traumaIAHandler vea datosPaciente
    if (req.body?.traumaJSON && !req.body.datosPaciente) {
      req.body.datosPaciente = req.body.traumaJSON.paciente || {};
    }

    // Intercepta res.json para decidir si la IA aportó algo útil
    res.json = (body) => {
      const ok = body && body.ok !== false;
      const idPago = req.body?.idPago;

      // ---- 1) extraer exámenes desde la RESPUESTA de IA (solo TRAUMA) ----
      let exFromBody = null;
      if (Array.isArray(body?.examenes) && body.examenes.length > 0) {
        exFromBody = body.examenes;
      } else if (typeof body?.examen === "string" && body.examen.trim()) {
        exFromBody = [body.examen];
      } else if (
        typeof body?.orden?.examen === "string" &&
        body.orden.examen.trim()
      ) {
        exFromBody = [body.orden.examen];
      }

      // ---- 2) ver si ya había algo útil guardado en memoria.trauma ----
      const saved = idPago ? memoria.get(ns("trauma", idPago)) : null;
      const hasFromMem =
        Array.isArray(saved?.examenes) && saved.examenes.length > 0;

      // Función para obtener paciente plano desde el request
      const traumaJSON = req.body?.traumaJSON;
      const paciente =
        traumaJSON?.paciente || req.body?.datosPaciente || req.body || {};

      // ===== CASO A: la IA aportó algo (o ya había algo guardado) =====
      if (ok && (exFromBody || hasFromMem)) {
        if (idPago) {
          const prev = saved || {};
          const next = { ...prev, ...paciente };

          // Normalizar exámenes → siempre "examenes" (array)
          if (Array.isArray(exFromBody) && exFromBody.length > 0) {
            next.examenes = exFromBody;
          }

          // Diagnóstico y justificación, si vienen
          if (
            typeof body?.diagnostico === "string" &&
            body.diagnostico.trim()
          ) {
            next.diagnosticoIA = body.diagnostico;
          }
          if (
            typeof body?.justificacion === "string" &&
            body.justificacion.trim()
          ) {
            next.justificacionIA = body.justificacion;
          }

          memoria.set(ns("trauma", idPago), next);
        }

        res.json = originalJson; // restaurar
        return originalJson(body);
      }

      // ===== CASO B: IA NO aportó nada útil → usar fallbackTrauma =====
      const fb = fallbackTrauma(paciente); // { examen, diagnostico, justificacion }
      const prev = idPago ? memoria.get(ns("trauma", idPago)) || {} : {};

      if (idPago) {
        memoria.set(ns("trauma", idPago), {
          ...prev,
          ...paciente,
          examenes: [fb.examen],
          diagnosticoIA: fb.diagnostico,
          justificacionIA: fb.justificacion,
        });
      }

      res.json = originalJson; // restaurar
      return originalJson({
        ok: true,
        fallback: true,
        examenes: [fb.examen],
        diagnosticoIA: fb.diagnostico,
        justificacionIA: fb.justificacion,
      });
    };

    try {
      await Promise.resolve(handler(req, res));
    } catch (_e) {
      // ===== ERROR real de IA → ir directo a fallback =====
      const idPago = req.body?.idPago;
      const traumaJSON = req.body?.traumaJSON;
      const paciente =
        traumaJSON?.paciente || req.body?.datosPaciente || req.body || {};

      const fb = fallbackTrauma(paciente);
      const prev = idPago ? memoria.get(ns("trauma", idPago)) || {} : {};

      if (idPago) {
        memoria.set(ns("trauma", idPago), {
          ...prev,
          ...paciente,
          examenes: [fb.examen],
          diagnosticoIA: fb.diagnostico,
          justificacionIA: fb.justificacion,
        });
      }

      res.json = originalJson;
      return originalJson({
        ok: true,
        fallback: true,
        examenes: [fb.examen],
        diagnosticoIA: fb.diagnostico,
        justificacionIA: fb.justificacion,
      });
    } finally {
      // Restaurar por si Express continúa con otros middlewares
      res.json = originalJson;
    }
  };
}

// Preflight explícito + rutas IA Trauma
app.options("/ia-trauma", cors(corsOptions));
app.options("/ia/trauma", cors(corsOptions));
app.post("/ia-trauma", cors(corsOptions), traumaIAWithFallback(_traumaIA)); // existente + fallback
app.post("/ia/trauma", cors(corsOptions), traumaIAWithFallback(_traumaIA)); // alias legacy + fallback

// =====================================================
// ============   CHAT GPT (nuevo módulo)  =============
// =====================================================

app.use("/api", chatRouter);



// ===== 404 handler explícito
app.use((req, res) => {
  console.warn("404 no encontrada:", req.method, req.originalUrl);
  res
    .status(404)
    .json({ ok: false, error: "Ruta no encontrada", path: req.originalUrl });
});

// ===== Arranque
app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});
