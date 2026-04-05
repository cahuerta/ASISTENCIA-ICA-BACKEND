# correo/email_orden.py
# Envío de orden por correo (Resend) — JAMÁS bloqueante
# Stateless — recibe datos completos, sin memoria server-side
# Depende de: httpx

import base64
import logging
import re
from typing import Callable

import httpx

logger = logging.getLogger("email_orden")

RESEND_API     = "https://api.resend.com/emails"
RESERVAS_BASE  = "https://reservas.icarticular.cl"

# Mapeo doctor_id (medicos.json) → professional_id (professionals.json ICA)
_MAP_DR_RESERVA = {
    "cristobal_huerta": "huerta",
    "jaime_espinoza":   "espinoza",
}


# ============================================================
# HELPERS
# ============================================================
def _email_valido(e: str) -> bool:
    return bool(re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', str(e or "").strip()))


def _extraer_email(datos: dict) -> str | None:
    if not datos:
        return None
    if datos.get("email"):
        return str(datos["email"]).strip()
    trauma_json = datos.get("traumaJSON") or {}
    paciente    = trauma_json.get("paciente") or {}
    if paciente.get("email"):
        return str(paciente["email"]).strip()
    return None


def _asunto_por_modulo(modulo: str) -> str:
    return {
        "trauma":    "Orden de imagenología – ICA",
        "preop":     "Orden preoperatoria – ICA",
        "generales": "Orden de exámenes – ICA",
    }.get(modulo, "Orden médica – ICA")


def _bloque_reserva(datos: dict) -> str:
    """
    Arma el bloque con link de reserva según derivación.
    No se envía si el paciente ya viene de una reserva.
    """
    # Si ya tiene reserva, no enviar link
    if datos.get("origen") == "reserva":
        return ""

    deriv  = datos.get("deriv") or {}
    doctor = deriv.get("doctor") or {}
    sede   = deriv.get("sede")   or {}

    doctor_id     = doctor.get("id") or ""
    doctor_nombre = doctor.get("nombre") or ""
    sede_nombre   = sede.get("nombre") or ""
    agenda        = doctor.get("agenda") or sede_nombre

    # Mapear al ID del sistema de reservas ICA
    reserva_id = _MAP_DR_RESERVA.get(doctor_id)
    if not reserva_id:
        return ""

    link = f"{RESERVAS_BASE}?dr={reserva_id}"

    lineas = [
        "─────────────────────────────────────",
        "📅 RESERVE SU HORA",
        "",
    ]

    if doctor_nombre:
        lineas.append(f"Médico recomendado: {doctor_nombre}")
    if agenda:
        lineas.append(f"Centro: {agenda}")

    lineas += [
        "",
        "Reserve su hora en línea:",
        link,
        "─────────────────────────────────────",
    ]

    return "\n".join(lineas)


# ============================================================
# ENVÍO — NUNCA BLOQUEANTE (captura todas las excepciones)
# ============================================================
async def enviar_orden_por_correo(
    datos:         dict,
    modulo:        str,
    generador_pdf: Callable[[dict], bytes],
    config:        dict,
) -> None:
    """
    datos:         dict con datos del paciente (debe incluir 'email')
    modulo:        'trauma' | 'preop' | 'generales' | 'ia'
    generador_pdf: callable(datos) → bytes
    config:        { resend_api_key, resend_from? }

    NUNCA lanza excepción — cualquier error se loggea y se ignora.
    """
    try:
        logger.info("📨 [RESEND] Intento envío email. módulo=%s", modulo)

        resend_key = config.get("resend_api_key") or ""
        if not resend_key:
            logger.warning("⚠️ [RESEND] RESEND_API_KEY no configurada")
            return

        from_addr = config.get("resend_from") or "contacto@icarticular.cl"

        email = _extraer_email(datos)
        if not _email_valido(email):
            logger.warning("⚠️ [RESEND] Email inválido: %s", email)
            return

        # — Generar PDF en memoria —
        try:
            pdf_bytes = generador_pdf(datos)
        except Exception as e:
            logger.error("❌ [RESEND] Error generando PDF: %s", e)
            return

        pdf_b64 = base64.b64encode(pdf_bytes).decode()
        asunto  = _asunto_por_modulo(modulo)

        # — Bloque de reserva (solo si no viene de reserva) —
        bloque_reserva = _bloque_reserva(datos)

        cuerpo = (
            "Estimado(a),\n\n"
            "Adjuntamos su orden médica generada por Asistencia ICA.\n"
        )

        if bloque_reserva:
            cuerpo += f"\n{bloque_reserva}\n"

        cuerpo += "\nInstituto de Cirugía Articular"

        payload = {
            "from":    f"Instituto de Cirugía Articular <{from_addr}>",
            "to":      [email],
            "subject": asunto,
            "text":    cuerpo,
            "attachments": [
                {
                    "filename": "orden_medica.pdf",
                    "content":  pdf_b64,
                }
            ],
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                RESEND_API,
                headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type":  "application/json",
                },
                json=payload,
            )
            r.raise_for_status()

        logger.info("📧 [RESEND] Email enviado OK a: %s", email)

    except Exception as e:
        # 🔴 NUNCA romper flujo PDF — solo loggear
        logger.error("❌ [RESEND] Error email (IGNORADO): %s", e)
        
