# derivacion/derivaciones_config.py
# Base de datos de derivaciones (SOLO LECTURA)
# - NO contiene lógica
# - SOLO datos configurables
# - El orden define la prioridad (primera coincidencia gana)

DERIVACIONES: list[dict] = [

    # =========================================================
    # 🇨🇱 CHILE
    # =========================================================

    {
        "id": "CL_MAULE",
        "match": {
            "country":        "CL",
            "regionIncludes": "maule",
        },
        "resultado": {
            "sede":   "Instituto de Cirugía Articular – Curicó",
            "mensaje": "Atención traumatológica especializada en Curicó",
            "accion": "AGENDA_CURICO",
        },
    },

    {
        "id": "CL_METROPOLITANA",
        "match": {
            "country":        "CL",
            "regionIncludes": "metropolitana",
        },
        "resultado": {
            "sede":   "Red de derivación – Santiago",
            "mensaje": "Derivación a especialista en Santiago",
            "accion": "DERIVACION_SANTIAGO",
        },
    },

    {
        "id": "CL_GENERAL",
        "match": {
            "country": "CL",
        },
        "resultado": {
            "sede":   "Red nacional",
            "mensaje": "Derivación traumatológica dentro de Chile",
            "accion": "DERIVACION_REGIONAL",
        },
    },

    # =========================================================
    # 🌎 INTERNACIONAL
    # =========================================================

    {
        "id": "INT_GENERAL",
        "match": {
            "country": "*",
        },
        "resultado": {
            "sede":   "Derivación internacional",
            "mensaje": "Informe orientativo. Se recomienda evaluación con traumatólogo local.",
            "accion": "INFORME_ORIENTATIVO",
        },
    },

]
