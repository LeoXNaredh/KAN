import type { HttpRequestOptions, HttpResponse, HttpTransportPort } from "../HttpTransportPort";

export interface FakeHttpEndpointConfig {
  /** Si es `false`, checkReachable() da false (simula un endpoint inalcanzable). */
  reachable?: boolean;
  handler?: (options: HttpRequestOptions) => HttpResponse;
}

/**
 * Endpoint HTTP simulado en memoria para tests del plugin (mismo rol que
 * FakeMqttTransport) — nunca usado para probar el transporte real, eso lo
 * cubre FetchHttpTransport.test.ts contra un http.createServer real
 * (ADR-012).
 */
export class FakeHttpTransport implements HttpTransportPort {
  public readonly requests: Array<{ baseUrl: string; options: HttpRequestOptions }> = [];

  constructor(private readonly endpoints: Record<string, FakeHttpEndpointConfig> = {}) {}

  async checkReachable(baseUrl: string): Promise<boolean> {
    return this.endpoints[baseUrl]?.reachable !== false;
  }

  async request(baseUrl: string, options: HttpRequestOptions): Promise<HttpResponse> {
    this.requests.push({ baseUrl, options });
    const handler = this.endpoints[baseUrl]?.handler;
    if (handler) return handler(options);
    return { status: 200, body: {} };
  }
}
