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

/**
 * Resuelve especialidad por inclusión semántica simple
 * SIN heurística, SIN IA, SIN default clínico
 */
function resolverEspecialidad(dolor = "") {
  const texto = norm(dolor);

  for (const key of Object.keys(MAP_DOLOR_A_ESPECIALIDAD)) {
    if (texto.includes(key)) {
      return MAP_DOLOR_A_ESPECIALIDAD[key];
    }
  }

  return null;
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

/* ===================== NOTA MÉDICA (OBLIGATORIA) ===================== */
/**
 * La NOTA:
 * - SIEMPRE existe
 * - SIEMPRE es de derivación
 * - GEO solo agrega precisión
 */
function buildNota({ especialidad, sede, doctor }) {
  const partes = [];

  const espTexto = especialidad
    ? especialidad.charAt(0).toUpperCase() + especialidad.slice(1)
    : "la especialidad correspondiente";

  // 1) Evaluación (SIEMPRE)
  partes.push(`Sugerimos evaluación por especialista en ${espTexto}.`);

  // 2) Médico (solo si existe)
  if (doctor?.nombre) {
    partes.push(`Recomendamos al Dr. ${doctor.nombre}.`);
  }

  // 3) Centro (solo si GEO permitió resolver sede)
  if (sede?.nombre) {
    partes.push(`Puede solicitar su hora en ${sede.nombre}.`);
  }

  return partes.join(" ");
}

/* ===================== RESOLVER PRINCIPAL ===================== */
/**
 * @param datos  → { dolor }
 * @param geo    → { country, region } (opcional)
 */
export function resolverDerivacion(datos = {}, geo) {
  const { dolor } = datos;

  const especialidad = resolverEspecialidad(dolor);
  const sede = resolverSedePorGeo(geo);
  const doctor = obtenerDoctor(sede, especialidad);

  const nota = buildNota({
    especialidad,
    sede,
    doctor,
  });

  return {
    dolor,
    especialidad,
    sede,
    doctor: doctor || null,
    doctores: doctor ? [doctor] : [],
    nota, // 🔒 SIEMPRE presente
    source: "resolver",
  };
}
