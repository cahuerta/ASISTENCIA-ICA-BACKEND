# ordenes/preop_odonto.py
# Evaluación Preoperatoria por Odontología — timbre rotado 20°, dos columnas de firma
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
MARGIN_L  = 50
MARGIN_R  = 50
MARGIN_T  = 50
MARGIN_B  = 50   # pie gestionado manualmente con canvas


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
        fontSize=14, fontName="Helvetica-Bold", spaceAfter=6,
    )
    item = ParagraphStyle(
        "Item", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica", spaceAfter=3,
    )
    obs_s = ParagraphStyle(
        "Obs", parent=styles["Normal"],
        fontSize=12, fontName="Helvetica",
        alignment=TA_LEFT, spaceAfter=4,
    )
    return titulo, subtitulo, campo, seccion, item, obs_s


# ============================================================
# PIE — dos columnas: izquierda (médico + timbre), derecha (odontólogo)
# ============================================================
def _dibujar_pie(c: rl_canvas.Canvas, doc) -> None:
    avail_w = PAGE_W - MARGIN_L - MARGIN_R
    gap     = 40
    col_w   = (avail_w - gap) / 2
    left_x  = MARGIN_L
    right_x = MARGIN_L + col_w + gap
    line_y  = MARGIN_B + 110      # coordenada Y desde abajo

    # ---- Columna izquierda: firma + timbre ----
    firma_w = min(200, col_w - 10)
    firma_x = left_x + (col_w - firma_w) / 2
    firma_y = line_y + 28 + 60    # encima de la línea

    firma_path = _ASSETS / "FIRMA.png"
    if firma_path.exists():
        c.drawImage(
            str(firma_path),
            firma_x, firma_y,
            width=firma_w, height=20 * mm,
            preserveAspectRatio=True, mask="auto",
        )

    # Timbre rotado 20° dentro de la columna izquierda
    timbre_path = _ASSETS / "timbre.jpg"
    if timbre_path.exists():
        timbre_w = min(85, col_w * 0.42)
        timbre_x = min(firma_x + firma_w - timbre_w * 0.2, left_x + col_w - timbre_w)
        timbre_y = firma_y - 18
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

    # Línea izquierda
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1)
    c.line(left_x, line_y, left_x + col_w, line_y)

    # Datos médico
    c.setFont("Helvetica", 12)
    y_txt = line_y - 14
    for linea in [
        "Dr. Cristóbal Huerta Cortés",
        "RUT: 14.015.125-4",
        "Cirujano de Reconstrucción Articular",
        "INSTITUTO DE CIRUGÍA ARTICULAR",
    ]:
        c.drawCentredString(left_x + col_w / 2, y_txt, linea)
        y_txt -= 14

    # ---- Columna derecha: odontólogo ----
    c.line(right_x, line_y, right_x + col_w, line_y)
    c.setFont("Helvetica", 12)
    c.drawCentredString(right_x + col_w / 2, line_y - 14, "Firma Odontólogo(a)")


# ============================================================
# GENERAR PDF — retorna bytes
# ============================================================
def generar_preop_odonto(datos: dict) -> bytes:
    """
    datos: {
        nombre, rut, edad, dolor, lado,
        observaciones?: str,
        conclusion?:    'APTO' | 'APTO CON RESERVAS' | 'NO APTO'
    }
    Retorna: bytes del PDF generado.
    """
    nombre        = datos.get("nombre") or ""
    rut           = datos.get("rut") or ""
    edad          = datos.get("edad") or ""
    dolor         = datos.get("dolor") or ""
    lado          = datos.get("lado") or ""
    observaciones = str(datos.get("observaciones") or "").strip()
    conclusion    = str(datos.get("conclusion") or "").upper().strip()
    sintomas      = f"{dolor} {lado}".strip()

    titulo_s, subtitulo_s, campo_s, seccion_s, item_s, obs_s = _estilos()

    # bottomMargin grande para dejar espacio al pie dibujado con canvas
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=MARGIN_L, rightMargin=MARGIN_R,
        topMargin=MARGIN_T,  bottomMargin=200,
    )

    def on_page(canvas, doc):
        _dibujar_pie(canvas, doc)

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
    elementos.append(Paragraph("Evaluación Preoperatoria por Odontología", subtitulo_s))
    elementos.append(Spacer(1, 8 * mm))

    # — Datos paciente —
    for label, valor in [
        ("Nombre", nombre),
        ("Edad",   str(edad)),
        ("RUT",    rut),
        ("Motivo/Clínica", f"Dolor en {sintomas}" if sintomas else "—"),
    ]:
        elementos.append(Paragraph(f"<b>{label}:</b> {valor}", campo_s))

    elementos.append(Spacer(1, 8 * mm))

    # — Evaluación clínica —
    elementos.append(Paragraph("Evaluación Clínica:", seccion_s))
    elementos.append(Spacer(1, 3 * mm))
    for linea in [
        "• Caries activas: _______________________________",
        "• Enfermedad periodontal: _______________________",
        "• Piezas en mal estado/focos infecciosos: _______",
        "• Lesiones mucosas: _____________________________",
        "• Recomendaciones de higiene: ___________________",
    ]:
        elementos.append(Paragraph(linea, item_s))

    elementos.append(Spacer(1, 6 * mm))

    # — Observaciones —
    elementos.append(Paragraph("Observaciones:", seccion_s))
    obs_txt = observaciones or (
        "_____________________________________________________________\n"
        "_____________________________________________________________\n"
        "_____________________________________________________________"
    )
    elementos.append(Paragraph(obs_txt.replace("\n", "<br/>"), obs_s))

    elementos.append(Spacer(1, 6 * mm))

    # — Conclusión con checkboxes —
    elementos.append(Paragraph("Conclusión:", seccion_s))
    for opcion in ["APTO", "APTO CON RESERVAS", "NO APTO"]:
        marca = "☑" if conclusion == opcion else "☐"
        elementos.append(Paragraph(f"{marca} {opcion}", item_s))

    doc.build(elementos, onFirstPage=on_page, onLaterPages=on_page)
    return buffer.getvalue()
      
