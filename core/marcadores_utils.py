# core/marcadores_utils.py
# Utilidades genéricas para puntos dolorosos por región (multi-vista)
# Sin dependencias externas — lógica pura

import re


# ============================================================
# NORMALIZAR MARCADORES DESDE BODY
# ============================================================
def normalizar_marcadores_desde_body(body: dict) -> dict:
    """
    Normaliza la entrada del request a:
    {
        "rodilla": { "frente": [], "lateral": [], "posterior": [] },
        "hombro":  { ... },
        ...
    }
    Acepta:
    - body["marcadores"]           (recomendado, múltiples regiones)
    - body["<region>Marcadores"]   (legacy: rodillaMarcadores, hombroMarcadores, etc.)
    """
    out: dict[str, dict] = {}

    # 1) Estándar recomendado
    marcadores = body.get("marcadores")
    if isinstance(marcadores, dict):
        for region, obj in marcadores.items():
            if isinstance(obj, dict):
                out[_slug(region)] = _sanitizar_por_vistas(obj)

    # 2) Legacy: <region>Marcadores
    for k, v in body.items():
        m = re.match(r'^([a-zA-ZñÑ]+)Marcadores$', k)
        if m and isinstance(v, dict):
            out[_slug(m.group(1))] = _sanitizar_por_vistas(v)

    return out


def _slug(s: str) -> str:
    return str(s).strip().lower()


def _sanitizar_por_vistas(obj: dict) -> dict:
    """Devuelve { frente:[], lateral:[], posterior:[] } + vistas adicionales."""
    norm: dict[str, list[str]] = {}
    for vista in ["frente", "lateral", "posterior"]:
        arr = obj.get(vista, [])
        norm[vista] = [
            str(x).strip() for x in (arr if isinstance(arr, list) else [])
            if str(x).strip()
        ]
    for k, v in obj.items():
        if k not in norm and isinstance(v, list):
            norm[k] = [str(x).strip() for x in v if str(x).strip()]
    return norm


# ============================================================
# SELECCIONAR REGIONES RELEVANTES
# ============================================================
def seleccionar_regiones_relevantes(marcadores: dict, dolor: str = "") -> dict:
    """
    Si `dolor` menciona una región conocida, devuelve solo esas regiones.
    Si no reconoce ninguna, devuelve todas.
    """
    regiones = list(marcadores.keys())
    if not regiones:
        return {}
    d = str(dolor or "").lower()
    hits = [r for r in regiones if r in d]
    if hits:
        return {r: marcadores[r] for r in hits}
    return marcadores


# ============================================================
# TEXTO LEGIBLE PARA PROMPT
# ============================================================
def _ucfirst(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def marcadores_a_texto_prompt(marcadores_regional: dict) -> str:
    """Texto multi-región y multi-vista para incluir en el prompt de IA."""
    bloques = []
    for region, vistas in marcadores_regional.items():
        sub = []
        for vista, arr in vistas.items():
            if isinstance(arr, list) and arr:
                sub.append(f"{_ucfirst(vista)}:\n• " + "\n• ".join(arr))
        if sub:
            bloques.append(f"{_ucfirst(region)} — Puntos marcados\n" + "\n\n".join(sub))
    return "\n\n".join(bloques) if bloques else "Sin puntos dolorosos marcados."


# ============================================================
# TIPS CLÍNICOS POR REGIÓN
# ============================================================
def _aplanar_vistas(obj: dict) -> list[str]:
    out = []
    for v in obj.values():
        if isinstance(v, list):
            out.extend(v)
    return [str(s).lower() for s in out]


def _tips_desde_listado(tokens: list[str], reglas: list[tuple]) -> list[str]:
    hay = lambda rx: any(re.search(rx, t) for t in tokens)
    return [txt for rx, txt in reglas if hay(rx)]


_MAPEADORES: dict[str, callable] = {
    "rodilla": lambda obj: _tips_desde_listado(
        _aplanar_vistas(obj),
        [
            (r'\binterl[ií]nea?\s+medial\b',    "Interlínea medial → sospecha menisco medial."),
            (r'\binterl[ií]nea?\s+lateral\b',   "Interlínea lateral → sospecha menisco lateral."),
            (r'\b(r[óo]tula|patelar|patelofemoral|ap[eé]x)\b', "Dolor patelofemoral → síndrome PF/condropatía."),
            (r'\btuberosidad\s+tibial\b',        "Tuberosidad tibial → Osgood–Schlatter / tendón rotuliano."),
            (r'\b(pes\s+anserin[oó]|pata\s+de\s+ganso)\b', "Pes anserino → tendinopatía/bursitis anserina."),
            (r'\b(gerdy|banda\s+ilio?tibial|tracto\s+ilio?tibial)\b', "Banda iliotibial/Gerdy → síndrome banda ITB."),
            (r'\bpopl[ií]tea?\b',               "Fosa poplítea → evaluar quiste de Baker."),
        ],
    ),
    "hombro": lambda obj: _tips_desde_listado(
        _aplanar_vistas(obj),
        [
            (r'\b(subacromial|acromion|bursa\s*subacromial)\b',           "Dolor subacromial → síndrome subacromial / supraespinoso."),
            (r'\b(tub[eé]rculo\s*mayor|footprint|troquiter)\b',           "Tubérculo mayor → tendinopatía del manguito (supra/infra)."),
            (r'\b(surco\s*bicipital|bicipital|porci[oó]n\s*larga\s*del\s*b[ií]ceps)\b', "Surco bicipital → tendinopatía de la porción larga del bíceps."),
            (r'\b(acromioclavicular|acromio\-?clavicular|ac)\b',          "Dolor AC → artropatía acromioclavicular."),
            (r'\b(posterosuperior|labrum\s*superior|slap)\b',             "Dolor posterosuperior → considerar lesión labral (SLAP)."),
        ],
    ),
    # Agrega aquí más regiones en el futuro (codo, tobillo, etc.)
}


def marcadores_a_tips(marcadores_regional: dict) -> list[str]:
    """Genera tips clínicos para todas las regiones presentes."""
    tips = []
    for region, obj in marcadores_regional.items():
        fn = _MAPEADORES.get(region)
        if callable(fn):
            tips.extend(fn(obj))
    return tips
  
