// geo.js
// Infraestructura pura: IP + geolocalización
// NO contiene lógica clínica
// NO decide derivaciones
// Guarda GEO en memoria temporal para uso posterior por resolver.js

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
   GEOLOCALIZACIÓN POR IP
   Proveedor: ipapi.co
   ============================================================ */
export async function geoFromIP(ip) {
  // Casos locales / desarrollo
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
  } catch (err) {
    return {
      ip,
      country: null,
      error: "geo_lookup_failed",
    };
  }
}

/* ============================================================
   GEOLOCALIZACIÓN DESDE GPS (REVERSE GEOCODING)
   Proveedor: OpenStreetMap / Nominatim
   ============================================================ */
async function geoFromGPS(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=es`,
      {
        headers: { "User-Agent": "Asistencia-ICA/1.0" },
      }
    );

    const data = await res.json();
    const addr = data.address || {};

    return {
      country: "CL",
      country_name: "Chile",
      region: addr.state || null,
      city:
        addr.city ||
        addr.town ||
        addr.village ||
        null,
      latitude: lat,
      longitude: lon,
      source: "gps",
    };
  } catch {
    // Si falla el reverse, devolvemos GPS crudo
    return {
      country: "CL",
      latitude: lat,
      longitude: lon,
      source: "gps",
    };
  }
}

/* ============================================================
   SET / GET DE GEO (MEMORIA TEMPORAL)
   ============================================================ */
export function setGeo(geo) {
  GEO_CACHE = geo;
}

export function getGeo() {
  return GEO_CACHE;
}

/* ============================================================
   FUNCIÓN PRINCIPAL
   - Se llama UNA VEZ al inicio (ping)
   - Calcula GEO
   - La guarda en memoria
   - NO decide nada
   ============================================================ */
export async function detectarGeo(req) {
  // 1️⃣ Si ya hay GEO desde GPS, no recalcular
  if (GEO_CACHE && GEO_CACHE.source === "gps") {
    return GEO_CACHE;
  }

  // 2️⃣ Si viene GPS explícito desde frontend
  if (req?.body?.geo?.source === "gps") {
    const { lat, lon } = req.body.geo || {};
    if (typeof lat === "number" && typeof lon === "number") {
      const geoGPS = await geoFromGPS(lat, lon);
      setGeo(geoGPS);
      return geoGPS;
    }
  }

  // 3️⃣ Fallback IP
  const ip = getClientIP(req);
  const geo = await geoFromIP(ip);

  setGeo(geo);
  return geo;
}
