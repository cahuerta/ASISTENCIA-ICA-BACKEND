// nuevoModuloChat.js
import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import { generarInformeIA } from "./informeIA.js";
// ⬇️ Reusar tu generador de órdenes de imagenología (acepta varias líneas)
import { generarOrdenImagenologia } from "./ordenImagenologia.js";

const router = express.Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- Prompt y utilidades ---------- */
const SYSTEM_PROMPT_IA = `
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA BREVE centrada en EXÁMENES a solicitar.

Reglas:
- Español claro. Extensión total: máx. 140–170 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales (“podría sugerir”, “compatible con”).
- Prioriza IMAGENOLOGÍA. Si corresponde, sugiere ECOGRAFÍA en lesiones de partes blandas (frecuente en hombro/codo/mano).
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en los exámenes.
- Integra los PUNTOS DOLOROSOS DE RODILLA si existen (interlínea medial/lateral → orienta a menisco; dolor peripatela/patelofemoral → síndrome patelofemoral; tuberosidad tibial → Osgood/tendón rotuliano; pes anserino → tendinopatía/bursitis; banda iliotibial/Gerdy → síndrome banda ITB; fosa poplítea → quiste de Baker).
- La EXPLICACIÓN CLÍNICA debe referenciar explícitamente los puntos dolorosos cuando existan.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (1 entidad clínica probable específica a la zona)
• (2ª entidad diferencial, si procede)

Explicación breve:
• (≈60–100 palabras, 1–3 frases que justifiquen el enfoque y el porqué de los exámenes; referencia a los puntos dolorosos si existen)

Exámenes sugeridos:
• (EXAMEN 1 — incluir lateralidad si aplica)
• (EXAMEN 2 — complementario o alternativa razonable; incluir lateralidad si aplica)

Indicaciones:
• Presentarse con la orden; ayuno solo si el examen lo solicita.
• Acudir a evaluación presencial con el/la especialista sugerido/a.

Devuelve SOLO el texto en este formato (sin comentarios adicionales).
`.trim();

function recortar(str, max = 1200) {
  if (!str) return "";
  return str.length > max ? (str.slice(0, max).trim() + "…") : str;
}

// Lee datos previos del paciente desde la "memoria" del backend
function leerPacienteDeMemoria(memoria, idPago) {
  const spaces = ["ia", "trauma", "preop", "generales"];
  for (const s of spaces) {
    const v = memoria.get(`${s}:${idPago}`);
    if (v) return v;
  }
  return null;
}

/* --- Parser de “Exámenes sugeridos” (toma hasta 2) --- */
function parseExamenesSugeridos(text = "") {
  if (!text) return { all: [], firstTwo: [], rm: [], rx: [], eco: [], otros: [] };

  const sec =
    /Examen(?:es)? sugeridos?:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)/i.exec(text);
  if (!sec) return { all: [], firstTwo: [], rm: [], rx: [], eco: [], otros: [] };

  const bloque = sec[1] || "";
  const bullets = bloque
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[•\-\*]\s*(.+)$/.exec(l)?.[1] || l).trim())
    .map((l) => l.replace(/\s+/g, " ").replace(/\s*\.\s*$/, "."))
    .filter(Boolean);

  const firstTwo = bullets.slice(0, 2);

  const rm = [], rx = [], eco = [], otros = [];
  for (const b of firstTwo) {
    const l = b.toLowerCase();
    const isRM  = l.includes("resonancia") || /\brm\b/.test(l) || l.includes("resonancia magn");
    const isRX  = /\brx\b/.test(l) || l.includes("radiografía") || l.includes("rayos x") || l.includes("teleradiograf");
    const isECO = l.includes("ecografía") || l.includes("ecografia") || l.includes("ultrasonido") || /\beco\b/.test(l);
    if (isRM) rm.push(b);
    else if (isRX) rx.push(b);
    else if (isECO) eco.push(b);
    else otros.push(b);
  }

  return { all: bullets, firstTwo, rm, rx, eco, otros };
}

