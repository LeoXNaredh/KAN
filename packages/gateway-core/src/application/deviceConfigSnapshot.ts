import type { AlertRule } from "../domain/entities/AlertRule";

export interface DeviceConfigBundle {
  deviceId: string;
  deviceKind: string;
  generatedAt: string;
  alertRules: AlertRule[];
}

/**
 * `true` si un `capabilityRef` (convención `c_<agentId8>_<deviceId>_<capabilityName>`,
 * ver `GlobalCapabilityRegistry.sync()`) corresponde a este `deviceId` —
 * funciona contra el string guardado, sin necesitar que el dispositivo esté
 * conectado ahora mismo (backup/restore de config, docs/06, no depende de
 * `GlobalCapabilityRegistry`, que es en memoria y se vacía en cada reinicio
 * del Gateway).
 */
function capabilityRefMatchesDevice(ref: string, deviceId: string): boolean {
  return ref.includes(`_${deviceId}_`) || ref.endsWith(`_${deviceId}`);
}

/**
 * Una alerta "pertenece" a un dispositivo si vigila una de sus capabilities
 * directamente, o si aparece en alguno de sus `steps` (multi-dispositivo
 * coordinado) — en ese caso se respalda la regla COMPLETA con todos sus
 * pasos, no un fragmento recortado: restaurarla a medias la dejaría rota.
 */
export function alertRuleReferencesDevice(rule: AlertRule, deviceId: string): boolean {
  if (capabilityRefMatchesDevice(rule.capabilityRef, deviceId)) return true;
  return (rule.steps ?? []).some((step) => capabilityRefMatchesDevice(step.capabilityRef, deviceId));
}

/**
 * Arma el snapshot de tipo "config" (docs/06, Plataforma C — PLC/Modbus/
 * OPC-UA): no hay programa que leer del dispositivo, solo lo que KAN ya
 * sabe sobre él. Alcance de este incremento: reglas de alerta únicamente —
 * `kan_run_sequence` es explícitamente ad-hoc/no persistido (ver
 * `sequenceTools.ts`) y `ScheduledJob` no tiene un id estable reasignable en
 * `SchedulerPort.schedule()`, así que restaurarlo duplicaría el job en vez
 * de recrearlo — fuera de alcance por ahora.
 */
export function buildDeviceConfigBundle(deviceId: string, deviceKind: string, allAlertRules: AlertRule[]): DeviceConfigBundle {
  return {
    deviceId,
    deviceKind,
    generatedAt: new Date().toISOString(),
    alertRules: allAlertRules.filter((rule) => alertRuleReferencesDevice(rule, deviceId)),
  };
}

export function parseDeviceConfigBundle(content: Buffer): DeviceConfigBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString("utf-8"));
  } catch {
    throw new Error("El snapshot de configuración está corrupto (no es JSON válido).");
  }
  const bundle = parsed as Partial<DeviceConfigBundle> | null;
  if (!bundle || !Array.isArray(bundle.alertRules)) {
    throw new Error("El snapshot de configuración tiene un formato inesperado.");
  }
  return bundle as DeviceConfigBundle;
}
