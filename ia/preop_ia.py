# ia/preop_ia.py
# IA Pre Op: recibe { idPago, paciente, comorbilidades, tipoCirugia }
# Devuelve { ok, examenes, informeIA }
# Stateless — sin memoria server-side

import re
import json
import logging
from typing import Any

import httpx

logger = logging.getLogger("preop_ia")

# ============================================================
# CATÁLOGO EXACTO
# ============================================================
CATALOGO_EXAMENES: list[str] = [
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
]

_CANON: set[str] = set(CATALOGO_EXAMENES)

_ALIAS: dict[str, str] = {
    "HEMOGRAMA":                              "HEMOGRAMA MAS VHS",
    "VELOCIDAD DE SEDIMENTACION":             "VHS",
    "V.S.G.":                                 "VHS",
    "GLUCOSA":                                "GLICEMIA",
    "APTT":                                   "TTPA",
    "A PTT":                                  "TTPA",
    "A-PTT":                                  "TTPA",
    "TIEMPO DE PROTROMBINA":                  "TP/INR",
    "INR":                                    "TP/INR",
    "COAGULOGRAMA":                           "PERFIL DE COAGULACION (TP/INR y TTPA)",
    "ORINA":                                  "ORINA COMPLETA",
    "EXAMEN DE ORINA":                        "ORINA COMPLETA",
    "ECG":                                    "ECG DE REPOSO",
    "ELECTROCARDIOGRAMA":                     "ECG DE REPOSO",
    "RX DE TORAX":                            "RADIOGRAFIA DE TORAX",
    "RX TORAX":                               "RADIOGRAFIA DE TORAX",
    "RADIOGRAFIA TORAX":                      "RADIOGRAFIA DE TORAX",
    "PASE ODONTOLÓGICO":                      "PASE ODONTOLOGICO",
    "PASE DE ODONTOLOGIA":                    "PASE ODONTOLOGICO",
    "EVALUACION ODONTOLOGICA PREOPERATORIA":  "PASE ODONTOLOGICO",
}

_ETIQUETAS: dict[str, str] = {
    "hta":                 "Hipertensión arterial",
    "dm2":                 "Diabetes mellitus tipo 2",
    "dislipidemia":        "Dislipidemia",
    "obesidad":            "Obesidad",
    "tabaquismo":          "Tabaquismo",
    "epoc_asma":           "EPOC / Asma",
    "cardiopatia":         "Cardiopatía",
    "erc":                 "Enfermedad renal crónica",
    "hipotiroidismo":      "Hipotiroidismo",
    "anticoagulantes":     "Uso de anticoagulantes/antiagregantes",
    "artritis_reumatoide": "Artritis reumatoide / autoinmune",
}


# ============================================================
# HELPERS
# ============================================================
def _normalizar_nombre(raw: str) -> str | None:
    key = str(raw or "").strip().upper()
    if key in _CANON:
        return key
    return _ALIAS.get(key)


