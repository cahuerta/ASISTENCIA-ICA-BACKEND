# routers/resolver.py
# Derivación: qué especialista de ICA recomendar según la zona del dolor.
#
# v3 — LOS MÉDICOS SALEN DE SUPABASE (no de derivacion/medicos.json):
#   Se usa la misma lista que la agenda de reservas: los profesionales públicos
#   en la ficha clínica (GET {FICHA_API}/professionals?public=true&scope=...&region=...,
#   tablas "profesionales" y "sedes" de Supabase). Así Ipo, Ica (agenda), la orden
#   impresa y el correo recomiendan siempre a un médico que existe y tiene agenda.
#   - GEO CON PRIORIDAD ICA: se busca primero entre los médicos de ICA de la región
#     del paciente; si en su región no hay de esa zona, entre todos los de ICA.
#     Sin ubicación: la región de ICA (core/geo.py, nunca Santiago por defecto).
#   - MÉDICOS EXTERNOS: apagados por ahora. Cuando haya médicos de otros centros,
#     se encienden con la variable de Render DERIVACION_EXTERNOS=1 (sin tocar este
#     archivo): si ICA no tiene especialista para esa zona, se busca entre los
#     externos de la región del paciente. ICA siempre va primero.
#   - Zona -> especialidad con las mismas palabras que usa la agenda
#     (BookingCerebro.jsx, ESPECIALIDAD_POR_ZONA): basta con que el campo
#     "especialidad" del médico en la ficha diga "Rodilla", "Cadera", "Hombro"...
#     Un médico nuevo en la ficha queda disponible sin tocar este archivo.
#   - Si hay varios para la zona, se recomienda el primero; si no hay ninguno,
#     no se nombra a nadie (Ica muestra los especialistas en la agenda).
#   - Cada lista se guarda 5 minutos en memoria. Si la ficha no responde, se usa la
#     última lista conocida; si nunca respondió, no se nombra médico (la nota de
#     derivación sale igual).
#
#   Variables de Render (opcionales):
#     FICHA_API_URL     (por defecto https://services.icarticular.cl)
#     DERIVACION_SCOPE  (centro, por defecto "ica")
#     DERIVACION_EXTERNOS ("1" para incluir médicos de otros centros; por defecto no)
#
# CONTRATO (igual que antes, lo usan /resolver-derivacion, la orden y el correo):
#   resolver_derivacion(datos, geo) -> { dolor, especialidad, sede, doctor,
#                                        doctores, nota, source }
#   doctor: { id, nombre, especialidad, agenda, reservaId } | None

import logging
import os
import time
import unicodedata

import httpx

logger = logging.getLogger("resolver")

FICHA_API = (os.getenv("FICHA_API_URL") or "https://services.icarticular.cl").rstrip("/")
SCOPE     = (os.getenv("DERIVACION_SCOPE") or "ica").strip()
EXTERNOS  = (os.getenv("DERIVACION_EXTERNOS") or "").strip().lower() in ("1", "true", "si", "sí")
TTL_S     = 300
TIEMPO_S  = 4.0

SEDE_ICA = {"sedeId": "ica_curico", "nombre": "Instituto de Cirugía Articular – Curicó"}


# ============================================================
# ZONA -> ESPECIALIDAD (mismas palabras que la agenda de reservas)
# ============================================================
# Zona del dolor (lo que llega de los asistentes, con sinónimos) -> clave
_ZONA_A_CLAVE: list[tuple[str, str]] = [
    ("columna", "columna"), ("espalda", "columna"), ("lumbar", "columna"),
    ("cervical", "columna"), ("dorsal", "columna"), ("cuello", "columna"),
    ("rodilla", "rodilla"),
    ("cadera", "cadera"), ("ingle", "cadera"),
    ("hombro", "hombro"),
    ("codo", "codo"),
    ("muneca", "mano"), ("mano", "mano"), ("dedo", "mano"),
    ("tobillo", "tobillo"), ("pie", "tobillo"), ("talon", "tobillo"),
]

# Palabras de la especialidad del médico (campo "specialty" en la ficha)
_ESPECIALIDAD_POR_ZONA: dict[str, list[str]] = {
    "rodilla": ["rodilla"],
    "cadera":  ["cadera"],
    "hombro":  ["hombro", "extremidad superior"],
    "codo":    ["codo", "extremidad superior"],
    "mano":    ["mano", "muneca", "extremidad superior"],
    "tobillo": ["tobillo", "pie"],
    "columna": ["columna"],
}


def _norm(s: str) -> str:
    """minúsculas y sin tildes ("Muñeca" -> "muneca")."""
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _resolver_especialidad(dolor: str = "") -> str | None:
    """Zona del dolor -> especialidad. Sin IA, sin default."""
    texto = _norm(dolor)
    palabras = set(texto.replace(",", " ").split())
    for clave, esp in _ZONA_A_CLAVE:
        # "pie" solo como palabra entera (no dentro de "piel", "pierna")
        if (clave in palabras) if clave == "pie" else (clave in texto):
            return esp
    return None


# ============================================================
# PROFESIONALES DE ICA (ficha clínica / Supabase), con caché
# ============================================================
_cache: dict[tuple, dict] = {}   # (scope, region) -> {"lista", "hasta"}


