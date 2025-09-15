// generalesIA.js — ESM
// IA Generales: recibe { idPago, paciente, comorbilidades }, devuelve { examenes, informeIA }
// y persiste en memoria bajo namespace 'generales'

import OpenAI from "openai";

export default function iaGeneralesHandler(memoria) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const ns = (s, id) => `${s}:${id}`;

  // ===== Catálogo EXACTO (para que coincida con el PDF) =====
  // OJO: Respetamos mayúsculas/acentos tal como los usa tu PDF.
  const CATALOGO = [
    "HEMOGRAMA",
    "VHS",
    "PCR",
    "ELECTROLITOS PLASMATICOS",
    "PERFIL BIOQUIMICO",
    "PERFIL LIPIDICO",
    "PERFIL HEPÁTICO",
    "CREATININA",
    "TTPK",
    "HEMOGLOBINA GLICOSILADA",
    "VITAMINA D",
    "ORINA",
    "UROCULTIVO",
    "ECG DE REPOSO",
    "MAMOGRAFÍA",
    "TSHm y T4 LIBRE",
    "CALCIO",
    "PAPANICOLAO (según edad)",
    "ANTÍGENO PROSTÁTICO",
    "CEA",
    "RX DE TÓRAX",
    "GRUPO Y RH",
  ];
  const catUpper = new Map(CATALOGO.map(n => [n.trim().toUpperCase(), n]));
  const validarContraCatalogo = (lista) => {
    if (!Array.isArray(lista)) return [];
    const out = [];
    for (const it of lista) {
      const raw = typeof it === "string" ? it : (it && it.nombre) || "";
      const key = String(raw).trim().toUpperCase();
      if (catUpper.has(key)) out.push(catUpper.get(key));
    }
    // quitar duplicados conservando orden
    return [...new Set(out)];
  };

  // ===== Utilidades informe fallback =====
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

  function construirInformeFallback({ paciente = {}, comorbilidades = {} }) {
    const nombre = paciente?.nombre || "";
    const edad = Number(paciente?.edad) || null;

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
    if (comorbilidades.erc) consideraciones.push("Función renal / evitar nefrotóxicos.");
    if (comorbilidades.cardiopatia || (edad && edad >= 40)) consideraciones.push("ECG de reposo / estratificación CV.");
    if (comorbilidades.epoc_asma || comorbilidades.tabaquismo) consideraciones.push("Optimización respiratoria.");

    return [
      `Evaluación de Chequeo General (resumen)\n`,
      `Paciente: ${nombre || "—"}   Edad: ${edad ?? "—"} años`,
      ``,
      `Comorbilidades:\n${lista}`,
      `Alergias: ${alergias || "—"}`,
      `Anticoagulantes/antiagregantes: ${anticoags}`,
      otras ? `Otras comorbilidades:\n${otras}` : "",
      ``,
      `Consideraciones:`,
      `${consideraciones.length ? "• " + consideraciones.join("\n• ") : "• Sin consideraciones adicionales más allá del protocolo estándar."}`,
    ].filter(Boolean).join("\n");
  }

  // ===== Basal programática (siempre presente) =====
  function basalGenerales(p = {}, c = {}) {
    const out = new Set();
    const edad = Number(p?.edad);
    const genero = String(p?.genero || "").toLowerCase();

    // Siempre
    [
      "HEMOGRAMA",
      "VHS",
      "PCR",
      "ELECTROLITOS PLASMATICOS",
      "PERFIL BIOQUIMICO",
      "PERFIL LIPIDICO",
      "PERFIL HEPÁTICO",
      "CREATININA",
      "ORINA",
      "VITAMINA D",
    ].forEach(n => out.add(n));

    // Condiciones
    if (c.dm2) out.add("HEMOGLOBINA GLICOSILADA");
    if (c.hipotiroidismo || genero === "mujer") out.add("TSHm y T4 LIBRE");
    if (c.erc) out.add("UROCULTIVO");

    // Edad / cardio
    if ((Number.isFinite(edad) && edad >= 40) || c.hta || c.cardiopatia || c.dislipidemia)
      out.add("ECG DE REPOSO");

    // Mujer (screening)
    if (genero === "mujer") {
      if (Number.isFinite(edad) && edad >= 40) out.add("MAMOGRAFÍA");
      if (Number.isFinite(edad) && edad >= 25) out.add("PAPANICOLAO (según edad)");
      if (Number.isFinite(edad) && edad >= 50) out.add("CALCIO");
    }

    // Hombre (screening)
    if (genero === "hombre") {
      if (Number.isFinite(edad) && edad >= 50) out.add("ANTÍGENO PROSTÁTICO");
      if (Number.isFinite(edad) && edad >= 50) out.add("CEA");
    }

    // Respiratorio
    if (c.epoc_asma || c.tabaquismo) out.add("RX DE TÓRAX");

    // Validar contra catálogo y ordenar como catálogo
    return validarContraCatalogo([...out]);
  }

  // ===== Prompt (devuelve SOLO JSON) =====
  function buildPromptJSON({ paciente, comorbilidades, catalogo }) {
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

    // Sugerimos una BASE explícita (igual reforzaremos programáticamente)
    const baseMinima = [
      "HEMOGRAMA",
      "VHS",
      "PCR",
      "ELECTROLITOS PLASMATICOS",
      "PERFIL BIOQUIMICO",
      "PERFIL LIPIDICO",
      "PERFIL HEPÁTICO",
      "CREATININA",
      "ORINA",
      "VITAMINA D"
    ];

    return `
Eres un asistente clínico para CHEQUEO GENERAL.
Devuelve EXCLUSIVAMENTE un JSON válido con:
{
  "examenes": [ /* subconjunto EXACTO del catálogo */ ],
  "informeIA": "resumen clínico (máx 140 palabras) de comorbilidades y foco del chequeo"
}

Instrucciones:
- Incluye SIEMPRE esta base mínima si no está contraindicada:
  ${baseMinima.map(s => `- ${s}`).join("\n  ")}
- Agrega exámenes condicionales según edad, género y comorbilidades.
- Usa SOLO nombres del catálogo; NADA fuera del catálogo.
- No prescribas fármacos y no hagas diagnósticos definitivos.

Catálogo permitido:
${catalogo.map(s => `- ${s}`).join("\n")}

Datos:
- Paciente: ${paciente?.nombre || "—"} (${Number(paciente?.edad) || "—"} años, ${paciente?.genero || "—"})
- Comorbilidades marcadas:
${resumen}
- Alergias: ${alergiasTxt || "—"}
- Anticoagulantes/antiagregantes: ${anticoTxt}
- Otras (texto): ${otras || "—"}
`.trim();
  }

  // ---- Robustez para extraer JSON ----
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
        catalogoExamenes = [],
      } = req.body || {};

      if (!idPago || !paciente || !paciente.nombre) {
        return res.status(400).json({ ok: false, error: "Faltan idPago o datos del paciente." });
      }

      // Catálogo desde el request (si viene) o el local
      const catalogo =
        Array.isArray(catalogoExamenes) && catalogoExamenes.length
          ? catalogoExamenes.map(s => String(s).trim()).filter(Boolean)
          : CATALOGO;

      let examenesIA = [];
      let informeIA = "";

      // 1) LLM (si hay API key)
      if (process.env.OPENAI_API_KEY) {
        const prompt = buildPromptJSON({ paciente, comorbilidades, catalogo });
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            max_tokens: 450,
            messages: [
              { role: "system", content: "Devuelve únicamente JSON válido según las reglas dadas." },
              { role: "user", content: prompt },
            ],
          });

          const content = completion?.choices?.[0]?.message?.content || "";
          const parsed = extraerJSON(content);

          if (parsed && Array.isArray(parsed.examenes)) {
            examenesIA = validarContraCatalogo(parsed.examenes);
          }
          if (parsed && typeof parsed.informeIA === "string") {
            informeIA = parsed.informeIA.trim();
          }
        } catch (err) {
          console.warn("OpenAI fallo ia-generales:", err?.message || err);
        }
      }

      // 2) Basal programática SIEMPRE incluida (evita que LLM omita básicos)
      const base = basalGenerales(paciente, comorbilidades);
      const examenesFinal = validarContraCatalogo([...(examenesIA || []), ...base]);

      // 3) Informe fallback si LLM no lo dio
      if (!informeIA) {
        informeIA = construirInformeFallback({ paciente, comorbilidades });
      }

      // 4) Persistencia (merge sin destruir lo previo)
      const prev = memoria.get(ns("generales", idPago)) || {};
      const next = {
        ...prev,
        ...paciente,                 // aplanado
        comorbilidades,
        examenesIA: examenesFinal,
        informeIA,
        pagoConfirmado: true,
      };
      memoria.set(ns("generales", idPago), next);

      return res.json({ ok: true, examenes: examenesFinal, informeIA });
    } catch (e) {
      console.error("ia-generales error:", e);
      return res.status(500).json({ ok: false, error: "No se pudo generar chequeo general." });
    }
  };
}
