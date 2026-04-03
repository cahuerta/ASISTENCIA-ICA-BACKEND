# pdf/resonancia_formulario.py
# Formulario de Seguridad para Resonancia Magnética — timbre rotado 20°
# Stateless — recibe datos completos, retorna bytes
# Depende de: reportlab

import io
from datetime import datetime
from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfgen import canvas as rl_canvas

_ASSETS = Path(__file__).parent.parent / "assets"

PAGE_W, PAGE_H = A4
MARGIN_L = 50
MARGIN_R = 50
MARGIN_T = 50
MARGIN_B = 180

# ============================================================
# CHECKLIST — claves y etiquetas (igual que el JS original)
# ============================================================
ITEMS = [
    ("marcapasos",              "¿Tiene marcapasos o desfibrilador implantado (DAI)?"),
    ("coclear_o_neuro",         "¿Tiene implante coclear o neuroestimulador?"),
    ("clips_aneurisma",         "¿Tiene clips de aneurisma cerebral?"),
    ("valvula_cardiaca_metal",  "¿Tiene válvula cardíaca u otro implante metálico intracraneal?"),
    ("fragmentos_metalicos",    "¿Tiene fragmentos metálicos/balas (en ojos o cuerpo)?"),
    ("protesis_placas_tornillos","¿Tiene prótesis, placas o tornillos metálicos?"),
    ("cirugia_reciente_3m",     "¿Cirugía reciente (< 3 meses) con implante?"),
    ("embarazo",                "¿Embarazo o sospecha de embarazo?"),
    ("claustrofobia",           "¿Claustrofobia importante?"),
    ("peso_mayor_150",          "¿Peso mayor a 150 kg (límite equipo)?"),
    ("no_permanece_inmovil",    "¿Dificultad para permanecer inmóvil 20–30 min?"),
    ("tatuajes_recientes",      "¿Tatuajes o maquillaje permanente hechos hace < 6 semanas?"),
    ("piercings_no_removibles", "¿Piercings que no puede retirar?"),
    ("bomba_insulina_u_otro",   "¿Usa bomba de insulina u otro dispositivo externo?"),
    ("requiere_contraste",      "¿Este examen requiere contraste (gadolinio)?"),
    ("erc_o_egfr_bajo",         "¿Insuficiencia renal conocida o eGFR < 30?"),
    ("alergia_gadolinio",       "¿Alergia previa a gadolinio?"),
    ("reaccion_contrastes",     "¿Reacción alérgica grave previa a otros contrastes?"),
    ("requiere_sedacion",       "¿Requiere sedación para poder realizar el examen?"),
    ("ayuno_6h",                "¿Ha cumplido ayuno de 6 horas? (si habrá sedación)"),
]


# ============================================================
# ESTILOS
# ============================================================
def _estilos():
    styles = getSampleStyleSheet()
    titulo = ParagraphStyle(
        "Titulo", parent=styles["Normal"],
        fontSize=18, fontName="Helvetica-Bold",
        alignment=TA_CENTER, spaceAfter=4,
    )
    subtitulo = ParagraphStyle(
        "Subtitulo", parent=styles["Normal"],
        fontSize=16, fontName="Helvetica-Bold",
        alignment=TA_CENTER, underline=1, spaceAfter=12,
    )
    campo = ParagraphStyle(
        "Campo", parent=styles["Normal"],
        fontSize=14, fontName="Helvetica", spaceAfter=4,
    )
    fecha_s = ParagraphStyle(
        "Fecha", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        textColor=(0.33, 0.33, 0.33), spaceAfter=8,
    )
    seccion = ParagraphStyle(
        "Seccion", parent=styles["Normal"],
        fontSize=14, fontName="Helvetica-Bold", spaceAfter=6,
    )
    obs_s = ParagraphStyle(
        "Obs", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        alignment=TA_LEFT, spaceAfter=4,
    )
    return titulo, subtitulo, campo, fecha_s, seccion, obs_s


# ============================================================
# FIRMA + TIMBRE ROTADO — callback de canvas
# ============================================================
def _dibujar_firma_timbre(c: rl_canvas.Canvas, doc) -> None:
    base_y  = 55
    firma_w = 60 * mm
    firma_x = (PAGE_W - firma_w) / 2

    firma_path = _ASSETS / "FIRMA.png"
    if firma_path.exists():
        c.drawImage(
            str(firma_path),
            firma_x, base_y + 38,
            width=firma_w, height=20 * mm,
            preserveAspectRatio=True, mask="auto",
        )

    c.setFont("Helvetica", 12)
    c.drawCentredString(PAGE_W / 2, base_y + 34, "_________________________")
    c.drawCentredString(PAGE_W / 2, base_y + 20, "Firma Paciente / Responsable")

    timbre_path = _ASSETS / "timbre.jpg"
    if timbre_path.exists():
        timbre_w = 28 * mm
        timbre_x = firma_x + firma_w + 4 * mm
        timbre_y = base_y + 42
        cx = timbre_x + timbre_w / 2
        cy = timbre_y + timbre_w / 2

        c.saveState()
        c.translate(cx, cy)
        c.rotate(20)
        c.translate(-cx, -cy)
        c.drawImage(
            str(timbre_path),
            timbre_x, timbre_y,
            width=timbre_w, height=timbre_w,
            preserveAspectRatio=True, mask="auto",
        )
        c.restoreState()

    c.setFont("Helvetica", 12)
    for i, linea in enumerate([
        "Dr. Cristóbal Huerta Cortés",
        "RUT: 14.015.125-4",
        "Cirujano de Reconstrucción Articular",
        "INSTITUTO DE CIRUGIA ARTICULAR",
    ]):
        c.drawCentredString(PAGE_W / 2, base_y - (i * 14), linea)


