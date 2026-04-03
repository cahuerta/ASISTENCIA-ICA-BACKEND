# derivacion/derivacion_engine.py
# Motor genérico de derivación clínica
# - Lee SOLO datos desde derivaciones_config.py
# - Usa georreferencia normalizada (geo)
# - NO contiene reglas hardcodeadas de clínica
# - Primera coincidencia gana (orden importa)

from derivacion.derivaciones_config import DERIVACIONES


# ============================================================
# MATCHERS (privados del motor)
# ============================================================

def _match_country(rule_country: str | None, geo_country: str | None) -> bool:
    if not rule_country or rule_country == "*":
        return True
    return rule_country == geo_country


def _match_region_includes(rule_region: str | None, geo_region: str | None) -> bool:
    if not rule_region:
        return True
    if not geo_region:
        return False
    return rule_region.lower() in geo_region.lower()


def _match_rule(match: dict, geo: dict) -> bool:
    if not geo:
        return False
    if not _match_country(match.get("country"), geo.get("country")):
        return False
    if not _match_region_includes(match.get("regionIncludes"), geo.get("region")):
        return False
    return True


# ============================================================
# RESOLVER PRINCIPAL
# ============================================================

def resolver_derivacion_generica(geo: dict = {}) -> dict:
    """
    Recorre las reglas en orden — primera coincidencia gana.
    geo: { country, region }
    Retorna: { id, sede, mensaje, accion, ... }
    """
    for rule in DERIVACIONES:
        if _match_rule(rule.get("match") or {}, geo):
            return {
                "id": rule.get("id"),
                **rule.get("resultado", {}),
            }

    # Fallback absoluto (no debería ocurrir si hay regla "*")
    return {
        "id":      "SIN_DERIVACION",
        "sede":    None,
        "mensaje": "No fue posible determinar una derivación",
        "accion":  "SIN_DERIVACION",
    }
  