def _profesionales(scope: str | None, region: str | None) -> list[dict]:
    """Profesionales públicos de la ficha; scope None = todos los centros.
    Con region, la ficha deja los de esa región (o todos, si ninguno es de ahí)."""
    clave = (scope or "", region or "")
    entrada = _cache.setdefault(clave, {"lista": None, "hasta": 0.0})
    ahora = time.monotonic()
    if entrada["lista"] is not None and ahora < entrada["hasta"]:
        return entrada["lista"]
    params = {"public": "true"}
    if scope:
        params["scope"] = scope
    if region:
        params["region"] = region
    try:
        r = httpx.get(f"{FICHA_API}/professionals", params=params, timeout=TIEMPO_S)
        r.raise_for_status()
        data = r.json()
        lista = data if isinstance(data, list) else (data or {}).get("professionals") or []
        lista = [
            {"id": str(p.get("id")), "name": str(p.get("name")), "specialty": str(p.get("specialty") or "")}
            for p in lista
            if isinstance(p, dict) and p.get("id") and p.get("name")
        ]
        entrada.update(lista=lista, hasta=ahora + TTL_S)
        return lista
    except Exception as e:
        logger.warning("No se pudo leer la lista de profesionales de la ficha: %s", type(e).__name__)
        # Se reintenta en 30 s; mientras, la última lista conocida (o ninguna)
        entrada["hasta"] = ahora + 30
        return entrada["lista"] or []


def _de_la_zona(lista: list[dict], especialidad: str, agenda: str) -> list[dict]:
    claves = _ESPECIALIDAD_POR_ZONA.get(especialidad) or []
    return [
        {
            "id":           p["id"],
            "nombre":       p["name"],
            "especialidad": p["specialty"],
            "agenda":       agenda,
            "reservaId":    p["id"],   # ?dr= de reservas.icarticular.cl (botón del correo)
        }
        for p in lista
        if any(c in _norm(p["specialty"]) for c in claves)
    ]


def _region(geo: dict | None) -> str | None:
    if isinstance(geo, dict) and geo.get("country") == "CL" and geo.get("region"):
        return _norm(geo["region"])
    return None


def _doctores(especialidad: str | None, region: str | None) -> tuple[list[dict], dict]:
    """(médicos de la zona, sede). ICA primero; externos solo si están encendidos."""
    if not especialidad:
        return [], SEDE_ICA
    # 1) ICA, en la región del paciente (la ficha deja todos los de ICA si ninguno es de ahí)
    if region:
        docs = _de_la_zona(_profesionales(SCOPE, region), especialidad, SEDE_ICA["nombre"])
        if docs:
            return docs, SEDE_ICA
    # 2) ICA, cualquier región
    docs = _de_la_zona(_profesionales(SCOPE, None), especialidad, SEDE_ICA["nombre"])
    if docs:
        return docs, SEDE_ICA
    # 3) Externos de la región del paciente (apagado hasta DERIVACION_EXTERNOS=1)
    if EXTERNOS and region:
        docs = _de_la_zona(_profesionales(None, region), especialidad, "")
        if docs:
            return docs, {"sedeId": "externos", "nombre": ""}
    return [], SEDE_ICA


# ============================================================
# NOTA
# ============================================================
def _nombre_sin_titulo(nombre: str) -> str:
    """"Dr. Jaime Espinoza" -> "Jaime Espinoza" (la nota ya antepone el título)."""
    n = str(nombre or "").strip()
    for titulo in ("Dra. ", "Dra ", "Dr. ", "Dr "):
        if n.startswith(titulo):
            return n[len(titulo):].strip()
    return n


def _build_nota(especialidad: str | None, sede: dict | None, doctor: dict | None) -> str:
    """La nota SIEMPRE existe y SIEMPRE es de derivación."""
    esp_texto = (
        especialidad[0].upper() + especialidad[1:]
        if especialidad else "la especialidad correspondiente"
    )

    partes = [f"Sugerimos evaluación por especialista en {esp_texto}."]

    if doctor and doctor.get("nombre"):
        nombre = str(doctor["nombre"]).strip()
        titulo = "a la Dra." if nombre.startswith("Dra") else "al Dr."
        partes.append(f"Recomendamos {titulo} {_nombre_sin_titulo(nombre)}.")

    if sede and sede.get("nombre"):
        partes.append(f"Puede solicitar su hora en {sede['nombre']}.")

    return " ".join(partes)


# ============================================================
# RESOLVER PRINCIPAL
# ============================================================
def resolver_derivacion(datos: dict | None = None, geo: dict | None = None) -> dict:
    """
    datos: { dolor, ... }
    geo:   { country, region } — región del paciente (ICA siempre primero)
    Retorna: { dolor, especialidad, sede, doctor, doctores, nota, source }
    nota es SIEMPRE presente.
    """
    datos        = datos or {}
    dolor        = datos.get("dolor") or ""
    especialidad = _resolver_especialidad(dolor)
    doctores, sede = _doctores(especialidad, _region(geo))
    doctor       = doctores[0] if doctores else None
    nota         = _build_nota(especialidad, sede, doctor)

    return {
        "dolor":        dolor,
        "especialidad": especialidad,
        "sede":         sede,
        "doctor":       doctor,
        "doctores":     doctores,
        "nota":         nota,        # 🔒 SIEMPRE presente
        "source":       "ficha",
    }
    
