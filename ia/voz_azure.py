# ia/voz_azure.py
# VOZ NATURAL — texto a audio MP3 para Ica, Ipo, Sophia y Katia.
#
# v2 (11-11-2026): la voz sale de GOOGLE Text-to-Speech (el servidor ya está en
# Google): voces Neural2, gratis hasta 1 millón de caracteres al mes; si Google
# no puede (tope o error) se prueba WaveNet (gratis hasta 4 millones), luego una
# voz genérica de Google y, si hay clave, Azure como antes. Si nada responde, el
# navegador usa su voz (respaldo), sin quedar mudo.
#   Ica: mujer · Ipo: hombre · Sophia: mujer de otro acento (para sonar distinta de Ica).
# Las voces se pueden cambiar con variables de entorno (VOZ_GOOGLE_ICA, VOZ_GOOGLE_IPO,
# VOZ_GOOGLE_SOPHIA) sin tocar el código.
# Clave: GOOGLE_TTS_API_KEY (solo en el servidor, nunca en el navegador), restringida
# a la API de Text-to-Speech. Azure (AZURE_SPEECH_KEY/REGION) queda opcional.
#
# Para gastar poco:
#   - CACHÉ en memoria: lo que se repite (saludos, menús, preguntas del banco) se
#     pide una sola vez mientras el servidor esté arriba.
#   - PAUSA tras un rechazo por tope: durante unos segundos no se insiste con ese
#     proveedor.
#   - Tope de largo por frase y límite por IP, para que nadie agote el plan.
#
# Privacidad: el texto que se habla no lleva nombre ni RUT del paciente; igual, si
# aparece algo con forma de RUT, no se manda afuera (el navegador lo dice con su voz).
#
# CONTRATO: sintetizar(texto, voz, velocidad, tono, config) -> bytes MP3
#           o levanta VozError(status, mensaje).

import asyncio
import base64
import hashlib
import logging
import re
import time
from collections import OrderedDict, deque
from xml.sax.saxutils import escape

import os

import httpx

logger = logging.getLogger("voz_azure")

# ── Google ─────────────────────────────────────────────────────
# Por cada asistente: (voz Neural2, voz WaveNet, idioma, género) — en ese orden se prueba.
VOCES_GOOGLE = {
    "ica":       (os.getenv("VOZ_GOOGLE_ICA") or "es-US-Neural2-A",    "es-US-Wavenet-A", "es-US", "FEMALE"),
    "ipo":       (os.getenv("VOZ_GOOGLE_IPO") or "es-US-Neural2-B",    "es-US-Wavenet-B", "es-US", "MALE"),
    "sophia":    (os.getenv("VOZ_GOOGLE_SOPHIA") or "es-ES-Neural2-A", "es-ES-Wavenet-C", "es-ES", "FEMALE"),
    "femenina":  (os.getenv("VOZ_GOOGLE_ICA") or "es-US-Neural2-A",    "es-US-Wavenet-A", "es-US", "FEMALE"),
    "masculina": (os.getenv("VOZ_GOOGLE_IPO") or "es-US-Neural2-B",    "es-US-Wavenet-B", "es-US", "MALE"),
}
VELOCIDAD_G = {"lenta": 0.88, "normal": 0.96, "rapida": 1.08}
TONO_G = {"grave": -2.0, "normal": 0.0, "aguda": 2.0}
_pausa_google = {}   # nivel ("neural2" | "wavenet" | "generica") -> hasta cuándo no se intenta

# ── Azure (opcional, último recurso) ───────────────────────────
# Quién habla con qué voz. "femenina"/"masculina" quedan para otros asistentes (Katia).
VOCES = {
    "ica":       "es-CL-CatalinaNeural",
    "ipo":       "es-CL-LorenzoNeural",
    "sophia":    "es-MX-DaliaNeural",
    "femenina":  "es-CL-CatalinaNeural",
    "masculina": "es-CL-LorenzoNeural",
}
VOZ_DEFECTO = "ica"

# Un poco más pausado que lo normal: suena más amable y se entiende mejor por teléfono
VELOCIDAD = {"lenta": "-12%", "normal": "-4%", "rapida": "+8%"}
TONO = {"grave": "-6%", "normal": "+0%", "aguda": "+6%"}

FORMATO_AUDIO = "audio-24khz-48kbitrate-mono-mp3"
TIEMPO_MAX_S = 8.0
MAX_CARACTERES = 700

# Caché en memoria (se pierde al reiniciar el servidor, y está bien)
CACHE_MAX_BYTES = 40 * 1024 * 1024
_cache: "OrderedDict[str, bytes]" = OrderedDict()
_cache_bytes = 0

