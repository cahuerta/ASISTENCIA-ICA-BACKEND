// traumaIA.js — IA para módulo TRAUMA (imagenología)
// ESM (Node >= 18). Compatible con memoria Map compartida desde index.js.
// Usa OpenAI si hay API key; si no, cae a heurística local.

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ---- Utilidades ---- */
function normalizarExamenes(dolor = "", lado = "", lista = []) {
  const L = (lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const arr = (Array.isArray(lista) ? lista : [])
    .map(x => String(x || "").trim())
    .filter(Boolean)
    .map(x => x.toUpperCase());

  return arr.map(x => {
    // añade lateralidad si aplica y no viene
    if (
      /(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE)/i.test(x) &&
      !/\b(IZQUIERDA|DERECHA)\b/i.test(x)
    ) {
      return x.replace(/\.$/, "") + lat + ".";
    }
    return x;
  }).slice(0, 2);
}

function fallbackHeuristico(p = {}) {
  const d = String(p.dolor || "").toLowerCase();
  const L = (p.lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const mayor60 = Number(p.edad) > 60;

  let examenes = [];
  if (d.includes("rodilla")) {
    examenes = mayor60
      ? [`RX DE RODILLA${lat} AP/LATERAL/AXIAL.`, "TELERADIOGRAFÍA DE EEII."]
      : [`RESONANCIA MAGNÉTICA DE RODILLA${lat}.`, "TELERADIOGRAFÍA DE EEII."];
  } else if (d.includes("cadera")) {
    examenes = mayor60
      ? ["RX DE PELVIS AP Y LÖWENSTEIN."]
      : [`RESONANCIA MAGNÉTICA DE CADERA${lat}.`];
  } else if (d.includes("columna")) {
    examenes = ["RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR.", "RX COLUMNA LUMBOSACRA AP/LAT."];
  } else {
    examenes = ["EVALUACIÓN IMAGENOLÓGICA SEGÚN CLÍNICA.", "RX SEGÚN PROTOCOLO."];
  }

  return {
    diagnostico: "Dolor musculoesquelético, estudio inicial.",
    justificacion:
      "Se propone estudio inicial acorde a la localización y edad para descartar patología ósea, articular y de partes blandas. La radiografía orienta en degeneración y lesiones óseas; la resonancia aporta evaluación intraarticular y de tejidos blandos cuando se sospechan lesiones internas. La selección definitiva considera anamnesis, examen físico y evolución de síntomas para optimizar rendimiento diagnóstico y seguridad del paciente.",
    examenes,
  };
}

function construirMensajesIA(p) {
  const info = {
    nombre: p?.nombre || "",
    rut: p?.rut || "",
    edad: p?.edad || "",
    genero: p?.genero || "",
    dolor: p?.dolor || "",
    lado: p?.lado || "",
    detalles: p?.detalles || null,
  };

  const system = [
    "Eres un asistente clínico de traumatología e imagenología.",
    "Devuelve SIEMPRE JSON estricto (sin texto extra).",
  ].join(" ");

  const instrucciones = `
Dado el siguiente paciente, responde con:
1) "diagnostico_presuntivo": una línea.
2) "justificacion_100_palabras": ~100 palabras (90–120), español, sin viñetas.
3) "examenes_imagenologicos": ARREGLO con EXACTAMENTE 2 exámenes de imagen. Usa mayúsculas, incluye lateralidad si corresponde (IZQUIERDA/DERECHA).

Entrada (paciente):
${JSON.stringify(info, null, 2)}

Salida (JSON estrictamente):
{
  "diagnostico_presuntivo": "texto",
  "justificacion_100_palabras": "texto",
  "examenes_imagenologicos": ["EXAMEN 1", "EXAMEN 2"]
}
`.trim();

  return [
    { role: "system", content: system },
    { role: "user", content: instrucciones },
  ];
}

async function llamarIA(mensajes) {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("OPENAI_API_KEY no configurada");

  const r = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages,
      response_format: { type: "json_object" },
    }),
  });

  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    throw new Error(`OpenAI ${r.status}: ${raw}`);
  }
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt);
}

/* ---- Handler factory ---- */
export default function traumaIAHandler(memoria) {
  const ns = (s, id) => `${s}:${id}`;

  return async (req, res) => {
    try {
      const { idPago, paciente = {}, detalles = null } = req.body || {};
      if (!idPago) return res.status(400).json({ ok: false, error: "Falta idPago" });

      const p = { ...paciente, detalles };

      // Llamada IA con fallback
      let out;
      try {
        const mensajes = construirMensajesIA(p);
        const ia = await llamarIA(mensajes);

        const diagnostico = String(ia?.diagnostico_presuntivo || "").trim();
        const justificacion = String(ia?.justificacion_100_palabras || "").trim();
        let examenes = Array.isArray(ia?.examenes_imagenologicos)
          ? ia.examenes_imagenologicos
          : [];

        examenes = normalizarExamenes(p?.dolor, p?.lado, examenes);

        if (examenes.length !== 2 || !diagnostico || justificacion.length < 60) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico, justificacion, examenes };
        }
      } catch {
        out = fallbackHeuristico(p);
      }

      // Persistir en memoria para reutilizar /api/pdf-ia-orden/:idPago
      const registro = {
        ...p,
        examenesIA: out.examenes,
        // 'respuesta' es usada por tu generador de PDF IA para extraer nota si aplica
        respuesta: `Diagnóstico presuntivo: ${out.diagnostico}\n\n${out.justificacion}`,
        pagoConfirmado: true,
      };
      memoria.set(ns("ia", idPago), registro);
      memoria.set(ns("meta", idPago), { moduloAutorizado: "ia" });

      return res.json({
        ok: true,
        diagnostico: out.diagnostico,
        informeIA: out.justificacion,
        examenes: out.examenes,
      });
    } catch (e) {
      console.error("ia-trauma error:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
