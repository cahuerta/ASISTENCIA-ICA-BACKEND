# ia/agente_ipo.py
# AGENTE IPO — conversación natural con barandas para el asistente de dolor.
#
# Por cada frase del paciente, Haiku hace dos cosas:
#   1. marca qué puntos de la LISTA OBLIGATORIA de la zona quedaron respondidos
#      con lo que dijo (aunque no se le haya preguntado directamente);
#   2. propone UNA pregunta corta y concreta sobre lo que falta.
# La lista son las preguntas por zona de Ipo (bancoPreguntas.js en ASISTENCIA-ICA):
# signos de alarma de la zona y preguntas del dolor. Llega en cada turno.
#
# Barandas (las controla este archivo, no la IA):
#   - Solo se aceptan ids de la lista y valores con la forma correcta.
#   - Alarma "grave" respondida con sí -> urgencia=True de inmediato.
#   - completo=True solo cuando NO queda ningún punto pendiente.
#   - Si la IA falla, tarda o propone algo fuera de la lista, la siguiente
#     pregunta es la del banco (fuente "guion"): nunca se queda sin pregunta.
#   - A la IA no le llegan nombre ni RUT: solo edad, sexo, zona y lo conversado.
#   - La IA no diagnostica ni aconseja aquí; el diagnóstico y el examen siguen
#     saliendo del módulo de trauma (/ia-trauma).
#
# v2 (fluidez): preguntas más cortas y conversadas, entradas variadas (no siempre
#   "Entiendo") y algo más de variedad (temperature 0.5). Las barandas no cambian.
#
# CONTRATO: { ok, respuestas: {id: {valor, resumen}}, siguiente: {id, texto, tipo} | None,
#             urgencia, completo, fuente: "ia" | "guion" }

import json
import logging
import re

import httpx

logger = logging.getLogger("agente_ipo")

MODELO_DEFECTO = "claude-haiku-4-5-20251001"
TIEMPO_MAX_S = 8.0
MAX_TURNOS_CONVERSACION = 24
MAX_PALABRAS_PREGUNTA = 30

SYSTEM_PROMPT = """
Eres Ipo, el asistente virtual de dolor del Instituto de Cirugía Articular (Chile).
Conversas por voz con un paciente para completar una lista de preguntas clínicas
sobre su dolor. No eres médico: NO diagnosticas, NO das consejos ni tratamientos.

En cada turno recibes: los datos básicos, la LISTA (cada punto con id, tipo y texto),
los puntos ya respondidos, la conversación y la última frase del paciente.

Tu trabajo:
1. Revisa TODO lo que el paciente ha dicho y marca los puntos de la lista que quedaron
   respondidos, aunque no se le haya preguntado directamente. Solo marca lo que el
   paciente dijo claramente; si hay duda, déjalo pendiente.
   - Tipo "sino": valor true (sí) o false (no). Si dijo que no tiene ninguno de los
     síntomas de la pregunta, es false; si tiene alguno, es true.
   - Tipo "abierta": valor null y un resumen breve con las palabras del paciente.
2. Elige el siguiente punto PENDIENTE (prioridad: alarmas "grave", luego "aviso",
   luego el resto, en el orden de la lista) y formula UNA sola pregunta:
   - Español de Chile, cálido y conversado, tuteando, como lo diría una persona en voz
     alta. Corta: idealmente menos de 18 palabras, nunca más de 25.
   - A veces (no siempre) parte reconociendo lo que dijo en 2 a 5 palabras, VARIANDO
     la forma ("Ya, te entiendo.", "Qué lata, eso molesta.", "Perfecto.", "Ok, gracias.").
     Mira la conversación: no repitas la misma entrada que usaste antes ni partas
     dos veces seguidas igual. Nunca uses "Entiendo" dos turnos seguidos.
   - Si lo que contó es preocupante o doloroso, muestra empatía breve y sincera.
   - Puedes reformular el texto del punto, pero debe preguntar lo mismo, completo.
     En los de tipo "sino" la pregunta debe poder responderse con sí o no.
   - Nada de listas ni explicaciones: una sola pregunta.
   - Nunca preguntes algo ya respondido. Nunca preguntes por puntos fuera de la lista.

Responde SOLO con un JSON, sin texto adicional:
{"respuestas": [{"id": "...", "valor": true|false|null, "resumen": "..."}],
 "siguiente_id": "...", "pregunta": "..."}
Si ya no queda nada pendiente: "siguiente_id": null, "pregunta": "".
""".strip()


