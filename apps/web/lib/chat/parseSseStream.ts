/**
 * Parseo de Server-Sent Events del `/api/chat` (ADR-027, docs/16 P7) —
 * primer consumidor de streaming del repo. `parseSseChunk` queda separado y
 * puro (sin tocar `fetch`/`ReadableStream`) para poder testearse aislado el
 * día que `apps/web` tenga un test runner configurado.
 */
export function parseSseChunk<T>(buffer: string): { events: T[]; remainder: string } {
  const parts = buffer.split("\n\n");
  // El último elemento puede ser un chunk incompleto (todavía sin el \n\n
  // final) — se conserva para completarlo con el próximo `read()`.
  const remainder = parts.pop() ?? "";

  const events: T[] = [];
  for (const part of parts) {
    const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    try {
      events.push(JSON.parse(dataLine.slice("data: ".length)) as T);
    } catch {
      // Chunk malformado — se ignora, no se rompe el resto del stream.
    }
  }
  return { events, remainder };
}

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
