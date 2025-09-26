// traumaIA.js — IA para módulo TRAUMA (imagenología) con puntos dolorosos
// ESM (Node >= 18)
// Usa OpenAI si hay API key; si falla, usa fallback heurístico.

const OPENAI_API = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ------------------------------------------------------------- */
/* Utils de normalización y fallback                             */
/* ------------------------------------------------------------- */

function normalizarExamen(examen = "", dolor = "", lado = "") {
  let x = String(examen || "").trim();
  if (!x) return "";
  x = x.toUpperCase();
  if (!x.endsWith(".")) x += ".";

  // Añadir lateralidad si aplica
  const L = (lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  if (/\b(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE)\b/.test(x) &&
      lat && !/\b(IZQUIERDA|DERECHA)\b/.test(x)) {
    x = x.replace(/\.$/, "") + lat + ".";
  }

  // Estandariza ECO partes blandas con zona
  if (/ECOGRAF[ÍI]A.*PARTES\s+BLANDAS/.test(x) && !/\bDE\b/.test(x)) {
    const zona = (dolor || "").toUpperCase();
    if (zona && !/COLUMNA/.test(zona)) {
      x = `ECOGRAFÍA DE PARTES BLANDAS DE ${zona}${lat}.`.toUpperCase();
    }
  }
  return x;
}

function fallbackHeuristico(p = {}) {
  const d = String(p.dolor || "").toLowerCase();
  const L = (p.lado || "").toUpperCase();
  const lat = L ? ` ${L}` : "";
  const mayor60 = Number(p.edad) > 60;

  if (d.includes("rodilla")) {
    const diagnostico = `Gonalgia${lat ? ` ${L.toLowerCase()}` : ""}`;
    const examen = mayor60
      ? `RX DE RODILLA${lat} AP/LATERAL/AXIAL.`
      : `RESONANCIA MAGNÉTICA DE RODILLA${lat}.`;
    const justificacion =
      "Estudio dirigido a estructuras intraarticulares y periarticulares de la rodilla. La elección prioriza rendimiento diagnóstico según edad y sospecha; RX evalúa compromiso óseo/degenerativo y RM valora meniscos, cartílago y ligamentos. Los puntos dolorosos orientan la sospecha específica.";
    return { diagnostico, examen, justificacion };
  }

  const diagnostico = "Dolor osteoarticular localizado";
  const examen = "EVALUACIÓN IMAGENOLÓGICA SEGÚN CLÍNICA.";
  const justificacion =
    "Se inicia estudio de la región comprometida, priorizando seguridad y costo-efectividad. La selección del examen se ajusta a la sospecha clínica y hallazgos dirigidos.";
  return { diagnostico, examen, justificacion };
}

/* ------------------------------------------------------------- */
/* Mapeo clínico: puntos de rodilla → hipótesis                  */
/* ------------------------------------------------------------- */

/**
 * Espera { frente: string[], lateral: string[], posterior: string[] }
 * con etiquetas como: "interlínea medial/lateral", "rótula", "tuberosidad tibial",
 * "pes anserino", "banda iliotibial/gerdy", "fosa poplítea", etc.
 */
function inferirHipotesisDesdePuntos(rodillaMarcadores = {}) {
  const labels = [
    ...(rodillaMarcadores.frente || []),
    ...(rodillaMarcadores.posterior || []),
    ...(rodillaMarcadores.lateral || []),
  ]
    .map((s) => String(s || "").toLowerCase())
    .filter(Boolean);

  const hit = (rx) => labels.some((t) => rx.test(t));

  const hallazgos = [];
  const sospechas = [];

  // Interlíneas → meniscos
  if (hit(/\binterl[ií]nea?\s+medial\b/)) {
    hallazgos.push("Dolor selectivo en interlínea medial");
    sospechas.push("Lesión de menisco medial");
  }
  if (hit(/\binterl[ií]nea?\s+lateral\b/)) {
    hallazgos.push("Dolor selectivo en interlínea lateral");
    sospechas.push("Lesión de menisco lateral");
  }

  // Rótula / PF
  if (hit(/\b(r[óo]tula|patelar|patelofemoral|ap(e|é)x)\b/)) {
    hallazgos.push("Dolor peripatela/patelofemoral");
    sospechas.push("Síndrome patelofemoral o condropatía rotuliana");
  }

  // Tuberosidad tibial
  if (hit(/\btuberosidad\s+tibial\b/)) {
    hallazgos.push("Dolor en tuberosidad tibial");
    sospechas.push("Osgood–Schlatter o tendinopatía del tendón rotuliano");
  }

  // Pes anserino
  if (hit(/\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b/)) {
    hallazgos.push("Dolor en región pes anserino");
    sospechas.push("Tendinopatía del pes anserinus / bursitis anserina");
  }

  // Banda iliotibial / Gerdy
  if (hit(/\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b/)) {
    hallazgos.push("Dolor sobre inserción del tracto iliotibial");
    sospechas.push("Síndrome de la banda iliotibial");
  }

  // LCM / LCL (aproximación por bordes)
  if (hit(/\bborde\s+medial\b/) || hit(/\bepic[óo]ndilo\s+femoral\s+medial\b/)) {
    hallazgos.push("Dolor en trayecto medial de la rodilla");
    sospechas.push("Esguince del ligamento colateral medial (LCM)");
  }
  if (hit(/\bborde\s+lateral\b/) || hit(/\bepic[óo]ndilo\s+femoral\s+lateral\b/)) {
    hallazgos.push("Dolor en trayecto lateral de la rodilla");
    sospechas.push("Esguince del ligamento colateral lateral (LCL)");
  }

  // Fosa poplítea
  if (hit(/\bpopl[ií]tea?\b/)) {
    hallazgos.push("Dolor/firmeza en fosa poplítea");
    sospechas.push("Quiste de Baker / patología poplítea");
  }

  if (hallazgos.length === 0) hallazgos.push("Dolor selectivo en puntos marcados");
  if (sospechas.length === 0) sospechas.push("Compromiso meniscal o periarticular a precisar");

  return { hallazgos, sospechas };
}

function describirPuntosClinicos(detalles = {}) {
  const m = detalles?.rodillaMarcadores || null;
  if (!m) return { texto: "Sin puntos dolorosos marcados.", hallazgos: [], sospechas: [] };

  const { hallazgos, sospechas } = inferirHipotesisDesdePuntos(m);
  const texto = [
    "PUNTOS DOLOROSOS MARCADOS",
    ...hallazgos.map((h) => `• ${h}`),
    "",
    "SOSPECHAS ORIENTADAS POR LOS PUNTOS",
    ...sospechas.map((s) => `• ${s}`),
  ].join("\n");

  return { texto, hallazgos, sospechas };
}

/* ------------------------------------------------------------- */
/* Prompt: 1 diagnóstico + 1 examen + justificación basada en pts */
/* ------------------------------------------------------------- */

function construirMensajesIA(p) {
  const info = {
    nombre: p?.nombre || "",
    rut: p?.rut || "",
    edad: p?.edad || "",
    genero: p?.genero || "",
    dolor: p?.dolor || "",
    lado: p?.lado || "",
  };

  const { texto: puntosTexto } = describirPuntosClinicos(p?.detalles || null);

  const system = [
    "Eres un asistente clínico de traumatología e imagenología.",
    "Selecciona UN diagnóstico presuntivo y UN examen imagenológico inicial.",
    "La justificación clínica DEBE referenciar explícitamente los puntos dolorosos marcados.",
    "Evita sobreestudio: prioriza RX o ecografía si resuelven la pregunta clínica.",
    "Incluye lateralidad textual (izquierda/derecha) cuando aplique.",
    "Responde SIEMPRE SOLO JSON válido, sin texto fuera del JSON.",
  ].join(" ");

  const user = `
PACIENTE
${JSON.stringify(info, null, 2)}

HALLAZGOS DIRIGIDOS (PUNTOS DOLOROSOS)
${puntosTexto}

SALIDA (SOLO JSON VÁLIDO)
{
  "diagnostico_presuntivo": "3–8 palabras, específico, con lateralidad si aplica",
  "examen": "UN SOLO EXAMEN, EN MAYÚSCULAS",
  "justificacion_clinica": "60–120 palabras, referenciando los puntos y su correlato anatómico/patológico"
}
`.trim();

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------------------------------------- */
/* Llamada al modelo                                              */
/* ------------------------------------------------------------- */

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
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages,
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

/* ------------------------------------------------------------- */
/* Handler principal                                              */
/* ------------------------------------------------------------- */

export default function traumaIAHandler(memoria) {
  const ns = (s, id) => `${s}:${id}`;

  return async (req, res) => {
    try {
      const {
        idPago,
        paciente = {},
        detalles = null,
        rodillaMarcadores = null, // ← también aceptamos top-level
      } = req.body || {};
      if (!idPago) return res.status(400).json({ ok: false, error: "Falta idPago" });

      // Normaliza: preferimos detalles.rodillaMarcadores; si no, usamos top-level
      const detallesAll = {
        ...(detalles || {}),
        rodillaMarcadores: (detalles?.rodillaMarcadores ?? rodillaMarcadores) || null,
      };
      const p = { ...paciente, detalles: detallesAll };

      // IA con puntos
      let out;
      try {
        const mensajes = construirMensajesIA(p);
        const ia = await llamarIA(mensajes);

        const diagnostico = String(ia?.diagnostico_presuntivo || "").trim();
        const examenRaw  = String(ia?.examen || "").trim();
        const justificacion = String(ia?.justificacion_clinica || "").trim();

        const examen = normalizarExamen(examenRaw, p?.dolor, p?.lado);

        if (!diagnostico || !examen) {
          out = fallbackHeuristico(p);
        } else {
          out = { diagnostico, examen, justificacion };
        }
      } catch {
        out = fallbackHeuristico(p);
      }

      // Persistencia mínima (si usas memoria para PDF/reportes)
      const registro = {
        ...p,
        examenesIA: [out.examen],
        respuesta: `Diagnóstico presuntivo: ${out.diagnostico}\n\n${out.justificacion}`,
        pagoConfirmado: true,
      };
      try {
        memoria?.set?.(ns("ia", idPago), registro);
        memoria?.set?.(ns("meta", idPago), { moduloAutorizado: "ia" });
      } catch {}

      // Respuesta final
      return res.json({
        ok: true,
        diagnostico: out.diagnostico,
        examenes: [out.examen],
        justificacion: out.justificacion,
      });
    } catch (e) {
      console.error("ia-trauma error:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}
