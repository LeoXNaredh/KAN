import type { PortInfo, RawSerialConnection, RawSerialConnectionState, RawSerialTransportPort } from "../RawSerialTransportPort";

const CTRL_A = 0x01;
const CTRL_B = 0x02;
const CTRL_C = 0x03;
const CTRL_D = 0x04;
const RAW_REPL_BANNER = Buffer.from("raw REPL; CTRL-B to exit\r\n>");
const OK = Buffer.from("OK");

/**
 * Dispositivo serial simulado (ADR-012: probar contra un "cliente real" en
 * vez de mockear la lógica interna) — cada `write()` del host recibe un
 * buffer crudo, el fake decide qué responder, igual que respondería el
 * firmware real sobre UART.
 */
export interface FakeRawDevice {
  path: string;
  manufacturer?: string;
  handle(written: Buffer): Buffer | undefined;
}

export class FakeRawSerialTransport implements RawSerialTransportPort {
  constructor(private readonly devices: FakeRawDevice[]) {}

  async list(): Promise<PortInfo[]> {
    return this.devices.map((device) => ({ path: device.path, manufacturer: device.manufacturer }));
  }

  async open(path: string, _baudRate: number): Promise<RawSerialConnection> {
    const device = this.devices.find((d) => d.path === path);
    if (!device) throw new Error(`Puerto no encontrado: ${path}`);

    let state: RawSerialConnectionState = "connected";
    const dataHandlers = new Set<(chunk: Buffer) => void>();

    return {
      get state() {
        return state;
      },
      write: (data: Buffer) => {
        if (state !== "connected") return;
        const response = device.handle(data);
        if (response && response.length > 0) {
          queueMicrotask(() => {
            if (state !== "connected") return;
            for (const handler of dataHandlers) handler(response);
          });
        }
      },
      onData: (handler: (chunk: Buffer) => void) => {
        dataHandlers.add(handler);
        return () => dataHandlers.delete(handler);
      },
      close: async () => {
        state = "disconnected";
      },
    };
  }
}

/**
 * Simula un board MicroPython real: entra/sale de raw REPL con
 * Ctrl-A/Ctrl-B, y ejecuta el subconjunto de operaciones que
 * `snippets.ts` genera (list/read/write) contra un filesystem en memoria —
 * reconocidas por el comentario `#KAN_OP ...` que encabeza cada script (un
 * device real lo ignora, es un comentario Python válido; este fake lo usa
 * para no tener que interpretar Python de verdad).
 */
export class FakeMicroPythonDevice implements FakeRawDevice {
  private rawMode = false;
  private readonly fs: Map<string, Buffer>;

  constructor(
    public readonly path: string,
    initialFiles: Record<string, string> = {},
    public readonly manufacturer?: string,
  ) {
    this.fs = new Map(Object.entries(initialFiles).map(([file, content]) => [file, Buffer.from(content, "utf-8")]));
  }

  handle(written: Buffer): Buffer | undefined {
    if (written.length === 1 && written[0] === CTRL_A) {
      this.rawMode = true;
      return Buffer.concat([Buffer.from("\r\n"), RAW_REPL_BANNER]);
    }
    if (written.length === 1 && written[0] === CTRL_B) {
      this.rawMode = false;
      return Buffer.from("\r\n>>> ");
    }
    if (written.length === 1 && written[0] === CTRL_C) {
      return undefined;
    }
    if (this.rawMode && written.length > 0 && written[written.length - 1] === CTRL_D) {
      const code = written.subarray(0, -1).toString("utf-8");
      const { stdout, stderr } = this.execute(code);
      return Buffer.concat([OK, stdout, Buffer.from([CTRL_D]), stderr, Buffer.from([CTRL_D]), Buffer.from(">")]);
    }
    return undefined;
  }

  private execute(code: string): { stdout: Buffer; stderr: Buffer } {
    const firstLine = code.split("\n", 1)[0];
    const match = /^#KAN_OP (\w+)(?: (.*))?$/.exec(firstLine);
    if (!match) {
      return { stdout: Buffer.alloc(0), stderr: Buffer.from("Traceback: comando desconocido\n") };
    }
    const op = match[1];
    const rest = match[2] ?? "";

    if (op === "list") {
      const lines = Array.from(this.fs.entries()).map(([file, content]) => `${file} ${content.byteLength}`);
      return { stdout: Buffer.from(lines.join("\n")), stderr: Buffer.alloc(0) };
    }

    if (op === "read") {
      const filePath = rest.trim();
      const content = this.fs.get(filePath);
      if (!content) {
        return { stdout: Buffer.alloc(0), stderr: Buffer.from(`OSError: [Errno 2] ENOENT: '${filePath}'\n`) };
      }
      return { stdout: Buffer.from(content.toString("base64")), stderr: Buffer.alloc(0) };
    }

    if (op === "write") {
      const spaceIndex = rest.indexOf(" ");
      const filePath = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
      const base64Content = spaceIndex === -1 ? "" : rest.slice(spaceIndex + 1);
      this.fs.set(filePath, Buffer.from(base64Content, "base64"));
      return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }

    return { stdout: Buffer.alloc(0), stderr: Buffer.from(`Traceback: operación desconocida '${op}'\n`) };
  }

  /** Para asserts en tests — qué quedó guardado tras un project_restore_snapshot. */
  readFileSync(path: string): string | undefined {
    return this.fs.get(path)?.toString("utf-8");
  }
}
