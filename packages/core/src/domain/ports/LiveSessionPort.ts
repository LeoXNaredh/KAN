import type { ToolDescriptor } from "@kan/plugin-contract";

/**
 * Credencial de corta duración para que el browser abra el WebSocket de una
 * sesión de voz en tiempo real directo contra el proveedor (ADR-044) — nunca
 * la API key real. `model`/`wsUrl` viajan junto al token porque el cliente
 * los necesita para conectar, no están hardcodeados en el browser.
 */
export interface LiveSessionConfig {
  model: string;
  wsUrl: string;
  token: string;
  expiresAt: string;
}

/**
 * Puerto angosto a propósito (ADR-044): lo único que corre del lado del
 * servidor en una sesión de voz en tiempo real es mintear esta credencial,
 * con el system prompt y las tools ya bloqueados adentro — la sesión en sí
 * (audio bidireccional, tool calls) es inherentemente del browser, no algo
 * que este puerto pueda o deba abstraer.
 */
export interface LiveSessionPort {
  createSession(systemPrompt: string, tools: ToolDescriptor[]): Promise<LiveSessionConfig>;
}
