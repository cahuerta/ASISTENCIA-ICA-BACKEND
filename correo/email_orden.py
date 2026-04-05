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

RESEND_API    = "https://api.resend.com/emails"
RESERVAS_BASE = "https://reservas.icarticular.cl"

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


def _bloque_reserva_html(datos: dict) -> str:
    """
    Bloque HTML con botón de reserva según derivación.
    Vacío si el paciente ya viene de una reserva.
    """
    if datos.get("origen") == "reserva":
        return ""

    deriv         = datos.get("deriv") or {}
    doctor        = deriv.get("doctor") or {}
    sede          = deriv.get("sede")   or {}
    doctor_id     = doctor.get("id") or ""
    doctor_nombre = doctor.get("nombre") or ""
    agenda        = doctor.get("agenda") or sede.get("nombre") or ""

    reserva_id = _MAP_DR_RESERVA.get(doctor_id)
    if not reserva_id:
        return ""

    link = f"{RESERVAS_BASE}?dr={reserva_id}"

    lineas_info = ""
    if doctor_nombre:
        lineas_info += f"<p style='margin:4px 0;color:#334155;font-size:14px;'><strong>Médico recomendado:</strong> {doctor_nombre}</p>"
    if agenda:
        lineas_info += f"<p style='margin:4px 0;color:#334155;font-size:14px;'><strong>Centro:</strong> {agenda}</p>"

    return f"""
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px 24px;margin:24px 0;">
      <p style="margin:0 0 12px 0;font-size:16px;font-weight:700;color:#1e3a5f;">📅 Reserve su hora</p>
      {lineas_info}
      <div style="margin-top:16px;">
        <a href="{link}"
           style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;">
          Reservar hora en línea →
        </a>
      </div>
      <p style="margin:12px 0 0 0;font-size:12px;color:#64748b;">Servicio opcional. Reserva sujeta a disponibilidad.</p>
    </div>
    """


def _html_body(nombre: str, bloque_reserva: str) -> str:
    nombre_display = nombre or "Paciente"
    return f"""
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:16px;
              box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">

    <!-- Header -->
    <div style="background:#0f172a;padding:24px 32px;">
      <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Instituto de Cirugía Articular</p>
      <p style="margin:4px 0 0 0;color:#94a3b8;font-size:13px;">Orden médica generada por Asistencia ICA</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="margin:0 0 16px 0;font-size:15px;color:#0f172a;">
        Estimado/a <strong>{nombre_display}</strong>,
      </p>
      <p style="margin:0 0 24px 0;font-size:14px;color:#475569;line-height:1.6;">
        Adjuntamos su orden médica generada por el sistema de Asistencia ICA.
        Por favor preséntela en el centro de imagenología indicado.
      </p>

      {bloque_reserva}

      <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">
        Instituto de Cirugía Articular — Curicó, Chile<br>
        <a href="mailto:contacto@icarticular.cl" style="color:#1d4ed8;">contacto@icarticular.cl</a>
      </p>
    </div>

  </div>
</body>
</html>
"""


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

        pdf_b64       = base64.b64encode(pdf_bytes).decode()
        asunto        = _asunto_por_modulo(modulo)
        nombre        = datos.get("nombre") or ""
        bloque_reserva = _bloque_reserva_html(datos)
        html_content  = _html_body(nombre, bloque_reserva)

        payload = {
            "from":    f"Instituto de Cirugía Articular <{from_addr}>",
            "to":      [email],
            "subject": asunto,
            "html":    html_content,
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
