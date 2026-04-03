# main.py
# Aplicación FastAPI principal — equivalente de index.js
# Stateless: sin memoria server-side
# Soporta Flow + Khipu como pasarelas de pago

import asyncio
import io
import logging
import os
import re
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from typing import Any

# ============================================================
# MÓDULOS PROPIOS
# ============================================================
from core.geo import get_client_ip, geo_from_ip, resolver_geo_por_gps
from routers.resolver import resolver_derivacion
from routers.flow_client import crear_pago_flow_backend
from routers.rm_pdf_routes import router as rm_router
from correo.email_orden import enviar_orden_por_correo          # ← correo/ no email/

from ia.trauma_ia import trauma_ia
from ia.generales_ia import generales_ia
from ia.preop_ia import preop_ia
from ia.chat import preview_informe

from ordenes.orden_imagenologia import generar_orden_imagenologia
from ordenes.ia_orden_imagenologia import generar_orden_imagenologia_ia
from ordenes.preop_orden_lab import generar_orden_preop_lab
from ordenes.preop_odonto import generar_preop_odonto
from ordenes.generales_orden import generar_orden_generales
from pdf.generador import generar_informe_ia
from pdf.resonancia_formulario import generar_formulario_resonancia
from fallbacks.trauma import fallback_trauma

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

# ============================================================
# CONFIG DESDE ENV
# ============================================================
FRONTEND_BASE  = os.getenv("FRONTEND_BASE") or os.getenv("RETURN_BASE") or "https://icarticular.cl"
RETURN_BASE    = os.getenv("RETURN_BASE") or FRONTEND_BASE
PORT           = int(os.getenv("PORT") or 3001)

KHIPU_API_KEY  = os.getenv("KHIPU_API_KEY") or ""
KHIPU_API_BASE = "https://payment-api.khipu.com"
KHIPU_AMOUNT   = int(os.getenv("KHIPU_AMOUNT") or 1000)
KHIPU_SUBJECT  = os.getenv("KHIPU_SUBJECT") or "Orden médica ICA"
_ENV           = (os.getenv("KHIPU_ENV") or "integration").lower()
KHIPU_MODE     = "production" if _ENV in ("prod", "production") else \
                 "guest"      if _ENV == "guest" else "integration"

FLOW_AMOUNT    = int(os.getenv("FLOW_AMOUNT") or KHIPU_AMOUNT)
FLOW_SUBJECT   = os.getenv("FLOW_SUBJECT") or KHIPU_SUBJECT

CONFIG = {
    "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY") or "",
    "openai_api_key":    os.getenv("OPENAI_API_KEY") or "",
    "anthropic_model":   os.getenv("ANTHROPIC_MODEL") or "claude-sonnet-4-6",
    "openai_model":      os.getenv("OPENAI_MODEL") or "gpt-4o-mini",
    "resend_api_key":    os.getenv("RESEND_API_KEY") or "",
    "resend_from":       os.getenv("RESEND_FROM") or "contacto@icarticular.cl",
    "flow_api_key":      os.getenv("FLOW_API_KEY") or "",
    "flow_secret_key":   os.getenv("FLOW_SECRET_KEY") or "",
    "flow_env":          os.getenv("FLOW_ENV") or "sandbox",
    "khipu_api_key":     KHIPU_API_KEY,
    "khipu_amount":      KHIPU_AMOUNT,
    "khipu_subject":     KHIPU_SUBJECT,
    "khipu_env":         _ENV,
    "return_base":       RETURN_BASE,
    "frontend_base":     FRONTEND_BASE,
}

GUEST_PERFIL = {"nombre": "Guest", "rut": "11.111.111-1"}

# ============================================================
# APP
# ============================================================
app = FastAPI(title="Asistencia ICA Backend")
app.state.config = CONFIG

# ============================================================
# CORS
# ============================================================
ALLOWED_ORIGINS = [
    FRONTEND_BASE,
    "https://asistencia-ica-fggf.vercel.app",
    "https://icarticular.cl",
    "https://www.icarticular.cl",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=False,
)

# ============================================================
# ROUTERS
# ============================================================
app.include_router(rm_router)

# ============================================================
# UTILS
# ============================================================
def _sanitize(t: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_-]+', '_', str(t or ""))

def _norm_rut(s: str) -> str:
    return re.sub(r'[^0-9kK]', '', str(s or "")).upper()

def _modulo_desde_id_o_body(idPago: str, modulo: str = "") -> str:
    m = str(modulo or "").lower()
    if m == "preop"     or str(idPago).startswith("preop_"):     return "preop"
    if m == "generales" or str(idPago).startswith("generales_"): return "generales"
    if m == "ia"        or str(idPago).startswith("ia_"):        return "ia"
    return "trauma"

