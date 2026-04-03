# fallbacks/trauma.py
# Fallback por zona (1 examen, con lateralidad)
# CONTRATO: siempre devuelve { diagnostico, examen, justificacion } sin IA

import re


def fallback_trauma(p: dict = {}) -> dict:
    """Devuelve { diagnostico, examen, justificacion } sin llamada a IA."""

    zona = str(p.get("dolor") or "").lower()
    lado = str(p.get("lado") or "").upper()          # "IZQUIERDA" / "DERECHA"
    lat  = f" {lado}" if lado else ""

    def con_lat(nombre: str) -> str:
        return f"{nombre}{lado.lower()}" if lado else nombre

    rules = [
        {
            "test": r"mano|muñeca",
            "exam": f"ECOGRAFÍA DE MANO{lat}.",
            "dx":   f"Dolor de mano/muñeca{con_lat(' ')}".strip(),
        },
        {
            "test": r"codo",
            "exam": f"ECOGRAFÍA DE CODO{lat}.",
            "dx":   f"Dolor de codo{con_lat(' ')}".strip(),
        },
        {
            "test": r"rodilla",
            "exam": f"RESONANCIA MAGNÉTICA DE RODILLA{lat}.",
            "dx":   f"Gonalgia{con_lat(' ')}".strip(),
        },
        {
            "test": r"cadera",
            "exam": f"RESONANCIA MAGNÉTICA DE CADERA{lat}.",
            "dx":   f"Dolor de cadera{con_lat(' ')}".strip(),
        },
        {
            "test": r"hombro",
            "exam": f"RESONANCIA MAGNÉTICA DE HOMBRO{lat}.",
            "dx":   f"Dolor de hombro{con_lat(' ')}".strip(),
        },
        {
            "test": r"columna\s*cervical",
            "exam": "RESONANCIA MAGNÉTICA DE COLUMNA CERVICAL.",
            "dx":   "Dolor de columna cervical",
        },
        {
            "test": r"columna\s*(dorsal|torácica)",
            "exam": "RESONANCIA MAGNÉTICA DE COLUMNA DORSAL.",
            "dx":   "Dolor de columna dorsal",
        },
        {
            "test": r"columna|lumbar",
            "exam": "RESONANCIA MAGNÉTICA DE COLUMNA LUMBAR.",
            "dx":   "Dolor de columna lumbar",
        },
        {
            "test": r"tobillo|pie",
            "exam": f"RESONANCIA MAGNÉTICA DE PIE/TOBILLO{lat}.",
            "dx":   f"Dolor de pie/tobillo{con_lat(' ')}".strip(),
        },
        {
            "test": r"pierna|brazo",
            "exam": f"RESONANCIA MAGNÉTICA DE {'PIERNA' if 'pierna' in zona else 'BRAZO'}{lat}.",
            "dx":   f"Dolor de {'pierna' if 'pierna' in zona else 'brazo'}{con_lat(' ')}".strip(),
        },
    ]

    examen      = ""
    diagnostico = ""

    for r in rules:
        if re.search(r["test"], zona):
            examen      = r["exam"]
            diagnostico = r["dx"]
            break

    if not examen:
        z = (p.get("dolor") or "REGIÓN COMPROMETIDA").upper()
        examen      = f"RESONANCIA MAGNÉTICA DE {z}{lat}."
        diagnostico = "Dolor osteoarticular localizado"

    justificacion = (
        "Selección basada en la región y la lateralidad para estudiar con precisión "
        "estructuras internas y tejidos blandos. Ajustar según examen físico y evolución clínica."
    )

    return {"diagnostico": diagnostico, "examen": examen, "justificacion": justificacion}
  
