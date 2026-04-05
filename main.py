# main.py
# FastAPI — equivalente completo de index.js
# Memoria temporal en RAM (igual que Map de Node)
# Soporta Flow + Khipu

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

from core.geo import get_client_ip, geo_from_ip, resolver_geo_por_gps
from routers.resolver import resolver_derivacion
from routers.flow_client import crear_pago_flow_backend
from routers.rm_pdf_routes import router as rm_router
from correo.email_orden import enviar_orden_por_correo

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
# CONFIG
# ============================================================
FRONTEND_BASE      = os.getenv("FRONTEND_BASE") or os.getenv("RETURN_BASE") or "https://icarticular.cl"
RETURN_BASE        = os.getenv("RETURN_BASE") or FRONTEND_BASE
PORT               = int(os.getenv("PORT") or 3001)
KHIPU_API_KEY      = os.getenv("KHIPU_API_KEY") or ""
KHIPU_API_BASE     = "https://payment-api.khipu.com"
KHIPU_AMOUNT       = int(os.getenv("KHIPU_AMOUNT") or 1000)
KHIPU_SUBJECT      = os.getenv("KHIPU_SUBJECT") or "Orden médica ICA"
_ENV               = (os.getenv("KHIPU_ENV") or "integration").lower()
KHIPU_MODE         = "production" if _ENV in ("prod","production") else \
                     "guest"      if _ENV == "guest" else "integration"
FLOW_AMOUNT        = int(os.getenv("FLOW_AMOUNT") or KHIPU_AMOUNT)
FLOW_SUBJECT       = os.getenv("FLOW_SUBJECT") or KHIPU_SUBJECT
ICA_BACKEND_URL    = os.getenv("ICA_BACKEND_URL") or ""
ICA_PREDIAG_SECRET = os.getenv("PREDIAG_SECRET")  or "ica_prediag_2024"

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
# MEMORIA TEMPORAL (igual que Map de Node)
# ============================================================
_memoria: dict[str, dict] = {}

def _ns(space: str, id_pago: str) -> str:
    return f"{space}:{id_pago}"

def _mem_get(space: str, id_pago: str) -> dict:
    return dict(_memoria.get(_ns(space, id_pago)) or {})

def _mem_set(space: str, id_pago: str, data: dict) -> None:
    _memoria[_ns(space, id_pago)] = data

def _mem_del(space: str, id_pago: str) -> bool:
    return _memoria.pop(_ns(space, id_pago), None) is not None

def _mem_pick(id_pago: str) -> tuple[str | None, dict | None]:
    for s in ["ia", "trauma", "preop", "generales"]:
        v = _memoria.get(_ns(s, id_pago))
        if v:
            return s, dict(v)
    return None, None

def _merge(prev: dict, incoming: dict) -> dict:
    next_ = {**prev}
    for k, v in incoming.items():
        if v is None: continue
        if isinstance(v, list) and len(v) == 0: continue
        if isinstance(v, str) and not v.strip(): continue
        next_[k] = v
    return next_

# ============================================================
# APP
# ============================================================
app = FastAPI(title="Asistencia ICA Backend")
app.state.config = CONFIG

ALLOWED_ORIGINS = [
    FRONTEND_BASE,
    "https://asistencia-ica-fggf.vercel.app",
    "https://icarticular.cl",
    "https://www.icarticular.cl",
    "https://app.icarticular.cl",
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

app.include_router(rm_router)

# ============================================================
# UTILS
# ============================================================
def _sanitize(t: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_-]+', '_', str(t or ""))

def _norm_rut(s: str) -> str:
    # Quita puntos pero mantiene guión — igual que frontend normalizeRut
    return re.sub(r'[.]', '', str(s or '')).upper().strip()

def _modulo_desde(id_pago: str, modulo: str = "") -> str:
    m = str(modulo or "").lower()
    if m == "preop"     or str(id_pago).startswith("preop_"):     return "preop"
    if m == "generales" or str(id_pago).startswith("generales_"): return "generales"
    if m == "ia"        or str(id_pago).startswith("ia_"):        return "ia"
    return "trauma"

def _es_guest(datos: dict) -> bool:
    return (str(datos.get("nombre") or "").strip().lower() == "guest" and
            _norm_rut(datos.get("rut") or "") == _norm_rut(GUEST_PERFIL["rut"]))

def _build_examen(rec: dict) -> str:
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
# REGISTRAR EN ICA (no bloqueante — se llama tras emitir PDF)
# ============================================================
async def _registrar_en_ica(
    datos: dict,
    modulo: str,
    examenes: list,
    diagnostico: str,
    justificacion: str,
) -> None:
    # Solo grabar ficha si el paciente viene de reserva
    if datos.get("origen") != "reserva":
        return
    if not ICA_BACKEND_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{ICA_BACKEND_URL}/api/prediagnostico/registrar",
                headers={"x-internal-user": "ia_prediagnostico"},
                json={
                    "rut":           _norm_rut(datos.get("rut") or ""),
                    "nombre":        datos.get("nombre") or "",
                    "edad":          datos.get("edad"),
                    "genero":        datos.get("genero") or "",
                    "dolor":         datos.get("dolor") or "",
                    "lado":          datos.get("lado") or "",
                    "diagnostico":   diagnostico,
                    "examenes":      examenes,
                    "justificacion": justificacion,
                    "idPago":        datos.get("idPago") or "",
                    "modulo":        modulo,
                },
            )
        logger.info("Registrado en ICA: rut=%s modulo=%s", datos.get("rut"), modulo)
    except Exception as e:
        logger.warning("No se pudo registrar en ICA: %s", e)

