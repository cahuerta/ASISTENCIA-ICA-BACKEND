// preopIA.js — ESM
// Ruta IA Pre Op: genera { examenes, informeIA } con OpenAI y persiste en memoria (namespace 'preop')

import OpenAI from "openai";

export default function iaPreopHandler(memoria) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const ns = (s, id) => `${s}:${id}`;

  // ===== Catálogo EXACTO (nombre literal para compatibilidad con PDF) =====
  const CATALOGO_EXAMENES = [
    "HEMOGRAMA MAS VHS",
    "PCR",
    "ELECTROLITOS PLASMATICOS",
    "PERFIL BIOQUIMICO",
    "PERFIL LIPIDICO",
    "PERFIL HEPATICO",
    "CREATININA",
    "TTPK",
    "HEMOGLOBINA GLICOSILADA",
    "VITAMINA D",
    "GRUPO Y RH",
    "VIH",
    "ORINA",
    "UROCULTIVO",
    "ECG DE REPOSO",
  ];
  const catUpper = new Map(CATALOGO_EXAMENES.map((n) => [n.trim().toUpperCase(), n]));
  const validarContraCatalogo = (lista) => {
    if (!Array.isArray(lista)) return null;
    const out = [];
    for (const it of lista) {
      const raw = typeof it === "string" ? it : (it && it.nombre) || "";
      const key = String(raw).trim().toUpperCase();
      if (catUpper.has(key)) out.push(catUpper.get(key));
    }
    return out.length ? out : null;
  };

  // ===== Utilidades para informe fallback =====
  const etiqueta = {
    hta: "Hipertensión arterial",
    dm2: "Diabetes mellitus tipo 2",
    dislipidemia: "Dislipidemia",
    obesidad: "Obesidad",
    tabaquismo: "Tabaquismo",
    epoc_asma: "EPOC / Asma",
    cardiopatia: "Cardiopatía",
    erc: "Enfermedad renal crónica",
    hipotiroidismo: "Hipotiroidismo",
    anticoagulantes: "Uso de anticoagulantes/antiagregantes",
    artritis_reumatoide: "Artritis reumatoide / autoinmune",
  };
  const resumenComorbilidades = (c = {}) => {
    const pos = Object.keys(etiqueta)
      .filter((k) => c[k] === true)
      .map((k) => `• ${etiqueta[k]}`);
    return pos.length ? pos.join("\n") : "Sin comorbilidades relevantes reportadas.";
  };

  function construirInformeFallback({ paciente = {}, comorbilidades = {}, tipoCirugia = "" }) {
    const nombre = paciente?.nombre || "";
    const edad = Number(paciente?.edad) || null;
    const dolor = paciente?.dolor || "";
    const lado = paciente?.lado || "";
    const cirugiaTxt = tipoCirugia || "No especificada";

    // Alergias: acepta string o objeto {tiene, detalle}
    const alergias =
      typeof comorbilidades?.alergias === "object"
        ? comorbilidades.alergias.tiene
          ? (comorbilidades.alergias.detalle || "Refiere alergias.")
          : "No refiere."
        : (comorbilidades?.alergias || "").toString().trim();

    // Anticoagulantes: acepta boolean o {usa, detalle}
    const anticoags =
      typeof comorbilidades?.anticoagulantes === "object"
        ? comorbilidades.anticoagulantes.usa
          ? `Sí${comorbilidades.anticoagulantes.detalle ? ` — ${comorbilidades.anticoagulantes.detalle}` : ""}`
          : "No"
        : (comorbilidades?.anticoagulantes ? "Sí" : "No");

    const otras = (comorbilidades?.otras || "").toString().trim();
    const lista = resumenComorbilidades(comorbilidades);

    const consideraciones = [];
    if (comorbilidades.dm2) consideraciones.push("Control glicémico (HbA1c).");
    if (comorbilidades.erc) consideraciones.push("Evaluar función renal / evitar nefrotóxicos.");
    if (comorbilidades.cardiopatia || (edad && edad >= 60)) consideraciones.push("ECG de reposo / estratificación cardiovascular.");
    if (comorbilidades.epoc_asma || comorbilidades.tabaquismo) consideraciones.push("Optimización respiratoria.");
    if (comorbilidades.anticoagulantes === true || comorbilidades?.anticoagulantes?.usa)
      consideraciones.push("Plan suspensión/puente de anticoagulación.");

    return [
      `Evaluación Preoperatoria (resumen)\n`,
      `Paciente: ${nombre || "—"}   Edad: ${edad ?? "—"} años`,
      `Motivo/Área: ${dolor || "—"} ${lado || ""}`.trim(),
      `Cirugía planificada: ${cirugiaTxt}`,
      ``,
      `Comorbilidades:\n${lista}`,
      `Alergias: ${alergias || "—"}`,
      `Anticoagulantes/antiagregantes: ${anticoags}`,
      otras ? `Otras comorbilidades:\n${otras}` : "",
      ``,
      `Consideraciones preoperatorias:`,
      `${consideraciones.length ? "• " + consideraciones.join("\n• ") : "• Sin consideraciones adicionales más allá del protocolo estándar."}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ===== Prompt para ChatGPT (devuelve SOLO JSON) =====
  function buildPromptJSON({ paciente, comorbilidades, tipoCirugia, catalogo }) {
    const resumen = resumenComorbilidades(comorbilidades);
    const alergiasTxt =
      typeof comorbilidades?.alergias === "object"
        ? (comorbilidades.alergias.tiene ? (comorbilidades.alergias.detalle || "Refiere alergias.") : "No refiere.")
        : (comorbilidades?.alergias || "").toString();

    const anticoTxt =
      typeof comorbilidades?.anticoagulantes === "object"
        ? (comorbilidades.anticoagulantes.usa
            ? `Sí${comorbilidades.anticoagulantes.detalle ? ` — ${comorbilidades.anticoagulantes.detalle}` : ""}`
            : "No")
        : (comorbilidades?.anticoagulantes ? "Sí" : "No");

    const otras = (comorbilidades?.otras || "").toString();

    return `
Eres un asistente clínico para evaluación PREOPERATORIA.
Responde EXCLUSIVAMENTE con un JSON válido, sin texto extra, con la forma:
{
  "examenes": [ /* lista de nombres exactamente del catálogo dado */ ],
  "informeIA": "texto breve en español (máx 140 palabras) que resuma comorbilidades y consideraciones preoperatorias"
}

Reglas:
- "examenes" DEBEN ser un subconjunto EXACTO del catálogo (coincidencia literal).
- No prescribas fármacos. Enfócate en laboratorio y ECG preoperatorios.
- Mantén el "informeIA" conciso, sin alarmismo.

Catálogo permitido:
${catalogo.map((s) => `- ${s}`).join("\n")}

Datos:
- Paciente: ${paciente?.nombre || "—"} (${Number(paciente?.edad) || "—"} años)
- Cirugía planificada: ${tipoCirugia || "No especificada"}
- Motivo/Área: ${paciente?.dolor || "—"} ${paciente?.lado || ""}
- Comorbilidades marcadas:
${resumen}
- Alergias: ${alergiasTxt || "—"}
- Anticoagulantes/antiagregantes: ${anticoTxt}
- Otras (texto): ${otras || "—"}
`.trim();
  }

  // Robustez: extraer JSON aunque venga dentro de ```json ... ```
  function extraerJSON(str = "") {
    try { return JSON.parse(str); } catch {}
    const m = str.match(/```json\s*([\s\S]*?)```/i) || str.match(/```([\s\S]*?)```/);
    if (m && m[1]) { try { return JSON.parse(m[1]); } catch {} }
    const m2 = str.match(/\{[\s\S]*\}/);
    if (m2) { try { return JSON.parse(m2[0]); } catch {} }
    return null;
  }

  return async (req, res) => {
    try {
      const {
        idPago,
        paciente = {},
        comorbilidades = {},
        tipoCirugia = "",
        catalogoExamenes = [],
      } = req.body || {};

      if (!idPago || !paciente || !paciente.nombre) {
        return res.status(400).json({ ok: false, error: "Faltan idPago o datos del paciente." });
      }

      // 1) Catálogo desde el front (si viene) o el local
      const catalogo =
        Array.isArray(catalogoExamenes) && catalogoExamenes.length
          ? catalogoExamenes.map((s) => String(s).trim()).filter(Boolean)
          : CATALOGO_EXAMENES;

      // 2) Llamada a OpenAI (si hay API key)
      let examenes = null;
      let informeIA = "";

      if (process.env.OPENAI_API_KEY) {
        const prompt = buildPromptJSON({ paciente, comorbilidades, tipoCirugia, catalogo });
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            max_tokens: 400,
            messages: [
              { role: "system", content: "Devuelve únicamente JSON válido según las reglas dadas." },
              { role: "user", content: prompt },
            ],
          });

          const content = completion?.choices?.[0]?.message?.content || "";
          const parsed = extraerJSON(content);

          if (parsed && Array.isArray(parsed.examenes)) {
            // ⬇️ Validamos contra el catálogo, pero si no hay match, NO rellenamos con fijos
            examenes = validarContraCatalogo(parsed.examenes) || [];
          }
          if (parsed && typeof parsed.informeIA === "string") {
            informeIA = parsed.informeIA.trim();
          }
        } catch (err) {
          console.warn("OpenAI fallo ia-preop:", err?.message || err);
        }
      }

      // 3) Sin exámenes fijos de relleno: dejamos [] si no hay IA
      if (!Array.isArray(examenes)) examenes = [];

      // Informe fallback (solo texto) si la IA no lo entregó
      if (!informeIA) {
        informeIA = construirInformeFallback({ paciente, comorbilidades, tipoCirugia });
      }

      // 4) Persistencia (merge sin destruir lo previo)
      const prev = memoria.get(ns("preop", idPago)) || {};
      const next = {
        ...prev,
        ...paciente,            // aplanado
        comorbilidades,
        tipoCirugia,
        examenesIA: examenes,
        informeIA,
      };
      memoria.set(ns("preop", idPago), next);

      return res.json({ ok: true, examenes, informeIA });
    } catch (e) {
      console.error("ia-preop error:", e);
      return res.status(500).json({ ok: false, error: "No se pudo generar indicación preoperatoria." });
    }
  };
}
