// traumaIA.js — IA para módulo TRAUMA (imagenología)
// ESM (Node >= 18).
// Usa OpenAI si hay API key; si no, cae a heurística local solo si el JSON falla.

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ---- Utilidades ---- */
function normalizarExamenes(dolor = "", lado = "", lista = []) {
  const L = (lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const arr = (Array.isArray(lista) ? lista : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  if (!arr.length) return [];

  let x = arr[0].toUpperCase();

  // Estandarizar ECO "partes blandas"
  if (/ECOGRAF[ÍI]A.*PARTES\s+BLANDAS/.test(x)) {
    if (!/\bDE\b/.test(x)) {
      const zona = (dolor || "").toUpperCase();
      if (zona && !/COLUMNA/i.test(zona)) {
        x = `ECOGRAFÍA DE PARTES BLANDAS DE ${zona}${lat}`.trim();
      }
    }
  }

  // Añadir lateralidad cuando aplica
  if (
    /(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE|COLUMNA)\b/.test(x) &&
    lat &&
    !/\b(IZQUIERDA|DERECHA)\b/.test(x)
  ) {
    x = x.replace(/\.$/, "") + lat;
  }

  if (!x.endsWith(".")) x += ".";
  return [x];
}

/* ---- Fallback específico por zona (solo si IA falla) ---- */
function fallbackHeuristico(p = {}) {
  const d = String(p.dolor || "").toLowerCase();
  const L = (p.lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const mayor60 = Number(p.edad) > 60;

  let examen = "";
  let dx = ""; // diagnóstico presuntivo zona-específico

  if (d.includes("rodilla")) {
    dx = `Gonalgia${lat ? ` ${L.toLowerCase()}` : ""}`;
    examen = mayor60
      ? `RX DE RODILLA${lat} AP/LATERAL/AXIAL.`
      : `RESONANCIA MAGNÉTICA DE RODILLA${lat}.`;
  } else if (d.includes("cadera")) {
    dx = "Coxalgia";
    examen = mayor60
      ? `RX DE PELVIS AP Y LÖWENSTEIN.`
      : `RESONANCIA MAGNÉTICA DE CADERA${lat}.`;
  } else if (d.includes("cervical")) {
    dx = "Cervicalgia";
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA CERVICAL.`;
  } else if (d.includes("dorsal")) {
    dx = "Dorsalgia";
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA DORSAL.`;
  } else if (d.includes("lumbar") || d.includes("columna")) {
    dx = "Lumbalgia mecánica";
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR.`;
  } else if (d.includes("hombro")) {
    dx = `Omalgia — tendinopatía del manguito rotador${lat ? ` ${L.toLowerCase()}` : ""}`;
    examen = mayor60
      ? `RX DE HOMBRO${lat} AP/AXIAL.`
      : `ECOGRAFÍA DE PARTES BLANDAS DE HOMBRO${lat}.`;
  } else if (d.includes("codo")) {
    dx = `Epicondilalgia probable${lat ? ` ${L.toLowerCase()}` : ""}`;
    examen = mayor60
      ? `RX DE CODO${lat} AP/LATERAL.`
      : `ECOGRAFÍA DE PARTES BLANDAS DE CODO${lat}.`;
  } else if (d.includes("muñeca") || d.includes("muneca") || d.includes("mano")) {
    dx = `Tenosinovitis/tendinopatía de muñeca/mano${lat ? ` ${L.toLowerCase()}` : ""}`;
    examen = mayor60
      ? `RX DE MANO/MUÑECA${lat} AP/OBLICUA/LATERAL.`
      : `ECOGRAFÍA DE PARTES BLANDAS DE MANO/MUÑECA${lat}.`;
  } else if (d.includes("tobillo") || d.includes("pie")) {
    dx = `Esguince de tobillo/pie${lat ? ` ${L.toLowerCase()}` : ""}`;
    examen = mayor60
      ? `RX DE TOBILLO/PIE${lat} AP/LATERAL/OBLICUA.`
      : `RESONANCIA MAGNÉTICA DE TOBILLO${lat}.`;
  } else {
    dx = "Dolor osteoarticular localizado";
    examen = `EVALUACIÓN IMAGENOLÓGICA SEGÚN CLÍNICA.`;
  }

  return {
    diagnostico: dx,
    explicacion:
      "Se sugiere estudio inicial dirigido a la región comprometida para descartar compromiso óseo, articular o de partes blandas. La elección prioriza rendimiento diagnóstico y seguridad según edad y sospecha clínica. El resultado orientará conducta y necesidad de exámenes complementarios.",
    examenes: [examen],
  };
}

/* ---- Prompt a la IA (más libre, pero con reglas de especificidad) ---- */
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
    "Responde SIEMPRE en JSON válido, sin texto adicional.",
    // Diagnóstico presuntivo específico por zona
    "Evita diagnósticos genéricos como 'dolor musculoesquelético'.",
    "Usa etiquetas por región cuando corresponda: cervicalgia, dorsalgia, lumbalgia, gonalgia, coxalgia, omalgia, epicondilalgia, tenosinovitis, esguince de tobillo, etc.",
    "El diagnóstico presuntivo debe ser breve (3–8 palabras) y, si aplica, incluir lateralidad textual (derecha/izquierda).",
    // Examen único y estandarizado
    "Sugiere EXACTAMENTE 1 examen imagenológico inicial, en MAYÚSCULAS y estandarizado.",
    "Incluye lateralidad IZQUIERDA/DERECHA si aplica (cadera, rodilla, hombro, codo, mano/muñeca, tobillo/pie).",
    "En HOMBRO, CODO y MANO/MUÑECA de pacientes jóvenes, prioriza ECOGRAFÍA DE PARTES BLANDAS.",
    "En COLUMNA especifica CERVICAL, DORSAL o LUMBAR según la región de dolor declarada.",
  ].join(" ");

  const instrucciones = `
Paciente:
${JSON.stringify(info, null, 2)}

Devuelve SOLO el siguiente JSON:

{
  "diagnostico_presuntivo": "una línea breve y específica (3–8 palabras)",
  "explicacion_50_palabras": "40–60 palabras en español, sin viñetas",
  "examen_imagenologico": ["UN SOLO EXAMEN, EN MAYÚSCULAS"]
}
  `.trim();

  return [
    { role: "system", content: system },
    { role: "user", content: instrucciones },
  ];
}

/* ---- Llamada a la IA ---- */
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

/* ---- Handler ---- */
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

        const diagnostico = String(ia?.diagnostico_presuntivo || "").trim();
        const explicacion = String(ia?.explicacion_50_palabras || "").trim();
        let examenes = Array.isArray(ia?.examen_imagenologico)
          ? ia.examen_imagenologico
          : [];

        examenes = normalizarExamenes(p?.dolor, p?.lado, examenes);

        // Solo usamos fallback si la IA no trajo diagnóstico o examen
        if (!diagnostico || !examenes.length) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico, explicacion, examenes };
        }
      } catch {
        out = fallbackHeuristico(p);
      }

      // Persistimos para el PDF de orden
      const registro = {
        ...p,
        examenesIA: out.examenes,
        respuesta: `Diagnóstico presuntivo: ${out.diagnostico}\n\n${out.explicacion}`,
        pagoConfirmado: true,
      };
      memoria.set(ns("ia", idPago), registro);
      memoria.set(ns("meta", idPago), { moduloAutorizado: "ia" });

      return res.json({
        ok: true,
        diagnostico: out.diagnostico,
        informeIA: out.explicacion,
        examenes: out.examenes,
      });
    } catch (e) {
      console.error("ia-trauma error:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
