import type { ToolDescriptor, ToolExecutionResult } from "@kan/plugin-contract";
import { MEMORY_CATEGORIES } from "../domain/entities/MemoryEntry";
import type { MemoryContextPort } from "../domain/ports/MemoryContextPort";

const SET_MEMORY_TOOL = "kan_set_memory";
const REMOVE_MEMORY_TOOL = "kan_remove_memory";

/**
 * Tools internas de memoria (ADR-035) — declaradas y despachadas enteramente
 * acá dentro, nunca vía ToolProviderPort/Gateway/Edge Agent: no son acciones
 * físicas, son lectura/escritura de datos del propio usuario ya autorizados
 * por su sesión. Siempre disponibles si SendMessageUseCase tiene un
 * MemoryContextPort, sin importar si el Gateway está configurado o caído.
 */
export const MEMORY_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: SET_MEMORY_TOOL,
    description:
      "Guarda o actualiza un hecho sobre el usuario o su entorno para recordarlo en futuras conversaciones " +
      "(ej. el usuario dice 'recordá que mi impresora se llama Ender 3'). Si ya existe un hecho con la misma " +
      "categoría y clave, se actualiza su valor.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...MEMORY_CATEGORIES], description: "Categoría del hecho." },
        key: { type: "string", description: "Identificador corto y único del hecho, ej. 'impresora_3d'." },
        value: { type: "string", description: "El valor a recordar, ej. 'Ender 3, en el taller'." },
      },
      required: ["category", "key", "value"],
    },
  },
  {
    name: REMOVE_MEMORY_TOOL,
    description:
      "Elimina un hecho previamente guardado sobre el usuario, cuando pide olvidarlo o corregirlo por completo.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...MEMORY_CATEGORIES], description: "Categoría del hecho a eliminar." },
        key: { type: "string", description: "Clave del hecho a eliminar." },
      },
      required: ["category", "key"],
    },
  },
];

export function isMemoryToolName(name: string): boolean {
  return name === SET_MEMORY_TOOL || name === REMOVE_MEMORY_TOOL;
}

interface ParsedSetArgs {
  category: string;
  key: string;
  value: string;
}

interface ParsedRemoveArgs {
  category: string;
  key: string;
}

function parseCategory(args: unknown): string | undefined {
  const category = (args as { category?: unknown } | null)?.category;
  return typeof category === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(category)
    ? category
    : undefined;
}

function parseNonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function parseSetArgs(args: unknown): ParsedSetArgs | undefined {
  const category = parseCategory(args);
  const key = parseNonEmptyString((args as { key?: unknown } | null)?.key);
  const value = parseNonEmptyString((args as { value?: unknown } | null)?.value);
  if (!category || !key || !value) return undefined;
  return { category, key, value };
}

function parseRemoveArgs(args: unknown): ParsedRemoveArgs | undefined {
  const category = parseCategory(args);
  const key = parseNonEmptyString((args as { key?: unknown } | null)?.key);
  if (!category || !key) return undefined;
  return { category, key };
}

/**
 * Valida `args` en runtime (vienen del modelo como `unknown`) y devuelve
 * `{success:false, error}` en vez de tirar ante datos inválidos — el error
 * vuelve al modelo como mensaje `tool` (mismo mecanismo que ya usa
 * summarizeToolResult en SendMessageUseCase), así puede autocorregirse en
 * la ronda siguiente sin ningún cambio en ConversationPanel.tsx.
 */
export async function executeMemoryTool(
  memoryContext: MemoryContextPort,
  name: string,
  args: unknown,
): Promise<ToolExecutionResult> {
  if (name === SET_MEMORY_TOOL) {
    const parsed = parseSetArgs(args);
    if (!parsed) {
      return {
        success: false,
        error: `${SET_MEMORY_TOOL} requiere 'category' (una de: ${MEMORY_CATEGORIES.join(", ")}), 'key' y 'value' no vacíos.`,
      };
    }
    const entry = await memoryContext.set(parsed.category, parsed.key, parsed.value);
    return { success: true, data: entry };
  }

  if (name === REMOVE_MEMORY_TOOL) {
    const parsed = parseRemoveArgs(args);
    if (!parsed) {
      return {
        success: false,
        error: `${REMOVE_MEMORY_TOOL} requiere 'category' (una de: ${MEMORY_CATEGORIES.join(", ")}) y 'key' no vacíos.`,
      };
    }
    await memoryContext.remove(parsed.category, parsed.key);
    return { success: true, data: { category: parsed.category, key: parsed.key } };
  }

  return { success: false, error: `Tool de memoria desconocida: ${name}` };
}
