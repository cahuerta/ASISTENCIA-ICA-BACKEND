// geo.js
// Infraestructura pura: IP + geolocalización
// NO contiene lógica clínica ni reglas de negocio

let GEO_CACHE = null;
export function setGeo(geo) {
  GEO_CACHE = geo;
}

export function getGeo() {
  return GEO_CACHE;
}

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
   FUNCIÓN PRINCIPAL
   (única que debe llamar index.js)
   ============================================================ */
export async function detectarGeo(req) {
  const ip = getClientIP(req);
  const geo = await geoFromIP(ip);

  setGeo(geo); // ← 🔑 queda guardado en memoria infra

  return geo;
}
