// resolver.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname para ES Modules (DEBE ir antes de usarse)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directorio real de derivación
const DERIVACION_DIR = path.join(__dirname, "derivacion");

// Bases de datos de derivación (solo lectura)
import { getGeo } from "./geo.js";

// Loader JSON compatible Node 18 / Render
function loadJSON(file) {
  return JSON.parse(
    fs.readFileSync(path.join(DERIVACION_DIR, file), "utf8")
  );
}

const sedesGeo = loadJSON("sedes.geo.json");
const medicosDB = loadJSON("medicos.json");

// Config histórica
const CONFIG_PATH = path.join(DERIVACION_DIR, "derivacion.config.json");

let __CACHE = { cfg: null, mtimeMs: 0 };

/* ============================================================
   CONFIG BASE (legacy)
   ============================================================ */
function leerConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `No se encontró derivacion.config.json en: ${CONFIG_PATH}`
    );
  }

  const stat = fs.statSync(CONFIG_PATH);
  if (__CACHE.cfg && __CACHE.mtimeMs === stat.mtimeMs) {
    return __CACHE.cfg;
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw);

  if (!cfg.segmentos || typeof cfg.segmentos !== "object") {
    throw new Error("derivacion.config.json inválido: falta 'segmentos'.");
  }

  __CACHE = { cfg, mtimeMs: stat.mtimeMs };
  return cfg;
}

export function recargarDerivacionConfig() {
  __CACHE = { cfg: null, mtimeMs: 0 };
  return leerConfig();
}

/* ============================================================
   HELPERS
   ============================================================ */
function normaliza(s) {
  return (s || "").toLowerCase();
}

/** Heurística simple por palabras clave */
function inferirSegmento(datos = {}) {
  const seg = normaliza(datos.segmento);
  if (seg === "cadera" || seg === "rodilla") return seg;

  const examen = normaliza(datos.examen);
  const dolor = normaliza(datos.dolor);

  const kCadera = [
    "cadera",
    "inguinal",
    "acetabular",
    "fémur proximal",
    "femur proximal",
  ];
  const kRodilla = [
    "rodilla",
    "rótula",
    "rotula",
    "patelar",
    "menisco",
    "ligamento cruzado",
    "lca",
    "lcp",
  ];

  const textos = [examen, dolor].filter(Boolean);

  if (textos.some((t) => kCadera.some((k) => t.includes(k)))) return "cadera";
  if (textos.some((t) => kRodilla.some((k) => t.includes(k)))) return "rodilla";

  return "";
}

/** Resolver sede según geolocalización */
function resolverSedePorGeo(geo = {}) {
  const country = geo.country;
  const region = normaliza(geo.region);

  if (country && sedesGeo[country]) {
    for (const key of Object.keys(sedesGeo[country])) {
      if (region.includes(key)) {
        return sedesGeo[country][key];
      }
    }
  }

  return sedesGeo.DEFAULT || null;
}

/** Obtiene médicos (SIEMPRE array) */
function obtenerDoctoresPorSedeYSegmento(sedeId, segmento) {
  if (!sedeId || !segmento) return [];
  return medicosDB?.[sedeId]?.[segmento] || [];
}

/** Construcción de NOTA CLÍNICA COMPLETA */
function buildNotaCompleta({ segmento, sede, doctor }) {
  const partes = [];

  if (sede?.nombre) {
    partes.push(`Sugerimos realizar el examen en ${sede.nombre}.`);
  }

  if (segmento) {
    partes.push(`Posterior evaluación con especialista en ${segmento}.`);
  } else {
    partes.push("Posterior evaluación con especialista correspondiente.");
  }

  if (doctor?.nombre) {
    partes.push(`Se recomienda consulta con Dr. ${doctor.nombre}.`);
  }

  return partes.join(" ");
}

/* ============================================================
   RESOLVER PRINCIPAL
   ============================================================ */
/**
 * @param {Object} datos
 * @param {Object|null} geo  -> { country, region, city }
 */
export function resolverDerivacion(datos = {}, geo = null) {
  if (!geo) {
    geo = getGeo();
  }

  leerConfig();

  // Normalizar examen (IA / guest)
  if (!datos.examen && typeof datos.examenTexto === "string") {
    datos.examen = datos.examenTexto;
  }

  /* ----------------------------------------------------------
     1) Derivación explícita
     ---------------------------------------------------------- */
  if (datos.derivacion?.doctor || datos.derivacion?.doctorId) {
    const d = datos.derivacion;

    const doctor =
      d.doctor ||
      (d.doctorId
        ? {
            id: d.doctorId,
            nombre: d.nombre || "",
            especialidad: d.especialidad || "",
            agenda: d.agenda || "",
            contactoWeb: d.contactoWeb || "",
          }
        : null);

    const segmento = normaliza(datos.segmento) || inferirSegmento(datos);

    const nota = buildNotaCompleta({
      segmento,
      sede: null,
      doctor,
    });

    return {
      segmento,
      sede: null,
      doctores: doctor ? [doctor] : [],
      doctor: doctor || null,
      nota,
      source: "explicit",
    };
  }

  /* ----------------------------------------------------------
     2) Segmento
     ---------------------------------------------------------- */
  const segmento = inferirSegmento(datos);

  /* ----------------------------------------------------------
     3) Sede por geolocalización
     ---------------------------------------------------------- */
  const sede = geo ? resolverSedePorGeo(geo) : null;

  /* ----------------------------------------------------------
     4) Médicos por sede + segmento
     ---------------------------------------------------------- */
  const doctores = sede
    ? obtenerDoctoresPorSedeYSegmento(sede.sedeId, segmento)
    : [];

  const doctorPrincipal = doctores[0] || null;

  /* ----------------------------------------------------------
     5) Nota clínica COMPLETA
     ---------------------------------------------------------- */
  const nota = buildNotaCompleta({
    segmento,
    sede,
    doctor: doctorPrincipal,
  });

  return {
    segmento,
    sede,
    doctores,
    doctor: doctorPrincipal,
    nota,
    source: geo ? "geo+segmento" : "segmento",
  };
}

/* ============================================================
   UTILIDAD
   ============================================================ */
export function obtenerDerivacionConfig() {
  return leerConfig();
}