# Tras un 429 (demasiadas peticiones) no se insiste por este tiempo
PAUSA_TRAS_429_S = 20.0
_pausa_hasta = 0.0

# Límite por IP: peticiones a Azure (las del caché no cuentan)
LIMITE_IP = 40
VENTANA_IP_S = 60.0
_por_ip: dict[str, deque] = {}

PATRON_RUT = re.compile(r"\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b")

# Una sola petición a Azure por texto aunque lleguen dos iguales a la vez
_en_curso: dict[str, asyncio.Future] = {}


class VozError(Exception):
    def __init__(self, status: int, mensaje: str):
        super().__init__(mensaje)
        self.status = status
        self.mensaje = mensaje


def _limpiar(texto: str) -> str:
    t = re.sub(r"\s+", " ", str(texto or "")).strip()
    # Fuera emojis y símbolos que la voz leería raro
    t = re.sub(r"[\U0001F300-\U0001FAFF☀-➿]", "", t)
    return t


def _ssml(texto: str, voz: str, velocidad: str, tono: str) -> str:
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='es-CL'>"
        f"<voice name='{voz}'>"
        f"<prosody rate='{VELOCIDAD[velocidad]}' pitch='{TONO[tono]}'>{escape(texto)}</prosody>"
        "</voice></speak>"
    )


def _clave_cache(texto: str, voz: str, velocidad: str, tono: str) -> str:
    return hashlib.sha256(f"{voz}|{velocidad}|{tono}|{texto}".encode("utf-8")).hexdigest()


def _cache_get(clave: str) -> bytes | None:
    audio = _cache.get(clave)
    if audio is not None:
        _cache.move_to_end(clave)
    return audio


def _cache_put(clave: str, audio: bytes) -> None:
    global _cache_bytes
    if clave in _cache or len(audio) > CACHE_MAX_BYTES // 4:
        return
    _cache[clave] = audio
    _cache_bytes += len(audio)
    while _cache_bytes > CACHE_MAX_BYTES and _cache:
        _, viejo = _cache.popitem(last=False)
        _cache_bytes -= len(viejo)


def _permitir_ip(ip: str) -> bool:
    ahora = time.monotonic()
    cola = _por_ip.setdefault(ip or "?", deque())
    while cola and ahora - cola[0] > VENTANA_IP_S:
        cola.popleft()
    if len(cola) >= LIMITE_IP:
        return False
    cola.append(ahora)
    # Limpieza de IPs viejas para que el diccionario no crezca sin fin
    if len(_por_ip) > 5000:
        for k in [k for k, c in _por_ip.items() if not c or ahora - c[-1] > VENTANA_IP_S]:
            _por_ip.pop(k, None)
    return True


async def _pedir_azure(ssml: str, clave_api: str, region: str) -> bytes:
    global _pausa_hasta
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    async with httpx.AsyncClient(timeout=TIEMPO_MAX_S) as client:
        r = await client.post(
            url,
            headers={
                "Ocp-Apim-Subscription-Key": clave_api,
                "Content-Type":              "application/ssml+xml",
                "X-Microsoft-OutputFormat":  FORMATO_AUDIO,
                "User-Agent":                "asistencia-ica-backend",
            },
            content=ssml.encode("utf-8"),
        )
    if r.status_code == 429:
        _pausa_hasta = time.monotonic() + PAUSA_TRAS_429_S
        raise VozError(503, "Voz ocupada, usa la del navegador")
    if r.status_code in (401, 403):
        # Clave mala o tope mensual del plan gratis: se avisa en el log y se usa el respaldo
        logger.warning("Azure TTS rechazó la petición (%s): revisar clave o tope del plan", r.status_code)
        _pausa_hasta = time.monotonic() + PAUSA_TRAS_429_S
        raise VozError(503, "Voz no disponible")
    if r.status_code != 200 or not r.content:
        raise VozError(502, f"Azure TTS respondió {r.status_code}")
    return r.content


async def _pedir_google(texto: str, nombre: str | None, idioma: str, genero: str,
                       velocidad: str, tono: str, clave_api: str) -> bytes:
    voz = {"languageCode": idioma, "ssmlGender": genero}
    if nombre:
        voz["name"] = nombre
    cuerpo = {
        "input": {"text": texto},
        "voice": voz,
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": VELOCIDAD_G[velocidad],
                        "pitch": TONO_G[tono], "sampleRateHertz": 24000},
    }
    async with httpx.AsyncClient(timeout=TIEMPO_MAX_S) as client:
        r = await client.post("https://texttospeech.googleapis.com/v1/text:synthesize",
                              params={"key": clave_api}, json=cuerpo)
    if r.status_code != 200:
        raise VozError(r.status_code, f"Google TTS respondió {r.status_code}: {r.text[:160]}")
    audio = base64.b64decode((r.json() or {}).get("audioContent") or "")
    if not audio:
        raise VozError(502, "Google TTS sin audio")
    return audio


