// caseRouter.js — Router único para pago/pdf/reset
import express from "express";
import PDFDocument from "pdfkit";

/* ====== Config mínima desde ENV ====== */
const RETURN_BASE = process.env.RETURN_BASE || process.env.FRONTEND_BASE || "https://icarticular.cl";
const _ENV = (process.env.KHIPU_ENV || "integration").toLowerCase();
const KHIPU_MODE =
  _ENV === "guest" ? "guest" :
  (_ENV === "prod" || _ENV === "production") ? "production" : "integration";

const KHIPU_API_BASE = "https://payment-api.khipu.com";
const KHIPU_API_KEY  = process.env.KHIPU_API_KEY || "";
const KHIPU_AMOUNT   = Number(process.env.KHIPU_AMOUNT || 1000);
const KHIPU_SUBJECT  = process.env.KHIPU_SUBJECT || "Orden médica ICA";
const CURRENCY       = "CLP";

/* ====== Utils ====== */
const ns = (s, id) => `${s}:${id}`;
const sanitize = (t) => String(t || "").replace(/[^a-zA-Z0-9_-]+/g, "_");
const normRut = (s="") => String(s).replace(/[^0-9kK]/g,"").toUpperCase();
const getBackendBase = (req) => `${req.protocol}://${req.get("host")}`;
const getCase = (memoria, space, id) => memoria.get?.(ns(space, id)) || null;

function mergeNoDestructivo(prev = {}, incoming = {}) {
  const next = { ...prev };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    next[k] = v;
  }
  // preservar campos críticos
  if (Array.isArray(prev.examenesIA) && (!Array.isArray(next.examenesIA) || next.examenesIA.length === 0)) {
    next.examenesIA = prev.examenesIA;
  }
  if (prev.diagnosticoIA && !next.diagnosticoIA) next.diagnosticoIA = prev.diagnosticoIA;
  if (prev.justificacionIA && !next.justificacionIA) next.justificacionIA = prev.justificacionIA;
  if (prev.rmForm && !next.rmForm) next.rmForm = prev.rmForm;
  if (prev.rmObservaciones && !next.rmObservaciones) next.rmObservaciones = prev.rmObservaciones;
  return next;
}

function limpiarCaso(memoria, id) {
  const spaces = ["ia","trauma","preop","generales","meta"];
  let removed = 0;
  for (const s of spaces) removed += memoria.delete(ns(s, id)) ? 1 : 0;
  return removed;
}

/* ====== Lazy loaders de generadores PDF ====== */
let _genTrauma = null;
async function loadOrdenImagenologia(){ if(_genTrauma) return _genTrauma; const m = await import("./ordenImagenologia.js"); _genTrauma = m.generarOrdenImagenologia; return _genTrauma; }
let _genPreopLab=null,_genPreopOd=null;
async function loadPreop(){ if(!_genPreopLab){const m=await import("./preopOrdenLab.js"); _genPreopLab=m.generarOrdenPreopLab;} if(!_genPreopOd){const m=await import("./preopOdonto.js"); _genPreopOd=m.generarPreopOdonto;} return {_genPreopLab,_genPreopOd}; }
let _genGenerales=null;
async function loadGenerales(){ if(_genGenerales) return _genGenerales; const m=await import("./generalesOrden.js"); _genGenerales=m.generarOrdenGenerales; return _genGenerales; }
let _genRM=null;
async function loadFormularioRM(){ if(_genRM) return _genRM; const m = await import("./resonanciaFormularioPDF.js"); _genRM = m.generarFormularioResonancia; return _genRM; }

/* ====== Texto para PDF (reuse de tus helpers) ====== */
function buildExamenTextoStrict(rec={}) {
  if (Array.isArray(rec.examenesIA) && rec.examenesIA.length > 0) {
    return rec.examenesIA.map(x => String(x||"").trim()).filter(Boolean).join("\n");
  }
  if (typeof rec.examen === "string" && rec.examen.trim()) return rec.examen.trim();
  return "";
}
function buildNotaStrict(rec={}) {
  if (typeof rec.nota === "string" && rec.nota.trim()) return rec.nota.trim();
  if (typeof rec.observaciones === "string" && rec.observaciones.trim()) return rec.observaciones.trim();
  if (typeof rec.informeIA === "string" && rec.informeIA.trim()) return rec.informeIA.trim();
  return "";
}
function contieneRM(texto=""){ const s=String(texto||"").toLowerCase(); return s.includes("resonancia") || s.includes("resonancia magn") || /\brm\b/i.test(texto); }