# ============================================================
# HEALTH
# ============================================================
@app.get("/")
def root(): return "OK"

@app.get("/health")
def health(): return {"ok": True, "mode": KHIPU_MODE, "frontend": FRONTEND_BASE}

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
            return {"ok": True, "geo": resolver_geo_por_gps(g["lat"], g["lon"])}
        return {"ok": True, "geo": await geo_from_ip(get_client_ip(request))}
    except Exception as e:
        logger.error("geo-ping error: %s", e)
        raise HTTPException(500)

@app.get("/geo-ping")
async def geo_ping_get(request: Request):
    try:
        return {"ok": True, "geo": await geo_from_ip(get_client_ip(request))}
    except Exception as e:
        logger.error("geo-ping error: %s", e)
        raise HTTPException(500)

# ============================================================
# ZOHO
# ============================================================
@app.get("/zoho/callback")
async def zoho_callback(code: str = ""):
    if not code: raise HTTPException(400, detail="Falta code")
    logger.info("ZOHO AUTH CODE: %s", code)
    return {"ok": True, "message": "Zoho authorization code recibido", "code": code}

@app.get("/debug/zoho/accounts")
async def debug_zoho_accounts():
    token = os.getenv("ZOHO_MAIL_ACCESS_TOKEN") or ""
    if not token: raise HTTPException(500, detail="Falta ZOHO_MAIL_ACCESS_TOKEN")
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get("https://mail.zoho.com/api/accounts",
                             headers={"Authorization": f"Bearer {token}"})
    return Response(content=r.text, status_code=r.status_code, media_type="application/json")

# ============================================================
# WEBHOOKS
# ============================================================
@app.post("/webhook")
async def webhook_khipu(request: Request):
    try: body = await request.json()
    except: body = {}
    logger.info("Webhook Khipu: %s", body)
    return Response("OK", status_code=200)

@app.post("/flow-confirmation")
async def flow_confirmation(request: Request):
    body = await request.body()
    logger.info("Flow confirmation: %s", body)
    return Response("OK", status_code=200)

@app.get("/flow-return")
@app.post("/flow-return")
async def flow_return(idPago: str = "", modulo: str = "trauma"):
    params = urlencode({"pago": "ok", "idPago": idPago, "modulo": modulo})
    return RedirectResponse(url=f"{RETURN_BASE}?{params}", status_code=302)

