// resolver.js
// Lógica clínica PURA
// NO detecta GEO
// NO usa estado
// SOLO decide con datos recibidos

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ===================== __dirname ===================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===================== DB ===================== */
const DERIVACION_DIR = path.join(__dirname, "derivacion");

function loadJSON(file) {
  return JSON.parse(
    fs.readFileSync(path.join(DERIVACION_DIR, file), "utf8")
  );
}

const sedesGeo = loadJSON("sedes.geo.json");
const medicosDB = loadJSON("medicos.json");

/* ===================== MAPEO DIRECTO ===================== */
/* ESTA TABLA ES LA VERDAD */
const MAP_DOLOR_A_ESPECIALIDAD = {
  rodilla: "rodilla",
  cadera: "cadera",
  hombro: "hombro",
  codo: "codo",
  mano: "mano",
  tobillo: "tobillo",
  columna: "columna",
};

/* ===================== HELPERS ===================== */
function norm(s) {
  return (s || "").toLowerCase();
}

function resolverEspecialidad(dolor = "") {
  const k = norm(dolor);
  return MAP_DOLOR_A_ESPECIALIDAD[k] || null;
}

/**
 * Resolver sede SOLO si geo es válido
 * - NO default
 * - NO inventa
 */
function resolverSedePorGeo(geo) {
  if (!geo || !geo.country || !geo.region) return null;

  const country = geo.country;
  const region = norm(geo.region);

  const countryDB = sedesGeo[country];
  if (!countryDB) return null;

  for (const key of Object.keys(countryDB)) {
    if (region.includes(norm(key))) {
      return countryDB[key];
    }
  }

  return null;
}

function obtenerDoctor(sede, especialidad) {
  if (!sede || !especialidad) return null;
  const lista = medicosDB?.[sede.sedeId]?.[especialidad];
  return Array.isArray(lista) && lista.length ? lista[0] : null;
}

/* ===================== NOTA MÉDICA (VERSIÓN FINAL) ===================== */
function buildNota({ dolor, sede, doctor }) {
  const partes = [];

  const especialidad = dolor
    ? dolor.toLowerCase()
    : "la especialidad correspondiente";

  // 1) Evaluación
  partes.push(
    `Sugerimos evaluación por especialista en ${especialidad}.`
  );

  // 2) Médico (pertenece al centro)
  if (doctor?.nombre) {
    partes.push(`Recomendamos al Dr. ${doctor.nombre}.`);
  }

  // 3) Centro según GEO
  if (sede?.nombre) {
    partes.push(`Puede solicitar su hora en ${sede.nombre}.`);
  }

  return partes.join(" ");
}
/* ===================== RESOLVER PRINCIPAL ===================== */
/**
 * @param datos  → { dolor }
 * @param geo    → { country, region } (OBLIGATORIO si se quiere sede)
 */
export function resolverDerivacion(datos = {}, geoParam) {
  const geo = geoParam || datos.geo || null;
  console.log("🧭 [RESOLVER] GEO RECIBIDO:", JSON.stringify(geo));

  const especialidad = resolverEspecialidad(dolor);
  const sede = resolverSedePorGeo(geo);
  const doctor = obtenerDoctor(sede, especialidad);

  const nota = buildNota({
    dolor,
    sede,
    doctor,
  });

  return {
    dolor,
    especialidad,
    sede,
    doctor: doctor || null,
    doctores: doctor ? [doctor] : [],
    nota,
    source: "resolver",
  };
}