/* ====== Router ====== */
export default function caseRouter(app){
  const router = express.Router();
  const memoria = app.get("memoria");

  // PAGO (central, incluye guest)
  router.post("/pay", async (req, res) => {
    try {
      const { idPago, modulo, datosPaciente, modoGuest } = req.body || {};
      if (!idPago) return res.status(400).json({ ok:false, error:"Falta idPago" });

      const space = (modulo || "").toLowerCase() === "preop" ? "preop"
                   : (modulo || "").toLowerCase() === "generales" ? "generales"
                   : (modulo || "").toLowerCase() === "ia" ? "ia"
                   : "trauma";

      // merge data
      if (datosPaciente) {
        const prev = getCase(memoria, space, idPago) || {};
        const next = mergeNoDestructivo(prev, datosPaciente);
        memoria.set(ns(space, idPago), next);
      }
      memoria.set(ns("meta", idPago), { moduloAutorizado: space });

      // GUEST flow
      if (modoGuest === true || KHIPU_MODE === "guest") {
        if (space === "ia") { // IA exige pagoConfirmado para su PDF
          const prev = getCase(memoria, space, idPago) || {};
          memoria.set(ns(space, idPago), { ...prev, pagoConfirmado: true });
        }
        const url = new URL(RETURN_BASE);
        url.searchParams.set("pago","ok");
        url.searchParams.set("idPago", idPago);
        url.searchParams.set("modulo", space);
        return res.json({ ok:true, url: url.toString(), guest:true });
      }

      // REAL Khipu
      if (!KHIPU_API_KEY) return res.status(500).json({ ok:false, error:"Falta KHIPU_API_KEY" });

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
        headers: { "content-type":"application/json", "x-api-key": KHIPU_API_KEY },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(()=> ({}));
      if (!r.ok) {
        const msg = j?.message || `Error Khipu (${r.status})`;
        return res.status(502).json({ ok:false, error: msg, detail: j || null });
      }
      const urlPago = j?.payment_url || j?.simplified_transfer_url || j?.url;
      if (!urlPago) return res.status(502).json({ ok:false, error:"Khipu no entregó payment_url", detail:j });

      return res.json({ ok:true, url: urlPago });
    } catch (e) {
      console.error("/case/pay error:", e);
      return res.status(500).json({ ok:false, error:e.message });
    }
  });

  // PDF unificado (con reset opcional)
  router.get("/pdf/:idPago", async (req, res) => {
    try {
      const id = req.params.idPago;
      const modulo = String(req.query.modulo || "").toLowerCase();
      const reset = String(req.query.reset || "0") === "1";

      const meta = memoria.get(ns("meta", id));
      const space = modulo || meta?.moduloAutorizado;
      if (!space) return res.status(400).json({ ok:false, error:"Falta modulo" });
      if (!meta || meta.moduloAutorizado !== space) return res.sendStatus(402);

      let d = getCase(memoria, space, id);
      if (!d) return res.sendStatus(404);

      // IA exige pago confirmado
      if (space === "ia" && !d.pagoConfirmado) return res.sendStatus(402);

      let generar, filename, writer;
      const rut = normRut(d.rut || d.RUT || d.RUN || "");
      const basePDF = () => {
        const doc = new PDFDocument({ size:"A4", margin:50 });
        doc.pipe(res);
        return doc;
      };

      // Config por módulo
      if (space === "trauma") {
        generar = await loadOrdenImagenologia();
        const datos = { ...d, examen: buildExamenTextoStrict(d), nota: buildNotaStrict(d), rut };
        filename = `orden_${sanitize(d.nombre || "paciente")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        writer = basePDF(); generar(writer, datos); writer.end();
      } else if (space === "preop") {
        const { _genPreopLab, _genPreopOd } = await loadPreop();
        filename = `preop_${sanitize(d.nombre || "paciente")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        writer = basePDF(); _genPreopLab(writer, { ...d, rut }); writer.addPage(); _genPreopOd(writer, { ...d, rut }); writer.end();
      } else if (space === "generales") {
        generar = await loadGenerales();
        filename = `generales_${sanitize(d.nombre || "paciente")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        writer = basePDF(); generar(writer, { ...d, rut }); writer.end();
      } else if (space === "ia") {
        generar = await loadOrdenImagenologia();
        const datos = { ...d, examen: buildExamenTextoStrict(d), nota: buildNotaStrict(d), rut };
        filename = `ordenIA_${sanitize(d.nombre || "paciente")}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        writer = basePDF(); generar(writer, datos); writer.end();
      } else {
        return res.status(400).json({ ok:false, error:"Módulo inválido" });
      }

      if (reset) {
        res.on("finish", () => {
          try { limpiarCaso(memoria, id); } catch (e) { console.warn("reset post-PDF falló:", e); }
        });
      }
    } catch (e) {
      console.error("/case/pdf error:", e);
      res.sendStatus(500);
    }
  });

  // RESET unificado
  router.delete("/:idPago", (req,res) => {
    try {
      const id = req.params.idPago;
      if (!id) return res.status(400).json({ ok:false, error:"Falta idPago" });
      const meta = memoria.get(ns("meta", id));
      if (!meta) return res.status(404).json({ ok:false, error:"Caso no encontrado o no autorizado" });
      const removed = limpiarCaso(memoria, id);
      return res.json({ ok:true, removed });
    } catch (e) {
      console.error("/case delete error:", e);
      return res.status(500).json({ ok:false, error:"No se pudo limpiar el caso" });
    }
  });

  return router;
}
