/**
 * Abstracción de un cliente HTTP contra un endpoint ya configurado (nunca
 * uno arbitrario elegido en la conversación — ver README). Igual que
 * MqttTransportPort/BluetoothTransportPort en los plugins hermanos:
 * testeable sin red real con un fake (ver infra/FakeHttpTransport.ts). La
 * implementación real (infra/FetchHttpTransport.ts) usa `fetch` nativo, sin
 * dependencia nueva.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpAuthHeader {
  name: string;
  value: string;
}

export interface HttpRequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  authHeader?: HttpAuthHeader;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface HttpTransportPort {
  request(baseUrl: string, options: HttpRequestOptions): Promise<HttpResponse>;
  /** true si `baseUrl` responde algo (cualquier status HTTP) — nunca lanza. */
  checkReachable(baseUrl: string, timeoutMs: number): Promise<boolean>;
}
