// preopIA.js — ESM
// Ruta IA Pre Op: genera { examenes, informeIA } con OpenAI y persiste en memoria (namespace 'preop')

import OpenAI from "openai";

export default function iaPreopHandler(memoria) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const ns = (s, id) => `${s}:${id}`;

  // ===== Catálogo (nombres canónicos EXACTOS para compatibilidad con PDF) =====
  // Nota: incluimos entradas separadas y compuestas para mayor compatibilidad.
  const CATALOGO_EXAMENES = [
    "HEMOGRAMA MAS VHS",
    "VHS",
    "PCR",
    "GLICEMIA",
    "HEMOGLOBINA GLICOSILADA",
    "ELECTROLITOS PLASMATICOS",
    "PERFIL BIOQUIMICO",
    "PERFIL LIPIDICO",
    "PERFIL HEPATICO",
    "CREATININA",
    "UREA",
    "TP/INR",
    "TTPA",
    "TTPK",
    "PERFIL DE COAGULACION (TP/INR y TTPA)",
    "GRUPO Y RH",
    "PRUEBAS CRUZADAS (2U)",
    "VIH",
    "ORINA COMPLETA",
    "ORINA",
    "UROCULTIVO",
    "ECG DE REPOSO",
    "RADIOGRAFIA DE TORAX",
    "PASE ODONTOLOGICO",
  ];

  const CANON = new Set(CATALOGO_EXAMENES);

  // Sinónimos -> nombre canónico del catálogo
  const ALIAS = new Map([
    // Hemograma/VHS
    ["HEMOGRAMA", "HEMOGRAMA MAS VHS"],
    ["VELOCIDAD DE SEDIMENTACION", "VHS"],
    ["V.S.G.", "VHS"],
    // Glucosa
    ["GLUCOSA", "GLICEMIA"],
    // Coagulación
    ["APTT", "TTPA"],
    ["A PTT", "TTPA"],
    ["A-PTT", "TTPA"],
    ["TIEMPO DE PROTROMBINA", "TP/INR"],
    ["INR", "TP/INR"],
    ["COAGULOGRAMA", "PERFIL DE COAGULACION (TP/INR y TTPA)"],
    // Orina
    ["ORINA", "ORINA COMPLETA"],
    ["EXAMEN DE ORINA", "ORINA COMPLETA"],
    // ECG
    ["ECG", "ECG DE REPOSO"],
    ["ELECTROCARDIOGRAMA", "ECG DE REPOSO"],
    // Rx tórax
    ["RX DE TORAX", "RADIOGRAFIA DE TORAX"],
    ["RX TORAX", "RADIOGRAFIA DE TORAX"],
    ["RADIOGRAFIA TORAX", "RADIOGRAFIA DE TORAX"],
    // Odontología
    ["PASE ODONTOLÓGICO", "PASE ODONTOLOGICO"],
    ["PASE DE ODONTOLOGIA", "PASE ODONTOLOGICO"],
    ["EVALUACION ODONTOLOGICA PREOPERATORIA", "PASE ODONTOLOGICO"],
  ]);

  function normalizarNombre(raw = "") {
    const key = String(raw || "").trim().toUpperCase();
    if (CANON.has(key)) return key;          // respeta EXACTO si está en catálogo
    if (ALIAS.has(key)) return ALIAS.get(key);
    return null;
  }

  function validarContraCatalogo(lista) {
    if (!Array.isArray(lista)) return null;
    const out = new Set();
    for (const it of lista) {
      const raw = typeof it === "string" ? it : (it && it.nombre) || "";
      const norm = normalizarNombre(raw);
      if (norm) out.add(norm);
    }
    return out.size ? Array.from(out) : null;
  }

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
    return pos.length
      ? pos.join("\n")
      : "Sin comorbilidades relevantes reportadas.";
  };

  function construirInformeFallback({
    paciente = {},
    comorbilidades = {},
    tipoCirugia = "",
  }) {
    const nombre = paciente?.nombre || "";
    const edad = Number(paciente?.edad) || null;
    const dolor = paciente?.dolor || "";
    const lado = paciente?.lado || "";
    const cirugiaTxt = tipoCirugia || "No especificada";

    // Alergias: acepta string o objeto {tiene, detalle}
    const alergias =
      typeof comorbilidades?.alergias === "object"
        ? comorbilidades.alergias.tiene
          ? comorbilidades.alergias.detalle || "Refiere alergias."
          : "No refiere."
        : (comorbilidades?.alergias || "").toString().trim();

    // Anticoagulantes: acepta boolean o {usa, detalle}
    const anticoags =
      typeof comorbilidades?.anticoagulantes === "object"
        ? comorbilidades.anticoagulantes.usa
          ? `Sí${
              comorbilidades.anticoagulantes.detalle
                ? ` — ${comorbilidades.anticoagulantes.detalle}`
                : ""
            }`
          : "No"
        : comorbilidades?.anticoagulantes
        ? "Sí"
        : "No";

    const otras = (comorbilidades?.otras || "").toString().trim();
    const lista = resumenComorbilidades(comorbilidades);

    const consideraciones = [];
    if (comorbilidades.dm2) consideraciones.push("Control glicémico (HbA1c).");
    if (comorbilidades.erc)
      consideraciones.push("Evaluar función renal / evitar nefrotóxicos.");
    if (comorbilidades.cardiopatia || (edad && edad >= 60))
      consideraciones.push(
        "ECG de reposo y evaluación cardiovascular según riesgo."
      );
    if (comorbilidades.epoc_asma || comorbilidades.tabaquismo)
      consideraciones.push("Optimización respiratoria.");
    if (
      comorbilidades.anticoagulantes === true ||
      comorbilidades?.anticoagulantes?.usa
    )
      consideraciones.push("Plan suspensión o puente de anticoagulación.");

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
      `${
        consideraciones.length
          ? "• " + consideraciones.join("\n• ")
          : "• Sin consideraciones adicionales más allá del protocolo estándar."
      }`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // ===== Reglas BASALES + por comorbilidad (deterministas) =====
  function examenesBasales(paciente = {}, comorbilidades = {}, tipoCirugia = "") {
    const edad = Number(paciente?.edad);
    const mayor60 = Number.isFinite(edad) && edad >= 60;
    const esArtro = /ARTROPLASTIA/i.test(String(tipoCirugia || ""));

    const add = new Set();

    // Basal general para cirugía mayor ortopédica (artroplastia) y preop
    add.add("HEMOGRAMA MAS VHS");
    add.add("PCR");
    add.add("GLICEMIA");
    add.add("ELECTROLITOS PLASMATICOS");
    add.add("PERFIL BIOQUIMICO");
    add.add("PERFIL HEPATICO");
    add.add("CREATININA");
    add.add("UREA");
    add.add("ORINA COMPLETA");
    add.add("UROCULTIVO");
    add.add("GRUPO Y RH");

    // *** OBLIGATORIOS: COAGULACIÓN (tres variantes para compatibilidad) ***
    add.add("PERFIL DE COAGULACION (TP/INR y TTPA)");
    add.add("TP/INR");
    add.add("TTPK");

    // *** OBLIGATORIO: ECG SIEMPRE ***
    add.add("ECG DE REPOSO");

    // Cirugía mayor: reservar cruzadas
    if (esArtro) add.add("PRUEBAS CRUZADAS (2U)");

    // Diabetes/obesidad: HbA1c
    if (comorbilidades?.dm2 || comorbilidades?.obesidad) {
      add.add("HEMOGLOBINA GLICOSILADA");
    }

    // Rx tórax si mayor60 o EPOC/asma/tabaquismo/cardiopatía
    if (
      mayor60 ||
      comorbilidades?.epoc_asma ||
      comorbilidades?.tabaquismo ||
      comorbilidades?.cardiopatia
    ) {
      add.add("RADIOGRAFIA DE TORAX");
    }

    // Pase odontológico para artroplastia (foco infeccioso)
    if (esArtro) add.add("PASE ODONTOLOGICO");

    // Validamos contra catálogo por seguridad
    return validarContraCatalogo(Array.from(add)) || [];
  }

  // ===== Prompt para ChatGPT (devuelve SOLO JSON) =====
  function buildPromptJSON({
    paciente,
    comorbilidades,
    tipoCirugia,
    catalogo,
    basales,
  }) {
    const resumen = resumenComorbilidades(comorbilidades);

    const esArtro = /ARTROPLASTIA/i.test(tipoCirugia || "");
    const reglasArtro = esArtro
      ? `
- Contexto: ARTROPLASTIA (cadera/rodilla). Los exámenes basales YA INCLUYEN (obligatorios): hemograma+VHS, PCR, glicemia, bioquímica/renal, perfil hepático, COAGULACIÓN (perfil + TP/INR + TTPK), orina completa + urocultivo, grupo y RH, ECG de reposo, pruebas cruzadas (2U), y Rx de tórax según riesgo/edad, además de HbA1c si DM/obesidad y pase odontológico.
- Tu tarea es AGREGAR del catálogo solo lo que creas faltante según comorbilidades/edad. Si nada falta, devuelve lista vacía para "examenes" (porque ya vienen los basales).`
      : `
- Hay exámenes basales predefinidos (incluyen ECG y coagulación). Solo agrega del catálogo lo que falte por comorbilidades/edad. Si nada falta, devuelve lista vacía para "examenes".`;

    return `
Eres un asistente clínico para evaluación PREOPERATORIA.
Devuelve EXCLUSIVAMENTE un JSON válido con forma:
{
  "examenes": [ /* SOLO nombres exactamente del catálogo (nuevos a agregar, los basales ya se incluyen) */ ],
  "informeIA": "texto breve en español (≤140 palabras) con consideraciones preoperatorias"
}

Reglas:
- Usa únicamente ítems del catálogo (coincidencia literal).
- No prescribas fármacos. Enfócate en laboratorio, ECG y Rx tórax si corresponde.
${reglasArtro}

Catálogo permitido:
${catalogo.map((s) => `- ${s}`).join("\n")}

Exámenes basales ya incluidos:
${basales.map((s) => `- ${s}`).join("\n")}

Datos del paciente:
- Nombre/Edad: ${paciente?.nombre || "—"} / ${Number(paciente?.edad) || "—"} años
- Cirugía planificada: ${tipoCirugia || "No especificada"}
- Motivo/Área: ${paciente?.dolor || "—"} ${paciente?.lado || ""}
- Comorbilidades marcadas:
${resumen}
`.trim();
  }

  // Robustez: extraer JSON aunque venga dentro de ```json ... ```
  function extraerJSON(str = "") {
    try {
      return JSON.parse(str);
    } catch {}
    const m =
      str.match(/```json\s*([\s\S]*?)```/i) || str.match(/```([\s\S]*?)```/);
    if (m && m[1]) {
      try {
        return JSON.parse(m[1]);
      } catch {}
    }
    const m2 = str.match(/\{[\s\S]*\}/);
    if (m2) {
      try {
        return JSON.parse(m2[0]);
      } catch {}
    }
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
        return res
          .status(400)
          .json({ ok: false, error: "Faltan idPago o datos del paciente." });
      }

      // 1) Catálogo desde el front (si viene) o el local
      const catalogo =
        Array.isArray(catalogoExamenes) && catalogoExamenes.length
          ? catalogoExamenes.map((s) => String(s).trim()).filter(Boolean)
          : CATALOGO_EXAMENES;

      // 2) Construir basales deterministas (con ECG y coagulación obligatorios)
      const base = examenesBasales(paciente, comorbilidades, tipoCirugia);

      // 3) Llamada a OpenAI (si hay API key) para sugerir EXTRAS sobre los basales
      let extras = [];
      let informeIA = "";

      if (process.env.OPENAI_API_KEY) {
        const prompt = buildPromptJSON({
          paciente,
          comorbilidades,
          tipoCirugia,
          catalogo,
          basales: base,
        });
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            max_tokens: 450,
            messages: [
              {
                role: "system",
                content:
                  "Devuelve únicamente JSON válido según las reglas dadas.",
              },
              { role: "user", content: prompt },
            ],
          });

          const content = completion?.choices?.[0]?.message?.content || "";
          const parsed = extraerJSON(content);

          if (parsed && Array.isArray(parsed.examenes)) {
            extras = validarContraCatalogo(parsed.examenes) || [];
          }
          if (parsed && typeof parsed.informeIA === "string") {
            informeIA = parsed.informeIA.trim();
          }
        } catch (err) {
          console.warn("OpenAI fallo ia-preop:", err?.message || err);
        }
      }

      // 4) Mezcla final: BASALES ∪ EXTRAS (deduplicado)
      const examenes = Array.from(new Set([...(base || []), ...(extras || [])]));

      // 5) Informe fallback si la IA no lo entregó
      if (!informeIA) {
        informeIA = construirInformeFallback({
          paciente,
          comorbilidades,
          tipoCirugia,
        });
      }

      // 6) Persistencia (merge sin destruir lo previo)
      const prev = memoria.get(ns("preop", idPago)) || {};
      const next = {
        ...prev,
        ...paciente, // aplanado
        comorbilidades,
        tipoCirugia,
        examenesIA: examenes,
        informeIA,
      };
      memoria.set(ns("preop", idPago), next);

      return res.json({ ok: true, examenes, informeIA });
    } catch (e) {
      console.error("ia-preop error:", e);
      return res.status(500).json({
        ok: false,
        error: "No se pudo generar indicación preoperatoria.",
      });
    }
  };
}