# ============================================================
# GUARDAR DATOS — TRAUMA
# ============================================================
@app.post("/guardar-datos")
async def guardar_datos(request: Request):
    body = await request.json()
    id_pago        = body.get("idPago") or ""
    datos_paciente = body.get("datosPaciente") or {}
    trauma_json    = body.get("traumaJSON")
    geo            = body.get("geo")

    if not id_pago or (not datos_paciente and not trauma_json):
        raise HTTPException(400, detail="Faltan idPago o datosPaciente/traumaJSON")

    prev = _mem_get("trauma", id_pago)
    incoming: dict = {**(datos_paciente or {}), "geo": geo or prev.get("geo")}

    if isinstance(trauma_json, dict):
        pac        = trauma_json.get("paciente") or {}
        ia         = trauma_json.get("ia") or {}
        resonancia = trauma_json.get("resonancia") or {}
        marcadores = trauma_json.get("marcadores") or {}
        incoming = {
            **pac,
            "geo":              geo or trauma_json.get("geo") or prev.get("geo"),
            "examenesIA":       ia.get("examenes") or [],
            "diagnosticoIA":    ia.get("diagnostico") or "",
            "justificacionIA":  ia.get("justificacion") or "",
            "rmForm":           resonancia.get("checklist"),
            "rmObservaciones":  resonancia.get("resumenTexto") or "",
            "ordenAlternativa": resonancia.get("ordenAlternativa") or "",
            "marcadores":       marcadores,
            "rodillaMarcadores": marcadores.get("rodilla"),
            "manoMarcadores":    marcadores.get("mano"),
            "hombroMarcadores":  marcadores.get("hombro"),
            "codoMarcadores":    marcadores.get("codo"),
            "tobilloMarcadores": marcadores.get("tobillo"),
            "caderaMarcadores":  marcadores.get("cadera"),
            "traumaJSON":        trauma_json,
        }
        if body.get("resonanciaChecklist"):    incoming["rmForm"] = body["resonanciaChecklist"]
        if body.get("resonanciaResumenTexto"): incoming["rmObservaciones"] = body["resonanciaResumenTexto"]
        if body.get("ordenAlternativa"):       incoming["ordenAlternativa"] = body["ordenAlternativa"]

    next_ = _merge(prev, incoming)
    if isinstance(incoming.get("examenesIA"), list) and incoming["examenesIA"]:
        next_["examenes"] = list(incoming["examenesIA"])
    if isinstance(prev.get("examenes"), list) and not next_.get("examenes"):
        next_["examenes"] = prev["examenes"]
    for f in ["diagnosticoIA", "justificacionIA", "rmForm", "rmObservaciones"]:
        if prev.get(f) and not next_.get(f):
            next_[f] = prev[f]
    next_["pagoConfirmado"] = True
    _mem_set("trauma", id_pago, next_)
    return {"ok": True}

# ============================================================
# GUARDAR DATOS — PREOP
# ============================================================
@app.post("/guardar-datos-preop")
async def guardar_datos_preop(request: Request):
    body = await request.json()
    id_pago        = body.get("idPago") or ""
    datos_paciente = body.get("datosPaciente") or {}
    comorbilidades = body.get("comorbilidades")
    tipo_cirugia   = body.get("tipoCirugia")
    examenes_ia    = body.get("examenesIA")
    informe_ia     = body.get("informeIA")
    nota           = body.get("nota")

    if not id_pago or not datos_paciente:
        raise HTTPException(400, detail="Faltan idPago o datosPaciente")

    prev  = _mem_get("preop", id_pago)
    next_ = {**prev}
    for k, v in datos_paciente.items():
        if v is None or (isinstance(v, list) and not v) or (isinstance(v, str) and not v.strip()): continue
        next_[k] = v
    if isinstance(comorbilidades, dict):
        next_["comorbilidades"] = {**(next_.get("comorbilidades") or {}), **comorbilidades}
    if tipo_cirugia: next_["tipoCirugia"] = tipo_cirugia
    if isinstance(examenes_ia, list) and examenes_ia:
        prev_list = next_.get("examenesIA") or []
        next_["examenesIA"] = list(dict.fromkeys([*prev_list, *examenes_ia]))
    if isinstance(informe_ia, str) and informe_ia.strip(): next_["informeIA"] = informe_ia.strip()
    if isinstance(nota, str) and nota.strip(): next_["nota"] = nota.strip()
    next_["pagoConfirmado"] = True
    _mem_set("preop", id_pago, next_)
    return {"ok": True}

# ============================================================
# GUARDAR DATOS — GENERALES
# ============================================================
@app.post("/guardar-datos-generales")
async def guardar_datos_generales(request: Request):
    body = await request.json()
    id_pago        = body.get("idPago") or ""
    datos_paciente = body.get("datosPaciente") or {}
    comorbilidades = body.get("comorbilidades")
    examenes_ia    = body.get("examenesIA")
    informe_ia     = body.get("informeIA")
    nota           = body.get("nota")

    if not id_pago or not datos_paciente:
        raise HTTPException(400, detail="Faltan idPago o datosPaciente")

    prev  = _mem_get("generales", id_pago)
    next_ = {**prev}
    for k, v in datos_paciente.items():
        if v is None or (isinstance(v, list) and not v) or (isinstance(v, str) and not v.strip()): continue
        next_[k] = v
    if isinstance(comorbilidades, dict):
        next_["comorbilidades"] = {**(next_.get("comorbilidades") or {}), **comorbilidades}
    if isinstance(examenes_ia, list) and examenes_ia:
        prev_list = next_.get("examenesIA") or []
        next_["examenesIA"] = list(dict.fromkeys([*prev_list, *examenes_ia]))
    if isinstance(informe_ia, str) and informe_ia.strip(): next_["informeIA"] = informe_ia.strip()
    if isinstance(nota, str) and nota.strip(): next_["nota"] = nota.strip()
    next_["pagoConfirmado"] = True
    _mem_set("generales", id_pago, next_)
    return {"ok": True}

