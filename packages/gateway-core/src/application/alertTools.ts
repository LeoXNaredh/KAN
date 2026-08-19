import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";
import type { AlertRule } from "../domain/entities/AlertRule";
import type { AlertMonitor } from "./AlertMonitor";
import { parseSequenceSteps } from "./sequenceTools";

const SET_ALERT_TOOL = "kan_set_alert";
const CANCEL_ALERT_TOOL = "kan_cancel_alert";
const LIST_ALERTS_TOOL = "kan_list_alerts";

/**
 * Tools de alertas (sistema básico de alertas) — mismo patrón que
 * schedulerTools.ts (ADR-039): declaradas y despachadas acá, dentro de
 * `Gateway.listTools()`/`executeTool()`, antes de llegar a
 * `ToolResolver`/`GlobalCapabilityRegistry` — una alerta no es la capability
 * de ningún dispositivo, es una operación del propio AlertMonitor.
 */
export const ALERT_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: SET_ALERT_TOOL,
    description:
      "Crea una alerta de umbral: avisa la primera vez que el valor que devuelve una capability de lectura " +
      "(read-only) supera o baja de un límite (ej. 'avisame si la temperatura supera 40 grados'). KAN sondea " +
      "esa capability periódicamente — no avisa de nuevo en cada chequeo mientras el valor siga del mismo lado " +
      "del límite, solo cuando vuelve a cruzarlo. Con 'steps', además de avisar ejecuta esa secuencia de " +
      "capabilities en orden cuando la alerta se dispara (ej. 'cuando el sensor de temperatura supere 35 grados, " +
      "apagá el motor y encendé el LED de alerta') — mismo criterio de seguridad que kan_run_sequence: se detiene " +
      "en el primer paso que falle o que necesite confirmación explícita, nunca la saltea.",
    inputSchema: {
      type: "object",
      properties: {
        capabilityRef: {
          type: "string",
          description: "El nombre exacto de una tool/capability de lectura ya disponible que devuelve el valor a vigilar.",
        },
        field: {
          type: "string",
          description:
            "Si el resultado de la capability es un objeto, el nombre del campo numérico a comparar (ej. 'temperatureC'). Omitilo si el resultado ya es un número.",
        },
        comparator: {
          type: "string",
          enum: ["above", "below"],
          description: "'above' para avisar cuando supera el límite, 'below' para cuando baja de él.",
        },
        threshold: { type: "number", description: "El valor límite." },
        label: {
          type: "string",
          description:
            "Frase natural en español, CON artículo, de lo que se está midiendo (ej. 'la temperatura', 'el nivel de batería') — se usa tal cual al principio del aviso.",
        },
        unit: { type: "string", description: "Unidad en lenguaje simple (ej. 'grados', '%') — opcional." },
        steps: {
          type: "array",
          description: "Opcional — secuencia de capabilities a ejecutar en orden cuando la alerta se dispare (multi-dispositivo coordinado).",
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
      required: ["capabilityRef", "comparator", "threshold", "label"],
    },
  },
  {
    name: CANCEL_ALERT_TOOL,
    description: "Cancela una alerta activa por su id (el que devolvió kan_set_alert o kan_list_alerts).",
    inputSchema: {
      type: "object",
      properties: { alertId: { type: "string" } },
      required: ["alertId"],
    },
  },
  {
    name: LIST_ALERTS_TOOL,
    description: "Lista las alertas activas ahora mismo, con su id, qué vigilan y su límite.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function isAlertToolName(name: string): boolean {
  return name === SET_ALERT_TOOL || name === CANCEL_ALERT_TOOL || name === LIST_ALERTS_TOOL;
}

function summarize(rule: AlertRule) {
  return {
    alertId: rule.id,
    capabilityRef: rule.capabilityRef,
    field: rule.field,
    comparator: rule.comparator,
    threshold: rule.threshold,
    label: rule.label,
    unit: rule.unit,
    steps: rule.steps,
    // Nunca se narra en lenguaje natural (mismo criterio que alertId) — acá
    // solo para que un consumidor HTTP (constructor visual de secuencias,
    // apps/web) pueda filtrar por dueño antes de mostrar la lista, ya que
    // este tool no filtra por `requestingUserId` como el resto del Gateway.
    createdBy: rule.createdBy,
  };
}

interface SetAlertArgs {
  capabilityRef?: unknown;
  field?: unknown;
  comparator?: unknown;
  threshold?: unknown;
  label?: unknown;
  unit?: unknown;
  steps?: unknown;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function executeAlertTool(
  alertMonitor: AlertMonitor,
  name: string,
  args: unknown,
  requestingUserId?: string,
): Promise<ToolExecutionResult> {
  if (name === SET_ALERT_TOOL) {
    const a = (args ?? {}) as SetAlertArgs;
    const capabilityRef = nonEmptyString(a.capabilityRef);
    const comparator = a.comparator;
    const threshold = a.threshold;
    const label = nonEmptyString(a.label);

    if (
      !capabilityRef ||
      (comparator !== "above" && comparator !== "below") ||
      typeof threshold !== "number" ||
      !Number.isFinite(threshold) ||
      !label
    ) {
      return {
        success: false,
        error: `${SET_ALERT_TOOL} requiere 'capabilityRef', 'comparator' ('above'/'below'), 'threshold' numérico y 'label' no vacíos.`,
      };
    }

    // 'steps' (opcional): multi-dispositivo coordinado — mismo runner que
    // kan_run_sequence, ver Gateway.runSteps(). Si viene, tiene que ser
    // válido (rechaza en vez de ignorar en silencio, mismo criterio que el
    // resto de este archivo).
    let steps;
    if (a.steps !== undefined) {
      steps = parseSequenceSteps(a.steps);
      if (!steps) {
        return { success: false, error: `${SET_ALERT_TOOL}: 'steps', si se manda, tiene que ser una lista no vacía de { capabilityRef }.` };
      }
    }

    try {
      const rule = alertMonitor.create({
        capabilityRef,
        field: nonEmptyString(a.field),
        comparator,
        threshold,
        label,
        unit: nonEmptyString(a.unit),
        steps,
        createdBy: requestingUserId,
      });
      return { success: true, data: { alertId: rule.id } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Error desconocido" };
    }
  }

  if (name === CANCEL_ALERT_TOOL) {
    const alertId = (args as { alertId?: unknown } | null)?.alertId;
    if (typeof alertId !== "string" || !alertId.trim()) {
      return { success: false, error: `${CANCEL_ALERT_TOOL} requiere 'alertId'.` };
    }
    const exists = alertMonitor.list().some((rule) => rule.id === alertId);
    if (!exists) {
      return { success: false, error: `No existe ninguna alerta activa con id "${alertId}".` };
    }
    alertMonitor.cancel(alertId);
    return { success: true, data: { alertId } };
  }

  if (name === LIST_ALERTS_TOOL) {
    return { success: true, data: { alerts: alertMonitor.list().map(summarize) } };
  }

  return { success: false, error: `Tool de alertas desconocida: ${name}` };
}
