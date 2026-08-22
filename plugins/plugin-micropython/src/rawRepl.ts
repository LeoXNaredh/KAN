import type { RawSerialConnection } from "./RawSerialTransportPort";

const CTRL_A = Buffer.from([0x01]);
const CTRL_B = Buffer.from([0x02]);
const CTRL_C = Buffer.from([0x03]);
const CTRL_D = Buffer.from([0x04]);
const RAW_REPL_BANNER = Buffer.from("raw REPL; CTRL-B to exit\r\n>");
const OK_ACK = Buffer.from("OK");

export class RawReplTimeoutError extends Error {}

/** El script devolvió algo por stderr (traceback de Python) — `stderr` trae el texto tal cual lo mandó el device. */
export class RawReplExecError extends Error {
  constructor(public readonly stderr: string) {
    super(`El dispositivo devolvió un error: ${stderr.trim()}`);
  }
}

/**
 * Buffer de bytes recibidos por la conexión, con espera por un terminador
 * exacto (`readUntil`) o por N bytes (`readExact`) — necesario porque el
 * raw REPL de MicroPython no es línea-por-línea (ver `RawSerialConnection`):
 * la respuesta a un `exec()` es `OK<stdout>\x04<stderr>\x04>`, con `\x04`
 * pudiendo aparecer también dentro de `<stdout>`/`<stderr>` si el script
 * hizo output binario — por eso `snippets.ts` codifica todo en base64 antes
 * de imprimirlo, nunca al revés (confiar en que el primer `\x04` que
 * aparezca es el terminador real).
 */
class ByteReader {
  private buffer = Buffer.alloc(0);
  private readonly dataListeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(connection: RawSerialConnection) {
    this.unsubscribe = connection.onData((chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (const listener of this.dataListeners) listener();
    });
  }

  async readUntil(terminator: Buffer, timeoutMs: number): Promise<Buffer> {
    const immediate = this.tryExtractUntil(terminator);
    if (immediate) return immediate;

    return new Promise((resolve, reject) => {
      const onData = () => {
        const extracted = this.tryExtractUntil(terminator);
        if (!extracted) return;
        clearTimeout(timer);
        this.dataListeners.delete(onData);
        resolve(extracted);
      };
      const timer = setTimeout(() => {
        this.dataListeners.delete(onData);
        reject(new RawReplTimeoutError(`Timeout esperando la respuesta del dispositivo (esperaba "${terminator.toString("latin1")}").`));
      }, timeoutMs);
      this.dataListeners.add(onData);
    });
  }

  async readExact(length: number, timeoutMs: number): Promise<Buffer> {
    const immediate = this.tryExtractExact(length);
    if (immediate) return immediate;

    return new Promise((resolve, reject) => {
      const onData = () => {
        const extracted = this.tryExtractExact(length);
        if (!extracted) return;
        clearTimeout(timer);
        this.dataListeners.delete(onData);
        resolve(extracted);
      };
      const timer = setTimeout(() => {
        this.dataListeners.delete(onData);
        reject(new RawReplTimeoutError(`Timeout esperando ${length} byte(s) de respuesta del dispositivo.`));
      }, timeoutMs);
      this.dataListeners.add(onData);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private tryExtractUntil(terminator: Buffer): Buffer | undefined {
    const index = this.buffer.indexOf(terminator);
    if (index === -1) return undefined;
    const result = this.buffer.subarray(0, index);
    this.buffer = this.buffer.subarray(index + terminator.length);
    return result;
  }

  private tryExtractExact(length: number): Buffer | undefined {
    if (this.buffer.length < length) return undefined;
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }
}

export interface RawReplSession {
  exec(code: string, timeoutMs: number): Promise<Buffer>;
  exit(): void;
  dispose(): void;
}

/**
 * Interrumpe lo que esté corriendo (dos Ctrl-C, mismo criterio que
 * mpremote/ampy: uno solo puede llegar en medio de una lectura de input()
 * bloqueada y no alcanzar) y entra a raw REPL (Ctrl-A). Deja al dispositivo
 * en raw REPL para toda la sesión — `MicroPythonPlugin` llama `exit()` recién
 * en `disconnect()`, no entre cada capability, para no renegociar el banner
 * en cada operación.
 */
export async function enterRawRepl(connection: RawSerialConnection, timeoutMs: number): Promise<RawReplSession> {
  const reader = new ByteReader(connection);
  connection.write(CTRL_C);
  connection.write(CTRL_C);
  connection.write(CTRL_A);
  await reader.readUntil(RAW_REPL_BANNER, timeoutMs);

  async function doExec(code: string, execTimeoutMs: number): Promise<Buffer> {
    connection.write(Buffer.concat([Buffer.from(code, "utf-8"), CTRL_D]));
    const ack = await reader.readExact(2, execTimeoutMs);
    if (!ack.equals(OK_ACK)) {
      throw new Error(`El dispositivo no confirmó la ejecución (esperaba "OK", llegó "${ack.toString("latin1")}").`);
    }
    const stdout = await reader.readUntil(CTRL_D, execTimeoutMs);
    const stderr = await reader.readUntil(CTRL_D, execTimeoutMs);
    // Prompt final ('>') — se drena best-effort, sin bloquear si no llega exacto: no cambia el resultado de este exec, solo deja la conexión lista para el próximo.
    await reader.readExact(1, 200).catch(() => undefined);
    if (stderr.length > 0) {
      throw new RawReplExecError(stderr.toString("utf-8"));
    }
    return stdout;
  }

  // El raw REPL es estrictamente de a un comando por vez (una sola conexión
  // serial, sin IDs de request) — quien llama (ej. `handleProjectCapability`
  // armando un snapshot con `Promise.all(entries.map(readFile))`) puede
  // disparar varios `exec()` en paralelo sin saber que comparten la misma
  // sesión. Encolarlos acá, no en cada caller, es lo que hace esa suposición
  // ("puedo leer archivos en paralelo") segura sin que nadie más tenga que
  // saber que el transporte de abajo es en realidad secuencial.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue(code: string, execTimeoutMs: number): Promise<Buffer> {
    const run = queue.then(() => doExec(code, execTimeoutMs));
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    exec: enqueue,
    exit(): void {
      connection.write(CTRL_B);
    },
    dispose(): void {
      reader.dispose();
    },
  };
}
