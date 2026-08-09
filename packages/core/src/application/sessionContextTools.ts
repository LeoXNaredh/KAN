import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";
import type { SessionContextPort } from "../domain/ports/SessionContextPort";

const SET_ACTIVE_DEVICE_TOOL = "kan_set_active_device";
const SET_ACTIVE_PROJECT_TOOL = "kan_set_active_project";
const SET_CURRENT_TASK_TOOL = "kan_set_current_task";

/**
 * Tools internas de contexto de sesión (ADR-055) — mismo criterio que
 * memoryTools.ts: declaradas y despachadas enteramente acá dentro, nunca
 * vía ToolProviderPort/Gateway/Edge Agent. Le dan a KAN una forma de fijar
 * "en qué está trabajando el usuario ahora" durante la conversación (ej.
 * "KAN, estoy trabajando en el ESP32-01 del proyecto Robot autónomo") sin
 * que el usuario tenga que repetirlo en cada mensaje — se lee de vuelta en
 * buildSystemPrompt() de SendMessageUseCase.
 */
export const SESSION_CONTEXT_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: SET_ACTIVE_DEVICE_TOOL,
    description:
      "Marca un dispositivo como el que el usuario está usando/mencionando ahora en la conversación " +
      "(ej. 'estoy trabajando con el ESP32-01'). Se recuerda durante el resto de la sesión sin que el " +
      "usuario tenga que repetirlo.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string", description: "Nombre o identificador del dispositivo activo." },
      },
      required: ["deviceId"],
    },
  },
  {
    name: SET_ACTIVE_PROJECT_TOOL,
    description: "Marca un proyecto como el que el usuario está trabajando ahora en la conversación.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Nombre o identificador del proyecto activo." },
      },
      required: ["projectId"],
    },
  },
  {
    name: SET_CURRENT_TASK_TOOL,
    description: "Marca la tarea en la que el usuario está enfocado ahora en la conversación.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Descripción corta de la tarea actual." },
      },
      required: ["task"],
    },
  },
];

export function isSessionContextToolName(name: string): boolean {
  return name === SET_ACTIVE_DEVICE_TOOL || name === SET_ACTIVE_PROJECT_TOOL || name === SET_CURRENT_TASK_TOOL;
}

function parseNonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

/**
 * Valida `args` en runtime (mismo criterio que executeMemoryTool: vienen
 * del modelo como `unknown`) y devuelve `{success:false, error}` ante datos
 * inválidos en vez de tirar, para que el modelo pueda autocorregirse en la
 * ronda siguiente.
 */
export async function executeSessionContextTool(
  sessionContext: SessionContextPort,
  name: string,
  args: unknown,
): Promise<ToolExecutionResult> {
  if (name === SET_ACTIVE_DEVICE_TOOL) {
    const deviceId = parseNonEmptyString((args as { deviceId?: unknown } | null)?.deviceId);
    if (!deviceId) return { success: false, error: `${SET_ACTIVE_DEVICE_TOOL} requiere 'deviceId' no vacío.` };
    await sessionContext.setActiveDevice(deviceId);
    return { success: true, data: { activeDevice: deviceId } };
  }

  if (name === SET_ACTIVE_PROJECT_TOOL) {
    const projectId = parseNonEmptyString((args as { projectId?: unknown } | null)?.projectId);
    if (!projectId) return { success: false, error: `${SET_ACTIVE_PROJECT_TOOL} requiere 'projectId' no vacío.` };
    await sessionContext.setActiveProject(projectId);
    return { success: true, data: { activeProject: projectId } };
  }

  if (name === SET_CURRENT_TASK_TOOL) {
    const task = parseNonEmptyString((args as { task?: unknown } | null)?.task);
    if (!task) return { success: false, error: `${SET_CURRENT_TASK_TOOL} requiere 'task' no vacío.` };
    await sessionContext.setCurrentTask(task);
    return { success: true, data: { currentTask: task } };
  }

  return { success: false, error: `Tool de contexto de sesión desconocida: ${name}` };
}
