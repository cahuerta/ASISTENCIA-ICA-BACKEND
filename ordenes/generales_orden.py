# ordenes/generales_orden.py
# Genera el PDF de Orden de Exámenes Generales — timbre rotado 20° (igual que original)
# Stateless — recibe datos completos, retorna bytes
# Depende de: reportlab

import io
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)
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
        fontSize=14, fontName="Helvetica", spaceAfter=6,
    )
    seccion = ParagraphStyle(
        "Seccion", parent=styles["Normal"],
        fontSize=14, fontName="Helvetica-Bold", spaceAfter=8,
    )
    item = ParagraphStyle(
        "Item", parent=styles["Normal"],
        fontSize=13, fontName="Helvetica", spaceAfter=3,
    )
    firma_s = ParagraphStyle(
        "Firma", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        alignment=TA_CENTER, spaceAfter=4,
    )
    return titulo, subtitulo, campo, seccion, item, firma_s


# ============================================================
# FIRMA + TIMBRE ROTADO — callback de canvas
# ============================================================
def _dibujar_firma_timbre(c: rl_canvas.Canvas, doc) -> None:
    base_y  = 55
    firma_w = 60 * mm
    firma_x = (PAGE_W - firma_w) / 2

    # — Firma imagen —
    firma_path = _ASSETS / "FIRMA.png"
    if firma_path.exists():
        c.drawImage(
            str(firma_path),
            firma_x, base_y + 38,
            width=firma_w, height=20 * mm,
            preserveAspectRatio=True, mask="auto",
        )

    # — Línea y etiqueta —
    c.setFont("Helvetica", 12)
    c.drawCentredString(PAGE_W / 2, base_y + 34, "_________________________")
    c.drawCentredString(PAGE_W / 2, base_y + 20, "Firma y Timbre Médico")

    # — Timbre rotado 20° —
    timbre_path = _ASSETS / "timbre.jpg"
    if timbre_path.exists():
        timbre_w = 28 * mm
        timbre_x = firma_x + firma_w + 4 * mm
        timbre_y = base_y + 42
        cx = timbre_x + timbre_w / 2
        cy = timbre_y + timbre_w / 2

        c.saveState()
        c.translate(cx, cy)
        c.rotate(20)                        # ← 20° igual que el JS original
        c.translate(-cx, -cy)
        c.drawImage(
            str(timbre_path),
            timbre_x, timbre_y,
            width=timbre_w, height=timbre_w,
            preserveAspectRatio=True, mask="auto",
        )
        c.restoreState()

    # — Datos médico —
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
def generar_orden_generales(datos: dict) -> bytes:
    """
    datos: { nombre, edad, rut, genero, examenes_ia: list[str], informe_ia?: str }
    Retorna: bytes del PDF generado.
    """
    nombre      = datos.get("nombre") or ""
    edad        = datos.get("edad") or ""
    rut         = datos.get("rut") or ""
    genero      = datos.get("genero") or ""
    examenes_ia = datos.get("examenes_ia") or []

    lista = [
        str(it if isinstance(it, str) else (it or {}).get("nombre", "")).strip()
        for it in examenes_ia
    ]
    lista = [s for s in lista if s]

    titulo_s, subtitulo_s, campo_s, seccion_s, item_s, firma_s = _estilos()

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
    elementos.append(Paragraph("Orden de Exámenes Generales", subtitulo_s))
    elementos.append(Spacer(1, 8 * mm))

    # — Datos paciente —
    for label, valor in [
        ("Nombre", nombre),
        ("RUT",    rut),
        ("Edad",   str(edad)),
        ("Género", genero),
    ]:
        elementos.append(Paragraph(f"<b>{label}:</b> {valor}", campo_s))

    elementos.append(Spacer(1, 8 * mm))

    # — Lista de exámenes —
    elementos.append(Paragraph("Exámenes solicitados:", seccion_s))
    elementos.append(Spacer(1, 4 * mm))

    if not lista:
        elementos.append(Paragraph("• (Sin exámenes registrados en este flujo)", item_s))
    else:
        items = [ListItem(Paragraph(e, item_s), bulletColor=colors.black) for e in lista]
        elementos.append(ListFlowable(items, bulletType="bullet", leftIndent=12))

    elementos.append(Spacer(1, 10 * mm))

    doc.build(elementos, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
    
