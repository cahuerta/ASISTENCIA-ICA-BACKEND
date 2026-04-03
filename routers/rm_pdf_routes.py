# routers/rm_pdf_routes.py
# Rutas para Formulario RM: guardar datos y generar PDF
# Stateless — datos llegan en el body, sin RM_STORE en memoria
# Depende de: FastAPI, reportlab

import io
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from typing import Any

from pdf.resonancia_formulario import generar_formulario_resonancia

logger = logging.getLogger("rm_pdf_routes")

router = APIRouter(tags=["resonancia"])

_ASSETS = Path(__file__).parent.parent / "assets"

# ============================================================
# CONSTANTES
# ============================================================
ALL_QUESTIONS = [
    "marcapasos",
    "coclear_o_neuro",
    "clips_aneurisma",
    "valvula_cardiaca_metal",
    "fragmentos_metalicos",
]

LABELS: dict[str, str] = {
    "marcapasos":              "Marcapasos",
    "coclear_o_neuro":         "Implante coclear / neuroestimulador",
    "clips_aneurisma":         "Clips de aneurisma",
    "valvula_cardiaca_metal":  "Válvula cardíaca metálica",
    "fragmentos_metalicos":    "Fragmentos metálicos (ocular/corporal)",
}


# ============================================================
# UTILS
# ============================================================
def _bool_to_text(v: Any) -> str:
    if v is True:  return "Sí"
    if v is False: return "No"
    return "No informado"


def _safe_str(v: Any, fallback: str = "—") -> str:
    if v == 0:
        return "0"
    return str(v or "").strip() or fallback


def _format_date_cl(dt: datetime | None = None) -> str:
    try:
        d = dt or datetime.now(tz=ZoneInfo("America/Santiago"))
        return d.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return (dt or datetime.now()).isoformat()


# ============================================================
# SCHEMAS
# ============================================================
class RmSaveBody(BaseModel):
    idPago:    str
    paciente:  dict = {}
    checklist: dict | None = None
    resumen:   str = ""


class RmPdfBody(BaseModel):
    idPago:    str
    paciente:  dict = {}
    checklist: dict | None = None
    resumen:   str = ""


# ============================================================
# POST /rm-save  (stateless: valida y retorna ok — sin store)
# ============================================================
@router.post("/rm-save")
async def rm_save(body: RmSaveBody):
    """
    Valida que el payload sea correcto.
    En modo stateless no persiste nada — el frontend
    guarda los datos en sessionStorage y los envía
    completos al llamar /pdf-rm.
    """
    if not body.idPago:
        raise HTTPException(400, detail="idPago requerido")
    return {"ok": True}


# ============================================================
# POST /pdf-rm  (stateless — datos completos en body)
# ============================================================
@router.post("/pdf-rm")
async def pdf_rm(body: RmPdfBody):
    """
    Genera el PDF del formulario RM con los datos recibidos.
    Retorna application/pdf.
    """
    if not body.idPago:
        raise HTTPException(400, detail="idPago requerido")

    paciente  = body.paciente or {}
    checklist = body.checklist or {}
    resumen   = body.resumen or ""

    try:
        pdf_bytes = generar_formulario_resonancia({
            "nombre":        paciente.get("nombre") or "",
            "rut":           paciente.get("rut") or "",
            "edad":          paciente.get("edad") or "",
            "rm_form":       checklist,
            "observaciones": resumen,
        })
    except Exception as e:
        logger.error("Error generando PDF RM: %s", e)
        raise HTTPException(500, detail="No se pudo generar el PDF")

    filename = f"Formulario_RM_{body.idPago}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ============================================================
# GET /pdf-rm/{id_pago}  (compatibilidad — redirige a POST)
# ============================================================
@router.get("/pdf-rm/{id_pago}")
async def pdf_rm_get(id_pago: str):
    raise HTTPException(
        405,
        detail=(
            "Este endpoint requiere POST con datos completos. "
            "Envía { idPago, paciente, checklist, resumen } via POST /pdf-rm."
        ),
      )
  
