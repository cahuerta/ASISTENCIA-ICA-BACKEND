# ordenes/orden_imagenologia.py
# Genera el PDF de Orden Médica de Imagenología
# Stateless — recibe datos completos, retorna bytes
# Depende de: reportlab

import io
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)

_ASSETS = Path(__file__).parent.parent / "assets"


# ============================================================
# ESTILOS
# ============================================================
def _estilos():
    styles = getSampleStyleSheet()

    titulo = ParagraphStyle(
        "Titulo",
        parent=styles["Normal"],
        fontSize=18, fontName="Helvetica-Bold",
        alignment=TA_CENTER, spaceAfter=4,
    )
    subtitulo = ParagraphStyle(
        "Subtitulo",
        parent=styles["Normal"],
        fontSize=16, fontName="Helvetica-Bold",
        alignment=TA_CENTER, spaceAfter=12,
        underline=1,
    )
    campo = ParagraphStyle(
        "Campo",
        parent=styles["Normal"],
        fontSize=14, fontName="Helvetica", spaceAfter=6,
    )
    examen_s = ParagraphStyle(
        "Examen",
        parent=styles["Normal"],
        fontSize=18, fontName="Helvetica-Bold",
        alignment=TA_CENTER, spaceAfter=8,
    )
    examen_label = ParagraphStyle(
        "ExamenLabel",
        parent=styles["Normal"],
        fontSize=14, fontName="Helvetica-Bold", spaceAfter=4,
    )
    nota_s = ParagraphStyle(
        "Nota",
        parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        alignment=TA_LEFT, spaceAfter=6,
    )
    firma_s = ParagraphStyle(
        "Firma",
        parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        alignment=TA_CENTER, spaceAfter=4,
    )
    return titulo, subtitulo, campo, examen_s, examen_label, nota_s, firma_s


# ============================================================
# BLOQUE FIRMA
# ============================================================
def _bloque_firma(firma_s) -> list:
    from reportlab.platypus import Image as RLImage

    elementos = []
    firma_path  = _ASSETS / "FIRMA.png"
    timbre_path = _ASSETS / "timbre.jpg"

    if firma_path.exists():
        elementos.append(Spacer(1, 8 * mm))
        img = RLImage(str(firma_path), width=60 * mm, height=20 * mm)
        img.hAlign = "CENTER"
        elementos.append(img)

    elementos.append(Paragraph("_________________________", firma_s))
    elementos.append(Paragraph("Firma y Timbre Médico", firma_s))
    elementos.append(Spacer(1, 4 * mm))
    elementos.append(Paragraph("Dr. Cristóbal Huerta Cortés", firma_s))
    elementos.append(Paragraph("RUT: 14.015.125-4", firma_s))
    elementos.append(Paragraph("Cirujano de Reconstrucción Articular", firma_s))
    elementos.append(Paragraph("INSTITUTO DE CIRUGÍA ARTICULAR", firma_s))
    return elementos


# ============================================================
# GENERAR PDF — retorna bytes
# ============================================================
def generar_orden_imagenologia(datos: dict) -> bytes:
    """
    datos: {
        nombre, edad, rut,
        dolor, lado,
        examen: str,   ← string final desde el router
        nota?:  str,
    }
    Retorna: bytes del PDF generado.
    """
    nombre = datos.get("nombre") or ""
    edad   = datos.get("edad") or ""
    rut    = datos.get("rut") or ""
    dolor  = datos.get("dolor") or ""
    lado   = datos.get("lado") or ""
    examen = datos.get("examen") or ""
    nota   = str(datos.get("nota") or "").strip()

    sintomas = f"{dolor} {lado}".strip()

    titulo_s, subtitulo_s, campo_s, examen_s, examen_label_s, nota_s, firma_s = _estilos()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=50, rightMargin=50,
        topMargin=50,  bottomMargin=180,
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
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
        ]))
        elementos.append(header_table)
    else:
        elementos.append(Paragraph("INSTITUTO DE CIRUGÍA ARTICULAR", titulo_s))

    elementos.append(Spacer(1, 6 * mm))
    elementos.append(Paragraph("Orden Médica de Imagenología", subtitulo_s))
    elementos.append(Spacer(1, 8 * mm))

    # — Datos paciente —
    for label, valor in [
        ("Nombre", nombre),
        ("Edad",   str(edad)),
        ("RUT",    rut),
        ("Descripción de síntomas", f"Dolor en {sintomas}" if sintomas else "—"),
    ]:
        elementos.append(Paragraph(f"<b>{label}:</b> {valor}", campo_s))

    elementos.append(Spacer(1, 10 * mm))

    # — Examen —
    elementos.append(Paragraph("Examen sugerido:", examen_label_s))
    elementos.append(Spacer(1, 8 * mm))
    elementos.append(Paragraph(examen, examen_s))
    elementos.append(Spacer(1, 12 * mm))

    # — Nota / derivación —
    if nota:
        elementos.append(Paragraph(f"Nota:<br/><br/>{nota}", nota_s))
        elementos.append(Spacer(1, 6 * mm))

    # — Firma —
    elementos.extend(_bloque_firma(firma_s))

    doc.build(elementos)
    return buffer.getvalue()
  
