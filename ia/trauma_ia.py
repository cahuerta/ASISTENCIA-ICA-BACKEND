# ia/trauma_ia.py
# TRAUMA IA — nota breve estricta: 1 diagnóstico + 1 examen
# Claude primario → OpenAI fallback → heurístico
# Stateless — sin memoria server-side
# CONTRATO: { ok, diagnostico, examenes[1], justificacion, informeIA }

import re
import logging
from typing import Any

import httpx

from fallbacks.trauma import fallback_trauma

logger = logging.getLogger("trauma_ia")

# ============================================================
# SYSTEM PROMPT
# ============================================================
SYSTEM_PROMPT = """
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA BREVE centrada en EXÁMENES a solicitar.

Reglas (ESTRICTAS):
- Español claro. Extensión total: 140–170 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales ("podría sugerir", "compatible con").
- Prioriza IMAGENOLOGÍA. Si corresponde, sugiere ECOGRAFÍA en lesiones de partes blandas (p. ej., hombro/codo/mano en pacientes jóvenes).
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en el examen.
- Integra PUNTOS DOLOROSOS si existen; la explicación debe referirse a ellos cuando estén presentes.
- **EXACTAMENTE 1** diagnóstico presuntivo.
- **EXACTAMENTE 1** examen sugerido.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (una sola entidad clínica específica a la zona)

Explicación breve:
• (≈60–100 palabras, 1–3 frases que justifiquen el enfoque y el porqué del examen; referencia a los puntos dolorosos si existen)

Exámenes sugeridos:
• (UN SOLO EXAMEN — incluir lateralidad si aplica)

Indicaciones:
• Presentarse con la orden; ayuno solo si el examen lo solicita.
• Acudir a evaluación presencial con el/la especialista sugerido/a.

Devuelve SOLO el texto en este formato (sin comentarios adicionales).
""".strip()


# ============================================================
# MARCADORES — helpers retro-compat
# ============================================================
def _slug(s: str) -> str:
    return str(s).strip().lower()


def _san_vista(obj: dict) -> dict:
    norm: dict[str, list[str]] = {}
    for vista in ["frente", "lateral", "posterior"]:
        arr = obj.get(vista, [])
        norm[vista] = [str(x).strip() for x in (arr if isinstance(arr, list) else []) if str(x).strip()]
    for k, v in obj.items():
        if k not in norm and isinstance(v, list):
            norm[k] = [str(x).strip() for x in v if str(x).strip()]
    return norm


def _leer_marcadores_desde_body(body: dict) -> dict:
    out: dict[str, dict] = {}
    marcadores = body.get("marcadores")
    if isinstance(marcadores, dict):
        for region, obj in marcadores.items():
            if isinstance(obj, dict):
                out[_slug(region)] = _san_vista(obj)
    for k, v in body.items():
        m = re.match(r'^([a-zA-ZñÑ]+)Marcadores$', k)
        if m and isinstance(v, dict):
            out[_slug(m.group(1))] = _san_vista(v)
    return out


def _filtrar_regiones_relevantes(marcadores: dict, dolor: str = "") -> dict:
    regiones = list(marcadores.keys())
    if not regiones:
        return {}
    d = str(dolor or "").lower()
    hits = [r for r in regiones if r in d]
    return {r: marcadores[r] for r in hits} if hits else marcadores


