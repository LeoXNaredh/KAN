import type { AIProviderPort } from "@kan/core";

/**
 * Hoy solo enruta a un único proveedor configurado. La interfaz ya está lista
 * para soportar fallback entre proveedores (ver docs/05-arquitectura-ia.md,
 * sección "Model Router") sin cambiar quién la consume.
 */
export class ModelRouter implements AIProviderPort {
  constructor(private readonly primary: AIProviderPort) {}

  get providerName(): string {
    return this.primary.providerName;
  }

  chat(request: Parameters<AIProviderPort["chat"]>[0]) {
    return this.primary.chat(request);
  }
}
