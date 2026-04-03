# ia/generales_ia.py
# IA Generales: recibe { idPago, paciente, comorbilidades }
# Devuelve { ok, examenes, informeIA }
# Stateless — sin memoria server-side

import re
import json
import unicodedata
import logging
from typing import Any

import httpx

logger = logging.getLogger("generales_ia")

# ============================================================
# CATÁLOGO EXACTO (coincidencia literal del PDF/Front)
# ============================================================
CATALOGO: list[str] = [
    "HEMOGRAMA",
    "VHS",
    "PCR",
    "ELECTROLITOS PLASMATICOS",
    "PERFIL BIOQUIMICO",
    "PERFIL LIPIDICO",
    "PERFIL HEPÁTICO",
    "CREATININA",
    "UREA",
    "TTPK",
    "HEMOGLOBINA GLICOSILADA",
    "VITAMINA D",
    "ORINA COMPLETA",
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
]

# Sinónimos → nombre canónico
_CANON: dict[str, str] = {
    "ORINA":               "ORINA COMPLETA",
    "PERFIL HEPATICO":     "PERFIL HEPÁTICO",
    "MAMOGRAFIA":          "MAMOGRAFÍA",
    "ANTIGENO PROSTATICO": "ANTÍGENO PROSTÁTICO",
    "RX DE TORAX":         "RX DE TÓRAX",
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

_BASE_MINIMA: list[str] = [
    "HEMOGRAMA", "VHS", "PCR", "ELECTROLITOS PLASMATICOS",
    "PERFIL BIOQUIMICO", "PERFIL LIPIDICO", "PERFIL HEPÁTICO",
    "CREATININA", "ORINA COMPLETA", "VITAMINA D",
]


# ============================================================
# HELPERS
# ============================================================
def _strip_accents(s: str) -> str:
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()


def _build_cat_upper(catalogo: list[str]) -> dict[str, str]:
    return {_strip_accents(n).upper().strip(): n for n in catalogo}


def _validar_contra_catalogo(lista: list[Any], catalogo: list[str] | None = None) -> list[str]:
    cat = catalogo or CATALOGO
    cat_upper = _build_cat_upper(cat)
    out: list[str] = []
    for it in lista:
        raw = (it if isinstance(it, str) else (it or {}).get("nombre", "")).strip()
        if not raw:
            continue
        norm = _strip_accents(raw).upper()
        canon_raw = _CANON.get(norm, raw)
        canon_key = _strip_accents(canon_raw).upper()
        if canon_key in cat_upper:
            out.append(cat_upper[canon_key])
        elif norm in cat_upper:
            out.append(cat_upper[norm])
    # deduplicar preservando orden
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]


def _resumen_comorbilidades(c: dict) -> str:
    pos = [f"• {_ETIQUETAS[k]}" for k in _ETIQUETAS if c.get(k) is True]
    return "\n".join(pos) if pos else "Sin comorbilidades relevantes reportadas."


def _texto_alergias(comorbilidades: dict) -> str:
    al = comorbilidades.get("alergias", "")
    if isinstance(al, dict):
        return al.get("detalle") or "Refiere alergias." if al.get("tiene") else "No refiere."
    return str(al).strip() or "—"


def _texto_anticoagulantes(comorbilidades: dict) -> str:
    ac = comorbilidades.get("anticoagulantes", "")
    if isinstance(ac, dict):
        if ac.get("usa"):
            detalle = ac.get("detalle", "")
            return f"Sí — {detalle}" if detalle else "Sí"
        return "No"
    return "Sí" if ac else "No"


