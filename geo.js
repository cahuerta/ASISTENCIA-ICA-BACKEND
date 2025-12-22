// geo.js
// Infraestructura pura: IP + geolocalización
// NO contiene lógica clínica
// NO decide derivaciones clínicas
// Guarda GEO en memoria temporal para uso posterior por resolver.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ============================================================
   __dirname
   ============================================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   CARGA DE SEDES (MISMO JSON QUE USA resolver)
   ============================================================ */
const DERIVACION_DIR = path.join(__dirname, "derivacion");
const sedesGeo = JSON.parse(
  fs.readFileSync(path.join(DERIVACION_DIR, "sedes.geo.json"), "utf8")
);

/* ============================================================
   MEMORIA INFRAESTRUCTURAL (TEMPORAL)
   ============================================================ */
let GEO_CACHE = null;

/* ============================================================
   IP REAL (proxy-safe, compatible Render / Vercel / Nginx)
   ============================================================ */
export function getClientIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

/* ============================================================
   GEOLOCALIZACIÓN POR IP (SIN CAMBIOS)
   ============================================================ */
export async function geoFromIP(ip) {
  if (!ip || ip === "127.0.0.1" || ip === "::1") {
    return {
      ip,
      country: "CL",
      country_name: "Chile",
      region: "DEV",
      city: "LOCAL",
      latitude: null,
      longitude: null,
      source: "local-dev",
    };
  }

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "Asistencia-ICA/1.0" },
    });

    const data = await res.json();

    return {
      ip,
      country: data.country_code || null,
      country_name: data.country_name || null,
      region: data.region || null,
      city: data.city || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      source: "ipapi",
    };
  } catch {
    return {
      ip,
      country: null,
      error: "geo_lookup_failed",
    };
  }
}

/* ============================================================
   RESOLVER GEO POR GPS (BBOX → region + city)
   ============================================================ */
function resolverGeoPorGPS(lat, lon) {
  const cl = sedesGeo.CL || {};

  for (const regionKey of Object.keys(cl)) {
    const sede = cl[regionKey];
    const b = sede.bbox;
    if (!b) continue;

    if (
      lat >= b.latMin &&
      lat <= b.latMax &&
      lon >= b.lonMin &&
      lon <= b.lonMax
    ) {
      return {
        country: "CL",
        region: regionKey,                 // 👈 CLAVE PARA resolver
        city: sede.ciudad || sede.nombre, // humano
        latitude: lat,
        longitude: lon,
        source: "gps",
      };
    }
  }

  return {
    country: "CL",
    region: null,
    city: null,
    latitude: lat,
    longitude: lon,
    source: "gps-default",
  };
}

/* ============================================================
   SET / GET DE GEO (SIN CAMBIOS)
   ============================================================ */
export function setGeo(geo) {
  GEO_CACHE = geo;
}

export function getGeo() {
  return GEO_CACHE;
}

/* ============================================================
   FUNCIÓN PRINCIPAL
   ============================================================ */
export async function detectarGeo(req) {
  // 1️⃣ Si ya hay GEO válido por GPS, no recalcular
  if (GEO_CACHE && GEO_CACHE.source === "gps") {
    return GEO_CACHE;
  }

  // 2️⃣ Si viene GPS explícito desde frontend
  if (req?.body?.geo?.source === "gps") {
    const { lat, lon } = req.body.geo || {};
    if (typeof lat === "number" && typeof lon === "number") {
      const geoGPS = resolverGeoPorGPS(lat, lon);
      setGeo(geoGPS);
      return geoGPS;
    }
  }

  // 3️⃣ Fallback IP (sin cambios)
  const ip = getClientIP(req);
  const geo = await geoFromIP(ip);
  setGeo(geo);
  return geo;
}
