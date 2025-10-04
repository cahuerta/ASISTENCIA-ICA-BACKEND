// index.js — ESM (Node >= 18)
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

// ===== Módulos
import chatRouter from "./nuevoModuloChat.js";
import iaPreopHandler from "./preopIA.js";        // ← PREOP IA
import generalesIAHandler from "./generalesIA.js"; // ← GENERALES IA
import traumaIAHandler from "./traumaIA.js";       // ← TRAUMA IA

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

// --- CORS actualizado (incluye icarticular.cl y alias www)
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // Postman/cURL
      if (FRONTENDS.includes(origin) || /\.vercel\.app$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error("CORS no permitido: " + origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
app.options("*", cors());

app.use(bodyParser.json());

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

// ===== Memoria simple (compartida)
const memoria = new Map();
app.set("memoria", memoria);

const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || "").replace(/[^a-zA-Z0-9_-]+/g, "_");

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
    const v = memoria.get(`${s}:${idPago}`);
    if (v) return { space: s, data: { ...v } };
  }
  return { space: null, data: null };
}

function buildExamenTextoStrict(rec = {}) {
  // Prioriza examenesIA[] si existe; si no, usa examen string; si no hay, vacío
  if (Array.isArray(rec.examenesIA) && rec.examenesIA.length > 0) {
    return rec.examenesIA.map(x => String(x || "").trim()).filter(Boolean).join("\n");
  }
  if (typeof rec.examen === "string" && rec.examen.trim()) {
    return rec.examen.trim();
  }
  return ""; // sin fallback
}

function buildNotaStrict(rec = {}) {
  // Prioriza nota; luego observaciones; luego informeIA; si nada, vacío
  if (typeof rec.nota === "string" && rec.nota.trim()) return rec.nota.trim();
  if (typeof rec.observaciones === "string" && rec.observaciones.trim()) return rec.observaciones.trim();
  if (typeof rec.informeIA === "string" && rec.informeIA.trim()) return rec.informeIA.trim();
  return "";
}

function contieneRM(texto = "") {
  const s = String(texto || "").toLowerCase();
  return s.includes("resonancia") || s.includes("resonancia magn") || /\brm\b/i.test(texto);
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
// ===============   PREVIEW (solo lectura)  ===========
// =====================================================

// Preview consistente con LO GUARDADO (requiere idPago). Sin fallback.
app.get("/sugerir-imagenologia", (req, res) => {
  try {
    const { idPago } = req.query || {};
    if (!idPago) return res.status(400).json({ ok: false, error: "Falta idPago" });

    const { data } = pickFromSpaces(memoria, idPago);
    if (!data) return res.status(404).json({ ok: false, error: "No hay datos" });

    const texto = buildExamenTextoStrict(data);
    const nota  = buildNotaStrict(data);

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

    if (!base) return res.status(404).json({ ok: false, error: "No hay datos" });

    const texto = buildExamenTextoStrict(base);
    const resonancia = contieneRM(texto);
    return res.json({ ok: true, resonancia, texto });
  } catch (e) {
    console.error("detectar-resonancia error:", e);
    return res.status(500).json({ ok: false, error: "No se pudo leer los datos" });
  }
});

// =====================================================
// ===============   TRAUMA (IMAGENOLOGÍA)  ============
// =====================================================

// Guardar (como ya lo tenías). Los módulos son los que definen los campos.
app.post("/guardar-datos", (req, res) => {
  const { idPago, datosPaciente } = req.body || {};
  if (!idPago || !datosPaciente)
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });

  memoria.set(ns("trauma", idPago), { ...datosPaciente, pagoConfirmado: true });
  res.json({ ok: true });
});