/* --- Helpers mínimos para la orden IA --- */
function notaAsistenciaIA(dolor = "") {
  const d = String(dolor || "").toLowerCase();
  const base = "Presentarse con esta orden. Ayuno NO requerido salvo indicación.";
  if (d.includes("rodilla")) return `${base}\nConsultar con nuestro especialista en rodilla Dr Jaime Espinoza.`;
  if (d.includes("cadera"))  return `${base}\nConsultar con nuestro especialista en cadera Dr Cristóbal Huerta.`;
  return base;
}

/* --- Fallback (hasta 2 exámenes) priorizando IA libre; se usa solo si falta JSON usable) --- */
function sugerirFallbackSegunClinica(dolor = "", lado = "", edad = null) {
  const d = String(dolor || "").toLowerCase();
  const L = String(lado || "").trim();
  const ladoTxt = L ? ` ${L.toUpperCase()}` : "";
  const edadNum = Number(edad);
  const joven = Number.isFinite(edadNum) ? edadNum < 40 : false;
  const mayor60 = Number.isFinite(edadNum) ? edadNum > 60 : false;

  if (d.includes("cervical")) return ["RESONANCIA MAGNÉTICA DE COLUMNA CERVICAL."];
  if (d.includes("dorsal"))   return ["RESONANCIA MAGNÉTICA DE COLUMNA DORSAL."];
  if (d.includes("lumbar") || d.includes("columna"))
    return ["RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR."];

  if (d.includes("rodilla")) {
    return mayor60
      ? [
          `RX DE RODILLA${ladoTxt} AP/LATERAL/AXIAL.`,
          `RM DE RODILLA${ladoTxt}.`,
        ]
      : [
          `RM DE RODILLA${ladoTxt}.`,
          `RX DE RODILLA${ladoTxt} AP/LATERAL.`,
        ];
  }

  if (d.includes("cadera")) {
    return mayor60
      ? [
          "RX DE PELVIS AP Y LÖWENSTEIN.",
          `RM DE CADERA${ladoTxt}.`,
        ]
      : [
          `RM DE CADERA${ladoTxt}.`,
          "RX DE PELVIS AP.",
        ];
  }

  if (d.includes("hombro")) {
    return joven
      ? [
          `ECOGRAFÍA DE HOMBRO${ladoTxt}.`,
          `RM DE HOMBRO${ladoTxt}.`,
        ]
      : [
          `RX DE HOMBRO${ladoTxt} AP/AXIAL.`,
          `RM DE HOMBRO${ladoTxt}.`,
        ];
  }

  if (d.includes("codo")) {
    return joven
      ? [
          `ECOGRAFÍA DE CODO${ladoTxt}.`,
          `RM DE CODO${ladoTxt}.`,
        ]
      : [
          `RX DE CODO${ladoTxt} AP/LATERAL.`,
          `RM DE CODO${ladoTxt}.`,
        ];
  }

  if (d.includes("muñeca") || d.includes("muneca") || d.includes("mano")) {
    return joven
      ? [
          `ECOGRAFÍA DE MANO/MUÑECA${ladoTxt}.`,
          `RM DE MUÑECA${ladoTxt}.`,
        ]
      : [
          `RX DE MANO/MUÑECA${ladoTxt} AP/OBLICUA/LATERAL.`,
          `RM DE MUÑECA${ladoTxt}.`,
        ];
  }

  if (d.includes("tobillo") || d.includes("pie")) {
    return [
      `RX DE TOBILLO/PIE${ladoTxt} AP/LATERAL/OBLICUA.`,
      `RM DE TOBILLO${ladoTxt}.`,
    ];
  }

  return ["Evaluación imagenológica según clínica.", "—"];
}

/* ====== NUEVO: helpers para incorporar puntos de rodilla ====== */

