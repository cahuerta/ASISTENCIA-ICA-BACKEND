// index.js — ESM (Node >= 18)
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

// ===== Nuevo módulo Chat GPT
import chatRouter from "./nuevoModuloChat.js";

// ===== Paths útiles
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== App base
const app = express();

// CORS: permite tu frontend en Vercel (y fallback a * en dev)
const FRONTEND_BASE =
  process.env.FRONTEND_BASE ||
  process.env.RETURN_BASE ||
  "https://asistencia-ica.vercel.app";

app.use(
  cors({
    origin: FRONTEND_BASE === "*" ? "*" : FRONTEND_BASE,
    credentials: false,
  })
);
app.use(bodyParser.json());

// ===== Puertos / bases
const PORT = process.env.PORT || 3001;
const BACKEND_BASE = process.env.BACKEND_BASE || ""; // si está vacío, lo deducimos por request
const RETURN_BASE =
  process.env.RETURN_BASE || FRONTEND_BASE || "https://asistencia-ica.vercel.app";

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

// ===== Memoria simple
const memoria = new Map();
app.set("memoria", memoria); // <-- compartir memoria con todos los módulos

const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || "").replace(/[^a-zA-Z0-9_-]+/g, "_");

// ===== Helpers clínicos
function sugerirExamenImagenologia(dolor = "", lado = "", edad = null) {
  const d = String(dolor || "").toLowerCase();
  const L = String(lado || "").trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : "";
  const edadNum = Number(edad);
  const mayor60 = Number.isFinite(edadNum) ? edadNum > 60 : false;

  if (d.includes("columna")) return ["RESONANCIA DE COLUMNA LUMBAR."];

  if (d.includes("rodilla")) {
    if (mayor60) {
      return [
        `RX DE RODILLA${ladoTxt} — AP, LATERAL, AXIAL PATELA.`,
        "TELERADIOGRAFIA DE EEII.",
      ];
    } else {
      return [
        `RESONANCIA MAGNETICA DE RODILLA${ladoTxt}.`,
        "TELERADIOGRAFIA DE EEII.",
      ];
    }
  }

  if (d.includes("cadera")) {
    if (mayor60) return ["RX DE PELVIS AP, Y LOWESTAIN."];
    return [`RESONANCIA MAGNETICA DE CADERA${ladoTxt}.`];
  }

  return ["Evaluación imagenológica según clínica."];
}

function notaAsistencia(dolor = "") {
  const d = String(dolor || "").toLowerCase();
  const base =
    "Presentarse con esta orden. Ayuno NO requerido salvo indicación.";
  if (d.includes("rodilla"))
    return `${base}\nConsultar con nuestro especialista en rodilla Dr Jaime Espinoza.`;
  if (d.includes("cadera"))
    return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  return base;
}

// ===== Carga perezosa de generadores PDF
let _genTrauma = null;
async function loadOrdenImagenologia() {
  if (_genTrauma) return _genTrauma;
  const m = await import("./ordenImagenologia.js");
  _genTrauma = m.generarOrdenImagenologia;
  return _genTrauma;
}

let _genPreopLab = null, _genPreopOdonto = null;
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

// ===== Utils
const getBackendBase = (req) =>
  BACKEND_BASE && BACKEND_BASE.startsWith("http")
    ? BACKEND_BASE
    : `${req.protocol}://${req.get("host")}`;

// ===== Salud / debug
app.get("/", (_req, res) => res.send("OK"));
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    mode: KHIPU_MODE,
    frontend: FRONTEND_BASE,
  })
);

// ===== Preview consistente con PDF
app.get("/sugerir-imagenologia", (req, res) => {
  const { dolor = "", lado = "", edad = "" } = req.query || {};
  try {
    const lines = sugerirExamenImagenologia(dolor, lado, edad);
    const nota = notaAsistencia(dolor);
    res.json({ ok: true, examLines: lines, examen: lines.join("\n"), nota });
  } catch (e) {
    console.error("sugerir-imagenologia error:", e);
    res.status(500).json({ ok: false, error: "No se pudo sugerir el examen" });
  }
});

// =====================================================
// ===============   TRAUMA (IMAGENOLOGÍA)  ============
// =====================================================