# ============================================================
# FILA CHECKLIST — pregunta + respuesta Sí/No en tabla
# ============================================================
def _fila_item(label: str, val, styles_item: ParagraphStyle, styles_resp: ParagraphStyle):
    respuesta = "Sí" if val is True else "No"
    return [
        Paragraph(f"• {label}", styles_item),
        Paragraph(f"Respuesta: {respuesta}", styles_resp),
    ]


# ============================================================
# GENERAR PDF — retorna bytes
# ============================================================
def generar_formulario_resonancia(datos: dict) -> bytes:
    """
    datos: {
        nombre, rut, edad,
        rm_form?: dict[str, bool],
        observaciones?: str,
    }
    Retorna: bytes del PDF generado.
    """
    nombre        = datos.get("nombre") or ""
    rut           = datos.get("rut") or ""
    edad          = datos.get("edad") or ""
    rm_form       = datos.get("rm_form") or {}
    observaciones = str(datos.get("observaciones") or "").strip()

    # Observaciones también pueden venir dentro de rm_form
    if not observaciones and isinstance(rm_form.get("observaciones"), str):
        observaciones = rm_form["observaciones"].strip()

    titulo_s, subtitulo_s, campo_s, fecha_s, seccion_s, obs_s = _estilos()

    item_s = ParagraphStyle(
        "Item", fontSize=11, fontName="Helvetica", spaceAfter=2,
    )
    resp_s = ParagraphStyle(
        "Resp", fontSize=11, fontName="Helvetica",
        alignment=TA_RIGHT, spaceAfter=2,
    )

    # Timestamp
    ahora = datetime.now()
    stamp = ahora.strftime("%d-%m-%Y %H:%M")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=MARGIN_L, rightMargin=MARGIN_R,
        topMargin=MARGIN_T,  bottomMargin=MARGIN_B,
    )

    def on_page(canvas, doc):
        _dibujar_firma_timbre(canvas, doc)

    elementos = []

    # — Encabezado —
    logo_path = _ASSETS / "ica.jpg"
    if logo_path.exists():
        from reportlab.platypus import Image as RLImage
        logo = RLImage(str(logo_path), width=30 * mm, height=20 * mm)
        header = Table(
            [[logo, Paragraph("INSTITUTO DE CIRUGÍA ARTICULAR", titulo_s)]],
            colWidths=[35 * mm, None],
        )
        header.setStyle(TableStyle([
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elementos.append(header)
    else:
        elementos.append(Paragraph("INSTITUTO DE CIRUGÍA ARTICULAR", titulo_s))

    elementos.append(Spacer(1, 6 * mm))
    elementos.append(Paragraph("Formulario de Seguridad — Resonancia Magnética", subtitulo_s))
    elementos.append(Spacer(1, 6 * mm))

    # — Datos paciente —
    for label, valor in [
        ("Nombre", nombre or "—"),
        ("RUT",    rut or "—"),
        ("Edad",   f"{edad} años" if edad else "—"),
    ]:
        elementos.append(Paragraph(f"<b>{label}:</b> {valor}", campo_s))

    elementos.append(Paragraph(f"Emisión: {stamp}", fecha_s))
    elementos.append(Spacer(1, 4 * mm))

    # — Checklist —
    elementos.append(Paragraph("Cuestionario de seguridad (marcar Sí/No):", seccion_s))
    elementos.append(Spacer(1, 3 * mm))

    avail_w = PAGE_W - MARGIN_L - MARGIN_R
    filas = [_fila_item(label, rm_form.get(key), item_s, resp_s) for key, label in ITEMS]
    tabla = Table(filas, colWidths=[avail_w * 0.75, avail_w * 0.25])
    tabla.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 2),
    ]))
    elementos.append(tabla)
    elementos.append(Spacer(1, 6 * mm))

    # — Observaciones —
    elementos.append(Paragraph("Observaciones:", seccion_s))
    elementos.append(Spacer(1, 2 * mm))
    if observaciones:
        elementos.append(Paragraph(observaciones, obs_s))
    else:
        gris = ParagraphStyle("Gris", parent=obs_s, textColor=(0.47, 0.47, 0.47))
        elementos.append(Paragraph("—", gris))

    doc.build(elementos, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
  