// Construye un bloque de texto legible para el prompt a partir de rodillaMarcadores
function rodillaPuntosTexto(rodillaMarcadores) {
  if (!rodillaMarcadores) return "Sin puntos dolorosos marcados.";
  const vista = (k) => Array.isArray(rodillaMarcadores[k]) ? rodillaMarcadores[k] : [];
  const bloques = [];
  const push = (titulo, arr) => {
    if (arr.length) {
      bloques.push(`${titulo}:\n• ${arr.join("\n• ")}`);
    }
  };
  push("Frente", vista("frente"));
  push("Lateral", vista("lateral"));
  push("Posterior", vista("posterior"));
  return bloques.length ? bloques.join("\n\n") : "Sin puntos dolorosos marcados.";
}

// Infiere tips clínicos muy breves (ayuda al modelo a mapear)
function tipsDesdePuntos(rodillaMarcadores) {
  if (!rodillaMarcadores) return [];
  const all = [
    ...(rodillaMarcadores.frente || []),
    ...(rodillaMarcadores.lateral || []),
    ...(rodillaMarcadores.posterior || []),
  ].map((s) => String(s || "").toLowerCase());

  const has = (rx) => all.some((t) => rx.test(t));
  const tips = [];
  if (has(/\binterl[ií]nea?\s+medial\b/)) tips.push("Interlínea medial → sospecha menisco medial.");
  if (has(/\binterl[ií]nea?\s+lateral\b/)) tips.push("Interlínea lateral → sospecha menisco lateral.");
  if (has(/\b(r[óo]tula|patelar|patelofemoral|ap(e|é)x)\b/)) tips.push("Dolor patelofemoral → considerar síndrome PF/condropatía.");
  if (has(/\btuberosidad\s+tibial\b/)) tips.push("Tuberosidad tibial → Osgood–Schlatter / tendón rotuliano.");
  if (has(/\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b/)) tips.push("Pes anserino → tendinopatía/bursitis anserina.");
  if (has(/\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b/)) tips.push("Banda iliotibial/Gerdy → síndrome banda ITB.");
  if (has(/\bpopl[ií]tea?\b/)) tips.push("Fosa poplítea → evaluar quiste de Baker.");
  return tips;
}

/* ===== Preview IA (antes de pagar) ===== */
router.post("/preview-informe", async (req, res) => {
  try {
    const { idPago, consulta, rodillaMarcadores: rodillaMarcadoresBody = null } = req.body || {};
    if (!consulta || !idPago) {
      return res.status(400).json({ ok: false, error: "Faltan datos obligatorios" });
    }

    const memoria = req.app.get("memoria");
    const prev = leerPacienteDeMemoria(memoria, idPago) || {};

    // Si ya había marcadores guardados en memoria (otra llamada previa), úsalos; si vienen en body, priorízalos
    const rodillaMarcadores = rodillaMarcadoresBody ?? prev?.rodillaMarcadores ?? null;

    const merged = {
      nombre:  req.body?.nombre  ?? prev?.nombre,
      edad:    req.body?.edad    ?? prev?.edad,
      rut:     req.body?.rut     ?? prev?.rut,
      genero:  req.body?.genero  ?? prev?.genero,
      dolor:   req.body?.dolor   ?? prev?.dolor,
      lado:    req.body?.lado    ?? prev?.lado,
      consulta,
      rodillaMarcadores,
    };

    const puntosTxt = rodillaPuntosTexto(rodillaMarcadores);
    const tips = tipsDesdePuntos(rodillaMarcadores);
    const tipsTxt = tips.length ? `\n\nTips clínicos (auto-generados):\n• ${tips.join("\n• ")}` : "";

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 520,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_IA },
        {
          role: "user",
          content:
            `Edad: ${merged.edad ?? "—"}\n` +
            (merged.genero ? `Género: ${merged.genero}\n` : "") +
            (merged.dolor ? `Región de dolor: ${merged.dolor}${merged.lado ? ` (${merged.lado})` : ""}\n` : "") +
            `Consulta/Indicación (texto libre):\n${merged.consulta}\n\n` +
            `Puntos dolorosos marcados (si aplica):\n${puntosTxt}${tipsTxt}\n\n` +
            `Redacta EXACTAMENTE con el formato solicitado y dentro del límite de palabras.`,
        },
      ],
    });

    const respuesta = recortar(completion.choices?.[0]?.message?.content || "", 1200);

    // Extrae y guarda HASTA 2 exámenes sugeridos (los dos primeros)
    const parsed = parseExamenesSugeridos(respuesta);

    memoria.set(`ia:${idPago}`, {
      ...prev,
      ...merged,
      respuesta,
      examenesIA: parsed.firstTwo, // ← arreglo (1–2)
      examenesIA_rm: parsed.rm,
      examenesIA_rx: parsed.rx,
      examenesIA_eco: parsed.eco,
      examenesIA_otros: parsed.otros,
      pagoConfirmado: false,
    });

    res.json({ ok: true, respuesta });
  } catch (err) {
    console.error("Error GPT (preview-informe):", err);
    res.status(500).json({ ok: false, error: "Error al generar preview" });
  }
});

