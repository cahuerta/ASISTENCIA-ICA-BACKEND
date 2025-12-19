// resolver.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getGeo } from "./geo.js";

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

function resolverSedePorGeo(geo = {}) {
  const country = geo.country;
  const region = norm(geo.region);

  if (country && sedesGeo[country]) {
    for (const key of Object.keys(sedesGeo[country])) {
      if (region.includes(key)) {
        return sedesGeo[country][key];
      }
    }
  }
  return sedesGeo.DEFAULT || null;
}

function obtenerDoctor(sede, especialidad) {
  if (!sede || !especialidad) return null;
  const lista = medicosDB?.[sede.sedeId]?.[especialidad];
  return Array.isArray(lista) && lista.length ? lista[0] : null;
}

/* ===================== NOTA MÉDICA ===================== */
function buildNota({ dolor, lado, sede, doctor }) {
  const partes = [];

  if (sede?.nombre) {
    partes.push(`Sugerimos realizar el examen en ${sede.nombre}.`);
  } else {
    partes.push(
      "Sugerimos realizar el examen en un centro de imagenología."
    );
  }

  const zona =
    dolor && lado ? `${dolor.toLowerCase()} ${lado.toLowerCase()}` :
    dolor ? dolor.toLowerCase() :
    "la zona evaluada";

  partes.push(`Posterior evaluación por especialista en ${zona}.`);

  if (doctor?.nombre) {
    partes.push(`Se recomienda evaluación con Dr. ${doctor.nombre}.`);
  }

  return partes.join(" ");
}

/* ===================== RESOLVER PRINCIPAL ===================== */
export function resolverDerivacion(datos = {}, geo = null) {
  const { dolor, lado } = datos;

  if (!geo) geo = getGeo();

  const especialidad = resolverEspecialidad(dolor);
  const sede = resolverSedePorGeo(geo);
  const doctor = obtenerDoctor(sede, especialidad);

  const nota = buildNota({
    dolor,
    lado,
    sede,
    doctor,
  });

  return {
    dolor,
    lado,
    especialidad,
    sede,
    doctor: doctor || null,
    doctores: doctor ? [doctor] : [],
    nota,
    source: "resolver",
  };
}
