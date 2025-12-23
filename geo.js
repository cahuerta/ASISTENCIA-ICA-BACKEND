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
   CONTRATO: { country, region }
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
   GEOLOCALIZACIÓN POR IP
   → NORMALIZA A { country, region }
   ============================================================ */
export async function geoFromIP(ip) {
  // desarrollo / local
  if (!ip || ip === "127.0.0.1" || ip === "::1") {
    return {
      country: "CL",
      region: "DEFAULT",
    };
  }

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { "User-Agent": "Asistencia-ICA/1.0" },
    });

    const data = await res.json();

    return {
      country: data.country_code || "CL",
      region: data.region
        ? String(data.region).toLowerCase()
        : "DEFAULT",
    };
  } catch {
    return {
      country: "CL",
      region: "DEFAULT",
    };
  }
}

/* ============================================================
   RESOLVER GEO POR GPS (BBOX)
   → NORMALIZA A { country, region }
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
        region: regionKey, // ← EXACTAMENTE lo que resolver necesita
      };
    }
  }

  return {
    country: "CL",
    region: "DEFAULT",
  };
}

/* ============================================================
   SET / GET DE GEO (CONTRATO LIMPIO)
   ============================================================ */
export function setGeo(geo) {
  GEO_CACHE = geo;
}

export function getGeo() {
  return GEO_CACHE;
}

/* ============================================================
   FUNCIÓN PRINCIPAL
   - GPS primero
   - IP si no hay GPS
   - SIEMPRE devuelve { country, region }
   ============================================================ */
export async function detectarGeo(req) {
  // 1️⃣ Si ya hay GEO cacheado, usarlo
  if (GEO_CACHE && GEO_CACHE.country && GEO_CACHE.region) {
    return GEO_CACHE;
  }

  // 2️⃣ GPS explícito desde frontend
  if (req?.body?.geo?.source === "gps") {
    const { lat, lon } = req.body.geo || {};
    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
      const geoGPS = resolverGeoPorGPS(latNum, lonNum);
      setGeo(geoGPS);
      return geoGPS;
    }
  }

  // 3️⃣ IP
  const ip = getClientIP(req);
  const geoIP = await geoFromIP(ip);
  setGeo(geoIP);
  return geoIP;
}
