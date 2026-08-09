import type { HttpRequestOptions, HttpResponse, HttpTransportPort } from "../HttpTransportPort";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REACHABLE_TIMEOUT_MS = 3000;

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase);
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Cliente HTTP real sobre `fetch` nativo (Node 18+) — sin dependencia nueva.
 * `checkReachable` nunca lanza: cualquier respuesta HTTP (incluido un
 * 404/401) cuenta como "hay un servidor ahí" — mismo criterio que
 * NodeMqttTransport, que solo confirma que hay un broker real, no más que
 * eso.
 */
export class FetchHttpTransport implements HttpTransportPort {
  async request(baseUrl: string, options: HttpRequestOptions): Promise<HttpResponse> {
    const url = buildUrl(baseUrl, options.path, options.query);
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.authHeader) headers[options.authHeader.name] = options.authHeader.value;

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    return { status: response.status, body: await parseBody(response) };
  }

  async checkReachable(baseUrl: string, timeoutMs: number = DEFAULT_REACHABLE_TIMEOUT_MS): Promise<boolean> {
    try {
      await fetch(baseUrl, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
      return true;
    } catch {
      return false;
    }
  }
}
