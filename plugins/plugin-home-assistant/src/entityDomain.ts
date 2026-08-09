import type { ActionSeverity } from "@kan/plugin-contract";

/**
 * Severidad por defecto según el dominio del entity_id (la parte antes del
 * punto, ej. "lock" en "lock.front_door") — mismo espíritu que
 * defaultSeverityFor en plugin-raspberry-pi/pinMap.ts, pero por dominio de
 * HA en vez de por pin físico. Es solo un default: el usuario reclasifica
 * cualquier entity_id en Safety Policy, esto nunca es la última palabra.
 */
const SAFETY_CRITICAL_DOMAINS = new Set(["lock", "alarm_control_panel"]);

const IRREVERSIBLE_MATERIAL_DOMAINS = new Set([
  "switch",
  "light",
  "climate",
  "cover",
  "fan",
  "vacuum",
  "media_player",
  "humidifier",
  "water_heater",
  "lawn_mower",
  "valve",
]);

export function domainOf(entityId: string): string {
  const dotIndex = entityId.indexOf(".");
  return dotIndex === -1 ? entityId : entityId.slice(0, dotIndex);
}

export function defaultSeverityForEntity(entityId: string): ActionSeverity {
  const domain = domainOf(entityId);
  if (SAFETY_CRITICAL_DOMAINS.has(domain)) return "safety-critical";
  if (IRREVERSIBLE_MATERIAL_DOMAINS.has(domain)) return "irreversible-material";
  return "read-only";
}
