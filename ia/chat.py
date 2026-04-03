# ia/chat.py
# Chat IA: nota breve + orden con marcadores multi-región
# Stateless — sin memoria server-side
# CONTRATO: { ok, respuesta, examenes, examenes_rm, examenes_rx, examenes_eco, examenes_otros }

import re
import logging
from typing import Any

import httpx

logger = logging.getLogger("chat_ia")

# ============================================================
# SYSTEM PROMPT
# ============================================================
SYSTEM_PROMPT = """
Eres un asistente clínico de TRAUMATOLOGÍA para pre-orientación.
Objetivo: redactar una NOTA BREVE centrada en EXÁMENES a solicitar.

Reglas:
- Español claro. Extensión total: máx. 140–170 palabras.
- NO es diagnóstico definitivo ni tratamiento. No prescribas fármacos.
- Evita alarmismo. Usa condicionales ("podría sugerir", "compatible con").
- Prioriza IMAGENOLOGÍA. Si corresponde, sugiere ECOGRAFÍA en lesiones de partes blandas (frecuente en hombro/codo/mano).
- Si hay lateralidad (Derecha/Izquierda), inclúyela explícitamente en los exámenes.
- Integra PUNTOS DOLOROSOS si existen; la explicación debe referirse a ellos cuando estén presentes.
- No repitas identificadores del paciente.

Formato EXACTO (mantén títulos y viñetas tal cual):
Diagnóstico presuntivo:
• (1 entidad clínica probable específica a la zona)
• (2ª entidad diferencial, si procede)

Explicación breve:
• (≈60–100 palabras, 1–3 frases que justifiquen el enfoque y el porqué de los exámenes; referencia a los puntos dolorosos si existen)

Examenes sugeridos:
• (EXAMEN 1 — incluir lateralidad si aplica)
• (EXAMEN 2 — complementario o alternativa razonable; incluir lateralidad si aplica)

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


def leer_marcadores_desde_body(body: dict) -> dict:
    out: dict[str, dict] = {}

    # 1) formato moderno: body.marcadores = { region: { frente, lateral, posterior } }
    marcadores = body.get("marcadores")
    if isinstance(marcadores, dict):
        for region, obj in marcadores.items():
            if isinstance(obj, dict):
                out[_slug(region)] = _san_vista(obj)

    # 2) retro-compat: body.<region>Marcadores
    for k, v in body.items():
        m = re.match(r'^([a-zA-ZñÑ]+)Marcadores$', k)
        if m and isinstance(v, dict):
            out[_slug(m.group(1))] = _san_vista(v)

    return out


def filtrar_regiones_relevantes(marcadores: dict, dolor: str = "") -> dict:
    regiones = list(marcadores.keys())
    if not regiones:
        return {}
    d = str(dolor or "").lower()
    hits = [r for r in regiones if r in d]
    if hits:
        return {r: marcadores[r] for r in hits}
    return marcadores


def _uc(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def marcadores_a_texto(m_reg: dict) -> str:
    bloques = []
    for region, vistas in m_reg.items():
        sub = []
        for vista, arr in vistas.items():
            if isinstance(arr, list) and arr:
                sub.append(f"{_uc(vista)}:\n• " + "\n• ".join(arr))
        if sub:
            bloques.append(f"{_uc(region)} — Puntos marcados\n" + "\n\n".join(sub))
    return "\n\n".join(bloques) if bloques else "Sin puntos dolorosos marcados."


# ============================================================
# TIPS CLÍNICOS
# ============================================================
def _flat_vistas(obj: dict) -> list[str]:
    out = []
    for v in obj.values():
        if isinstance(v, list):
            out.extend(v)
    return [str(s).lower() for s in out]


def _tips_rodilla(obj: dict) -> list[str]:
    t = _flat_vistas(obj)
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
    t = _flat_vistas(obj)
    has = lambda rx: any(re.search(rx, x) for x in t)
    arr = []
    if has(r'\b(subacromial|acromion|bursa\s*subacromial)\b'):           arr.append("Dolor subacromial → síndrome subacromial / supraespinoso.")
    if has(r'\b(tub[eé]rculo\s*mayor|footprint|troquiter)\b'):           arr.append("Tubérculo mayor → tendinopatía del manguito (supra/infra).")
    if has(r'\b(surco\s*bicipital|bicipital|porci[oó]n\s*larga\s*del\s*b[ií]ceps)\b'): arr.append("Surco bicipital → tendinopatía de la porción larga del bíceps.")
    if has(r'\b(acromioclavicular|acromio\-?clavicular)\b'):              arr.append("Dolor AC → artropatía acromioclavicular.")
    if has(r'\b(posterosuperior|labrum\s*superior|slap)\b'):              arr.append("Dolor posterosuperior → considerar lesión labral (SLAP).")
    return arr


def marcadores_a_tips(m_reg: dict) -> list[str]:
    tips = []
    for region, obj in m_reg.items():
        if region == "rodilla": tips.extend(_tips_rodilla(obj))
        if region == "hombro":  tips.extend(_tips_hombro(obj))
    return tips


# ============================================================
# PARSER DE EXÁMENES SUGERIDOS (hasta 2)
# ============================================================
def parse_examenes_sugeridos(text: str) -> dict:
    vacio = {"all": [], "first_two": [], "rm": [], "rx": [], "eco": [], "otros": []}
    if not text:
        return vacio

    sec = re.search(r'Examen(?:es)? sugeridos?:\s*([\s\S]*?)(?:\n\s*Indicaciones:|$)', text, re.I)
    if not sec:
        return vacio

    bloque = sec.group(1) or ""
    bullets = []
    for linea in bloque.splitlines():
        linea = linea.strip()
        if not linea:
            continue
        m = re.match(r'^[•\-\*]\s*(.+)$', linea)
        linea = (m.group(1) if m else linea).strip()
        linea = re.sub(r'\s+', ' ', linea).rstrip('.')
        if linea:
            bullets.append(linea + '.')

    first_two = bullets[:2]
    rm, rx, eco, otros = [], [], [], []

    for b in first_two:
        l = b.lower()
        if 'resonancia' in l or re.search(r'\brm\b', l):
            rm.append(b)
        elif re.search(r'\brx\b', l) or 'radiografía' in l or 'rayos x' in l:
            rx.append(b)
        elif 'ecografía' in l or 'ecografia' in l or 'ultrasonido' in l or re.search(r'\beco\b', l):
            eco.append(b)
        else:
            otros.append(b)

    return {"all": bullets, "first_two": first_two, "rm": rm, "rx": rx, "eco": eco, "otros": otros}


# ============================================================
# RECORTAR TEXTO
# ============================================================
def _recortar(s: str, max_len: int = 1200) -> str:
    if not s:
        return ""
    return s[:max_len].strip() + "…" if len(s) > max_len else s


# ============================================================
# LLAMADAS IA
# ============================================================
async def _llamar_claude(messages: list[dict], api_key: str, model: str) -> str:
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
                "messages":   messages,
            },
        )
        r.raise_for_status()
        return (r.json().get("content") or [{}])[0].get("text", "").strip()


async def _llamar_openai(messages: list[dict], api_key: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type":  "application/json",
            },
            json={
                "model":       model,
                "temperature": 0.4,
                "max_tokens":  520,
                "messages":    [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
            },
        )
        r.raise_for_status()
        return (r.json().get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


# ============================================================
# HANDLER PRINCIPAL — PREVIEW
# ============================================================
async def preview_informe(payload: dict, config: dict) -> dict:
    """
    payload: {
        idPago, consulta,
        nombre?, edad?, rut?, genero?, dolor?, lado?,
        marcadores?  (moderno o legacy)
    }
    config: { anthropic_api_key?, openai_api_key?, anthropic_model?, openai_model? }
    Retorna: { ok, respuesta, examenes, examenes_rm, examenes_rx, examenes_eco, examenes_otros }
    """
    id_pago  = payload.get("idPago") or ""
    consulta = payload.get("consulta") or ""

    if not id_pago or not consulta:
        return {"ok": False, "error": "Faltan datos obligatorios (idPago, consulta)."}

    # Datos del paciente desde el payload (stateless — no hay memoria)
    dolor  = str(payload.get("dolor") or "")
    lado   = str(payload.get("lado") or "")
    edad   = payload.get("edad")
    genero = str(payload.get("genero") or "")

    # Marcadores
    marcadores_raw = leer_marcadores_desde_body(payload)
    relevantes     = filtrar_regiones_relevantes(marcadores_raw, dolor)
    puntos_txt     = marcadores_a_texto(relevantes)
    tips_arr       = marcadores_a_tips(relevantes)
    tips_txt       = ("\n\nTips clínicos:\n• " + "\n• ".join(tips_arr)) if tips_arr else ""

    # Mensaje usuario
    user_content = (
        f"Edad: {edad or '—'}\n"
        + (f"Género: {genero}\n" if genero else "")
        + (f"Región de dolor: {dolor}{f' ({lado})' if lado else ''}\n" if dolor else "")
        + f"Consulta/Indicación (texto libre):\n{consulta}\n\n"
        + f"Puntos dolorosos marcados:\n{puntos_txt}{tips_txt}\n\n"
        + "Redacta EXACTAMENTE con el formato solicitado y dentro del límite de palabras."
    )

    messages = [{"role": "user", "content": user_content}]

    anthropic_key   = config.get("anthropic_api_key") or ""
    openai_key      = config.get("openai_api_key") or ""
    anthropic_model = config.get("anthropic_model") or "claude-sonnet-4-6"
    openai_model    = config.get("openai_model") or "gpt-4o-mini"

    respuesta = ""

    # Claude primario
    if anthropic_key:
        try:
            respuesta = await _llamar_claude(messages, anthropic_key, anthropic_model)
        except Exception as e:
            logger.warning("Claude falló chat preview: %s", e)

    # OpenAI fallback
    if not respuesta and openai_key:
        try:
            respuesta = await _llamar_openai(messages, openai_key, openai_model)
        except Exception as e:
            logger.warning("OpenAI falló chat preview: %s", e)

    if not respuesta:
        return {"ok": False, "error": "No se pudo generar el preview."}

    respuesta = _recortar(respuesta, 1200)
    parsed    = parse_examenes_sugeridos(respuesta)

    return {
        "ok":             True,
        "respuesta":      respuesta,
        "examenes":       parsed["first_two"],
        "examenes_rm":    parsed["rm"],
        "examenes_rx":    parsed["rx"],
        "examenes_eco":   parsed["eco"],
        "examenes_otros": parsed["otros"],
  }
  