def _uc(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def _marcadores_a_texto(m_reg: dict) -> str:
    bloques = []
    for region, vistas in m_reg.items():
        sub = []
        for vista, arr in vistas.items():
            if isinstance(arr, list) and arr:
                sub.append(f"{_uc(vista)}:\n• " + "\n• ".join(arr))
        if sub:
            bloques.append(f"{_uc(region)} — Puntos marcados\n" + "\n\n".join(sub))
    return "\n\n".join(bloques) if bloques else "Sin puntos dolorosos marcados."


def _flat(obj: dict) -> list[str]:
    out = []
    for v in obj.values():
        if isinstance(v, list):
            out.extend(v)
    return [str(s).lower() for s in out]


def _tips_rodilla(obj: dict) -> list[str]:
    t = _flat(obj)
    has = lambda rx: any(re.search(rx, x) for x in t)
    arr = []
    if has(r'\binterl[ií]nea?\s+medial\b'):    arr.append("Interlínea medial → sospecha menisco medial.")
    if has(r'\binterl[ií]nea?\s+lateral\b'):   arr.append("Interlínea lateral → sospecha menisco lateral.")
    if has(r'\b(r[óo]tula|patelar|patelofemoral|ap[eé]x)\b'): arr.append("Dolor patelofemoral → síndrome PF/condropatía.")
    if has(r'\btuberosidad\s+tibial\b'):        arr.append("Tuberosidad tibial → Osgood–Schlatter / tendón rotuliano.")
    if has(r'\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b'): arr.append("Pes anserino → tendinopatía/bursitis anserina.")
    if has(r'\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b'): arr.append("Banda ITB/Gerdy → síndrome banda ITB.")
    if has(r'\bpopl[ií]tea?\b'):                arr.append("Fosa poplítea → evaluar quiste de Baker.")
    return arr


def _tips_hombro(obj: dict) -> list[str]:
    t = _flat(obj)
    has = lambda rx: any(re.search(rx, x) for x in t)
    arr = []
    if has(r'\b(subacromial|acromion|bursa\s*subacromial)\b'):           arr.append("Dolor subacromial → síndrome subacromial / supraespinoso.")
    if has(r'\b(tub[eé]rculo\s*mayor|footprint|troquiter)\b'):           arr.append("Tubérculo mayor → tendinopatía del manguito (supra/infra).")
    if has(r'\b(surco\s*bicipital|bicipital|porci[oó]n\s*larga\s*del\s*b[ií]ceps)\b'): arr.append("Surco bicipital → tendinopatía de la porción larga del bíceps.")
    if has(r'\b(acromioclavicular|acromio\-?clavicular)\b'):              arr.append("Dolor AC → artropatía acromioclavicular.")
    if has(r'\b(posterosuperior|labrum\s*superior|slap)\b'):              arr.append("Dolor posterosuperior → considerar lesión labral (SLAP).")
    return arr


def _tips_desde_marcadores(m_reg: dict) -> list[str]:
    tips = []
    for region, obj in m_reg.items():
        if region == "rodilla": tips.extend(_tips_rodilla(obj))
        if region == "hombro":  tips.extend(_tips_hombro(obj))
    return tips


# ============================================================
# NORMALIZAR EXAMEN
# ============================================================
def _normalizar_examen(examen: str, dolor: str = "", lado: str = "") -> str:
    x = str(examen or "").strip()
    if not x:
        return ""
    x = x.upper()
    if not x.endswith("."):
        x += "."
    lado_u = str(lado or "").upper()
    lat    = f" {lado_u}" if lado_u else ""
    if (
        re.search(r'\b(CADERA|RODILLA|HOMBRO|TOBILLO|PIERNA|BRAZO|CODO|MUÑECA|MANO|PIE)\b', x)
        and lat
        and not re.search(r'\b(IZQUIERDA|DERECHA)\b', x)
    ):
        x = x.rstrip(".") + lat + "."
    if re.search(r'ECOGRAF[ÍI]A.*PARTES\s+BLANDAS', x) and "DE" not in x:
        zona = str(dolor or "").upper()
        if zona and "COLUMNA" not in zona:
            x = f"ECOGRAFÍA DE PARTES BLANDAS DE {zona}{lat}.".upper()
    return x


# ============================================================
# FALLBACK HEURÍSTICO
# ============================================================
def _fallback_heuristico(p: dict) -> dict:
    return fallback_trauma(p)


# ============================================================
# CONSTRUIR MENSAJE USUARIO
# ============================================================
def _construir_mensaje_usuario(p: dict) -> str:
    dolor  = str(p.get("dolor") or "")
    lado   = str(p.get("lado") or "")
    edad   = p.get("edad")
    genero = str(p.get("genero") or "")
    marc   = (p.get("detalles") or {}).get("marcadores") or {}

    puntos_txt = _marcadores_a_texto(marc)
    tips_arr   = _tips_desde_marcadores(marc)
    tips_txt   = ("\n\nTips clínicos:\n• " + "\n• ".join(tips_arr)) if tips_arr else ""

    return (
        f"Edad: {edad or '—'}\n"
        + (f"Género: {genero}\n" if genero else "")
        + (f"Región de dolor: {dolor}{f' ({lado})' if lado else ''}\n" if dolor else "")
        + f"Puntos dolorosos marcados:\n{puntos_txt}{tips_txt}\n\n"
        + "Redacta EXACTAMENTE con el formato solicitado y el carácter ESTRICTO de 1 diagnóstico y 1 examen."
    )


# ============================================================
# PARSE SECCIONES
# ============================================================
def _parse_secciones(text: str) -> dict:
    out = {"diagnostico": "", "explicacion": "", "examen": ""}
    if not text:
        return out

    def _bullets(block: str) -> list[str]:
        result = []
        for linea in block.splitlines():
            linea = linea.strip()
            if not linea:
                continue
            m = re.match(r'^[•\-\*]\s*(.+)$', linea)
            result.append((m.group(1) if m else linea).strip())
        return [s for s in result if s]

    sec_dx = re.search(r'Diagn[oó]stico presuntivo:\s*([\s\S]*?)(?:\n\s*Explicaci[oó]n breve:|$)', text, re.I)
    if sec_dx:
        out["diagnostico"] = (_bullets(sec_dx.group(1)) or [""])[0]

    sec_exp = re.search(r'Explicaci[oó]n breve:\s*([\s\S]*?)(?:\n\s*Ex[aá]menes sugeridos:|$)', text, re.I)
    if sec_exp:
        out["explicacion"] = " ".join(_bullets(sec_exp.group(1))).strip()

    sec_ex = re.search(r'Ex[aá]men(?:es)? sugeridos?:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)', text, re.I)
    if sec_ex:
        bullets = [re.sub(r'\s*\.\s*$', '.', b) for b in _bullets(sec_ex.group(1))]
        out["examen"] = bullets[0] if bullets else ""

    return out


# ============================================================
# LLAMADAS IA
# ============================================================
async def _llamar_claude(user_msg: str, api_key: str, model: str) -> str:
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
                "max_tokens": 600,
                "system":     SYSTEM_PROMPT,
                "messages":   [{"role": "user", "content": user_msg}],
            },
        )
        r.raise_for_status()
        return (r.json().get("content") or [{}])[0].get("text", "").strip()


