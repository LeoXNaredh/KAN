/**
 * Parseo de chunks de Server-Sent Events (ADR-030, docs/18) — extraído de
 * `apps/web` para que un futuro cliente móvil (roadmap P7) consuma el mismo
 * parser ya probado en vez de reimplementarlo. Deliberadamente puro (sin
 * tocar `fetch`/`ReadableStream`, que difieren por plataforma — ver
 * `readSseStream` en cada app consumidora) para poder testearse aislado.
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
