// preopIA.js — ESM
// Ruta IA Pre Op: genera { examenes, informeIA } y persiste en memoria (namespace 'preop')

export default function iaPreopHandler(memoria) {
  const ns = (s, id) => `${s}:${id}`;

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

  const catUpper = new Map(
    CATALOGO_EXAMENES.map((n) => [n.trim().toUpperCase(), n])
  );

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

  const etiqueta = {
    hta: "Hipertensión arterial",
    dm2: "Diabetes mellitus tipo 2",
    dislipidemia: "Dislipidemia",
    obesidad: "Obesidad",
    tabaquismo: "Tabaquismo activo",
    epoc_asma: "EPOC / Asma",
    cardiopatia: "Cardiopatía",
    erc: "Enfermedad renal crónica",
    hipotiroidismo: "Hipotiroidismo",
    anticoagulantes: "Uso de anticoagulantes/antiagregantes",
    artritis_reumatoide: "Artritis reumatoide / autoinmune",
  };

  function resumirComorbilidades(c = {}) {
    const positivos = Object.keys(etiqueta)
      .filter((k) => c[k] === true)
      .map((k) => `• ${etiqueta[k]}`);
    return positivos.length ? positivos.join("\n") : "Sin comorbilidades relevantes reportadas.";
  }

  function construirInforme({ paciente = {}, comorbilidades = {}, tipoCirugia = "" }) {
    const nombre = paciente?.nombre || "";
    const edad = Number(paciente?.edad) || null;
    const dolor = paciente?.dolor || "";
    const lado = paciente?.lado || "";
    const cirugiaTxt = tipoCirugia || "No especificada";

    const alergias = (comorbilidades?.alergias || "").trim();
    const meds = (comorbilidades?.medicamentos || "").trim();
    const cirPrev = (comorbilidades?.cirugiasPrevias || "").trim();
    const acDet = (comorbilidades?.anticoagulantes_detalle || "").trim();
    const tabaco = (comorbilidades?.tabaco || "").trim();
    const alcohol = (comorbilidades?.alcohol || "").trim();
    const otras = (comorbilidades?.otras || "").trim();
    const obs = (comorbilidades?.observaciones || "").trim();

    const listaComorb = resumirComorbilidades(comorbilidades);

    const consideraciones = [];
    if (comorbilidades.dm2) consideraciones.push("Control glicémico preoperatorio (HbA1c y ajustes si corresponde).");
    if (comorbilidades.erc) consideraciones.push("Evaluar función renal y fármacos nefrotóxicos.");
    if (comorbilidades.cardiopatia || (edad && edad >= 60)) consideraciones.push("ECG de reposo y estratificación de riesgo cardiovascular.");
    if (comorbilidades.epoc_asma || comorbilidades.tabaquismo) consideraciones.push("Optimización respiratoria y manejo broncodilatador si aplica.");
    if (comorbilidades.anticoagulantes) consideraciones.push("Plan de suspensión/puente de anticoagulación según protocolo.");

    const bloques = [
      `Evaluación Preoperatoria (resumen)\n`,
      `Paciente: ${nombre || "—"}   Edad: ${edad ?? "—"} años`,
      `Motivo/Área: ${dolor || "—"} ${lado || ""}`.trim(),
      `Cirugía planificada: ${cirugiaTxt}`,
      ``,
      `Comorbilidades:\n${listaComorb}`,
      `Alergias: ${alergias || "No refiere."}`,
      `Medicamentos actuales:\n${meds || "—"}`,
      `Anticoagulantes/antiagregantes: ${comorbilidades.anticoagulantes ? `Sí${acDet ? ` — ${acDet}` : ""}` : "No"}`,
      `Tabaquismo: ${tabaco || "—"}`,
      `Alcohol: ${alcohol || "—"}`,
      `Cirugías previas:\n${cirPrev || "—"}`,
      otras ? `Otras comorbilidades:\n${otras}` : "",
      obs ? `Observaciones:\n${obs}` : "",
      ``,
      `Consideraciones preoperatorias:`,
      `${consideraciones.length ? "• " + consideraciones.join("\n• ") : "• Sin consideraciones adicionales más allá del protocolo estándar."}`,
      ``,
      `Se solicitan exámenes preoperatorios estándar según protocolo ICA y riesgos individuales.`,
    ];

    return bloques.filter(Boolean).join("\n");
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

      // 1) Catálogo (si llegó desde el front, úsalo; si no, el local)
      const catalogo = Array.isArray(catalogoExamenes) && catalogoExamenes.length
        ? catalogoExamenes.map((s) => String(s).trim()).filter(Boolean)
        : CATALOGO_EXAMENES;

      // 2) Generación de exámenes (placeholder determinístico alineado al catálogo)
      //    Si quisieras filtrar, podrías hacerlo aquí; por ahora se devuelve el set completo.
      let examenesPropuestos = [...catalogo];

      // 3) Informe IA (generado en base a datos)
      const informeIA = construirInforme({ paciente, comorbilidades, tipoCirugia });

      // 4) Valida nombres exactos
      const examenes = validarContraCatalogo(examenesPropuestos) || CATALOGO_EXAMENES;

      // 5) Persistencia (merge sin destruir lo previo)
      const prev = memoria.get(ns("preop", idPago)) || {};
      const next = {
        ...prev,
        ...paciente, // aplanado como en el resto de módulos
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
