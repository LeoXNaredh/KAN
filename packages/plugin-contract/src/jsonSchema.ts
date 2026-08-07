/**
 * Subconjunto de JSON Schema (draft 2020-12) que cubre lo que las
 * capabilities de KAN necesitan declarar hoy: objetos con propiedades
 * tipadas y campos requeridos. No modela el estándar completo (oneOf,
 * $ref, formatos custom...) — se amplía si un plugin real lo necesita,
 * mismo criterio que el resto del proyecto (docs/16 P1).
 */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [keyword: string]: unknown;
}
