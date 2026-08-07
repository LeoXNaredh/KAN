import type { fetch } from "expo/fetch";
import { parseSseChunk } from "@kan/core";

/**
 * Consumo de streaming SSE del lado de React Native (ADR-030, docs/18
 * incremento 3). `parseSseChunk` es la misma función pura que ya usa
 * `apps/web` — solo esta parte (atada al `Response` que devuelve
 * `expo/fetch`, no al del navegador) es específica de la plataforma, tal
 * como anticipó ADR-030. `expo/fetch` no exporta su tipo `FetchResponse`
 * públicamente, así que se infiere con `Awaited<ReturnType<typeof fetch>>`
 * en vez de importarlo por nombre.
 */
export { parseSseChunk };

export type ExpoFetchResponse = Awaited<ReturnType<typeof fetch>>;

export async function* readSseStream<T>(response: ExpoFetchResponse): AsyncGenerator<T> {
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