def _texto(v, maximo: int) -> str:
    return str(v or "").strip()[:maximo]


def _leer_lista(preguntas) -> list[dict]:
    """La lista de la zona, solo con lo necesario y en el orden recibido."""
    lista = []
    vistos = set()
    for p in preguntas if isinstance(preguntas, list) else []:
        if not isinstance(p, dict):
            continue
        pid = _texto(p.get("id"), 60)
        tipo = p.get("tipo")
        if not pid or pid in vistos or tipo not in ("sino", "abierta"):
            continue
        vistos.add(pid)
        lista.append({
            "id": pid,
            "tipo": tipo,
            "texto": _texto(p.get("texto"), 400),
            "bandera": p.get("bandera") if p.get("bandera") in ("grave", "aviso") else None,
        })
    return lista


def _leer_respuestas(respuestas, lista: list[dict]) -> dict:
    """Respuestas conocidas, solo de ids de la lista y con la forma de su tipo."""
    tipos = {p["id"]: p["tipo"] for p in lista}
    salida = {}
    items = respuestas.items() if isinstance(respuestas, dict) else []
    for pid, r in items:
        if pid not in tipos or not isinstance(r, dict):
            continue
        valor = r.get("valor")
        resumen = _texto(r.get("resumen"), 400)
        if tipos[pid] == "sino":
            if not isinstance(valor, bool):
                continue
            salida[pid] = {"valor": valor, "resumen": resumen}
        else:
            if not resumen:
                continue
            salida[pid] = {"valor": None, "resumen": resumen}
    return salida


def _urgencia(lista: list[dict], respuestas: dict) -> bool:
    return any(p["bandera"] == "grave" and respuestas.get(p["id"], {}).get("valor") is True for p in lista)


def _pendientes(lista: list[dict], respuestas: dict) -> list[dict]:
    pend = [p for p in lista if p["id"] not in respuestas]
    orden = {"grave": 0, "aviso": 1, None: 2}
    return sorted(pend, key=lambda p: orden[p["bandera"]])  # estable: respeta el orden de la lista


def _pregunta_valida(texto: str) -> bool:
    t = str(texto or "").strip()
    return bool(t) and len(t.split()) <= MAX_PALABRAS_PREGUNTA and "?" in t


def _mensaje_usuario(datos: dict, lista: list[dict], respuestas: dict, conversacion: list, ultima: str) -> str:
    basicos = (
        f"Edad: {datos.get('edad') or '—'}. Sexo: {datos.get('sexo') or '—'}. "
        f"Zona del dolor: {datos.get('zona') or '—'}{(' ' + datos['lado']) if datos.get('lado') else ''}."
    )
    lista_txt = "\n".join(
        f"- id={p['id']} | tipo={p['tipo']}{' | alarma=' + p['bandera'] if p['bandera'] else ''} | {p['texto']}"
        for p in lista
    )
    resp_txt = "\n".join(
        f"- {pid}: {('sí' if r['valor'] else 'no') if isinstance(r['valor'], bool) else ''} {r['resumen']}".strip()
        for pid, r in respuestas.items()
    ) or "(ninguno)"
    conv_txt = "\n".join(
        f"{'Ipo' if c.get('rol') == 'ipo' else 'Paciente'}: {_texto(c.get('texto'), 600)}"
        for c in conversacion[-MAX_TURNOS_CONVERSACION:] if isinstance(c, dict)
    ) or "(inicio)"
    return (
        f"DATOS BÁSICOS: {basicos}\n\nLISTA:\n{lista_txt}\n\nYA RESPONDIDOS:\n{resp_txt}\n\n"
        f"CONVERSACIÓN:\n{conv_txt}\n\nÚLTIMA FRASE DEL PACIENTE: {_texto(ultima, 1200) or '(sin respuesta)'}"
    )


