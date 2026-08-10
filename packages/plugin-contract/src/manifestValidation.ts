import Ajv from "ajv";
import type { PluginManifest } from "./manifest";

const ajv = new Ajv({ allErrors: true, strict: false });

const PLUGIN_MANIFEST_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    displayName: { type: "string", minLength: 1 },
    kind: { enum: ["device-driver", "integration", "processing"] },
    runtime: { enum: ["in-process-ts", "python-sidecar"] },
    permissions: {
      type: "object",
      properties: {
        devices: { type: "array", items: { type: "string" } },
        network: { type: "boolean" },
        filesystem: { type: "array", items: { type: "string" } },
      },
      required: ["devices", "network", "filesystem"],
    },
    signature: { type: "string" },
  },
  required: ["id", "version", "displayName", "kind", "runtime", "permissions"],
} as const;

const validate = ajv.compile(PLUGIN_MANIFEST_SCHEMA);

export type ManifestValidationResult = { ok: true; manifest: PluginManifest } | { ok: false; error: string };

/**
 * Defensa en profundidad para `PluginInstaller` (ADR-056, Fase 3): no
 * confía ciegamente en el `manifest.json` de un paquete descargado (ni en
 * el `manifest` embebido en la fila del catálogo, Fase 4) antes de
 * registrarlo — valida forma y tipos básicos, mismo criterio que
 * `validateAgainstSchema` para el input de una capability. No es
 * verificación criptográfica (`signature` sigue siendo placeholder, ver
 * `manifest.ts`) — es la capa que sí existe hoy.
 */
export function validatePluginManifest(data: unknown): ManifestValidationResult {
  if (!validate(data)) {
    const message = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "manifest"} ${error.message ?? "es inválido"}`.trim())
      .join("; ");
    return { ok: false, error: `Manifest inválido: ${message || "no cumple el schema esperado"}` };
  }
  return { ok: true, manifest: data as PluginManifest };
}