async def _pedir_google_en_cascada(texto: str, voz: str, velocidad: str, tono: str, clave_api: str) -> bytes:
    """Neural2 → WaveNet → voz genérica de Google. Un nivel con tope (429) o rechazo
    (403) descansa un rato; un nombre de voz inválido (400) pasa al siguiente."""
    neural2, wavenet, idioma, genero = VOCES_GOOGLE[voz]
    ultimo = None
    for nivel, nombre in (("neural2", neural2), ("wavenet", wavenet), ("generica", None)):
        if time.monotonic() < _pausa_google.get(nivel, 0):
            continue
        try:
            return await _pedir_google(texto, nombre, idioma, genero, velocidad, tono, clave_api)
        except VozError as e:
            ultimo = e
            if e.status in (403, 429):
                _pausa_google[nivel] = time.monotonic() + (300 if e.status == 403 else PAUSA_TRAS_429_S)
            logger.warning("Voz Google (%s) no disponible: %s", nivel, e.mensaje)
        except Exception as e:
            ultimo = e
            logger.warning("Voz Google (%s) falló: %s", nivel, e)
    raise VozError(503, "Voz de Google no disponible") from ultimo


async def _generar(texto: str, voz: str, velocidad: str, tono: str, config: dict) -> bytes:
    """Google primero; Azure solo si está configurado y Google no pudo."""
    clave_google = config.get("google_tts_api_key") or ""
    clave_azure = config.get("azure_speech_key") or ""
    region = config.get("azure_speech_region") or ""
    error = None
    if clave_google:
        try:
            return await _pedir_google_en_cascada(texto, voz, velocidad, tono, clave_google)
        except VozError as e:
            error = e
    if clave_azure and region and time.monotonic() >= _pausa_hasta:
        return await _pedir_azure(_ssml(texto, VOCES[voz], velocidad, tono), clave_azure, region)
    raise error or VozError(503, "Voz no disponible")


async def sintetizar(texto: str, voz: str, velocidad: str, tono: str, config: dict, ip: str = "") -> bytes:
    hay_google = bool(config.get("google_tts_api_key"))
    hay_azure = bool(config.get("azure_speech_key") and config.get("azure_speech_region"))
    if not hay_google and not hay_azure:
        raise VozError(503, "Voz natural no configurada")

    texto = _limpiar(texto)
    if not texto:
        raise VozError(400, "Texto vacío")
    if len(texto) > MAX_CARACTERES:
        raise VozError(413, "Texto demasiado largo")
    if PATRON_RUT.search(texto):
        raise VozError(422, "El texto trae datos personales")

    voz = voz if voz in VOCES else VOZ_DEFECTO
    velocidad = velocidad if velocidad in VELOCIDAD else "normal"
    tono = tono if tono in TONO else "normal"

    clave = _clave_cache(texto, voz, velocidad, tono)
    audio = _cache_get(clave)
    if audio is not None:
        return audio

    if not hay_google and time.monotonic() < _pausa_hasta:
        raise VozError(503, "Voz ocupada, usa la del navegador")

    # Si ya se está pidiendo este mismo texto, se espera esa respuesta
    pendiente = _en_curso.get(clave)
    if pendiente is not None:
        return await asyncio.shield(pendiente)

    if not _permitir_ip(ip):
        raise VozError(429, "Demasiadas peticiones de voz")

    futuro = asyncio.get_running_loop().create_future()
    _en_curso[clave] = futuro
    try:
        audio = await _generar(texto, voz, velocidad, tono, config)
        _cache_put(clave, audio)
        futuro.set_result(audio)
        return audio
    except VozError as e:
        futuro.set_exception(e)
        raise
    except Exception as e:
        logger.warning("Voz falló: %s", e)
        err = VozError(502, "Voz no disponible")
        futuro.set_exception(err)
        raise err from e
    finally:
        _en_curso.pop(clave, None)
        # Evita el aviso "Future exception was never retrieved" si nadie más esperaba
        if futuro.done() and not futuro.cancelled() and futuro.exception() is not None:
            futuro.exception()