app.post("/guardar-datos", (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente)
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });
  memoria.set(ns("trauma", idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

// ---- Crear pago Khipu (real o guest) ----
async function crearPagoHandler(req, res) {
  try {
    const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
    if (!idPago)
      return res.status(400).json({ ok: false, error: "Falta idPago" });

    // Espacio lógico
    const space =
      modulo === "preop" || String(idPago).startsWith("preop_")
        ? "preop"
        : modulo === "generales" || String(idPago).startsWith("generales_")
        ? "generales"
        : "trauma";

    // Guarda datos del paciente (si llegan) en su namespace
    if (datosPaciente) memoria.set(ns(space, idPago), { ...datosPaciente });

    // ⛓️ Registrar módulo autorizado para ese idPago
    memoria.set(ns("meta", idPago), { moduloAutorizado: space });

    // Invitado o forzado por env
    if (modoGuest === true || KHIPU_MODE === "guest") {
      const url = new URL(RETURN_BASE);
      url.searchParams.set("pago", "ok");
      url.searchParams.set("idPago", idPago);
      return res.json({ ok: true, url: url.toString(), guest: true });
    }

    // Validación credenciales para Khipu real
    if (!KHIPU_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: "Falta KHIPU_API_KEY en el backend" });
    }

    // Armado de URLs de retorno y notificación
    const backendBase = getBackendBase(req);
    const payload = {
      amount: KHIPU_AMOUNT,
      currency: CURRENCY,
      subject: KHIPU_SUBJECT,
      transaction_id: idPago,
      return_url: `${RETURN_BASE}?pago=ok&idPago=${encodeURIComponent(idPago)}`,
      cancel_url: `${RETURN_BASE}?pago=cancelado&idPago=${encodeURIComponent(
        idPago
      )}`,
      notify_url: `${backendBase}/webhook`,
    };

    // 🌐 Llamado a Khipu v3 (x-api-key)  —> https://payment-api.khipu.com/v3/payments
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
      console.error("Respuesta de Khipu:", j); // log de ayuda
      return res.status(502).json({ ok: false, error: msg, detail: j || null });
    }

    // URL de pago (v3 expone payment_url y simplified_transfer_url)
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

// Rutas: canónica + alias
app.post("/crear-pago-khipu", crearPagoHandler);
app.post("/crear-pago", crearPagoHandler);

// ---- Webhook (opcional)
app.post("/webhook", express.json(), (req, res) => {
  try {
    console.log("Webhook Khipu:", req.body);
    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(200);
  }
});

// Obtener datos TRAUMA
app.get("/obtener-datos/:idPago", (req, res) => {
  const d = memoria.get(ns("trauma", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Descargar PDF TRAUMA — exige módulo autorizado = 'trauma'
app.get("/pdf/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "trauma") return res.sendStatus(402);

    const d = memoria.get(ns("trauma", req.params.idPago));
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402);

    const generar = await loadOrdenImagenologia();
    const lines = sugerirExamenImagenologia(d.dolor, d.lado, d.edad);
    const examen =
      d.examen && typeof d.examen === "string"
        ? d.examen
        : Array.isArray(lines)
        ? lines.join("\n")
        : String(lines || "");
    const nota = d.nota || notaAsistencia(d.dolor);
    const datos = { ...d, examen, nota };

    const filename = `orden_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generar(doc, datos);
    doc.end();
  } catch (e) {
    console.error("pdf/:idPago error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// ===============   PREOP (PDF 2 PÁGINAS)  ============
// =====================================================

app.post("/guardar-datos-preop", (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente)
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });
  memoria.set(ns("preop", idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

app.get("/obtener-datos-preop/:idPago", (req, res) => {
  const d = memoria.get(ns("preop", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Descargar PDF PREOP — exige módulo autorizado = 'preop'
app.get("/pdf-preop/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "preop") return res.sendStatus(402);

    const d = memoria.get(ns("preop", req.params.idPago));
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402);

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
  } catch (e) {
    console.error("pdf-preop/:idPago error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// ============   GENERALES (1 PDF)  ===================
// =====================================================

app.post("/guardar-datos-generales", (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente)
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });
  memoria.set(ns("generales", idPago), {
    ...datosPaciente,
    pagoConfirmado: true,
  });
  res.json({ ok: true });
});

app.get("/obtener-datos-generales/:idPago", (req, res) => {
  const d = memoria.get(ns("generales", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// Descargar PDF GENERALES — exige módulo autorizado = 'generales'
app.get("/pdf-generales/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "generales") return res.sendStatus(402);

    const d = memoria.get(ns("generales", req.params.idPago));
    if (!d) return res.sendStatus(404);
    // if (!d.pagoConfirmado) return res.sendStatus(402);

    const generar = await loadGenerales();

    const filename = `generales_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generar(doc, d);
    doc.end();
  } catch (e) {
    console.error("pdf-generales/:idPago error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// ============   ORDEN DESDE IA (NUEVO)  ==============
// =====================================================

// NUEVO: genera una ORDEN de imagenología/lab usando la salida del módulo IA
app.get("/api/pdf-ia-orden/:idPago", async (req, res) => {
  try {
    const id = req.params.idPago;
    const meta = memoria.get(ns("meta", id));
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(ns("ia", id));
    if (!d) return res.sendStatus(404);
    if (!d.pagoConfirmado) return res.sendStatus(402);

    // Usa el generador existente de orden imagenológica
    const generar = await loadOrdenImagenologia();

    // 1) Prioriza exámenes ya parseados desde IA; si no hay, usa la sugerencia automática
    const linesIA = Array.isArray(d.examenesIA) ? d.examenesIA : [];
    const lines =
      linesIA.length > 0
        ? linesIA
        : sugerirExamenImagenologia(d.dolor, d.lado, d.edad);

    const examen =
      Array.isArray(lines) ? lines.join("\n") : String(lines || "");

    // 2) Nota: si en la respuesta IA viene una sección “Indicaciones”, úsala; si no, nota por defecto
    let nota = d.nota;
    if (!nota) {
      const m = /Indicaciones:\s*([\s\S]+)/i.exec(d.respuesta || "");
      nota = (m && m[1] && m[1].trim()) || notaAsistencia(d.dolor);
    }

    const datosParaOrden = { ...d, examen, nota };

    const filename = `ordenIA_${sanitize(d.nombre || "paciente")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generar(doc, datosParaOrden);
    doc.end();
  } catch (e) {
    console.error("api/pdf-ia-orden error:", e);
    res.sendStatus(500);
  }
});

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
