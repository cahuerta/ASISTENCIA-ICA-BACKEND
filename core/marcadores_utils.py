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
    if not bloques:
        return "Sin puntos dolorosos marcados."
    texto = "\n\n".join(bloques)
    if any(isinstance(v, dict) and v.get("puntos") for v in marcadores_regional.values()):
        texto = ("(Puntos marcados por el paciente en un cuerpo 3D: indican dónde siente el dolor. "
                 "Si dicen músculo o hueso es lo que el paciente tocó, no un diagnóstico; "
                 "lo 'posible' (p. ej. menisco) se deduce de la ubicación.)\n\n" + texto)
    return texto


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


# Las reglas aceptan los nombres de los esquemas antiguos y los del cuerpo 3D (atlas):
# "Hueso: tibia (meseta tibial medial) — cara medial, a nivel de la articulación ·
#  interlínea medial (posible menisco medial)", "Músculo: vasto medial — ...", "Piel sobre ...".
_R = lambda reglas: (lambda obj: _tips_desde_listado(_aplanar_vistas(obj), reglas))

_MAPEADORES: dict[str, callable] = {
    "rodilla": _R([
        (r'interl[ií]nea?\s+medial|menisco\s+medial',                 "Interlínea medial → sospecha menisco medial."),
        (r'interl[ií]nea?\s+lateral|menisco\s+lateral',               "Interlínea lateral → sospecha menisco lateral."),
        (r'r[óo]tula|patelar|patelofemoral|tr[óo]clea|ap[eé]x',         "Dolor patelofemoral → síndrome PF/condropatía."),
        (r'tuberosidad\s+(anterior\s+de\s+la\s+)?tibia|tendón\s+rotuliano|polo\s+inferior', "Tuberosidad tibial / polo inferior → tendón rotuliano / Osgood–Schlatter."),
        (r'pes\s+anserin|pata\s+de\s+ganso|(sartorio|gr[aá]cil|semitendinoso).*por debajo', "Pes anserino → tendinopatía/bursitis anserina."),
        (r'gerdy|(banda|tracto|cintilla)\s+ilio?tibial',              "Banda iliotibial/Gerdy → síndrome banda ITB."),
        (r'popl[ií]te|cara posterior, a nivel de la articulaci',        "Fosa poplítea → evaluar quiste de Baker."),
        (r'c[óo]ndilo\s+femoral|meseta\s+tibial',                     "Cóndilo/meseta → considerar lesión condral, edema óseo o artrosis del compartimento."),
        (r'gastrocnemio|gemelo',                                         "Gastrocnemio → considerar desgarro muscular (pierna del tenista)."),
        (r'cabeza\s+del\s+peron',                                      "Cabeza del peroné → considerar lesión de esquina posterolateral / bíceps femoral."),
    ]),
    "hombro": _R([
        (r'subacromial|acromion\b|bursa\s*subacromial|supraespinoso', "Dolor subacromial → síndrome subacromial / supraespinoso."),
        (r'tub[eé]rculo\s*mayor|footprint|troqu[ií]ter|infraespinoso',  "Tubérculo mayor → tendinopatía del manguito (supra/infra)."),
        (r'surco\s*bicipital|corredera\s+bicipital|bicipital|b[ií]ceps\s+braquial\s*\(porci[oó]n\s*larga', "Surco bicipital → tendinopatía de la porción larga del bíceps."),
        (r'acromio\-?clavicular|\bac\b|extremo\s+acromial',          "Dolor AC → artropatía acromioclavicular."),
        (r'posterosuperior|labrum\s*superior|slap',                     "Dolor posterosuperior → considerar lesión labral (SLAP)."),
        (r'subescapular|troqu[ií]n|coracoides',                          "Anterior / troquín → considerar subescapular o coracoiditis."),
        (r'deltoides',                                                   "Dolor en el deltoides → suele ser dolor referido del manguito rotador."),
    ]),
    "cadera": _R([
        (r'trocánter\s+mayor|glúteo\s+medio|glúteo\s+menor|bursa\s+trocant', "Región trocantérica → tendinopatía glútea / bursitis trocantérica."),
        (r'cabeza\s+y\s+cuello\s+femoral|acet[áa]bulo|inguinal|ingle|psoas|il[ií]aco', "Ingle / anterior profunda → patología intraarticular (artrosis, choque femoroacetabular, lesión labral)."),
        (r'tuberosidad\s+isqui|isquiotibial|semitendinoso|semimembranoso|b[ií]ceps\s+femoral', "Tuberosidad isquiática → tendinopatía isquiotibial proximal."),
        (r'sacroil[ií]ac|sacro\b',                                       "Región sacroilíaca → considerar disfunción sacroilíaca o dolor lumbar referido."),
        (r'piriforme',                                                    "Glúteo profundo / piriforme → considerar síndrome del glúteo profundo."),
        (r'aductor|rama\s+del\s+pubis|s[ií]nfisis|grácil',             "Aductores / pubis → pubalgia / tendinopatía de aductores."),
        (r'espina\s+il[ií]aca\s+anterosuperior|tensor\s+de\s+la\s+fascia|sartorio', "EIAS → considerar entesopatía o meralgia parestésica."),
    ]),
    "codo": _R([
        (r'epic[óo]ndilo\s+lateral|extensor\s+radial\s+corto|extensor\s+de\s+los\s+dedos', "Epicóndilo lateral → epicondilitis lateral."),
        (r'epic[óo]ndilo\s+medial|epitr[óo]clea|pronador\s+redondo|flexor\s+radial|flexor\s+cubital', "Epicóndilo medial → epicondilitis medial (epitrocleítis)."),
        (r'ol[ée]cranon|tr[ií]ceps',                                      "Olécranon → bursitis olecraniana / tendinopatía tricipital."),
        (r'cabeza\s+del\s+radio',                                       "Cabeza del radio → considerar fractura o sinovitis radiocapitelar."),
        (r'b[ií]ceps\s+braquial|braquial\b',                            "Anterior → considerar tendinopatía o rotura del bíceps distal."),
    ]),
    "mano": _R([
        (r'estiloides\s+radial|abductor\s+largo\s+del\s+pulgar|radio\s+distal', "Estiloides radial → tenosinovitis de De Quervain."),
        (r'1er\s+metacarpiano|trapecio|oponente\s+del\s+pulgar',     "Base del pulgar → rizartrosis (artrosis trapeciometacarpiana)."),
        (r'escafoides|tabaquera',                                         "Escafoides / tabaquera anatómica → descartar fractura de escafoides."),
        (r'cara palmar.*(metacarpiano|falange\s+proximal)|polea\s+a1|lumbricales', "Palmar a nivel de la base del dedo → dedo en gatillo."),
        (r'cara palmar, a nivel de la mu[ñn]eca|t[úu]nel\s+carpiano|semilunar.*palmar', "Palmar en la muñeca → considerar síndrome del túnel carpiano."),
        (r'estiloides\s+cubital|extensor\s+cubital|piramidal|tfcc',   "Lado cubital de la muñeca → TFCC / tendinopatía del extensor cubital."),
    ]),
    "tobillo": _R([
        (r'mal[ée]olo\s+lateral|perone[oa]\s+(largo|corto)',          "Maléolo lateral → esguince lateral / tendinopatía peronea."),
        (r'aquiles',                                                      "Tendón de Aquiles → tendinopatía aquiliana."),
        (r'calc[áa]neo.*plantar|cara plantar del calc|flexor\s+corto\s+de\s+los\s+dedos', "Talón plantar → fascitis plantar."),
        (r'(2°|3er|4°)\s+metatarsiano.*plantar|plantar.*(2°|3er|4°)\s+metatarsiano', "Antepié plantar → metatarsalgia / neuroma de Morton."),
        (r'1er\s+metatarsiano|dedo\s+gordo',                           "Primer radio → hallux valgus / rigidus."),
        (r'5°\s+metatarsiano',                                          "Base del 5° metatarsiano → descartar fractura."),
        (r'mal[ée]olo\s+medial|flexor\s+largo',                        "Maléolo medial → considerar tibial posterior o esguince medial."),
    ]),
}


def marcadores_a_tips(marcadores_regional: dict) -> list[str]:
    """Genera tips clínicos para todas las regiones presentes."""
    tips = []
    for region, obj in marcadores_regional.items():
        fn = _MAPEADORES.get(region)
        if callable(fn):
            tips.extend(fn(obj))
    return tips
  
