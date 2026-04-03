# routers/case_router.py
# Router unificado: pago / PDF / reset
# Stateless — sin memoria server-side
# Depende de: FastAPI, httpx

import logging
import re
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any

logger = logging.getLogger("case_router")

# ============================================================
# CONFIG (se inyecta desde main.py via app.state)
# ============================================================
# Acceso: request.app.state.config

KHIPU_API_BASE = "https://payment-api.khipu.com"
CURRENCY       = "CLP"

ESPACIOS = ["trauma", "preop", "generales", "ia"]

router = APIRouter(prefix="/case", tags=["case"])


# ============================================================
# UTILS
# ============================================================
def _sanitize(t: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_-]+', '_', str(t or ""))


def _norm_rut(s: str) -> str:
    return re.sub(r'[^0-9kK]', '', str(s or "")).upper()


def _build_examen_texto(rec: dict) -> str:
    examenes = rec.get("examenes_ia") or rec.get("examenesIA") or []
    if isinstance(examenes, list) and examenes:
        return "\n".join(str(x).strip() for x in examenes if str(x).strip())
    examen = rec.get("examen") or ""
    return str(examen).strip()


def _build_nota(rec: dict) -> str:
    for campo in ["nota", "observaciones", "informe_ia", "informeIA"]:
        v = rec.get(campo)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _modulo_desde_body(modulo: str) -> str:
    m = str(modulo or "").lower()
    if m == "preop":    return "preop"
    if m == "generales": return "generales"
    if m == "ia":       return "ia"
    return "trauma"


# ============================================================
# SCHEMAS
# ============================================================
class PayBody(BaseModel):
    idPago:        str
    modulo:        str | None = None
    datosPaciente: dict | None = None
    modoGuest:     bool = False


# ============================================================
# ENDPOINT: POST /case/pay
# ============================================================
@router.post("/pay")
async def pay(body: PayBody, request: Request):
    cfg = request.app.state.config
    id_pago = body.idPago
    space   = _modulo_desde_body(body.modulo or "")

    khipu_mode   = str(cfg.get("khipu_env") or "integration").lower()
    khipu_mode   = "production" if khipu_mode in ("prod", "production") else \
                   "guest"      if khipu_mode == "guest" else "integration"
    return_base  = cfg.get("return_base") or cfg.get("frontend_base") or "https://icarticular.cl"
    khipu_key    = cfg.get("khipu_api_key") or ""
    khipu_amount = int(cfg.get("khipu_amount") or 1000)
    khipu_subject = cfg.get("khipu_subject") or "Orden médica ICA"

    # GUEST flow
    if body.modoGuest or khipu_mode == "guest":
        params = urlencode({"pago": "ok", "idPago": id_pago, "modulo": space})
        url = f"{return_base}?{params}"
        return {"ok": True, "url": url, "guest": True}

    # REAL Khipu
    if not khipu_key:
        raise HTTPException(500, detail="Falta KHIPU_API_KEY")

    base_url = str(request.base_url).rstrip("/")
    payload = {
        "amount":         khipu_amount,
        "currency":       CURRENCY,
        "subject":        khipu_subject,
        "transaction_id": id_pago,
        "return_url":     f"{return_base}?pago=ok&idPago={id_pago}&modulo={space}",
        "cancel_url":     f"{return_base}?pago=cancelado&idPago={id_pago}&modulo={space}",
        "notify_url":     f"{base_url}/webhook",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{KHIPU_API_BASE}/v3/payments",
                headers={
                    "content-type": "application/json",
                    "x-api-key":    khipu_key,
                },
                json=payload,
            )
        j = r.json() if r.content else {}
        if not r.is_success:
            msg = j.get("message") or f"Error Khipu ({r.status_code})"
            raise HTTPException(502, detail=msg)

        url_pago = j.get("payment_url") or j.get("simplified_transfer_url") or j.get("url")
        if not url_pago:
            raise HTTPException(502, detail="Khipu no entregó payment_url")

        return {"ok": True, "url": url_pago}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("/case/pay error: %s", e)
        raise HTTPException(500, detail=str(e))