async def _llamar_openai(user_msg: str, api_key: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type":  "application/json",
            },
            json={
                "model":       model,
                "temperature": 0.35,
                "max_tokens":  520,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": user_msg},
                ],
            },
        )
        r.raise_for_status()
        return (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


# ============================================================
# HANDLER PRINCIPAL
# ============================================================
async def trauma_ia(payload: dict, config: dict) -> dict:
    """
    payload: {
        idPago, paciente?, detalles?, traumaJSON?
    }
    config: {
        anthropic_api_key?, openai_api_key?,
        anthropic_model?,   openai_model?
    }
    Retorna: { ok, diagnostico, examenes[1], justificacion, informeIA }
    """
    id_pago      = payload.get("idPago") or ""
    paciente     = payload.get("paciente") or {}
    detalles     = payload.get("detalles") or {}
    trauma_json  = payload.get("traumaJSON")

    if not id_pago:
        return {"ok": False, "error": "Falta idPago"}

    marcadores_all = _leer_marcadores_desde_body(payload)

    if isinstance(trauma_json, dict):
        pac_tj = trauma_json.get("paciente") or {}
        paciente = {**paciente, **pac_tj}
        marc_tj  = trauma_json.get("marcadores") or {}
        if marc_tj:
            marcadores_all = marc_tj
        marc_relev = _filtrar_regiones_relevantes(
            marcadores_all, pac_tj.get("dolor") or paciente.get("dolor") or ""
        )
        detalles = {
            **detalles,
            "marcadores": marc_relev,
            "resonancia": trauma_json.get("resonancia"),
        }
    else:
        marc_relev = _filtrar_regiones_relevantes(
            marcadores_all, paciente.get("dolor") or ""
        )
        detalles = {**detalles, "marcadores": marc_relev}

    p = {**paciente, "detalles": detalles}

    anthropic_key   = config.get("anthropic_api_key") or ""
    openai_key      = config.get("openai_api_key") or ""
    anthropic_model = config.get("anthropic_model") or "claude-sonnet-4-6"
    openai_model    = config.get("openai_model") or "gpt-4o-mini"

    texto_ia  = ""
    proveedor = "fallback"
    out: dict | None = None

    user_msg = _construir_mensaje_usuario(p)

    # — Claude primario —
    if anthropic_key:
        try:
            texto_ia  = await _llamar_claude(user_msg, anthropic_key, anthropic_model)
            proveedor = "claude"
        except Exception as e:
            logger.warning("Claude falló trauma_ia: %s", e)

    # — OpenAI fallback —
    if not texto_ia and openai_key:
        try:
            texto_ia  = await _llamar_openai(user_msg, openai_key, openai_model)
            proveedor = "openai"
        except Exception as e:
            logger.warning("OpenAI falló trauma_ia: %s", e)

    if texto_ia:
        parsed = _parse_secciones(texto_ia)
        dx_ok  = str(parsed["diagnostico"]).strip()
        ex_ok  = _normalizar_examen(parsed["examen"], p.get("dolor"), p.get("lado"))
        just   = parsed["explicacion"] or "Justificación clínica basada en región y puntos dolorosos."
        if dx_ok and ex_ok:
            out = {"diagnostico": dx_ok, "examen": ex_ok, "justificacion": just}

    if not out:
        out = _fallback_heuristico(p)
        proveedor = "fallback"

    return {
        "ok":           True,
        "diagnostico":  out["diagnostico"],
        "examenes":     [out["examen"]],
        "justificacion": out["justificacion"],
        "informeIA":    out["justificacion"],
        "_debug": {
            "texto_bruto": texto_ia,
            "proveedor":   proveedor,
        },
  }
  
