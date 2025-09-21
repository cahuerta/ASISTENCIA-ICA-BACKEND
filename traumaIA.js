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
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .map((x) => x.toUpperCase());

  // Derivar zona a partir del "dolor"
  const zona = (() => {
    const d = String(dolor || "").toLowerCase();
    if (d.includes("hombro")) return "HOMBRO";
    if (d.includes("codo")) return "CODO";
    if (d.includes("muñeca") || d.includes("muneca")) return "MUÑECA";
    if (d.includes("mano")) return "MANO";
    if (d.includes("tobillo")) return "TOBILLO";
    if (d.includes("pie")) return "PIE";
    if (d.includes("rodilla")) return "RODILLA";
    if (d.includes("cadera")) return "CADERA";
    if (d.includes("columna")) return "COLUMNA LUMBAR";
    return "";
  })();

  const out = [];

  for (let x of arr) {
    if (/ECOGRAF[ÍI]A(\s+DE)?\s+PARTES\s+BLANDAS\b/.test(x)) {
      if (zona && zona !== "COLUMNA LUMBAR") {
        const ecoPB = `ECOGRAFÍA DE PARTES BLANDAS DE ${zona}${lat}.`;
        out.push(ecoPB);
      } else {
        out.push(x.replace(/\.$/, "") + ".");
      }
    } else if (
      /(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE)\b/.test(x) &&
      !/\b(IZQUIERDA|DERECHA)\b/.test(x) &&
      lat
    ) {
      out.push(x.replace(/\.$/, "") + lat + ".");
    } else {
      out.push(x.endsWith(".") ? x : `${x}.`);
    }
    if (out.length === 1) break; // limitar a 1
  }

  return out.slice(0, 1);
}

function fallbackHeuristico(p = {}) {
  const d = String(p.dolor || "").toLowerCase();
  const L = (p.lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const mayor60 = Number(p.edad) > 60;

  let examen = "";

  if (d.includes("rodilla")) {
    examen = mayor60
      ? `RX DE RODILLA${lat} AP/LATERAL/AXIAL.`
      : `RESONANCIA MAGNÉTICA DE RODILLA${lat}.`;
  } else if (d.includes("cadera")) {
    examen = mayor60
      ? `RX DE PELVIS AP Y LÖWENSTEIN.`
      : `RESONANCIA MAGNÉTICA DE CADERA${lat}.`;
  } else if (d.includes("columna")) {
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR.`;
  } 
  // === Ajustado: hombro / codo / mano → ECOGRAFÍA primero ===
  else if (d.includes("hombro")) {
    examen = `ECOGRAFÍA DE PARTES BLANDAS DE HOMBRO${lat}.`;
  } else if (d.includes("codo")) {
    examen = `ECOGRAFÍA DE PARTES BLANDAS DE CODO${lat}.`;
  } else if (d.includes("mano") || d.includes("muñeca") || d.includes("muneca")) {
    examen = `ECOGRAFÍA DE PARTES BLANDAS DE MUÑECA/MANO${lat}.`;
  } else if (d.includes("tobillo") || d.includes("pie")) {
    examen = mayor60
      ? `RX DE TOBILLO/PIE${lat} AP/LATERAL/OBLICUA.`
      : `RESONANCIA MAGNÉTICA DE TOBILLO${lat}.`;
  } else {
    examen = `EVALUACIÓN IMAGENOLÓGICA SEGÚN CLÍNICA.`;
  }

  return {
    diagnostico: "Dolor musculoesquelético, estudio inicial.",
    justificacion:
      "Se indica estudio inicial según la localización y el contexto clínico para descartar patología ósea, articular y de partes blandas. La elección prioriza rendimiento diagnóstico y seguridad del paciente, considerando edad, mecanismo, examen físico y evolución de los síntomas.",
    examenes: [examen],
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
2) "explicacion_50_palabras": 40–60 palabras en español, sin viñetas.
3) "examen_imagenologico": ARREGLO con EXACTAMENTE 1 examen de imagen (MAYÚSCULAS). Incluye lateralidad si corresponde (IZQUIERDA/DERECHA).

Entrada (paciente):
${JSON.stringify(info, null, 2)}

Salida (JSON estrictamente):
{
  "diagnostico_presuntivo": "texto",
  "explicacion_50_palabras": "texto",
  "examen_imagenologico": ["EXAMEN ÚNICO"]
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

      let out;
      try {
        const mensajes = construirMensajesIA(p);
        const ia = await llamarIA(mensajes);

        // parsing más tolerante
        const diagnostico = String(
          ia?.diagnostico_presuntivo || ia?.diagnóstico_presuntivo || ia?.diagnostico || ia?.diagnóstico || ""
        ).trim() || "Dolor musculoesquelético, estudio inicial.";

        const expl = String(
          ia?.explicacion_50_palabras || ia?.justificacion_100_palabras || ia?.justificacion || ""
        ).trim();

        let examenes = Array.isArray(ia?.examen_imagenologico)
          ? ia.examen_imagenologico
          : Array.isArray(ia?.examenes_imagenologicos)
          ? ia.examenes_imagenologicos
          : Array.isArray(ia?.examenes)
          ? ia.examenes
          : [];

        examenes = normalizarExamenes(p?.dolor, p?.lado, examenes);

        // validación más flexible
        if (examenes.length < 1 || expl.length < 25) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico, justificacion: expl, examenes };
        }
      } catch {
        out = fallbackHeuristico(p);
      }

      const registro = {
        ...p,
        examenesIA: out.examenes,
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
