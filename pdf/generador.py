# pdf/generador.py
# Informe Automático IA — timbre rotado 20°
# Stateless — recibe datos completos, retorna bytes
# Depende de: reportlab

import io
from pathlib import Path

from reportlab.lib.enums import TA_CENTER, TA_LEFT
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
    seccion = ParagraphStyle(
        "Seccion", parent=styles["Normal"],
        fontSize=14, fontName="Helvetica-Bold", spaceAfter=6,
    )
    respuesta_s = ParagraphStyle(
        "Respuesta", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        alignment=TA_LEFT, spaceAfter=4,
    )
    return titulo, subtitulo, campo, seccion, respuesta_s


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
    c.drawCentredString(PAGE_W / 2, base_y + 20, "Firma y Timbre Médico")

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
# GENERAR PDF — retorna bytes
# ============================================================
def generar_informe_ia(datos: dict) -> bytes:
    """
    datos: { nombre, edad, rut, consulta, respuesta }
    Retorna: bytes del PDF generado.
    """
    nombre   = datos.get("nombre") or ""
    edad     = datos.get("edad") or ""
    rut      = datos.get("rut") or ""
    consulta = datos.get("consulta") or ""
    respuesta = datos.get("respuesta") or "Sin respuesta"

    titulo_s, subtitulo_s, campo_s, seccion_s, respuesta_s = _estilos()

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
    elementos.append(Paragraph("Informe Automático IA", subtitulo_s))
    elementos.append(Spacer(1, 8 * mm))

    # — Datos paciente —
    for label, valor in [
        ("Nombre", nombre),
        ("Edad",   str(edad)),
        ("RUT",    rut),
    ]:
        elementos.append(Paragraph(f"<b>{label}:</b> {valor}", campo_s))

    elementos.append(Spacer(1, 6 * mm))

    # — Consulta —
    elementos.append(Paragraph("Consulta realizada:", seccion_s))
    elementos.append(Paragraph(consulta, respuesta_s))
    elementos.append(Spacer(1, 8 * mm))

    # — Respuesta IA —
    elementos.append(Paragraph("Informe / Sugerencia IA:", seccion_s))
    elementos.append(Spacer(1, 4 * mm))
    elementos.append(Paragraph(respuesta.replace("\n", "<br/>"), respuesta_s))

    doc.build(elementos, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
