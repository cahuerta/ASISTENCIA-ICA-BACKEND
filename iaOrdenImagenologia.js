// iaOrdenImagenologia.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolverDerivacion } from "./resolver.js";
import { memoria } from "./index.js"; // ← leer memoria directa por idPago (espacio IA)

// __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper para debug: stringify seguro y corto
function safeJson(obj, maxLen = 900) {
  try {
    const s = JSON.stringify(obj ?? null, null, 2);
    if (s.length > maxLen) return s.slice(0, maxLen) + "...[truncado]";
    return s;
  } catch {
    return "[no se pudo serializar]";
  }
}

/**
 * Orden de imagenología para MÓDULO IA
 * - El INDEX debe entregar "examen" como STRING final (buildExamenTextoStrict)
 * - "nota" viene ya construida en index (buildNotaStrict), si se usa
 */
export function generarOrdenImagenologiaIA(doc, datos) {
  const {
    nombre,
    edad,
    rut,
    dolor,
    lado,
    examen, // ← string final normalizado por index (IA)
    nota,   // ← nota final construida en index
    idPago, // opcional, para debug
  } = datos || {};

  // --------- ENCABEZADO ---------
  try {
    const logoPath = path.join(__dirname, "assets", "ica.jpg");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, { width: 120 });
    }
  } catch {}

  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(18)
    .text("INSTITUTO DE CIRUGÍA ARTICULAR", 180, 50);
  doc.moveDown(1.5);
  doc.fontSize(16)
    .text("Orden Médica de Imagenología (IA)", 180, undefined, {
      underline: true,
    });

  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  // --------- DATOS PACIENTE ---------
  const sintomas = `${dolor ?? ""} ${lado ?? ""}`.trim();
  doc.font("Helvetica").fontSize(14);
  doc.text(`Nombre: ${nombre ?? ""}`);
  doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ""}`);
  doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ""}`);
  doc.moveDown(0.5);
  doc.text(`Descripción de síntomas: Dolor en ${sintomas}`);
  doc.moveDown(2);

  // --------- EXAMEN (IA → INDEX) ---------
  doc.font("Helvetica-Bold").text("Examen sugerido:");
  doc.moveDown(4);

  // **ESTE ES EXACTAMENTE EL TEXTO QUE ENVÍA EL INDEX PARA IA**
  doc.font("Helvetica-Bold")
    .fontSize(18)
    .text(examen || ""); // ← SIN FALLBACK

  doc.moveDown(5);

  // --------- NOTA (resolver derivación) ---------
  let bloqueNota = "";
  try {
    const deriv =
      resolverDerivacion && typeof resolverDerivacion === "function"
        ? resolverDerivacion({ ...datos, examen, dolor }) || {}
        : {};

    const notaDeriv = typeof deriv.nota === "string" ? deriv.nota.trim() : "";
    bloqueNota = notaDeriv ? `Nota:\n\n${notaDeriv}` : "";
  } catch {}

  if (bloqueNota) {
    doc.font("Helvetica").fontSize(12).text(bloqueNota, { align: "left" });
  }

  // --------- FIRMA Y TIMBRE ---------
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left || 50;
  const marginR = doc.page.margins.right || 50;
  const baseY = pageH - 170;

  doc.font("Helvetica").fontSize(12);
  doc.text("_________________________", marginL, baseY, {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("Firma y Timbre Médico", marginL, baseY + 18, {
    align: "center",
    width: pageW - marginL - marginR,
  });

  // Firma
  try {
    const firmaPath = path.join(__dirname, "assets", "FIRMA.png");
    if (fs.existsSync(firmaPath)) {
      const firmaW = 250;
      const firmaX = (pageW - firmaW) / 2;
      const firmaY = baseY - 45;
      doc.image(firmaPath, firmaX, firmaY, { width: firmaW });
    }
  } catch {}

  // Timbre
  try {
    const timbrePath = path.join(__dirname, "assets", "timbre.jpg");
    if (fs.existsSync(timbrePath)) {
      const firmaW = 250;
      const firmaX = (pageW - firmaW) / 2;
      const timbreW = 110;
      const timbreX = firmaX + firmaW;
      const timbreY = baseY - 65;

      doc.save();
      doc.rotate(20, { origin: [timbreX + timbreW / 2, timbreY + timbreW / 2] });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch {}

  // --------- PIE ---------
  doc.font("Helvetica").fontSize(12);
  doc.text("Dr. Cristóbal Huerta Cortés", marginL, baseY + 52, {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("RUT: 14.015.125-4", {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("Cirujano de Reconstrucción Articular", {
    align: "center",
    width: pageW - marginL - marginR,
  });
  doc.text("INSTITUTO DE CIRUGIA ARTICULAR", {
    align: "center",
    width: pageW - marginL - marginR,
  });

  // --------- DEBUG FOOTER RÁPIDO (IA) ---------
  try {
    const examPreview = (examen || "").slice(0, 80);

    // Lo que está REALMENTE guardado en memoria para ese idPago (ESPACIO IA)
    let examenMem = "";
    let rawMemIA = null;

    if (idPago && memoria && typeof memoria.get === "function") {
      rawMemIA = memoria.get(`ia:${idPago}`);
      if (rawMemIA) {
        if (Array.isArray(rawMemIA.examenes) && rawMemIA.examenes.length > 0) {
          examenMem = rawMemIA.examenes.join(" | ");
        } else if (
          Array.isArray(rawMemIA.examenesIA) &&
          rawMemIA.examenesIA.length > 0
        ) {
          examenMem = rawMemIA.examenesIA.join(" | ");
        } else if (typeof rawMemIA.examen === "string") {
          examenMem = rawMemIA.examen;
        }
      }
    }

    console.log("DEBUG_PDF_IA_ORDEN", {
      idPago,
      rut,
      examenFromIndex: examen,
      examenFromMemIA: examenMem,
      rawMemIA,
    });

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor("#666")
      .text(
        `DEBUG IA(1/2): id=${idPago || "-"} | rut=${rut || "-"} | examenIDX=${examPreview}`
      )
      .text(`DEBUG_MEM_IA_EXAMEN: ${(examenMem || "").slice(0, 80)}`);
    doc.fillColor("black");
  } catch {}

  // --------- PÁGINA 2: DEBUG COMPLETO (IA) ---------
  try {
    const tieneMemoria = idPago && memoria && typeof memoria.get === "function";

    let snapIA = null;
    if (tieneMemoria) {
      snapIA = memoria.get(`ia:${idPago}`) || null;
    }

    const debugPayloadFront = {
      idPago,
      desdeIndex: {
        nombre,
        rut,
        edad,
        dolor,
        lado,
        examenIndex: examen,
        notaIndex: nota ?? null,
      },
    };

    const debugIA = snapIA?.debugIA || null;

    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text("DEBUG ORDEN IA", {
      align: "left",
    });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9);

    doc.text("1) PAYLOAD DESDE INDEX (datos que recibe generarOrdenImagenologiaIA):");
    doc.moveDown(0.2);
    doc.text(safeJson(debugPayloadFront), {
      align: "left",
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    });

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text("2) MEMORIA ia:idPago (memoria.get('ia:idPago')):");
    doc.moveDown(0.2);
    doc.font("Helvetica").text(safeJson(snapIA), {
      align: "left",
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    });

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text("3) DEBUG IA (texto bruto, Dx y examen normalizado):");
    doc.moveDown(0.2);
    doc.font("Helvetica").text(
      safeJson(
        debugIA || {
          info: "No se encontró debugIA en memoria. Revisa traumaIA.js / IAModulo.",
        }
      ),
      {
        align: "left",
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      }
    );
  } catch (e) {
    console.error("ERROR_DEBUG_PDF_IA_ORDEN", {
      idPago,
      error: e?.message,
    });
  }
}
