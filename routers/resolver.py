# routers/resolver.py
# Lógica clínica PURA — derivación por especialidad y geo
# NO detecta GEO
# NO usa estado
# SOLO decide con datos recibidos

import json
from pathlib import Path

_DERIVACION_DIR = Path(__file__).parent.parent / "derivacion"


# ============================================================
# DB — carga única al importar
# ============================================================
def _load(file: str) -> dict:
    return json.loads((_DERIVACION_DIR / file).read_text(encoding="utf-8"))


_SEDES_GEO  = _load("sedes.geo.json")
_MEDICOS_DB = _load("medicos.json")


# ============================================================
# MAPEO DIRECTO dolor → especialidad (ESTA TABLA ES LA VERDAD)
# ============================================================
_MAP_DOLOR_ESPECIALIDAD: dict[str, str] = {
    "rodilla": "rodilla",
    "cadera":  "cadera",
    "hombro":  "hombro",
    "codo":    "codo",
    "mano":    "mano",
    "tobillo": "tobillo",
    "columna": "columna",
}


# ============================================================
# HELPERS
# ============================================================
def _norm(s: str) -> str:
    return str(s or "").lower()


def _resolver_especialidad(dolor: str = "") -> str | None:
    """Resuelve especialidad por inclusión semántica simple. Sin IA, sin default."""
    texto = _norm(dolor)
    for key, esp in _MAP_DOLOR_ESPECIALIDAD.items():
        if key in texto:
            return esp
    return None


def _resolver_sede_por_geo(geo: dict | None) -> dict | None:
    """Resuelve sede SOLO si geo es válido. Sin default, sin inventar."""
    if not geo or not geo.get("country") or not geo.get("region"):
        return None

    country    = geo["country"]
    region     = _norm(geo["region"])
    country_db = _SEDES_GEO.get(country)

    if not country_db:
        return None

    for key, sede in country_db.items():
        if _norm(key) in region:
            return sede

    return None


def _obtener_doctor(sede: dict | None, especialidad: str | None) -> dict | None:
    if not sede or not especialidad:
        return None
    lista = (_MEDICOS_DB.get(sede.get("sedeId") or "") or {}).get(especialidad)
    return lista[0] if isinstance(lista, list) and lista else None


def _build_nota(especialidad: str | None, sede: dict | None, doctor: dict | None) -> str:
    """La nota SIEMPRE existe y SIEMPRE es de derivación."""
    esp_texto = (
        especialidad[0].upper() + especialidad[1:]
        if especialidad else "la especialidad correspondiente"
    )

    partes = [f"Sugerimos evaluación por especialista en {esp_texto}."]

    if doctor and doctor.get("nombre"):
        partes.append(f"Recomendamos al Dr. {doctor['nombre']}.")

    if sede and sede.get("nombre"):
        partes.append(f"Puede solicitar su hora en {sede['nombre']}.")

    return " ".join(partes)


# ============================================================
# RESOLVER PRINCIPAL
# ============================================================
def resolver_derivacion(datos: dict = {}, geo: dict | None = None) -> dict:
    """
    datos: { dolor, ... }
    geo:   { country, region } — opcional
    Retorna: { dolor, especialidad, sede, doctor, doctores, nota, source }
    nota es SIEMPRE presente.
    """
    dolor        = datos.get("dolor") or ""
    especialidad = _resolver_especialidad(dolor)
    sede         = _resolver_sede_por_geo(geo)
    doctor       = _obtener_doctor(sede, especialidad)
    nota         = _build_nota(especialidad, sede, doctor)

    return {
        "dolor":       dolor,
        "especialidad": especialidad,
        "sede":         sede,
        "doctor":       doctor or None,
        "doctores":     [doctor] if doctor else [],
        "nota":         nota,        # 🔒 SIEMPRE presente
        "source":       "resolver",
    }