def _es_guest(datos: dict) -> bool:
    nombre_ok = str(datos.get("nombre") or "").strip().lower() == "guest"
    rut_ok    = _norm_rut(datos.get("rut") or "") == _norm_rut(GUEST_PERFIL["rut"])
    return nombre_ok and rut_ok

def _build_examen_texto(rec: dict) -> str:
    for campo in ["examenes", "examenesIA"]:
        v = rec.get(campo)
        if isinstance(v, list) and v:
            return "\n".join(str(x).strip() for x in v if str(x).strip())
    return ""

def _build_nota(rec: dict) -> str:
    for campo in ["nota", "observaciones", "justificacionIA", "informeIA"]:
        v = rec.get(campo)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""

def _contiene_rm(texto: str) -> bool:
    s = str(texto or "").lower()
    return "resonancia" in s or bool(re.search(r'\brm\b', texto, re.I))

def _backend_base(request: Request) -> str:
    return str(request.base_url).rstrip("/")

# ============================================================
# HEALTH
# ============================================================
@app.get("/")
def root():
    return "OK"

@app.get("/health")
def health():
    return {"ok": True, "mode": KHIPU_MODE, "frontend": FRONTEND_BASE}

# ============================================================
# GEO PING
# ============================================================
class GeoPingBody(BaseModel):
    geo: dict | None = None

@app.post("/geo-ping")
async def geo_ping_post(body: GeoPingBody, request: Request):
    try:
        g = body.geo or {}
        if isinstance(g.get("lat"), (int, float)) and isinstance(g.get("lon"), (int, float)):
            resolved = resolver_geo_por_gps(g["lat"], g["lon"])
            return {"ok": True, "geo": resolved}
        ip       = get_client_ip(request)
        resolved = await geo_from_ip(ip)
        return {"ok": True, "geo": resolved}
    except Exception as e:
        logger.error("geo-ping error: %s", e)
        raise HTTPException(500)

@app.get("/geo-ping")
async def geo_ping_get(request: Request):
    try:
        ip       = get_client_ip(request)
        resolved = await geo_from_ip(ip)
        return {"ok": True, "geo": resolved}
    except Exception as e:
        logger.error("geo-ping error: %s", e)
        raise HTTPException(500)

# ============================================================
# ZOHO
# ============================================================
@app.get("/zoho/callback")
async def zoho_callback(code: str = ""):
    if not code:
        raise HTTPException(400, detail="Falta code")
    logger.info("ZOHO AUTH CODE: %s", code)
    return {"ok": True, "message": "Zoho authorization code recibido", "code": code}

@app.get("/debug/zoho/accounts")
async def debug_zoho_accounts():
    token = os.getenv("ZOHO_MAIL_ACCESS_TOKEN") or ""
    if not token:
        raise HTTPException(500, detail="Falta ZOHO_MAIL_ACCESS_TOKEN")
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            "https://mail.zoho.com/api/accounts",
            headers={"Authorization": f"Bearer {token}"},
        )
    return Response(content=r.text, status_code=r.status_code, media_type="application/json")

# ============================================================
# WEBHOOKS — FLOW + KHIPU
# ============================================================
@app.post("/webhook")
async def webhook_khipu(request: Request):
    body = await request.json()
    logger.info("Webhook Khipu: %s", body)
    return Response("OK", status_code=200)

@app.post("/flow-confirmation")
async def flow_confirmation(request: Request):
    body = await request.body()
    logger.info("Flow confirmation: %s", body)
    return Response("OK", status_code=200)

@app.get("/flow-return")
@app.post("/flow-return")
async def flow_return(request: Request, idPago: str = "", modulo: str = "trauma"):
    params    = urlencode({"pago": "ok", "idPago": idPago, "modulo": modulo})
    final_url = f"{RETURN_BASE}?{params}"
    return RedirectResponse(url=final_url, status_code=302)

# ============================================================
# PAGO — KHIPU
# ============================================================
class CrearPagoBody(BaseModel):
    idPago:        str
    modulo:        str | None = None
    datosPaciente: dict | None = None
    modoGuest:     bool = False