# ============================================================
# GUARDAR DATOS — IA
# ============================================================
@app.post("/api/guardar-datos-ia")
async def guardar_datos_ia(request: Request):
    body = await request.json()
    id_pago = body.get("idPago") or ""
    if not id_pago: raise HTTPException(400, detail="Falta idPago")

    prev  = _mem_get("ia", id_pago)
    next_ = {**prev}

    def mf(key, value):
        if value is None: return
        if isinstance(value, list) and not value: return
        if isinstance(value, str) and not value.strip(): return
        if isinstance(value, dict) and not value: return
        next_[key] = value

    ia_json = body.get("iaJSON")
    if isinstance(ia_json, dict):
        pac        = ia_json.get("paciente") or {}
        resonancia = ia_json.get("resonancia") or {}
        marcadores = ia_json.get("marcadores") or {}
        if pac:
            next_["paciente"] = {**(next_.get("paciente") or {}), **pac}
            for k in ["nombre","rut","edad","genero","dolor","lado"]: mf(k, pac.get(k))
        mf("consulta",  ia_json.get("consulta"))
        mf("informeIA", ia_json.get("informeIA"))
        mf("nota",      ia_json.get("nota"))
        examenes = ia_json.get("examenes") or ia_json.get("examenesIA")
        if isinstance(examenes, list) and examenes:
            mf("examenes", examenes); mf("examenesIA", examenes)
        if marcadores:
            next_["marcadores"] = {**(next_.get("marcadores") or {}), **marcadores}
        if resonancia.get("checklist"):        mf("rmForm", resonancia["checklist"])
        if resonancia.get("resumenTexto"):     mf("rmObservaciones", resonancia["resumenTexto"])
        if resonancia.get("ordenAlternativa"): mf("ordenAlternativa", resonancia["ordenAlternativa"])
        next_["iaJSON"] = ia_json

    datos_paciente = body.get("datosPaciente")
    if isinstance(datos_paciente, dict):
        for k, v in datos_paciente.items(): mf(k, v)

    marcadores = body.get("marcadores")
    if isinstance(marcadores, dict):
        next_["marcadores"] = {**(next_.get("marcadores") or {}), **marcadores}

    for campo in ["rodillaMarcadores","manoMarcadores","hombroMarcadores",
                  "codoMarcadores","tobilloMarcadores","caderaMarcadores"]:
        mf(campo, body.get(campo))

    if body.get("resonanciaChecklist"):    mf("rmForm", body["resonanciaChecklist"])
    if body.get("resonanciaResumenTexto"): mf("rmObservaciones", body["resonanciaResumenTexto"])
    if body.get("ordenAlternativa"):       mf("ordenAlternativa", body["ordenAlternativa"])
    if body.get("pagoConfirmado") is True or prev.get("pagoConfirmado"):
        next_["pagoConfirmado"] = True

    _mem_set("ia", id_pago, next_)
    return {"ok": True}

# ============================================================
# OBTENER DATOS
# ============================================================
@app.get("/obtener-datos/{id_pago}")
async def obtener_datos(id_pago: str):
    space, data = _mem_pick(id_pago)
    if not data: raise HTTPException(404)
    return {"ok": True, "datos": data, "space": space}

@app.get("/obtener-datos-preop/{id_pago}")
async def obtener_datos_preop(id_pago: str):
    d = _mem_get("preop", id_pago)
    if not d: raise HTTPException(404)
    return {"ok": True, "datos": d}

@app.get("/obtener-datos-generales/{id_pago}")
async def obtener_datos_generales(id_pago: str):
    d = _mem_get("generales", id_pago)
    if not d: raise HTTPException(404)
    return {"ok": True, "datos": d}