# ============================================================
# BASAL PROGRAMÁTICA (siempre presente)
# ============================================================
def _basal_generales(paciente: dict, comorbilidades: dict) -> list[str]:
    out: set[str] = set(_BASE_MINIMA)
    edad   = _safe_edad(paciente)
    genero = str(paciente.get("genero") or "").lower()
    c      = comorbilidades

    if c.get("dm2"):          out.add("HEMOGLOBINA GLICOSILADA")
    if c.get("hipotiroidismo") or genero == "mujer": out.add("TSHm y T4 LIBRE")
    if c.get("erc"):          out.add("UROCULTIVO")

    if edad is not None and edad >= 40 or c.get("hta") or c.get("cardiopatia") or c.get("dislipidemia"):
        out.add("ECG DE REPOSO")

    if genero == "mujer":
        if edad is not None and edad >= 40: out.add("MAMOGRAFÍA")
        if edad is not None and edad >= 25: out.add("PAPANICOLAO (según edad)")
        if edad is not None and edad >= 50: out.add("CALCIO")

    if genero == "hombre":
        if edad is not None and edad >= 50:
            out.add("ANTÍGENO PROSTÁTICO")
            out.add("CEA")

    if c.get("epoc_asma") or c.get("tabaquismo"):
        out.add("RX DE TÓRAX")

    return _validar_contra_catalogo(list(out))


def _safe_edad(paciente: dict) -> int | None:
    try:
        return int(paciente.get("edad") or 0) or None
    except (ValueError, TypeError):
        return None


# ============================================================
# INFORME FALLBACK
# ============================================================
def _construir_informe_fallback(paciente: dict, comorbilidades: dict) -> str:
    nombre = paciente.get("nombre") or ""
    edad   = _safe_edad(paciente)
    lista  = _resumen_comorbilidades(comorbilidades)
    alergias    = _texto_alergias(comorbilidades)
    anticoags   = _texto_anticoagulantes(comorbilidades)
    otras       = str(comorbilidades.get("otras") or "").strip()

    c = comorbilidades
    consideraciones = []
    if c.get("dm2"):        consideraciones.append("Control glicémico (HbA1c).")
    if c.get("erc"):        consideraciones.append("Función renal / evitar nefrotóxicos.")
    if c.get("cardiopatia") or (edad and edad >= 40):
        consideraciones.append("ECG de reposo / estratificación CV.")
    if c.get("epoc_asma") or c.get("tabaquismo"):
        consideraciones.append("Optimización respiratoria.")

    lineas = [
        "Evaluación de Chequeo General (resumen)\n",
        f"Paciente: {nombre or '—'}   Edad: {edad or '—'} años",
        "",
        f"Comorbilidades:\n{lista}",
        f"Alergias: {alergias}",
        f"Anticoagulantes/antiagregantes: {anticoags}",
    ]
    if otras:
        lineas.append(f"Otras comorbilidades:\n{otras}")
    lineas += [
        "",
        "Consideraciones:",
        ("• " + "\n• ".join(consideraciones)) if consideraciones
        else "• Sin consideraciones adicionales más allá del protocolo estándar.",
    ]
    return "\n".join(lineas)


# ============================================================
# PROMPT IA (JSON)
# ============================================================
def _build_prompt(paciente: dict, comorbilidades: dict, catalogo: list[str]) -> str:
    resumen     = _resumen_comorbilidades(comorbilidades)
    alergias    = _texto_alergias(comorbilidades)
    anticoags   = _texto_anticoagulantes(comorbilidades)
    otras       = str(comorbilidades.get("otras") or "").strip()
    edad        = _safe_edad(paciente) or "—"
    nombre      = paciente.get("nombre") or "—"
    genero      = paciente.get("genero") or "—"
    base_str    = "\n  ".join(f"- {s}" for s in _BASE_MINIMA)
    cat_str     = "\n".join(f"- {s}" for s in catalogo)

    return f"""Eres un asistente clínico para CHEQUEO GENERAL (no preoperatorio).
Devuelve EXCLUSIVAMENTE un JSON válido con:
{{
  "examenes": [ /* subconjunto EXACTO del catálogo */ ],
  "informeIA": "resumen clínico (máx 140 palabras) de comorbilidades y foco del chequeo"
}}

Instrucciones:
- Incluye SIEMPRE esta base mínima si no está contraindicada:
  {base_str}
- Agrega exámenes condicionales según edad, género y comorbilidades.
- Usa SOLO nombres del catálogo; NADA fuera del catálogo.
- No prescribas fármacos ni propongas cirugías.

Catálogo permitido:
{cat_str}

Datos:
- Paciente: {nombre} ({edad} años, {genero})
- Comorbilidades marcadas:
{resumen}
- Alergias: {alergias}
- Anticoagulantes/antiagregantes: {anticoags}
- Otras (texto): {otras or "—"}""".strip()