@app.post("/crear-pago-khipu")
@app.post("/crear-pago")
async def crear_pago_khipu(body: CrearPagoBody, request: Request):
    id_pago = body.idPago
    space   = _modulo_desde_id_o_body(id_pago, body.modulo or "")
    datos   = body.datosPaciente or {}

    if _es_guest(datos) or body.modoGuest:
        params = urlencode({"pago": "ok", "idPago": id_pago, "modulo": space})
        return {"ok": True, "url": f"{RETURN_BASE}?{params}", "guest": True}

    if not KHIPU_API_KEY:
        raise HTTPException(500, detail="Falta KHIPU_API_KEY")

    backend_base = _backend_base(request)
    payload = {
        "amount":         KHIPU_AMOUNT,
        "currency":       "CLP",
        "subject":        KHIPU_SUBJECT,
        "transaction_id": id_pago,
        "return_url":     f"{RETURN_BASE}?pago=ok&idPago={id_pago}&modulo={space}",
        "cancel_url":     f"{RETURN_BASE}?pago=cancelado&idPago={id_pago}&modulo={space}",
        "notify_url":     f"{backend_base}/webhook",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{KHIPU_API_BASE}/v3/payments",
            headers={"content-type": "application/json", "x-api-key": KHIPU_API_KEY},
            json=payload,
        )
    j = r.json() if r.content else {}
    if not r.is_success:
        raise HTTPException(502, detail=j.get("message") or f"Error Khipu ({r.status_code})")
    url_pago = j.get("payment_url") or j.get("simplified_transfer_url") or j.get("url")
    if not url_pago:
        raise HTTPException(502, detail="Khipu no entregó payment_url")
    return {"ok": True, "url": url_pago}

# ============================================================
# PAGO — FLOW
# ============================================================
@app.post("/crear-pago-flow")
async def crear_pago_flow(body: CrearPagoBody, request: Request):
    id_pago = body.idPago
    space   = _modulo_desde_id_o_body(id_pago, body.modulo or "")
    datos   = body.datosPaciente or {}

    if _es_guest(datos) or body.modoGuest:
        params = urlencode({"pago": "ok", "idPago": id_pago, "modulo": space})
        return {"ok": True, "url": f"{RETURN_BASE}?{params}", "guest": True}

    backend_base = _backend_base(request)
    email = datos.get("email") or os.getenv("FLOW_FALLBACK_EMAIL") or "sin-correo@icarticular.cl"

    resultado = await crear_pago_flow_backend(
        id_pago          = id_pago,
        amount           = FLOW_AMOUNT,
        subject          = FLOW_SUBJECT,
        email            = email,
        modulo           = space,
        url_confirmation = f"{backend_base}/flow-confirmation",
        url_return       = f"{backend_base}/flow-return?modulo={space}&idPago={id_pago}",
        optional_data    = {"rut": datos.get("rut") or "", "nombre": datos.get("nombre") or ""},
        config           = CONFIG,
    )
    return {"ok": True, "url": resultado["url"], "token": resultado["token"], "flowOrder": resultado["flow_order"]}

# ============================================================
# IA — TRAUMA
# ============================================================
class TraumaIABody(BaseModel):
    idPago:     str
    paciente:   dict | None = None
    detalles:   dict | None = None
    traumaJSON: dict | None = None

@app.post("/ia-trauma")
@app.post("/ia/trauma")
async def ia_trauma(body: TraumaIABody):
    result = await trauma_ia(body.model_dump(), CONFIG)
    if not result.get("ok"):
        p  = body.paciente or (body.traumaJSON or {}).get("paciente") or {}
        fb = fallback_trauma(p)
        return {"ok": True, "fallback": True,
                "examenes":      [fb["examen"]],
                "diagnostico":   fb["diagnostico"],
                "justificacion": fb["justificacion"],
                "informeIA":     fb["justificacion"]}
    return result

# ============================================================
# IA — GENERALES
# ============================================================
class GeneralesIABody(BaseModel):
    idPago:           str
    paciente:         dict = {}
    comorbilidades:   dict = {}
    catalogoExamenes: list = []

@app.post("/ia-generales")
async def ia_generales(body: GeneralesIABody):
    return await generales_ia(body.model_dump(), CONFIG)

# ============================================================
# IA — PREOP
# ============================================================
class PreopIABody(BaseModel):
    idPago:           str
    paciente:         dict = {}
    comorbilidades:   dict = {}
    tipoCirugia:      str = ""
    catalogoExamenes: list = []

@app.post("/ia-preop")
@app.post("/preop-ia")
async def ia_preop(body: PreopIABody):
    return await preop_ia(body.model_dump(), CONFIG)

# ============================================================
# CHAT — PREVIEW INFORME
# ============================================================
class ChatPreviewBody(BaseModel):
    idPago:     str
    consulta:   str
    nombre:     str | None = None
    edad:       Any = None
    rut:        str | None = None
    genero:     str | None = None
    dolor:      str | None = None
    lado:       str | None = None
    marcadores: dict | None = None

