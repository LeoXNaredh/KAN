import Ajv from "ajv";
import type { JsonSchema } from "./jsonSchema";

// `strict: false` porque las capabilities no declaran `additionalProperties`
// ni otros candados de JSON Schema estricto — hoy solo se exige forma básica
// (tipos, requeridos), no un contrato cerrado (docs/16 P1).
const ajv = new Ajv({ allErrors: true, strict: false });

export type SchemaValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Defensa en profundidad, dos capas (docs/16 P1): `ToolResolver` la llama
 * del lado del Gateway antes de despachar al Edge Agent, y
 * `CapabilityRegistry` la llama del lado del Edge Agent antes de tocar el
 * driver — ninguna reemplaza a la otra, un LLM y un Edge Agent son
 * fronteras de confianza distintas.
 *
 * Un schema ausente o vacío (`{}`) significa "sin restricciones" — varias
 * capabilities de solo lectura no toman input (ej. `read_sensor`,
 * `list_mqtt_topics`).
 */
export function validateAgainstSchema(schema: JsonSchema | undefined, input: unknown): SchemaValidationResult {
  if (!schema || Object.keys(schema).length === 0) return { ok: true };

  const validate = ajv.compile(schema);
  if (validate(input)) return { ok: true };

  const message = (validate.errors ?? [])
    .map((error) => `${error.instancePath || "entrada"} ${error.message ?? "es inválida"}`.trim())
    .join("; ");
  return { ok: false, error: `Argumentos inválidos: ${message || "no cumplen el schema esperado"}` };
}
