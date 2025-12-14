// derivacionEngine.js
// MOTOR GENÉRICO DE DERIVACIÓN CLÍNICA
// ----------------------------------
// - Lee SOLO datos desde derivaciones.config.js
// - Usa georreferencia normalizada (geo)
// - NO contiene reglas hardcodeadas de clínica
// - Primera coincidencia gana (orden importa)

import { DERIVACIONES } from "./derivaciones.config.js";

/* ============================================================
   MATCHERS (privados del motor)
   ============================================================ */

function matchCountry(ruleCountry, geoCountry) {
  if (!ruleCountry || ruleCountry === "*") return true;
  return ruleCountry === geoCountry;
}

function matchRegionIncludes(ruleRegion, geoRegion) {
  if (!ruleRegion) return true;
  if (!geoRegion) return false;
  return geoRegion.toLowerCase().includes(ruleRegion.toLowerCase());
}

function matchRule(match = {}, geo = {}) {
  if (!geo) return false;

  if (!matchCountry(match.country, geo.country)) return false;
  if (!matchRegionIncludes(match.regionIncludes, geo.region)) return false;

  return true;
}

/* ============================================================
   RESOLVER PRINCIPAL
   ============================================================ */
export function resolverDerivacionGenerica(geo = {}) {
  for (const rule of DERIVACIONES) {
    if (matchRule(rule.match, geo)) {
      return {
        id: rule.id || null,
        ...rule.resultado,
      };
    }
  }

  // Fallback absoluto (no debería ocurrir si hay regla "*")
  return {
    id: "SIN_DERIVACION",
    sede: null,
    mensaje: "No fue posible determinar una derivación",
    accion: "SIN_DERIVACION",
  };
}
