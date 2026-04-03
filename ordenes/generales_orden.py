# ordenes/generales_orden.py
# Genera el PDF de Orden de Exámenes Generales
# Stateless — recibe datos completos, sin memoria server-side
# Depende de: reportlab

from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, ListFlowable, ListItem,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import io

_ASSETS = Path(__file__).parent.parent / "assets"

# ============================================================
# ESTILOS
# ============================================================
def _estilos():
    styles = getSampleStyleSheet()
    titulo = ParagraphStyle(
        "Titulo",
        parent=styles["Normal"],
        fontSize=18,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        spaceAfter=4,
    )
    subtitulo = ParagraphStyle(
        "Subtitulo",
        parent=styles["Normal"],
        fontSize=16,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        underline=1,
        spaceAfter=12,
    )
    campo = ParagraphStyle(
        "Campo",
        parent=styles["Normal"],
        fontSize=14,
        fontName="Helvetica",
        spaceAfter=6,
    )
    seccion = ParagraphStyle(
        "Seccion",
        parent=styles["Normal"],
        fontSize=14,
        fontName="Helvetica-Bold",
        spaceAfter=8,
    )
    item = ParagraphStyle(
        "Item",
        parent=styles["Normal"],
        fontSize=13,
        fontName="Helvetica",
        spaceAfter=3,
    )
    firma = ParagraphStyle(
        "Firma",
        parent=styles["Normal"],
        fontSize=12,
        fontName="Helvetica",
        alignment=TA_CENTER,
        spaceAfter=4,
    )
    return titulo, subtitulo, campo, seccion, item, firma


# ============================================================
# FIRMA Y TIMBRE
# ============================================================
def _bloque_firma(styles_firma) -> list:
    from reportlab.platypus import Image as RLImage

    elementos = []
    firma_path  = _ASSETS / "FIRMA.png"
    timbre_path = _ASSETS / "timbre.jpg"
    logo_path   = _ASSETS / "ica.jpg"

    # Firma imagen
    if firma_path.exists():
        elementos.append(Spacer(1, 10 * mm))
        img = RLImage(str(firma_path), width=60 * mm, height=20 * mm)
        img.hAlign = "CENTER"
        elementos.append(img)

    elementos.append(Paragraph("_________________________", styles_firma))
    elementos.append(Paragraph("Firma y Timbre Médico", styles_firma))
    elementos.append(Spacer(1, 4 * mm))
    elementos.append(Paragraph("Dr. Cristóbal Huerta Cortés", styles_firma))
    elementos.append(Paragraph("RUT: 14.015.125-4", styles_firma))
    elementos.append(Paragraph("Cirujano de Reconstrucción Articular", styles_firma))
    elementos.append(Paragraph("INSTITUTO DE CIRUGIA ARTICULAR", styles_firma))
    return elementos


# ============================================================
# GENERAR PDF — retorna bytes
# ============================================================
def generar_orden_generales(datos: dict) -> bytes:
    """
    datos: {
        nombre, edad, rut, genero,
        examenes_ia: list[str],
        informe_ia?: str,
        id_pago?: str
    }
    Retorna: bytes del PDF generado.
    """
    nombre      = datos.get("nombre") or ""
    edad        = datos.get("edad") or ""
    rut         = datos.get("rut") or ""
    genero      = datos.get("genero") or ""
    examenes_ia = datos.get("examenes_ia") or []

    # Normalizar lista
    lista = [
        str(it if isinstance(it, str) else (it or {}).get("nombre", "")).strip()
        for it in examenes_ia
    ]
    lista = [s for s in lista if s]

    titulo_s, subtitulo_s, campo_s, seccion_s, item_s, firma_s = _estilos()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=50, rightMargin=50,
        topMargin=50,  bottomMargin=180,   # espacio para firma al pie
    )

    elementos = []

    # — Encabezado —
    logo_path = _ASSETS / "ica.jpg"
    if logo_path.exists():
        from reportlab.platypus import Image as RLImage
        logo = RLImage(str(logo_path), width=30 * mm, height=20 * mm)
        header_data = [[logo, Paragraph("INSTITUTO DE CIRUGÍA ARTICULAR", titulo_s)]]
        header_table = Table(header_data, colWidths=[35 * mm, None])
        header_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]))
        elementos.append(header_table)
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

    # — Firma —
    elementos.extend(_bloque_firma(firma_s))

    doc.build(elementos)
    return buffer.getvalue()