async function crearPagoHandler(req, res) {
  try {
    const { idPago, modoGuest, datosPaciente, modulo } = req.body || {};
    if (!idPago)
      return res.status(400).json({ ok: false, error: "Falta idPago" });

    const space =
      modulo === "preop" || String(idPago).startsWith("preop_")
        ? "preop"
        : modulo === "generales" || String(idPago).startsWith("generales_")
        ? "generales"
        : "trauma";

    // ======= MERGE NO DESTRUCTIVO (evita perder preview IA / checklist RM) =======
    if (datosPaciente) {
      const prev = memoria.get(ns(space, idPago)) || {};
      const incoming = datosPaciente || {};
      const next = { ...prev };

      for (const [k, v] of Object.entries(incoming)) {
        if (v === undefined) continue;                         // no pisar con undefined
        if (Array.isArray(v) && v.length === 0) continue;      // no pisar arrays no vacíos con vacíos
        if (typeof v === "string" && v.trim() === "") continue; // no pisar string con vacío
        next[k] = v;
      }

      // preservar campos críticos si incoming no aporta
      if (Array.isArray(prev.examenesIA) && (!Array.isArray(next.examenesIA) || next.examenesIA.length === 0)) {
        next.examenesIA = prev.examenesIA;
      }
      if (prev.diagnosticoIA && !next.diagnosticoIA) next.diagnosticoIA = prev.diagnosticoIA;
      if (prev.justificacionIA && !next.justificacionIA) next.justificacionIA = prev.justificacionIA;

      if (prev.rmForm && !next.rmForm) next.rmForm = prev.rmForm;
      if (prev.rmObservaciones && !next.rmObservaciones) next.rmObservaciones = prev.rmObservaciones;

      memoria.set(ns(space, idPago), next);
    }
    // ============================================================================

    memoria.set(ns("meta", idPago), { moduloAutorizado: space });

    if (modoGuest === true || KHIPU_MODE === "guest") {
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
      return_url: `${RETURN_BASE}?pago=ok&idPago=${encodeURIComponent(idPago)}&modulo=${space}`,
      cancel_url: `${RETURN_BASE}?pago=cancelado&idPago=${encodeURIComponent(idPago)}&modulo=${space}`,
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

app.get("/obtener-datos/:idPago", (req, res) => {
  const d = memoria.get(ns("trauma", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

// ===== PDF ORDEN (TRAUMA) — solo lee, sin fallback
app.get("/pdf/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "trauma") return res.sendStatus(402);

    // *** CAMBIO MÍNIMO: leer desde el mismo origen que usa el preview ***
    const { data: d } = pickFromSpaces(memoria, req.params.idPago);
    if (!d) return res.sendStatus(404);

    const generar = await loadOrdenImagenologia();

    const examen = buildExamenTextoStrict(d); // solo lo guardado
    const nota   = buildNotaStrict(d);        // solo lo guardado

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
  const {
    idPago,
    datosPaciente,
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
  const next = {
    ...prev,
    ...datosPaciente,
    comorbilidades: comorbilidades ?? prev.comorbilidades,
    tipoCirugia:   tipoCirugia   ?? prev.tipoCirugia,
    examenesIA:    Array.isArray(examenesIA) ? examenesIA : (prev.examenesIA || undefined),
    informeIA:     (typeof informeIA === "string" ? informeIA : prev.informeIA),
    nota:          (typeof nota === "string" ? nota : prev.nota),
    pagoConfirmado: true,
  };

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
  } catch (e) {
    console.error("pdf-preop/:idPago error:", e);
    res.sendStatus(500);
  }
});

// ← PREOP IA (y alias de compatibilidad)
app.post("/ia-preop", iaPreopHandler(memoria));
app.post("/preop-ia", iaPreopHandler(memoria));

// =====================================================
// ============   GENERALES (1 PDF)  ===================
// =====================================================

// IA de Generales
app.post("/ia-generales", generalesIAHandler(memoria));

// Guardar / obtener / PDF Generales (solo lectura)
app.post("/guardar-datos-generales", (req, res) => {
  const {
    idPago,
    datosPaciente,   // { nombre, rut, edad, genero, ... }
    comorbilidades,  // opcional
    examenesIA,      // opcional (array)
    informeIA,       // opcional (string)
    nota,            // opcional (string)
  } = req.body || {};

  if (!idPago || !datosPaciente)
    return res
      .status(400)
      .json({ ok: false, error: "Faltan idPago o datosPaciente" });

  const prev = memoria.get(ns("generales", idPago)) || {};
  const next = {
    ...prev,
    ...datosPaciente,
    comorbilidades: (typeof comorbilidades === "object" ? comorbilidades : prev.comorbilidades),
    examenesIA: Array.isArray(examenesIA) ? examenesIA : (prev.examenesIA || undefined),
    informeIA: typeof informeIA === "string" ? informeIA : (prev.informeIA || undefined),
    nota: typeof nota === "string" ? nota : (prev.nota || undefined),
    pagoConfirmado: true,
  };

  memoria.set(ns("generales", idPago), next);
  res.json({ ok: true });
});

app.get("/obtener-datos-generales/:idPago", (req, res) => {
  const d = memoria.get(ns("generales", req.params.idPago));
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

app.get("/pdf-generales/:idPago", async (req, res) => {
  try {
    const meta = memoria.get(ns("meta", req.params.idPago));
    if (!meta || meta.moduloAutorizado !== "generales") return res.sendStatus(402);

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
  } catch (e) {
    console.error("pdf-generales/:idPago error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// ============   ORDEN DESDE IA (solo lectura) ========
// =====================================================

// PDF IA (orden) — solo lee lo guardado por módulos IA/trauma/etc.
app.get("/api/pdf-ia-orden/:idPago", async (req, res) => {
  try {
    const id = req.params.idPago;
    const meta = memoria.get(ns("meta", id));
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(ns("ia", id));
    if (!d) return res.sendStatus(404);
    if (!d.pagoConfirmado) return res.sendStatus(402);

    const generar = await loadOrdenImagenologia();

    const examen = buildExamenTextoStrict(d); // solo lo guardado
    const nota   = buildNotaStrict(d);        // solo lo guardado

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
// =========   FORMULARIO RM (guardar / pdf)  ==========
// =====================================================

// Guardar FORMULARIO RM (solo si el caso contiene RM en exámenes)
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
      const v = memoria.get(`${s}:${idPago}`);
      if (v) { foundSpace = s; base = v; break; }
    }
    if (!base) {
      return res.status(404).json({ ok: false, error: "No hay datos base para ese idPago" });
    }

    // Debe contener RM en exámenes
    const texto = buildExamenTextoStrict(base);
    if (!contieneRM(texto)) {
      return res.status(409).json({ ok: false, error: "El caso no contiene Resonancia. No corresponde guardar formulario RM." });
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

    memoria.set(`${foundSpace}:${idPago}`, { ...base, ...patch });
    return res.json({ ok: true });
  } catch (e) {
    console.error("guardar-rm error:", e);
    return res.status(500).json({ ok: false, error: "No se pudo guardar formulario RM" });
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
      return res.status(404).json({ ok: false, error: "No corresponde formulario RM: los exámenes no incluyen Resonancia." });
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
      rmForm: d.rmForm || {},                                // ← lo guarda el front/módulo
      observaciones: d.rmObservaciones || d.observaciones || "",
    });

    doc.end();
  } catch (e) {
    console.error("pdf-rm error:", e);
    res.sendStatus(500);
  }
});

// =====================================================
// ============   TRAUMA IA (nuevo endpoint) ===========
// =====================================================

app.post("/ia-trauma", traumaIAHandler(memoria)); // existente
app.post("/ia/trauma", traumaIAHandler(memoria)); // alias legacy (para evitar 404)

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