# ============================================================
# EXTRACCIÓN ROBUSTA DE JSON
# ============================================================
def _extraer_json(texto: str) -> dict | None:
    for intentar in [
        texto,
        re.search(r"```json\s*([\s\S]*?)```", texto, re.I) and
            re.search(r"```json\s*([\s\S]*?)```", texto, re.I).group(1),
        re.search(r"```([\s\S]*?)```", texto) and
            re.search(r"```([\s\S]*?)```", texto).group(1),
        re.search(r"\{[\s\S]*\}", texto) and
            re.search(r"\{[\s\S]*\}", texto).group(0),
    ]:
        if not intentar:
            continue
        try:
            return json.loads(intentar)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


# ============================================================
# LLAMADAS IA (Claude primario → OpenAI fallback)
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
async def generales_ia(payload: dict, config: dict) -> dict:
    """
    payload: { idPago, paciente, comorbilidades, catalogoExamenes? }
    config:  { anthropic_api_key?, openai_api_key?,
               anthropic_model?, openai_model? }
    Retorna: { ok, examenes, informeIA }
    """
    id_pago       = payload.get("idPago") or ""
    paciente      = payload.get("paciente") or {}
    comorbilidades = payload.get("comorbilidades") or {}
    catalogo_raw  = payload.get("catalogoExamenes") or []

    if not id_pago or not paciente.get("nombre"):
        return {"ok": False, "error": "Faltan idPago o datos del paciente."}

    catalogo = (
        [str(s).strip() for s in catalogo_raw if s]
        if catalogo_raw else CATALOGO
    )

    examenes_ia: list[str] = []
    informe_ia  = ""

    anthropic_key  = config.get("anthropic_api_key") or ""
    openai_key     = config.get("openai_api_key") or ""
    anthropic_model = config.get("anthropic_model") or "claude-sonnet-4-6"
    openai_model    = config.get("openai_model") or "gpt-4o-mini"

    prompt = _build_prompt(paciente, comorbilidades, catalogo)

    # — Claude primario —
    if anthropic_key:
        try:
            texto   = await _llamar_claude(prompt, anthropic_key, anthropic_model)
            parsed  = _extraer_json(texto)
            if parsed and isinstance(parsed.get("examenes"), list):
                examenes_ia = _validar_contra_catalogo(parsed["examenes"], catalogo)
            if parsed and isinstance(parsed.get("informeIA"), str):
                informe_ia = parsed["informeIA"].strip()
        except Exception as e:
            logger.warning("Claude falló ia-generales: %s", e)

    # — OpenAI fallback —
    if not examenes_ia and openai_key:
        try:
            texto   = await _llamar_openai(prompt, openai_key, openai_model)
            parsed  = _extraer_json(texto)
            if parsed and isinstance(parsed.get("examenes"), list):
                examenes_ia = _validar_contra_catalogo(parsed["examenes"], catalogo)
            if parsed and isinstance(parsed.get("informeIA"), str):
                informe_ia = parsed["informeIA"].strip()
        except Exception as e:
            logger.warning("OpenAI falló ia-generales: %s", e)

    # — Basal programática SIEMPRE incluida —
    base = _basal_generales(paciente, comorbilidades)
    examenes_final = _validar_contra_catalogo(examenes_ia + base, catalogo)

    if not informe_ia:
        informe_ia = _construir_informe_fallback(paciente, comorbilidades)

    return {"ok": True, "examenes": examenes_final, "informeIA": informe_ia}
  