async def _llamar_haiku(user_msg: str, api_key: str, modelo: str) -> str:
    async with httpx.AsyncClient(timeout=TIEMPO_MAX_S) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json={
                "model":      modelo,
                "max_tokens": 500,
                "temperature": 0.5,   # algo de variedad al hablar; las barandas siguen igual
                "system":     SYSTEM_PROMPT,
                "messages":   [{"role": "user", "content": user_msg}],
            },
        )
        r.raise_for_status()
        return (r.json().get("content") or [{}])[0].get("text", "").strip()


def _leer_json(texto: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", texto or "")
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


async def turno_ipo(payload: dict, config: dict) -> dict:
    """
    payload: {
      zona, lado?, edad?, sexo?,
      preguntas: [{id, tipo: "sino"|"abierta", texto, bandera?}],   # lista de la zona
      respuestas: {id: {valor, resumen}},                             # ya conocidas
      conversacion: [{rol: "ipo"|"paciente", texto}],
      ultima: "lo último que dijo el paciente"
    }
    """
    lista = _leer_lista(payload.get("preguntas"))
    if not lista:
        return {"ok": False, "error": "Falta la lista de preguntas"}
    respuestas = _leer_respuestas(payload.get("respuestas"), lista)
    conversacion = payload.get("conversacion") if isinstance(payload.get("conversacion"), list) else []
    ultima = _texto(payload.get("ultima"), 1200)

    nuevas: dict = {}
    propuesta_id = None
    propuesta_txt = ""
    fuente = "guion"

    api_key = config.get("anthropic_api_key") or ""
    modelo = config.get("agente_model") or MODELO_DEFECTO
    if api_key and (ultima or conversacion):
        try:
            texto = await _llamar_haiku(
                _mensaje_usuario(payload, lista, respuestas, conversacion, ultima), api_key, modelo,
            )
            data = _leer_json(texto)
            crudas = {
                str(r.get("id")): {"valor": r.get("valor"), "resumen": r.get("resumen")}
                for r in data.get("respuestas") or [] if isinstance(r, dict)
            }
            # Solo lo nuevo y válido (lo ya respondido no se pisa)
            nuevas = {k: v for k, v in _leer_respuestas(crudas, lista).items() if k not in respuestas}
            propuesta_id = data.get("siguiente_id")
            propuesta_txt = _texto(data.get("pregunta"), 400)
            fuente = "ia"
        except Exception as e:
            logger.warning("Agente Ipo sin IA en este turno: %s", e)

    todas = {**respuestas, **nuevas}
    if _urgencia(lista, todas):
        return {"ok": True, "respuestas": nuevas, "siguiente": None, "urgencia": True, "completo": False, "fuente": fuente}

    pendientes = _pendientes(lista, todas)
    if not pendientes:
        return {"ok": True, "respuestas": nuevas, "siguiente": None, "urgencia": False, "completo": True, "fuente": fuente}

    # La pregunta de la IA solo si es sobre un punto pendiente y tiene buena forma;
    # si no, la del banco (primer pendiente, alarmas primero)
    por_id = {p["id"]: p for p in pendientes}
    if fuente == "ia" and propuesta_id in por_id and _pregunta_valida(propuesta_txt):
        p = por_id[propuesta_id]
        siguiente = {"id": p["id"], "texto": propuesta_txt, "tipo": p["tipo"]}
    else:
        p = pendientes[0]
        siguiente = {"id": p["id"], "texto": p["texto"], "tipo": p["tipo"]}
        fuente = "guion"

    return {"ok": True, "respuestas": nuevas, "siguiente": siguiente, "urgencia": False, "completo": False, "fuente": fuente}
