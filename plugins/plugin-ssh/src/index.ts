import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { SshAuth, SshConnection, SshTarget, SshTransportPort } from "./SshTransportPort";
import { NodeSshTransport } from "./infra/NodeSshTransport";

const DISCOVER_TIMEOUT_MS = 5000;
const DEFAULT_PORT = 22;

interface HostConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeDeviceId(raw: string): string {
  return `ssh_${raw.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function parseAuth(rawParts: string[]): SshAuth | undefined {
  const [kind, ...rest] = rawParts;
  if (kind === "password") {
    const [password] = rest;
    return password ? { kind: "password", value: password } : undefined;
  }
  if (kind === "key") {
    const [path, passphrase] = rest;
    return path ? { kind: "key", value: path, passphrase } : undefined;
  }
  return undefined;
}

/**
 * `KAN_SSH_HOSTS`: `nombre|host:puerto|usuario|auth` separados por coma,
 * donde `auth` es `key|/ruta/a/clave/privada[|passphrase]` o
 * `password|contraseña` (desalentado, pero soportado). **Esta variable es
 * obligatoria** — a diferencia del resto de los plugins de red, acá no
 * hay ningún modo "sin config, sin dispositivos pero el plugin igual
 * carga" que valga la pena destacar aparte: sin ella, este plugin
 * literalmente no puede hacer nada, por diseño (ver README).
 *
 * Se separa el string de auth por `|` en vez de `:` para no chocar con
 * rutas de Windows tipo `C:\ruta\clave` (que ya tienen dos puntos).
 */
function parseHosts(raw: string | undefined): HostConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): HostConfig | undefined => {
      const parts = entry.split("|");
      if (parts.length < 4) return undefined;
      const [name, hostPort, username, ...authParts] = parts;
      if (!name || !hostPort || !username) return undefined;

      const [host, portStr] = hostPort.split(":");
      const port = portStr ? Number(portStr) : DEFAULT_PORT;
      if (!host || !Number.isFinite(port)) return undefined;

      const auth = parseAuth(authParts);
      if (!auth) return undefined;

      return { name, host, port, username, auth };
    })
    .filter((config): config is HostConfig => config !== undefined);
}

function validatePath(input: unknown): ValidationResult<string> {
  const path = (input as { path?: unknown } | null)?.path;
  if (typeof path !== "string" || !path.trim()) return fail("'path' debe ser un string no vacío");
  return ok(path);
}

function validateCommand(input: unknown): ValidationResult<string> {
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== "string" || !command.trim()) return fail("'command' debe ser un string no vacío");
  return ok(command);
}

/**
 * Plugin de control remoto por SSH — la superficie de riesgo más grande
 * de todo el mapa de hardware de KAN: a diferencia de un pin GPIO o un
 * registro Modbus, un comando SSH puede hacer literalmente cualquier cosa
 * en la máquina remota. Por eso:
 *
 * - `KAN_SSH_HOSTS` es obligatoria y nunca se escanea — el host, usuario
 *   y método de auth los fija la config, nunca la conversación.
 * - `execute_command` es `safety-critical` (el techo del sistema) por
 *   defecto para CUALQUIER comando no clasificado explícitamente en
 *   Safety Policy. El target es el string completo del comando, no el
 *   programa/primer token — clasificar "ls -la /home" como reversible NO
 *   cubre "ls -la /tmp" ni ningún otro comando distinto, ni por
 *   casualidad ni por diseño: cada aprobación es para el comando exacto
 *   que el usuario revisó, no un patrón.
 * - `write_file` TAMBIÉN es `safety-critical`, no solo
 *   `irreversible-material` — escribir un archivo arbitrario en una
 *   máquina remota (ej. `~/.ssh/authorized_keys`, un crontab, un service
 *   de systemd) es tan peligroso como ejecutar código directo
 *   (persistencia/escalamiento de privilegios), así que comparte el techo
 *   con `execute_command` en vez de quedar en un nivel intermedio.
 * - `read_file`/`list_directory` son read-only (no cambian estado en la
 *   máquina remota) — el riesgo de confidencialidad de leer un archivo
 *   sensible (ej. una clave privada) no lo cubre este sistema de
 *   severidad, que es sobre reversibilidad de acciones físicas/de
 *   estado, no sobre confidencialidad; ese riesgo se mitiga en la config
 *   (qué hosts/usuarios se permiten), no por confirmación.
 */
export class SshDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "ssh";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-ssh",
    version: "0.1.0",
    displayName: "SSH (control remoto de PCs)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["ssh"], network: true, filesystem: [] }),
  };

  private readonly hosts = new Map<string, HostConfig>();
  private readonly connections = new Map<string, SshConnection>();

  constructor(private readonly transport: SshTransportPort = new NodeSshTransport()) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    const configs = parseHosts(process.env.KAN_SSH_HOSTS);
    const results = await Promise.all(
      configs.map(async (config) => {
        try {
          const target: SshTarget = { host: config.host, port: config.port, username: config.username, auth: config.auth };
          const connection = await this.transport.connect(target, { connectTimeoutMs: DISCOVER_TIMEOUT_MS });
          await connection.close();
          const id = sanitizeDeviceId(config.name);
          this.hosts.set(id, config);
          return { id, name: `SSH (${config.name}, ${config.username}@${config.host}:${config.port})`, kind: this.kind };
        } catch {
          return undefined;
        }
      }),
    );
    return results.filter((device): device is DeviceDescriptor => device !== undefined);
  }

  async connect(deviceId: string): Promise<void> {
    const config = this.hosts.get(deviceId);
    if (!config) throw new Error(`Dispositivo desconocido: ${deviceId}`);
    const target: SshTarget = { host: config.host, port: config.port, username: config.username, auth: config.auth };
    const connection = await this.transport.connect(target);
    this.connections.set(deviceId, connection);
  }

  async disconnect(deviceId: string): Promise<void> {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    await connection.close();
    this.connections.delete(deviceId);
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "execute_command",
        description: "Ejecuta un comando shell en la máquina remota — puede hacer cualquier cosa, sin restricciones.",
        severity: "safety-critical",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" }, timeoutMs: { type: "number" } },
          required: ["command"],
        },
        targetParam: "command",
      }),
      defineCapability({
        name: "read_file",
        description: "Lee el contenido de un archivo de texto en la máquina remota.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        targetParam: "path",
      }),
      defineCapability({
        name: "write_file",
        description: "Escribe (sobrescribe) un archivo de texto en la máquina remota — riesgo equivalente a ejecutar código.",
        severity: "safety-critical",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
        targetParam: "path",
      }),
      defineCapability({
        name: "list_directory",
        description: "Lista el contenido de un directorio en la máquina remota.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        targetParam: "path",
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (!this.hosts.has(deviceId)) return { success: false, error: `Dispositivo desconocido: ${deviceId}` };

    switch (capabilityName) {
      case "execute_command": {
        const command = validateCommand(input);
        if (!command.ok) return { success: false, error: command.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        const timeoutMs = (input as { timeoutMs?: unknown } | null)?.timeoutMs;
        try {
          const result = await connection.executeCommand(command.value, typeof timeoutMs === "number" ? timeoutMs : undefined);
          return { success: true, data: result };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "read_file": {
        const path = validatePath(input);
        if (!path.ok) return { success: false, error: path.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          const content = await connection.readFile(path.value);
          return { success: true, data: { content } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "write_file": {
        const path = validatePath(input);
        if (!path.ok) return { success: false, error: path.error };
        const content = (input as { content?: unknown } | null)?.content;
        if (typeof content !== "string") return { success: false, error: "'content' debe ser un string" };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          await connection.writeFile(path.value, content);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "list_directory": {
        const path = validatePath(input);
        if (!path.ok) return { success: false, error: path.error };
        const connection = this.connections.get(deviceId);
        if (!connection) return { success: false, error: "Dispositivo no conectado" };

        try {
          const entries = await connection.listDirectory(path.value);
          return { success: true, data: { entries } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }
}

export type { SshAuth, SshCommandResult, SshConnectOptions, SshConnection, SshDirectoryEntry, SshTarget, SshTransportPort } from "./SshTransportPort";
export { NodeSshTransport } from "./infra/NodeSshTransport";
export { FakeSshTransport, type FakeSshHostConfig } from "./infra/FakeSshTransport";
