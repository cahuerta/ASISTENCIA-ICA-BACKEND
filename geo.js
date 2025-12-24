// geo.js
// Infraestructura pura: IP + geolocalización
// CONTRATO:
// - SIEMPRE devuelve { country, region }
// - NUNCA null
// - NUNCA default
// - SIN estado global

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ============================================================
   __dirname
   ============================================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   CARGA DE SEDES (FUENTE ÚNICA)
   ============================================================ */
const DERIVACION_DIR = path.join(__dirname, "derivacion");
const sedesGeo = JSON.parse(
  fs.readFileSync(path.join(DERIVACION_DIR, "sedes.geo.json"), "utf8")
);

// Chile únicamente (extensible)
const CIUDADES = Object.entries(sedesGeo.CL || {});

/* ============================================================
   LOG HELPER
   ============================================================ */
function logGeo(msg, data = {}) {
  console.log(`🌍 [GEO] ${msg}`, JSON.stringify(data));
}

/* ============================================================
   IP REAL (Render / Proxy safe)
   ============================================================ */
export function getClientIP(req) {
  const raw =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "";

  const ip = raw.replace("::ffff:", "");

  logGeo("IP detectada", { ip });
  return ip;
}

/* ============================================================
   DISTANCIA (KM) – Haversine
   ============================================================ */
function distanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centroBBox(b) {
  return {
    lat: (b.latMin + b.latMax) / 2,
    lon: (b.lonMin + b.lonMax) / 2,
  };
}

/* ============================================================
   GPS → CIUDAD (BBOX o proximidad)
   ============================================================ */
function resolverGeoPorGPS(lat, lon) {
  logGeo("Resolviendo por GPS", { lat, lon });

  // 1️⃣ Dentro de BBOX
  for (const [region, sede] of CIUDADES) {
    const b = sede.bbox;
    if (
      lat >= b.latMin &&
      lat <= b.latMax &&
      lon >= b.lonMin &&
      lon <= b.lonMax
    ) {
      logGeo("GPS dentro de BBOX", { region });
      return { country: "CL", region };
    }
  }

  // 2️⃣ Proximidad real (siempre ciudad válida)
  let mejor = null;
  let minDist = Infinity;

  for (const [region, sede] of CIUDADES) {
    const c = centroBBox(sede.bbox);
    const d = distanciaKm(lat, lon, c.lat, c.lon);
    if (d < minDist) {
      minDist = d;
      mejor = region;
    }
  }

  logGeo("GPS fuera de BBOX, ciudad más cercana", {
    region: mejor,
    distancia_km: Math.round(minDist),
  });

  return { country: "CL", region: mejor };
}

/* ============================================================
   IP → CIUDAD (usa coords si existen)
   ============================================================ */
export async function geoFromIP(ip) {
  logGeo("Resolviendo por IP", { ip });

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "Asistencia-ICA/1.0" },
    });

    const data = await res.json();

    if (
      Number.isFinite(data.latitude) &&
      Number.isFinite(data.longitude)
    ) {
      return resolverGeoPorGPS(data.latitude, data.longitude);
    }
  } catch (e) {
    logGeo("Error IPAPI", { error: String(e) });
  }

  // Último recurso: centro geográfico de Chile (NO default)
  logGeo("IP sin coords, usando centro geográfico de Chile");
  return resolverGeoPorGPS(-34.5, -71.0);
}

/* ============================================================
   FUNCIÓN PRINCIPAL (STATELESS)
   ============================================================ */
export async function detectarGeo(req) {
  // 1️⃣ GPS explícito desde frontend
  if (req?.body?.geo?.source === "gps") {
    const lat = Number(req.body.geo.lat);
    const lon = Number(req.body.geo.lon);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return resolverGeoPorGPS(lat, lon);
    }
  }

  // 2️⃣ IP
  const ip = getClientIP(req);
  return await geoFromIP(ip);
}