# ============================================================
# ENDPOINT: GET /case/pdf/{id_pago}
# ============================================================
@router.get("/pdf/{id_pago}")
async def pdf(id_pago: str, request: Request, modulo: str = "", reset: int = 0):
    from ordenes.orden_imagenologia    import generar_orden_imagenologia
    from ordenes.ia_orden_imagenologia import generar_orden_imagenologia_ia
    from ordenes.preop_orden_lab       import generar_orden_preop_lab
    from ordenes.preop_odonto          import generar_preop_odonto
    from ordenes.generales_orden       import generar_orden_generales

    cfg     = request.app.state.config
    space   = _modulo_desde_body(modulo) if modulo else ""

    if not space:
        raise HTTPException(400, detail="Falta modulo")

    # En modo stateless los datos deben venir en query o el router los tiene
    # Este endpoint requiere que el frontend provea los datos via POST /case/pdf
    # — ver nota abajo. Por ahora devuelve 501 si no hay datos en state.
    # (Se completa en main.py con el flujo real de datos)
    raise HTTPException(501, detail=(
        "Endpoint /case/pdf requiere datos del paciente. "
        "Usar POST /case/pdf con body completo."
    ))


# ============================================================
# ENDPOINT: POST /case/pdf  (stateless — datos en body)
# ============================================================
class PdfBody(BaseModel):
    idPago:  str
    modulo:  str
    datos:   dict
    reset:   bool = False


@router.post("/pdf")
async def pdf_post(body: PdfBody, request: Request):
    from ordenes.orden_imagenologia    import generar_orden_imagenologia
    from ordenes.ia_orden_imagenologia import generar_orden_imagenologia_ia
    from ordenes.preop_orden_lab       import generar_orden_preop_lab
    from ordenes.preop_odonto          import generar_preop_odonto
    from ordenes.generales_orden       import generar_orden_generales
    from pdf.generador                 import generar_informe_ia

    space  = _modulo_desde_body(body.modulo)
    d      = body.datos
    rut    = _norm_rut(d.get("rut") or d.get("RUT") or d.get("RUN") or "")
    nombre = _sanitize(d.get("nombre") or "paciente")

    try:
        if space == "trauma":
            pdf_bytes = generar_orden_imagenologia({
                **d,
                "examen": _build_examen_texto(d),
                "nota":   _build_nota(d),
                "rut":    rut,
            })
            filename = f"orden_{nombre}.pdf"

        elif space == "preop":
            # Dos páginas: lab + odonto
            import io
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import SimpleDocTemplate, PageBreak
            # Generamos cada PDF por separado y los concatenamos
            from pypdf import PdfWriter, PdfReader
            lab_bytes   = generar_orden_preop_lab({**d, "rut": rut})
            odonto_bytes = generar_preop_odonto({**d, "rut": rut})

            writer = PdfWriter()
            for parte in [lab_bytes, odonto_bytes]:
                reader = PdfReader(io.BytesIO(parte))
                for page in reader.pages:
                    writer.add_page(page)
            out = io.BytesIO()
            writer.write(out)
            pdf_bytes = out.getvalue()
            filename = f"preop_{nombre}.pdf"

        elif space == "generales":
            pdf_bytes = generar_orden_generales({
                **d,
                "examenes_ia": d.get("examenes_ia") or d.get("examenesIA") or [],
                "rut": rut,
            })
            filename = f"generales_{nombre}.pdf"

        elif space == "ia":
            pdf_bytes = generar_informe_ia({
                **d,
                "examen": _build_examen_texto(d),
                "nota":   _build_nota(d),
                "rut":    rut,
            })
            filename = f"ordenIA_{nombre}.pdf"

        else:
            raise HTTPException(400, detail="Módulo inválido")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("/case/pdf error: %s", e)
        raise HTTPException(500, detail=str(e))

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============================================================
# ENDPOINT: DELETE /case/{id_pago}  (reset — sin-op en stateless)
# ============================================================
@router.delete("/{id_pago}")
async def reset(id_pago: str):
    # Stateless: no hay memoria que limpiar
    # El frontend limpia sessionStorage por su cuenta
    logger.info("Reset solicitado para idPago=%s (stateless: no-op)", id_pago)
    return {"ok": True, "removed": 0}
  
