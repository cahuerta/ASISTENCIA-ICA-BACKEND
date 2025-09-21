// traumaIA.js — IA para módulo TRAUMA (imagenología)
// ESM (Node >= 18).
// Usa OpenAI si hay API key; si no, cae a heurística local solo en caso de error/JSON inválido.

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

  // Estándar: ECOGRAFÍA DE PARTES BLANDAS
  if (/ECOGRAF[ÍI]A.*PARTES\s+BLANDAS/.test(x)) {
    if (!/DE/.test(x)) {
      const zona = (dolor || "").toUpperCase();
      x = `ECOGRAFÍA DE PARTES BLANDAS DE ${zona}${lat}`.trim();
    }
  }

  // Asegurar lateralidad si aplica
  if (
    /(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE|COLUMNA)/.test(x) &&
    lat &&
    !/\b(IZQUIERDA|DERECHA)\b/.test(x)
  ) {
    x = x.replace(/\.$/, "") + lat;
  }

  if (!x.endsWith(".")) x += ".";

  return [x];
}

/* ---- Fallback heurístico (solo si IA falla) ---- */
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
  } else if (d.includes("cervical")) {
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA CERVICAL.`;
  } else if (d.includes("dorsal")) {
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA DORSAL.`;
  } else if (d.includes("lumbar")) {
    examen = `RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR.`;
  } else if (d.includes("hombro")) {
    examen = mayor60
      ? `RX DE HOMBRO${lat} AP/AXIAL.`
      : `ECOGRAFÍA DE PARTES BLANDAS DE HOMBRO${lat}.`;
  } else if (d.includes("codo")) {
    examen = mayor60
      ? `RX DE CODO${lat} AP/LATERAL.`
      : `ECOGRAFÍA DE PARTES BLANDAS DE CODO${lat}.`;
  } else if (d.includes("mano") || d.includes("muñeca") || d.includes("muneca")) {
    examen = mayor60
      ? `RX DE MANO/MUÑECA${lat} AP/OBLICUA/LATERAL.`
      : `ECOGRAFÍA DE PARTES BLANDAS DE MANO/MUÑECA${lat}.`;
  } else if (d.includes("tobillo") || d.includes("pie")) {
    examen = mayor60
      ? `RX DE TOBILLO/PIE${lat} AP/LATERAL/OBLICUA.`
      : `RESONANCIA MAGNÉTICA DE TOBILLO${lat}.`;
  } else {
    examen = `EVALUACIÓN IMAGENOLÓGICA SEGÚN CLÍNICA.`;
  }

  return {
    diagnostico: "Dolor musculoesquelético, estudio inicial.",
    explicacion:
      "Se indica estudio inicial según localización y edad del paciente. El objetivo es descartar lesiones óseas, articulares o de partes blandas. El resultado orientará el manejo y la necesidad de estudios complementarios.",
    examenes: [examen],
  };
}

/* ---- Construcción del prompt ---- */
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
    "Debes sugerir EXACTAMENTE 1 examen de imagenología inicial estandarizado, en mayúsculas.",
    "Si la zona es COLUMNA, especifica CERVICAL, DORSAL o LUMBAR según corresponda.",
    "Incluye lateralidad IZQUIERDA/DERECHA si aplica (rodilla, cadera, hombro, codo, mano, tobillo, etc.).",
    "En pacientes jóvenes con dolor de HOMBRO, CODO o MANO/MUÑECA, prioriza ECOGRAFÍA DE PARTES BLANDAS.",
    "En otras zonas usa RX o RM según la edad y sospecha clínica.",
  ].join(" ");

  const instrucciones = `
Paciente:
${JSON.stringify(info, null, 2)}

Debes devolver en formato JSON:

{
  "diagnostico_presuntivo": "una línea breve en español",
  "explicacion_50_palabras": "explicación en 40-60 palabras, en español, sin viñetas",
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

        if (!diagnostico || !examenes.length) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico, explicacion, examenes };
        }
      } catch {
        out = fallbackHeuristico(p);
      }

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
