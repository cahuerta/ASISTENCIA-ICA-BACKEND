# routers/flow_client.py
# Cliente para crear pagos en Flow desde el backend
# Firma HMAC-SHA256 según documentación de Flow
# Stateless — sin memoria server-side

import hashlib
import hmac
import json
import logging
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("flow_client")

FLOW_BASE_SANDBOX    = "https://sandbox.flow.cl/api"
FLOW_BASE_PRODUCTION = "https://www.flow.cl/api"


# ============================================================
# HELPERS
# ============================================================
def _assert_env(config: dict) -> None:
    if not config.get("flow_api_key") or not config.get("flow_secret_key"):
        raise ValueError(
            "Faltan variables de entorno de Flow (FLOW_API_KEY / FLOW_SECRET_KEY)."
        )


def _make_signature(params: dict, secret_key: str) -> str:
    """
    Firma HMAC-SHA256 sobre parámetros ordenados por nombre.
    Sin incluir el campo 's' — igual que el JS original.
    """
    ordered_keys = sorted(params.keys())
    query_string = "&".join(f"{k}={params[k]}" for k in ordered_keys)
    return hmac.new(
        secret_key.encode("utf-8"),
        query_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _to_form_body(params: dict) -> str:
    return urlencode({k: str(v) for k, v in params.items() if v is not None})


def _base_url(config: dict) -> str:
    env = str(config.get("flow_env") or "sandbox").lower()
    return FLOW_BASE_PRODUCTION if env == "production" else FLOW_BASE_SANDBOX


# ============================================================
# CREAR PAGO
# ============================================================
async def crear_pago_flow_backend(
    id_pago:          str,
    amount:           int,
    subject:          str,
    email:            str,
    url_confirmation: str,
    url_return:       str,
    config:           dict,
    modulo:           str = "trauma",
    optional_data:    dict | None = None,
) -> dict:
    """
    Crea un pago en Flow.

    config: { flow_api_key, flow_secret_key, flow_env? }
    Retorna: { url, token, flow_order }
    """
    _assert_env(config)

    if not id_pago:
        raise ValueError("crear_pago_flow_backend requiere id_pago")
    if not amount or int(amount) <= 0:
        raise ValueError("crear_pago_flow_backend requiere amount > 0")
    if not subject:
        subject = f"Orden {modulo.upper()} Asistencia ICA"
    if not email:
        email = "sin-correo@icarticular.cl"
    if not url_confirmation or not url_return:
        raise ValueError(
            "crear_pago_flow_backend requiere url_confirmation y url_return"
        )

    api_key    = config["flow_api_key"]
    secret_key = config["flow_secret_key"]

    optional_dict = {"modulo": modulo}
    if optional_data:
        optional_dict.update(optional_data)

    base_params: dict = {
        "apiKey":          api_key,
        "commerceOrder":   id_pago,
        "subject":         subject,
        "currency":        "CLP",
        "amount":          int(amount),
        "email":           email,
        "urlConfirmation": url_confirmation,
        "urlReturn":       url_return,
        "optional":        json.dumps(optional_dict),
    }

    signature = _make_signature(base_params, secret_key)
    payload   = {**base_params, "s": signature}

    url_endpoint = f"{_base_url(config)}/payment/create"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                url_endpoint,
                content=_to_form_body(payload),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept":       "application/json",
                },
            )
        raw = r.text
    except httpx.HTTPError as e:
        raise RuntimeError(f"Error de red al crear pago en Flow: {e}") from e

    data = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        pass

    # HTTP 2xx + URL → éxito (igual que el JS)
    if r.is_success and data and data.get("url"):
        return {
            "url":        data["url"],
            "token":      data.get("token"),
            "flow_order": data.get("flowOrder"),
        }

    msg = (
        (data or {}).get("message")
        or (data or {}).get("error")
        or f"Error HTTP {r.status_code} al crear pago en Flow"
    )
    raise RuntimeError(f"{msg} — Respuesta: {raw}")
