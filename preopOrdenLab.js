// preopOrdenLab.js (ESM) — VERSIÓN DEBUG COMPLETA CORREGIDA
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { memoria } from "./index.js"; // ← leer memoria directa por idPago

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* Helper seguro para debug de objetos grandes */
function safeJson(obj, maxLen = 1000) {
  try {
    const s = JSON.stringify(obj ?? null, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen) + "...[truncado]" : s;
  } catch {
    return "[no se pudo serializar]";
  }
}

/* Normaliza lista IA para PDF */
function normalizarListaDesdeIA(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((it) => (typeof it === "string" ? it : it?.nombre || ""))
    .map((s) => String(s).trim())
    .filter(Boolean);
}

export function generarOrdenPreopLab(doc, datos = {}) {
  const {
    nombre,
    rut,
    edad,
    dolor,
    lado,
    tipoCirugia,
    examenesIA,
    nota,
    idPago,
  } = datos || {};

  /* ================= LEER MEMORIA UNA VEZ ================= */
  let memPreop = null;
  try {
    if (idPago && memoria && typeof memoria.get === "function") {
      memPreop = memoria.get(`preop:${idPago}`) || null;
    }
  } catch (e) {
    console.error("ERROR_LECTURA_MEM_PREOP", { idPago, error: e?.message });
  }

  /* ================= ENCABEZADO ================= */
  try {
    const logoPath = path.join(__dirname, "assets", "ica.jpg");
    if (fs.existsSync(logoPath)) doc.image(logoPath, 50, 40, { width: 120 });
  } catch {}

  doc.moveDown(1.5);
  doc.font("Helvetica-Bold").fontSize(18)
    .text("INSTITUTO DE CIRUGÍA ARTICULAR", 180, 50);

  doc.moveDown(1.5);
  doc.fontSize(16)
    .text("Orden Preoperatoria – Laboratorio y ECG", 180, undefined, {
      underline: true,
    });

  doc.moveDown(4);
  doc.x = doc.page.margins.left;

  /* ================= PACIENTE ================= */
  const sintomas = `${dolor ?? ""} ${lado ?? ""}`.trim();
  doc.font("Helvetica").fontSize(14);
  doc.text(`Nombre: ${nombre ?? ""}`);
  doc.moveDown(1);
  doc.text(`Edad: ${edad ?? ""}`);
  doc.moveDown(0.5);
  doc.text(`RUT: ${rut ?? ""}`);
  doc.moveDown(0.5);
  if (tipoCirugia) {
    doc.text(`Tipo de cirugía: ${tipoCirugia}`);
    doc.moveDown(0.5);
  }
  doc.text(`Descripción de síntomas: ${sintomas || "—"}`);
  doc.moveDown(2);

  /* ================= EXÁMENES ================= */
  // 1º intento: lo que llega desde index (front)
  // 2º intento: lo que está en memoria preop:idPago
  const listaExamenes = normalizarListaDesdeIA(
    Array.isArray(examenesIA) && examenesIA.length > 0
      ? examenesIA
      : memPreop?.examenesIA || []
  );

  doc.font("Helvetica-Bold").text("Solicito los siguientes exámenes:");
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(12);

  if (listaExamenes.length === 0) {
    doc.text("• (Sin exámenes registrados en este flujo)");
  } else {
    listaExamenes.forEach((e) => doc.text(`• ${e}`));
  }

  doc.moveDown(3);

  if (nota) {
    doc.font("Helvetica-Oblique").fontSize(11).text(nota);
    doc.moveDown(2);
  }

  /* ================= PIE: FIRMA ================= */
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

  /* Firma */
  try {
    const firmaPath = path.join(__dirname, "assets", "FIRMA.png");
    if (fs.existsSync(firmaPath))
      doc.image(firmaPath, (pageW - 250) / 2, baseY - 45, { width: 250 });
  } catch {}

  /* Timbre */
  try {
    const timbrePath = path.join(__dirname, "assets", "timbre.jpg");
    if (fs.existsSync(timbrePath)) {
      const timbreW = 110;
      const timbreX = (pageW - 250) / 2 + 250;
      const timbreY = baseY - 65;
      doc.save();
      doc.rotate(20, {
        origin: [timbreX + timbreW / 2, timbreY + timbreW / 2],
      });
      doc.image(timbrePath, timbreX, timbreY, { width: timbreW });
      doc.restore();
    }
  } catch {}

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
  doc.text("INSTITUTO DE CIRUGÍA ARTICULAR", {
    align: "center",
    width: pageW - marginL - marginR,
  });

  /* ======================================================
     ========= DEBUG FOOTER PÁGINA 1 (RESUMIDO) ============
     ====================================================== */
  try {
    const exFront = (examenesIA || []).join(" | ");
    const exMem = (memPreop?.examenesIA || []).join(" | ");

    console.log("DEBUG_PDF_PREOP", {
      idPago,
      examenesFront: examenesIA,
      examenesMem: memPreop?.examenesIA,
      memPreop,
    });

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor("#666");
    doc.text(`DEBUG(1/2): id=${idPago || "-"} | front=[${exFront}]`);
    doc.text(
      `DEBUG_MEM_EXAMENES: ${String(exMem || "").slice(0, 150)}`
    );
    doc.fillColor("black");
  } catch {}

  /* ======================================================
     ================ PÁGINA 2: DEBUG COMPLETO =============
     ====================================================== */
  try {
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text("DEBUG ORDEN PREOP / IA", {
      align: "left",
    });

    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(10);

    // 1) Payload desde index.js
    const debugPayloadFront = {
      idPago,
      nombre,
      rut,
      edad,
      dolor,
      lado,
      tipoCirugia,
      examenesIA,
      nota,
    };

    doc.text("1) PAYLOAD DESDE INDEX (datos enviados al PDF):");
    doc.moveDown(0.2);
    doc.text(safeJson(debugPayloadFront));

    // 2) Lo que hay realmente en memoria preop:idPago
    const snapPreop = memPreop || null;

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text(
      "2) MEMORIA preop:idPago (memoria.get('preop:idPago')):"
    );
    doc.moveDown(0.2);
    doc.font("Helvetica").text(safeJson(snapPreop));

    // 3) IA (si existe debugIA)
    let snapIA = null;
    try {
      snapIA =
        (snapPreop && snapPreop.debugIA) ||
        (idPago && memoria?.get && memoria.get(`ia:${idPago}`)) ||
        null;
    } catch {
      snapIA = null;
    }

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").text("3) DEBUG IA (respuesta bruta + exámenes):");
    doc.moveDown(0.2);
    doc.font("Helvetica").text(
      safeJson(
        snapIA || { info: "No se encontró debugIA en memoria. Revisa preopIA.js." }
      )
    );
  } catch (e) {
    console.error("ERROR_DEBUG_PDF_PREOP", { idPago, error: e?.message });
  }
}
