import type { ToolDescriptor } from "@kan/plugin-contract";
import type { TaskRequest } from "../domain/entities/GatewayTask";

export const RUN_SEQUENCE_TOOL = "kan_run_sequence";

/**
 * Tool de multi-dispositivo coordinado ad-hoc (requisito: "cuando el sensor
 * de temperatura supere 35 grados, apagá el motor y encendé el LED de
 * alerta" — la parte "apagá... y encendé..." es esto; "cuando... supere..."
 * es `kan_set_alert.steps`, que reusa el mismo runner). Mismo patrón que
 * schedulerTools.ts/alertTools.ts: declarada y despachada en
 * `Gateway.listTools()`/`executeTool()`, nunca pasa por
 * `ToolResolver`/`GlobalCapabilityRegistry` — no es la capability de ningún
 * dispositivo en sí, ejecuta varias en orden.
 */
export const SEQUENCE_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: RUN_SEQUENCE_TOOL,
    description:
      "Ejecuta una secuencia de una o varias capabilities, en orden, AHORA MISMO — se detiene en el primer paso " +
      "que falle o que necesite confirmación explícita del usuario (mismo criterio de seguridad que cualquier " +
      "acción individual, nunca se salta esa confirmación). Usala para coordinar varios dispositivos en una sola " +
      "orden del usuario (ej. 'apagá el motor y encendé el LED de alerta').",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              capabilityRef: { type: "string", description: "El nombre exacto de una tool/capability ya disponible." },
              input: { type: "object", description: "Argumentos de esa capability, si necesita alguno." },
            },
            required: ["capabilityRef"],
          },
        },
      },
      required: ["steps"],
    },
  },
];

export function isSequenceToolName(name: string): boolean {
  return name === RUN_SEQUENCE_TOOL;
}

/**
 * Mismo criterio de parseo que el `parseSteps` interno de schedulerTools.ts
 * (no compartido con ese archivo a propósito — ahí describe un `ScheduledJob`
 * persistido, acá una ejecución inmediata; misma forma por coincidencia, no
 * por acoplamiento) — reusado por `alertTools.ts` para `kan_set_alert.steps`,
 * que sí es genuinamente la misma necesidad ("una lista de pasos a correr").
 */
export function parseSequenceSteps(input: unknown): TaskRequest[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const steps: TaskRequest[] = [];
  for (const raw of input) {
    const capabilityRef = (raw as { capabilityRef?: unknown } | null)?.capabilityRef;
    if (typeof capabilityRef !== "string" || !capabilityRef.trim()) return undefined;
    steps.push({ capabilityRef, input: (raw as { input?: unknown }).input ?? {} });
  }
  return steps;
}

/** Reporte de un paso ya corrido — nunca el nombre técnico de la capability ni JSON crudo, mismo criterio que alertMessage.ts (el modelo narra en lenguaje simple a partir de esto, mismo patrón que cualquier otro tool result). */
export interface SequenceStepReport {
  deviceName: string;
  description: string;
  outcome: "done" | "failed" | "pending_confirmation";
  data?: unknown;
  error?: string;
}