@app.post("/api/preview-informe")
async def api_preview_informe(body: ChatPreviewBody):
    return await preview_informe(body.model_dump(), CONFIG)

# ============================================================
# PDF — UNIFICADO
# ============================================================
@app.post("/pdf")
async def pdf_unificado(request: Request):
    data    = await request.json()
    id_pago = data.get("idPago") or ""
    modulo  = _modulo_desde_id_o_body(id_pago, data.get("modulo") or "")
    d       = data.get("datos") or data
    rut     = _norm_rut(d.get("rut") or "")
    nombre  = _sanitize(d.get("nombre") or "paciente")

    try:
        if modulo == "trauma":
            deriv     = resolver_derivacion({"dolor": d.get("dolor")}, d.get("geo"))
            pdf_bytes = generar_orden_imagenologia({**d, "examen": _build_examen_texto(d), "nota": deriv["nota"], "rut": rut})
            filename  = f"orden_{nombre}.pdf"

        elif modulo == "preop":
            from pypdf import PdfWriter, PdfReader
            lab_b   = generar_orden_preop_lab({**d, "rut": rut})
            odont_b = generar_preop_odonto({**d, "rut": rut})
            writer  = PdfWriter()
            for parte in [lab_b, odont_b]:
                for page in PdfReader(io.BytesIO(parte)).pages:
                    writer.add_page(page)
            out = io.BytesIO()
            writer.write(out)
            pdf_bytes = out.getvalue()
            filename  = f"preop_{nombre}.pdf"

        elif modulo == "generales":
            pdf_bytes = generar_orden_generales({**d, "examenes_ia": d.get("examenesIA") or d.get("examenes_ia") or [], "rut": rut})
            filename  = f"generales_{nombre}.pdf"

        elif modulo == "ia":
            pdf_bytes = generar_orden_imagenologia_ia({**d, "examen": _build_examen_texto(d), "nota": _build_nota(d), "rut": rut}, resolver_derivacion)
            filename  = f"ordenIA_{nombre}.pdf"

        else:
            raise HTTPException(400, detail="Módulo inválido")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("pdf error: %s", e)
        raise HTTPException(500)

    asyncio.create_task(
        enviar_orden_por_correo(
            datos={**d, "rut": rut},
            modulo=modulo,
            generador_pdf=lambda _: pdf_bytes,
            config=CONFIG,
        )
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ============================================================
# PDF — PREOP específico
# ============================================================
@app.post("/pdf-preop")
async def pdf_preop(request: Request):
    data    = await request.json()
    d       = data.get("datos") or data
    rut     = _norm_rut(d.get("rut") or "")
    nombre  = _sanitize(d.get("nombre") or "paciente")

    from pypdf import PdfWriter, PdfReader
    lab_b   = generar_orden_preop_lab({**d, "rut": rut})
    odont_b = generar_preop_odonto({**d, "rut": rut})
    writer  = PdfWriter()
    for parte in [lab_b, odont_b]:
        for page in PdfReader(io.BytesIO(parte)).pages:
            writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    pdf_bytes = out.getvalue()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="preop_{nombre}.pdf"'},
    )

# ============================================================
# PDF — INFORME IA (texto)
# ============================================================
@app.post("/api/pdf-ia")
async def pdf_ia(request: Request):
    data      = await request.json()
    d         = data.get("datos") or data
    nombre    = _sanitize(d.get("nombre") or "paciente")
    pdf_bytes = generar_informe_ia(d)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="informeIA_{nombre}.pdf"'},
    )

# ============================================================
# PDF — ORDEN IA (imagenología)
# ============================================================
@app.post("/api/pdf-ia-orden")
async def pdf_ia_orden(request: Request):
    data      = await request.json()
    d         = data.get("datos") or data
    rut       = _norm_rut(d.get("rut") or "")
    nombre    = _sanitize(d.get("nombre") or "paciente")
    pdf_bytes = generar_orden_imagenologia_ia(
        {**d, "examen": _build_examen_texto(d), "nota": _build_nota(d), "rut": rut},
        resolver_derivacion,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="ordenIA_{nombre}.pdf"'},
    )

# ============================================================
# DETECTAR RESONANCIA
# ============================================================
class DetectarRMBody(BaseModel):
    idPago:        str | None = None
    datosPaciente: dict | None = None

@app.post("/detectar-resonancia")
async def detectar_resonancia(body: DetectarRMBody):
    base  = body.datosPaciente or {}
    texto = _build_examen_texto(base)
    return {"ok": True, "resonancia": _contiene_rm(texto), "texto": texto}

# ============================================================
