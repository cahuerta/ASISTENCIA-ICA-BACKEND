# core/geo.py
# Infraestructura pura: IP + geolocalización
# CONTRATO:
# - SIEMPRE devuelve { country, region }
# - NUNCA usa sesión
# - NUNCA guarda estado
# - NO depende de FastAPI

import json
import math
import logging
from pathlib import Path
from typing import Optional
import httpx

# ============================================================
# CARGA DE SEDES (FUENTE ÚNICA)
# ============================================================
_DERIVACION_DIR = Path(__file__).parent.parent / "derivacion"
_sedes_raw = json.loads((_DERIVACION_DIR / "sedes.geo.json").read_text(encoding="utf-8"))
_CIUDADES: list[tuple[str, dict]] = list((_sedes_raw.get("CL") or {}).items())

logger = logging.getLogger("geo")


# ============================================================
# LOG HELPER
# ============================================================
def _log(msg: str, **data) -> None:
    logger.info("🌍 [GEO] %s %s", msg, data)


# ============================================================
# IP REAL (Render / Proxy safe)
# ============================================================
def get_client_ip(request) -> str:
    """Extrae IP real desde headers de proxy o conexión directa."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else ""
    if not ip:
        ip = getattr(request.client, "host", "") or ""
    ip = ip.replace("::ffff:", "")
    _log("IP detectada", ip=ip)
    return ip


# ============================================================
# DISTANCIA (KM) — Haversine
# ============================================================
def _distancia_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _centro_bbox(b: dict) -> tuple[float, float]:
    return (b["latMin"] + b["latMax"]) / 2, (b["lonMin"] + b["lonMax"]) / 2


# ============================================================
# GPS → CIUDAD (BBOX o proximidad real)
# ============================================================
def resolver_geo_por_gps(lat: float, lon: float) -> dict:
    _log("Resolviendo por GPS", lat=lat, lon=lon)

    # 1) Dentro de BBOX
    for region, sede in _CIUDADES:
        b = sede["bbox"]
        if b["latMin"] <= lat <= b["latMax"] and b["lonMin"] <= lon <= b["lonMax"]:
            _log("GPS dentro de BBOX", region=region)
            return {"country": "CL", "region": region}

    # 2) Proximidad real (SIEMPRE devuelve una ciudad válida)
    mejor_region = None
    min_dist = float("inf")

    for region, sede in _CIUDADES:
        c_lat, c_lon = _centro_bbox(sede["bbox"])
        d = _distancia_km(lat, lon, c_lat, c_lon)
        if d < min_dist:
            min_dist = d
            mejor_region = region

    _log("GPS fuera de BBOX, ciudad más cercana", region=mejor_region, distancia_km=round(min_dist))
    return {"country": "CL", "region": mejor_region}


# ============================================================
# IP → GEO (usando coordenadas reales si existen)
# ============================================================
async def geo_from_ip(ip: str) -> dict:
    _log("Resolviendo por IP", ip=ip)

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(
                f"https://ipapi.co/{ip}/json/",
                headers={"User-Agent": "Asistencia-ICA/1.0"},
            )
            data = res.json()

        lat = data.get("latitude")
        lon = data.get("longitude")

        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            return resolver_geo_por_gps(lat, lon)

    except Exception as e:
        _log("Error IPAPI", error=str(e))

    # Último recurso: ciudad más cercana al centro del primer bbox
    region, sede = _CIUDADES[0]
    c_lat, c_lon = _centro_bbox(sede["bbox"])
    _log("IP sin coords, usando proximidad real", region=region)
    return resolver_geo_por_gps(c_lat, c_lon)
            