def _validar_contra_catalogo(lista: list[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for it in lista:
        raw = it if isinstance(it, str) else (it or {}).get("nombre", "")
        norm = _normalizar_nombre(str(raw))
        if norm and norm not in seen:
            out.append(norm)
            seen.add(norm)
    return out


def _resumen_comorbilidades(c: dict) -> str:
    pos = [f"• {_ETIQUETAS[k]}" for k in _ETIQUETAS if c.get(k) is True]
    return "\n".join(pos) if pos else "Sin comorbilidades relevantes reportadas."


def _texto_alergias(c: dict) -> str:
    al = c.get("alergias", "")
    if isinstance(al, dict):
        return al.get("detalle") or "Refiere alergias." if al.get("tiene") else "No refiere."
    return str(al).strip() or "—"


def _texto_anticoagulantes(c: dict) -> str:
    ac = c.get("anticoagulantes", "")
    if isinstance(ac, dict):
        if ac.get("usa"):
            detalle = ac.get("detalle", "")
            return f"Sí — {detalle}" if detalle else "Sí"
        return "No"
    return "Sí" if ac else "No"


def _safe_edad(paciente: dict) -> int | None:
    try:
        return int(paciente.get("edad") or 0) or None
    except (ValueError, TypeError):
        return None


def _es_artro(tipo_cirugia: str) -> bool:
    return bool(re.search(r"ARTROPLASTIA", str(tipo_cirugia or "").upper()))


# ============================================================
# INFORME FALLBACK
# ============================================================
def _construir_informe_fallback(paciente: dict, comorbilidades: dict, tipo_cirugia: str) -> str:
    nombre      = paciente.get("nombre") or ""
    edad        = _safe_edad(paciente)
    dolor       = paciente.get("dolor") or "—"
    lado        = paciente.get("lado") or ""
    cirugia_txt = tipo_cirugia or "No especificada"
    lista       = _resumen_comorbilidades(comorbilidades)
    alergias    = _texto_alergias(comorbilidades)
    anticoags   = _texto_anticoagulantes(comorbilidades)
    otras       = str(comorbilidades.get("otras") or "").strip()

    c = comorbilidades
    consideraciones = []
    if c.get("dm2"):
        consideraciones.append("Control glicémico (HbA1c).")
    if c.get("erc"):
        consideraciones.append("Evaluar función renal / evitar nefrotóxicos.")
    if c.get("cardiopatia") or (edad and edad >= 60):
        consideraciones.append("ECG de reposo y evaluación cardiovascular según riesgo.")
    if c.get("epoc_asma") or c.get("tabaquismo"):
        consideraciones.append("Optimización respiratoria.")
    if c.get("anticoagulantes") is True or (isinstance(c.get("anticoagulantes"), dict) and c["anticoagulantes"].get("usa")):
        consideraciones.append("Plan suspensión o puente de anticoagulación.")

    lineas = [
        "Evaluación Preoperatoria (resumen)\n",
        f"Paciente: {nombre or '—'}   Edad: {edad or '—'} años",
        f"Motivo/Área: {dolor} {lado}".strip(),
        f"Cirugía planificada: {cirugia_txt}",
        "",
        f"Comorbilidades:\n{lista}",
        f"Alergias: {alergias}",
        f"Anticoagulantes/antiagregantes: {anticoags}",
    ]
    if otras:
        lineas.append(f"Otras comorbilidades:\n{otras}")
    lineas += [
        "",
        "Consideraciones preoperatorias:",
        ("• " + "\n• ".join(consideraciones)) if consideraciones
        else "• Sin consideraciones adicionales más allá del protocolo estándar.",
    ]
    return "\n".join(lineas)


# ============================================================
# BASALES DETERMINISTAS
# ============================================================
def _examenes_basales(paciente: dict, comorbilidades: dict, tipo_cirugia: str) -> list[str]:
    edad    = _safe_edad(paciente)
    mayor60 = edad is not None and edad >= 60
    artro   = _es_artro(tipo_cirugia)
    c       = comorbilidades

    add: set[str] = {
        "HEMOGRAMA MAS VHS", "PCR", "GLICEMIA",
        "ELECTROLITOS PLASMATICOS", "PERFIL BIOQUIMICO", "PERFIL HEPATICO",
        "CREATININA", "UREA", "ORINA COMPLETA", "UROCULTIVO", "GRUPO Y RH",
        "PERFIL DE COAGULACION (TP/INR y TTPA)", "TP/INR", "TTPK",
        "ECG DE REPOSO",
    }

    if artro:
        add.add("PRUEBAS CRUZADAS (2U)")
        add.add("PASE ODONTOLOGICO")

    if c.get("dm2") or c.get("obesidad"):
        add.add("HEMOGLOBINA GLICOSILADA")

    if mayor60 or c.get("epoc_asma") or c.get("tabaquismo") or c.get("cardiopatia"):
        add.add("RADIOGRAFIA DE TORAX")

    return _validar_contra_catalogo(list(add))


# ============================================================
# PROMPT IA
# ============================================================
def _build_prompt(paciente: dict, comorbilidades: dict, tipo_cirugia: str,
                  catalogo: list[str], basales: list[str]) -> str:
    resumen  = _resumen_comorbilidades(comorbilidades)
    artro    = _es_artro(tipo_cirugia)
    edad     = _safe_edad(paciente) or "—"
    nombre   = paciente.get("nombre") or "—"
    dolor    = paciente.get("dolor") or "—"
    lado     = paciente.get("lado") or ""
    cat_str  = "\n".join(f"- {s}" for s in catalogo)
    base_str = "\n".join(f"- {s}" for s in basales)

    reglas_artro = (
        "- Contexto: ARTROPLASTIA. Los basales ya incluyen coagulación, cruzadas, odontológico. "
        "Solo agrega lo faltante por comorbilidades. Si nada falta, devuelve lista vacía."
        if artro else
        "- Hay basales predefinidos. Solo agrega del catálogo lo faltante por comorbilidades/edad. "
        "Si nada falta, devuelve lista vacía."
    )

    return f"""Eres un asistente clínico para evaluación PREOPERATORIA.
Devuelve EXCLUSIVAMENTE un JSON válido:
{{
  "examenes": [ /* SOLO nombres exactos del catálogo, adicionales a los basales */ ],
  "informeIA": "texto breve en español (≤140 palabras) con consideraciones preoperatorias"
}}

Reglas:
- Usa únicamente ítems del catálogo (coincidencia literal).
- No prescribas fármacos.
{reglas_artro}

Catálogo permitido:
{cat_str}

Exámenes basales ya incluidos:
{base_str}

Datos:
- Paciente: {nombre} / {edad} años
- Cirugía planificada: {tipo_cirugia or "No especificada"}
- Motivo/Área: {dolor} {lado}
- Comorbilidades:
{resumen}""".strip()


# ============================================================
# EXTRACCIÓN ROBUSTA DE JSON
# ============================================================
def _extraer_json(texto: str) -> dict | None:
    for candidato in [
        texto,
        (re.search(r"```json\s*([\s\S]*?)```", texto, re.I) or re.search(r"```([\s\S]*?)```", texto) or type("", (), {"group": lambda s, n: None})()).group(1),
        (re.search(r"\{[\s\S]*\}", texto) or type("", (), {"group": lambda s, n: None})()).group(0),
    ]:
        if not candidato:
            continue
        try:
            return json.loads(candidato)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


# ============================================================
# LLAMADAS IA
# ============================================================
async def _llamar_claude(prompt: str, api_key: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      model,
                "max_tokens": 500,
                "system":     "Devuelve únicamente JSON válido según las reglas dadas.",
                "messages":   [{"role": "user", "content": prompt}],
            },
        )
        r.raise_for_status()
        return (r.json().get("content") or [{}])[0].get("text", "").strip()


async def _llamar_openai(prompt: str, api_key: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type":  "application/json",
            },
            json={
                "model":       model,
                "temperature": 0.2,
                "max_tokens":  450,
                "messages": [
                    {"role": "system", "content": "Devuelve únicamente JSON válido según las reglas dadas."},
                    {"role": "user",   "content": prompt},
                ],
            },
        )
        r.raise_for_status()
        return (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


# ============================================================
# HANDLER PRINCIPAL
# ============================================================
async def preop_ia(payload: dict, config: dict) -> dict:
    """
    payload: { idPago, paciente, comorbilidades, tipoCirugia?, catalogoExamenes? }
    config:  { anthropic_api_key?, openai_api_key?, anthropic_model?, openai_model? }
    Retorna: { ok, examenes, informeIA }
    """
    id_pago        = payload.get("idPago") or ""
    paciente       = payload.get("paciente") or {}
    comorbilidades = payload.get("comorbilidades") or {}
    tipo_cirugia   = str(payload.get("tipoCirugia") or "")
    catalogo_raw   = payload.get("catalogoExamenes") or []

    if not id_pago or not paciente.get("nombre"):
        return {"ok": False, "error": "Faltan idPago o datos del paciente."}

    catalogo = (
        [str(s).strip() for s in catalogo_raw if s]
        if catalogo_raw else CATALOGO_EXAMENES
    )

    anthropic_key   = config.get("anthropic_api_key") or ""
    openai_key      = config.get("openai_api_key") or ""
    anthropic_model = config.get("anthropic_model") or "claude-sonnet-4-6"
    openai_model    = config.get("openai_model") or "gpt-4o-mini"

    # 1) Basales deterministas
    base = _examenes_basales(paciente, comorbilidades, tipo_cirugia)

    # 2) IA para extras sobre los basales
    extras: list[str] = []
    informe_ia = ""
    prompt = _build_prompt(paciente, comorbilidades, tipo_cirugia, catalogo, base)

    if anthropic_key:
        try:
            texto  = await _llamar_claude(prompt, anthropic_key, anthropic_model)
            parsed = _extraer_json(texto)
            if parsed and isinstance(parsed.get("examenes"), list):
                extras = _validar_contra_catalogo(parsed["examenes"])
            if parsed and isinstance(parsed.get("informeIA"), str):
                informe_ia = parsed["informeIA"].strip()
        except Exception as e:
            logger.warning("Claude falló ia-preop: %s", e)

    if not extras and openai_key:
        try:
            texto  = await _llamar_openai(prompt, openai_key, openai_model)
            parsed = _extraer_json(texto)
            if parsed and isinstance(parsed.get("examenes"), list):
                extras = _validar_contra_catalogo(parsed["examenes"])
            if parsed and isinstance(parsed.get("informeIA"), str):
                informe_ia = parsed["informeIA"].strip()
        except Exception as e:
            logger.warning("OpenAI falló ia-preop: %s", e)

    # 3) Mezcla final: basales ∪ extras (deduplicado, orden preservado)
    seen: set[str] = set()
    examenes: list[str] = []
    for e in base + extras:
        if e not in seen:
            examenes.append(e)
            seen.add(e)

    # 4) Informe fallback si IA no entregó
    if not informe_ia:
        informe_ia = _construir_informe_fallback(paciente, comorbilidades, tipo_cirugia)

    return {"ok": True, "examenes": examenes, "informeIA": informe_ia}
  
