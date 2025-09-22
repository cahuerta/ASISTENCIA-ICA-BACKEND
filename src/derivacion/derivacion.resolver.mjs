// src/derivacion/derivacion.resolver.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Resolver de derivaciones
 * - Carga y cachea derivacion.config.json
 * - Permite recarga manual
 * - Infere segmento por datos.segmento o keywords en dolor/examen
 * - Prioriza derivación explícita (si llega desde el front)
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ajusta si tu JSON vive en otra ruta:
const CONFIG_PATH = path.join(__dirname, "derivacion.config.json");

let __CACHE = { cfg: null, mtimeMs: 0 };

function leerConfig() {
  const exists = fs.existsSync(CONFIG_PATH);
  if (!exists) throw new Error(`No se encontró derivacion.config.json en: ${CONFIG_PATH}`);

  const stat = fs.statSync(CONFIG_PATH);
  if (__CACHE.cfg && __CACHE.mtimeMs === stat.mtimeMs) {
    return __CACHE.cfg; // cache válida
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw);

  // Validación mínima
  if (!cfg.segmentos || typeof cfg.segmentos !== "object") {
    throw new Error("derivacion.config.json inválido: falta 'segmentos'.");
  }
  if (!cfg.notaDefault) {
    cfg.notaDefault = "Se recomienda coordinar evaluación con la especialidad correspondiente, presentándose con el estudio realizado.";
  }
  if (!cfg.doctorDefault) {
    cfg.doctorDefault = {
      id: "ica_general",
      nombre: "ICA — Traumatología",
      especialidad: "Traumatología General",
      agenda: "ICA Curicó",
      contactoWeb: "https://www.icarticular.cl",
    };
  }

  __CACHE = { cfg, mtimeMs: stat.mtimeMs };
  return cfg;
}

/** Fuerza recarga desde disco (por si editas el JSON sin reiniciar el server) */
export function recargarDerivacionConfig() {
  __CACHE = { cfg: null, mtimeMs: 0 };
  return leerConfig();
}

function normaliza(s) {
  return (s || "").toLowerCase();
}

/** Heurística simple por palabras clave si no llega 'segmento' */
function inferirSegmento(datos = {}) {
  const seg = normaliza(datos.segmento);
  if (seg === "cadera" || seg === "rodilla") return seg;

  const examen = normaliza(datos.examen);
  const dolor = normaliza(datos.dolor);

  const kCadera = ["cadera", "inguinal", "acetabular", "fémur proximal", "femur proximal"];
  const kRodilla = ["rodilla", "rótula", "rotula", "patelar", "menisco", "ligamento cruzado", "lca", "lcp"];

  const textos = [examen, dolor].filter(Boolean);

  if (textos.some((t) => kCadera.some((k) => t.includes(k)))) return "cadera";
  if (textos.some((t) => kRodilla.some((k) => t.includes(k)))) return "rodilla";

  return ""; // desconocido
}

/**
 * Resolver principal
 * @param {Object} datos - puede incluir:
 *   - segmento: "rodilla" | "cadera" | ...
 *   - dolor, examen: strings (para inferir)
 *   - derivacion: opcional, si ya viene decidida desde el front
 * @returns {Object} { segmento, doctor, nota, source }
 */
export function resolverDerivacion(datos = {}) {
  const cfg = leerConfig();

  // 1) Prioridad: si viene derivación explícita del front, respetar
  if (datos.derivacion?.doctor || datos.derivacion?.doctorId) {
    const d = datos.derivacion;
    const doctor = d.doctor || {
      id: d.doctorId || "custom",
      nombre: d.nombre || "—",
      especialidad: d.especialidad || "—",
      agenda: d.agenda || "",
      contactoWeb: d.contactoWeb || "",
    };
    const nota = d.nota || cfg.notaDefault;
    return {
      segmento: normaliza(datos.segmento) || inferirSegmento(datos),
      doctor,
      nota,
      source: "explicit",
    };
  }

  // 2) Segmento por dato directo o inferido
  const segmento = inferirSegmento(datos);
  const entry = cfg.segmentos[segmento];

  if (entry) {
    return {
      segmento,
      doctor: entry.doctor || cfg.doctorDefault,
      nota: entry.nota || cfg.notaDefault,
      source: "segment",
    };
  }

  // 3) Fallback
  return {
    segmento: "",
    doctor: cfg.doctorDefault,
    nota: cfg.notaDefault,
    source: "fallback",
  };
}

/** Utilidad opcional para obtener la config actual (p.ej. logs o healthcheck) */
export function obtenerDerivacionConfig() {
  return leerConfig();
}