/* ===== Guardar datos IA tras pago confirmado ===== */
router.post("/guardar-datos-ia", (req, res) => {
  const { idPago } = req.body || {};
  if (!idPago) return res.status(400).json({ ok: false, error: "Falta idPago" });

  const memoria = req.app.get("memoria");
  const d = memoria.get(`ia:${idPago}`);
  if (!d) return res.status(404).json({ ok: false, error: "No hay datos previos" });

  memoria.set(`ia:${idPago}`, { ...d, pagoConfirmado: true });
  memoria.set(`meta:${idPago}`, { moduloAutorizado: "ia" });

  res.json({ ok: true });
});

/* ===== Obtener datos IA (para frontend) ===== */
router.get("/obtener-datos-ia/:idPago", (req, res) => {
  const memoria = req.app.get("memoria");
  const d = memoria.get(`ia:${req.params.idPago}`);
  if (!d) return res.status(404).json({ ok: false });
  res.json({ ok: true, datos: d });
});

/* ===== PDF IA (informe de texto) ===== */
router.get("/pdf-ia/:idPago", (req, res) => {
  try {
    const memoria = req.app.get("memoria");
    const meta = memoria.get(`meta:${req.params.idPago}`);
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(`ia:${req.params.idPago}`);
    if (!d) return res.sendStatus(404);
    if (!d.pagoConfirmado) return res.sendStatus(402);

    const filename = `informeIA_${req.params.idPago}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    generarInformeIA(doc, d);
    doc.end();
  } catch (err) {
    console.error("pdf-ia error:", err);
    res.sendStatus(500);
  }
});

/* ===== PDF IA (Orden de Exámenes) — HASTA 2 EXÁMENES ===== */
router.get("/pdf-ia-orden/:idPago", async (req, res) => {
  try {
    const memoria = req.app.get("memoria");
    const meta = memoria.get(`meta:${req.params.idPago}`);
    if (!meta || meta.moduloAutorizado !== "ia") return res.sendStatus(402);

    const d = memoria.get(`ia:${req.params.idPago}`);
    if (!d) return res.sendStatus(404);
    if (!d.pagoConfirmado) return res.sendStatus(402);

    const lineas =
      Array.isArray(d.examenesIA) && d.examenesIA.length > 0
        ? d.examenesIA.slice(0, 2)
        : sugerirFallbackSegunClinica(d.dolor, d.lado, d.edad).slice(0, 2);

    const examenStr = lineas.filter(Boolean).join("\n"); // varias líneas si hay 2
    const nota = notaAsistenciaIA(d.dolor);

    const filename = `ordenIA_${req.params.idPago}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    generarOrdenImagenologia(doc, {
      ...d,
      examen: examenStr,
      nota,
    });

    doc.end();
  } catch (err) {
    console.error("pdf-ia-orden error:", err);
    res.sendStatus(500);
  }
});

export default router;
