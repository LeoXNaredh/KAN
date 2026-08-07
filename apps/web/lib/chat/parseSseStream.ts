import { parseSseChunk } from "@kan/core";

/**
 * Consumo de streaming SSE del lado del navegador (ADR-027/030, docs/16 P7,
 * docs/18). `parseSseChunk` vive en `@kan/core` — compartida con un futuro
 * cliente móvil (roadmap P7); esto solo re-exporta y agrega la parte atada
 * al `Response`/`ReadableStream` del navegador, que sí es específica de
 * cada plataforma.
 */
export { parseSseChunk };

export async function* readSseStream<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseSseChunk<T>(buffer);
    buffer = remainder;
    for (const event of events) yield event;
  }
}
