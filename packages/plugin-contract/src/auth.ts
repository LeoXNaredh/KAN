import { timingSafeEqual } from "node:crypto";

/**
 * Compara dos tokens en tiempo constante (hallazgo M2 de docs/13-auditoria-v0.1.md).
 * Un `!==` normal es vulnerable a timing attack en teoría; el impacto real es
 * bajo mientras el Gateway solo escuche en localhost, pero es una línea barata
 * de arreglar y queda lista para cuando eso deje de ser cierto.
 */
export function safeCompareToken(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