@app.get("/api/obtener-datos-ia/{id_pago}")
async def obtener_datos_ia(id_pago: str):
    d = _mem_get("ia", id_pago)
    if not d: raise HTTPException(404)
    return {"ok": True, "datos": d}

# ============================================================
# SUGERIR IMAGENOLOGÍA
# ============================================================
@app.get("/sugerir-imagenologia")
async def sugerir_imagenologia(idPago: str = ""):
    if not idPago: raise HTTPException(400, detail="Falta idPago")
    _, data = _mem_pick(idPago)
    if not data: raise HTTPException(404)
    texto = _build_examen(data)
    return {"ok": True, "examLines": texto.split("\n") if texto else [],
            "examen": texto, "nota": _build_nota(data), "resonancia": _contiene_rm(texto)}

# ============================================================
# DETECTAR RESONANCIA
# ============================================================
@app.post("/detectar-resonancia")
async def detectar_resonancia(request: Request):
    body = await request.json()
    id_pago = body.get("idPago")
    if id_pago:
        _, base = _mem_pick(id_pago)
        base = base or {}
    else:
        base = body.get("datosPaciente") or {}
    texto = _build_examen(base)
    return {"ok": True, "resonancia": _contiene_rm(texto), "texto": texto}

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
    space   = _modulo_desde(id_pago, body.modulo or "")
    datos   = body.datosPaciente or {}

    if datos:
        prev  = _mem_get(space, id_pago)
        next_ = _merge(prev, datos)
        if space == "trauma":
            if prev.get("examenes") and not next_.get("examenes"): next_["examenes"] = prev["examenes"]
        else:
            if prev.get("examenesIA") and not next_.get("examenesIA"): next_["examenesIA"] = prev["examenesIA"]
        for f in ["diagnosticoIA","justificacionIA","rmForm","rmObservaciones"]:
            if prev.get(f) and not next_.get(f): next_[f] = prev[f]
        _mem_set(space, id_pago, next_)
    _mem_set("meta", id_pago, {"moduloAutorizado": space})

    if _es_guest(datos) or body.modoGuest:
        params = urlencode({"pago": "ok", "idPago": id_pago, "modulo": space})
        return {"ok": True, "url": f"{RETURN_BASE}?{params}", "guest": True}

    if not KHIPU_API_KEY: raise HTTPException(500, detail="Falta KHIPU_API_KEY")

    payload = {
        "amount": KHIPU_AMOUNT, "currency": "CLP", "subject": KHIPU_SUBJECT,
        "transaction_id": id_pago,
        "return_url":  f"{RETURN_BASE}?pago=ok&idPago={id_pago}&modulo={space}",
        "cancel_url":  f"{RETURN_BASE}?pago=cancelado&idPago={id_pago}&modulo={space}",
        "notify_url":  f"{_backend_base(request)}/webhook",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{KHIPU_API_BASE}/v3/payments",
                              headers={"content-type":"application/json","x-api-key":KHIPU_API_KEY},
                              json=payload)
    j = r.json() if r.content else {}
    if not r.is_success: raise HTTPException(502, detail=j.get("message") or f"Error Khipu ({r.status_code})")
    url_pago = j.get("payment_url") or j.get("simplified_transfer_url") or j.get("url")
    if not url_pago: raise HTTPException(502, detail="Khipu no entregó payment_url")
    return {"ok": True, "url": url_pago}

# ============================================================
# PAGO — FLOW
# ============================================================
@app.post("/crear-pago-flow")
async def crear_pago_flow(body: CrearPagoBody, request: Request):
    id_pago = body.idPago
    space   = _modulo_desde(id_pago, body.modulo or "")
    datos   = body.datosPaciente or {}

    if datos:
        prev  = _mem_get(space, id_pago)
        _mem_set(space, id_pago, _merge(prev, datos))
    _mem_set("meta", id_pago, {"moduloAutorizado": space})

    if _es_guest(datos) or body.modoGuest:
        params = urlencode({"pago": "ok", "idPago": id_pago, "modulo": space})
        return {"ok": True, "url": f"{RETURN_BASE}?{params}", "guest": True}

    backend_base = _backend_base(request)
    email = datos.get("email") or os.getenv("FLOW_FALLBACK_EMAIL") or "sin-correo@icarticular.cl"
    resultado = await crear_pago_flow_backend(
        id_pago=id_pago, amount=FLOW_AMOUNT, subject=FLOW_SUBJECT, email=email,
        modulo=space,
        url_confirmation=f"{backend_base}/flow-confirmation",
        url_return=f"{backend_base}/flow-return?modulo={space}&idPago={id_pago}",
        optional_data={"rut": datos.get("rut") or "", "nombre": datos.get("nombre") or ""},
        config=CONFIG,
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
async def ia_trauma_endpoint(body: TraumaIABody):
    result = await trauma_ia(body.model_dump(), CONFIG)
    if not result.get("ok"):
        p  = body.paciente or (body.traumaJSON or {}).get("paciente") or {}
        fb = fallback_trauma(p)
        result = {"ok": True, "fallback": True, "examenes": [fb["examen"]],
                  "diagnostico": fb["diagnostico"], "justificacion": fb["justificacion"],
                  "informeIA": fb["justificacion"]}
    id_pago  = body.idPago
    prev     = _mem_get("trauma", id_pago)
    pac      = body.paciente or (body.traumaJSON or {}).get("paciente") or {}
    geo      = prev.get("geo") or (body.traumaJSON or {}).get("geo")
    examenes = result.get("examenes") or []
    next_ = {**prev, **pac,
             "examenes":        examenes,
             "examenesIA":      examenes,
             "diagnosticoIA":   result.get("diagnostico",""),
             "justificacionIA": result.get("justificacion",""),
             "pagoConfirmado":  True}
    if geo: next_["geo"] = geo
    _mem_set("trauma", id_pago, next_)
    _mem_set("ia",     id_pago, next_)
    _mem_set("meta",   id_pago, {"moduloAutorizado": "ia"})
    return result

# ============================================================
# IA — GENERALES
# ============================================================
class GeneralesIABody(BaseModel):
    idPago: str
    paciente: dict = {}
    comorbilidades: dict = {}
    catalogoExamenes: list = []

@app.post("/ia-generales")
async def ia_generales_endpoint(body: GeneralesIABody):
    result = await generales_ia(body.model_dump(), CONFIG)
    if result.get("ok"):
        prev = _mem_get("generales", body.idPago)
        _mem_set("generales", body.idPago, {**prev, **body.paciente,
                 "comorbilidades": body.comorbilidades,
                 "examenesIA": result.get("examenes",[]),
                 "informeIA":  result.get("informeIA",""),
                 "pagoConfirmado": True})
        _mem_set("meta", body.idPago, {"moduloAutorizado": "generales"})
    return result

# ============================================================
# IA — PREOP
# ============================================================
class PreopIABody(BaseModel):
    idPago: str
    paciente: dict = {}
    comorbilidades: dict = {}
    tipoCirugia: str = ""
    catalogoExamenes: list = []

@app.post("/ia-preop")
@app.post("/preop-ia")
async def ia_preop_endpoint(body: PreopIABody):
    result = await preop_ia(body.model_dump(), CONFIG)
    if result.get("ok"):
        prev = _mem_get("preop", body.idPago)
        _mem_set("preop", body.idPago, {**prev, **body.paciente,
                 "comorbilidades": body.comorbilidades,
                 "tipoCirugia":    body.tipoCirugia,
                 "examenesIA":     result.get("examenes",[]),
                 "informeIA":      result.get("informeIA",""),
                 "pagoConfirmado": True})
        _mem_set("meta", body.idPago, {"moduloAutorizado": "preop"})
    return result

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
    result = await preview_informe(body.model_dump(), CONFIG)
    if result.get("ok"):
        prev = _mem_get("ia", body.idPago)
        _mem_set("ia", body.idPago, {**prev,
                 "nombre":    body.nombre, "edad": body.edad,
                 "rut":       body.rut,    "genero": body.genero,
                 "dolor":     body.dolor,  "lado": body.lado,
                 "consulta":  body.consulta,
                 "informeIA": result.get("respuesta",""),
                 "examenes":  result.get("examenes",[]),
                 "pagoConfirmado": False})
        _mem_set("meta", body.idPago, {"moduloAutorizado": "ia"})
    return result

  # ============================================================
# PDF — TRAUMA
# ============================================================
@app.get("/pdf/{id_pago}")
async def pdf_trauma(id_pago: str):
    meta = _mem_get("meta", id_pago)
    if not meta or meta.get("moduloAutorizado") not in ("trauma","ia"):
        return Response(status_code=402)
    d = _mem_get("trauma", id_pago) or _mem_get("ia", id_pago)
    if not d: return Response(status_code=404)

    rut    = _norm_rut(d.get("rut") or "")
    examen = _build_examen(d)
    deriv  = resolver_derivacion({"dolor": d.get("dolor")}, d.get("geo"))
    nota   = deriv["nota"]

    try:
        pdf_bytes = generar_orden_imagenologia({**d, "examen": examen, "nota": nota, "rut": rut})
    except Exception as e:
        logger.error("pdf trauma error: %s", e)
        return Response(status_code=500)

    filename = f"orden_{_sanitize(d.get('nombre') or 'paciente')}.pdf"
    asyncio.create_task(enviar_orden_por_correo(
        datos={**d, "rut": rut, "deriv": deriv}, modulo="trauma",
        generador_pdf=lambda _: pdf_bytes, config=CONFIG))
    asyncio.create_task(_registrar_en_ica(
        datos={**d, "rut": rut, "idPago": id_pago},
        modulo="trauma",
        examenes=d.get("examenes") or [],
        diagnostico=d.get("diagnosticoIA") or "",
        justificacion=d.get("justificacionIA") or "",
    ))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# PDF — PREOP
# ============================================================
@app.get("/pdf-preop/{id_pago}")
async def pdf_preop(id_pago: str):
    meta = _mem_get("meta", id_pago)
    if not meta or meta.get("moduloAutorizado") != "preop":
        return Response(status_code=402)
    d = _mem_get("preop", id_pago)
    if not d: return Response(status_code=404)

    rut = _norm_rut(d.get("rut") or "")
    try:
        from pypdf import PdfWriter, PdfReader
        lab_b   = generar_orden_preop_lab({**d, "rut": rut})
        odont_b = generar_preop_odonto({**d, "rut": rut})
        writer  = PdfWriter()
        for parte in [lab_b, odont_b]:
            for page in PdfReader(io.BytesIO(parte)).pages:
                writer.add_page(page)
        out = io.BytesIO(); writer.write(out)
        pdf_bytes = out.getvalue()
    except Exception as e:
        logger.error("pdf preop error: %s", e)
        return Response(status_code=500)

    filename = f"preop_{_sanitize(d.get('nombre') or 'paciente')}.pdf"
    asyncio.create_task(enviar_orden_por_correo(
        datos={**d, "rut": rut}, modulo="preop",
        generador_pdf=lambda _: pdf_bytes, config=CONFIG))
    asyncio.create_task(_registrar_en_ica(
        datos={**d, "rut": rut, "idPago": id_pago},
        modulo="preop",
        examenes=d.get("examenesIA") or [],
        diagnostico=d.get("informeIA") or "",
        justificacion=d.get("tipoCirugia") or "",
    ))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# PDF — GENERALES
# ============================================================
@app.get("/pdf-generales/{id_pago}")
async def pdf_generales(id_pago: str):
    meta = _mem_get("meta", id_pago)
    if not meta or meta.get("moduloAutorizado") != "generales":
        return Response(status_code=402)
    d = _mem_get("generales", id_pago)
    if not d: return Response(status_code=404)

    rut = _norm_rut(d.get("rut") or "")
    try:
        pdf_bytes = generar_orden_generales({**d, "rut": rut})
    except Exception as e:
        logger.error("pdf generales error: %s", e)
        return Response(status_code=500)

    filename = f"generales_{_sanitize(d.get('nombre') or 'paciente')}.pdf"
    asyncio.create_task(enviar_orden_por_correo(
        datos={**d, "rut": rut}, modulo="generales",
        generador_pdf=lambda _: pdf_bytes, config=CONFIG))
    asyncio.create_task(_registrar_en_ica(
        datos={**d, "rut": rut, "idPago": id_pago},
        modulo="generales",
        examenes=d.get("examenesIA") or [],
        diagnostico=d.get("informeIA") or "",
        justificacion=d.get("nota") or "",
    ))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# PDF — IA ORDEN (imagenología)
# ============================================================
@app.get("/api/pdf-ia-orden/{id_pago}")
async def pdf_ia_orden(id_pago: str):
    meta = _mem_get("meta", id_pago)
    if not meta or meta.get("moduloAutorizado") != "ia":
        return Response(status_code=402)
    d = _mem_get("ia", id_pago)
    if not d: return Response(status_code=404)

    rut    = _norm_rut(d.get("rut") or "")
    examen = _build_examen(d)
    nota   = _build_nota(d)
    try:
        pdf_bytes = generar_orden_imagenologia_ia(
            {**d, "examen": examen, "nota": nota, "rut": rut}, resolver_derivacion)
    except Exception as e:
        logger.error("pdf ia orden error: %s", e)
        return Response(status_code=500)

    filename = f"ordenIA_{_sanitize(d.get('nombre') or 'paciente')}.pdf"
    asyncio.create_task(enviar_orden_por_correo(
        datos={**d, "rut": rut}, modulo="ia",
        generador_pdf=lambda _: pdf_bytes, config=CONFIG))
    asyncio.create_task(_registrar_en_ica(
        datos={**d, "rut": rut, "idPago": id_pago},
        modulo="ia",
        examenes=d.get("examenes") or d.get("examenesIA") or [],
        diagnostico=d.get("diagnosticoIA") or "",
        justificacion=d.get("justificacionIA") or "",
    ))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# PDF — INFORME IA (texto)
# ============================================================
@app.get("/api/pdf-ia/{id_pago}")
async def pdf_ia_informe(id_pago: str):
    meta = _mem_get("meta", id_pago)
    if not meta or meta.get("moduloAutorizado") != "ia":
        return Response(status_code=402)
    d = _mem_get("ia", id_pago)
    if not d: return Response(status_code=404)

    try:
        pdf_bytes = generar_informe_ia({
            "nombre":    d.get("nombre"),
            "edad":      d.get("edad"),
            "rut":       d.get("rut"),
            "consulta":  d.get("consulta") or "",
            "respuesta": d.get("informeIA") or (d.get("iaJSON") or {}).get("informeIA") or "",
        })
    except Exception as e:
        logger.error("pdf ia informe error: %s", e)
        return Response(status_code=500)

    filename = f"informeIA_{_sanitize(d.get('nombre') or 'paciente')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# PDF — FORMULARIO RM
# ============================================================
@app.get("/pdf-rm/{id_pago}")
async def pdf_rm_get(id_pago: str):
    space, d = _mem_pick(id_pago)
    if not d: return Response(status_code=404)
    examen_txt = _build_examen(d)
    if not _contiene_rm(examen_txt):
        return JSONResponse(status_code=404,
            content={"ok": False, "error": "No corresponde formulario RM."})
    try:
        pdf_bytes = generar_formulario_resonancia({
            "nombre":        d.get("nombre") or "",
            "rut":           d.get("rut") or "",
            "edad":          d.get("edad") or "",
            "rm_form":       d.get("rmForm") or {},
            "observaciones": d.get("rmObservaciones") or d.get("observaciones") or "",
        })
    except Exception as e:
        logger.error("pdf rm error: %s", e)
        return Response(status_code=500)

    filename = f"formularioRM_{_sanitize(d.get('nombre') or 'paciente')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ============================================================
# GUARDAR RM
# ============================================================
@app.post("/guardar-rm")
async def guardar_rm(request: Request):
    body          = await request.json()
    id_pago       = body.get("idPago") or ""
    rm_form       = body.get("rmForm")
    observaciones = body.get("observaciones") or ""
    if not id_pago: raise HTTPException(400, detail="Falta idPago")

    space, base = _mem_pick(id_pago)
    if not base:
        return JSONResponse(status_code=404, content={"ok": False, "error": "No hay datos base"})
    if not _contiene_rm(_build_examen(base)):
        return JSONResponse(status_code=409, content={"ok": False, "error": "El caso no contiene Resonancia."})

    patch = {}
    if isinstance(rm_form, dict) and rm_form: patch["rmForm"] = rm_form
    if isinstance(observaciones, str): patch["rmObservaciones"] = observaciones
    if not patch: return {"ok": True, "skipped": True}

    _mem_set(space, id_pago, {**base, **patch})
    return {"ok": True}

# ============================================================
# RESET
# ============================================================
@app.delete("/reset/{id_pago}")
async def reset(id_pago: str):
    removed = sum(_mem_del(s, id_pago) for s in ["ia","trauma","preop","generales","meta"])
    return {"ok": True, "removed": removed}

# ============================================================
# RESOLVER DERIVACIÓN (usado por BookingCerebro de ICA)
# ============================================================
@app.post("/resolver-derivacion")
async def resolver_deriv(request: Request):
    body = await request.json()
    return resolver_derivacion(
        {"dolor": body.get("dolor") or ""},
        body.get("geo"),
    )

# ============================================================
# 404
# ============================================================
@app.exception_handler(404)
async def not_found(request: Request, exc):
    return JSONResponse(status_code=404,
        content={"ok": False, "error": "Ruta no encontrada", "path": str(request.url.path)})

