import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, closeSync, openSync, readSync, writeSync, readdirSync, statSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";
import { Server, utils } from "ssh2";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NodeSshTransport } from "./NodeSshTransport";

const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const TEST_USER = "kan";
const TEST_PASSWORD = "correcto-caballo-batería-grapa";

/**
 * Servidor SSH real (no un mock) para probar el transporte de punta a
 * punta — mismo criterio ADR-012 que el resto de los *TransportPort.test.ts.
 * A diferencia de Modbus RTU (sin servidor disponible en la librería) o
 * SNMP (con Agent real ya provisto), `ssh2` no trae un servidor de
 * ejemplo listo para usar — este servidor de prueba implementa `exec`
 * corriendo procesos reales via `child_process`, y un subsistema SFTP
 * mínimo (OPEN/READ/WRITE/CLOSE/OPENDIR/READDIR) respaldado por un
 * directorio temporal real en disco, adaptado del ejemplo oficial del
 * paquete (examples/sftp-server-download-only.js) para soportar
 * lectura/escritura real, no solo un archivo fijo de prueba.
 */
describe("NodeSshTransport (integración real contra un servidor SSH+SFTP real)", () => {
  let server: Server;
  let port: number;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "kan-ssh-test-"));
    writeFileSync(join(tempDir, "existente.txt"), "contenido real", "utf8");

    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    server = new Server({ hostKeys: [privateKey] }, (client) => {
      client.on("authentication", (ctx) => {
        if (ctx.method === "password" && ctx.username === TEST_USER && ctx.password === TEST_PASSWORD) {
          ctx.accept();
        } else {
          ctx.reject();
        }
      });

      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();

          session.on("exec", (execAccept, _reject, info) => {
            const channel = execAccept();
            exec(info.command, (error, stdout, stderr) => {
              if (stdout) channel.stdout.write(stdout);
              if (stderr) channel.stderr.write(stderr);
              channel.exit(error?.code ?? 0);
              channel.end();
            });
          });

          session.on("sftp", (sftpAccept) => {
            const sftp = sftpAccept();
            const openFiles = new Map<number, { fd?: number; writePath?: string; dirEntries?: string[]; dirCursor: number }>();
            let handleCounter = 0;

            function toHandle(id: number): Buffer {
              const handle = Buffer.alloc(4);
              handle.writeUInt32BE(id, 0);
              return handle;
            }
            function fromHandle(handle: Buffer): number {
              return handle.readUInt32BE(0);
            }

            sftp.on("OPEN", (reqId, filename, flags) => {
              const id = handleCounter++;
              try {
                if (flags & OPEN_MODE.WRITE) {
                  openFiles.set(id, { writePath: filename, dirCursor: 0 });
                } else {
                  const fd = openSync(filename, "r");
                  openFiles.set(id, { fd, dirCursor: 0 });
                }
                sftp.handle(reqId, toHandle(id));
              } catch {
                sftp.status(reqId, STATUS_CODE.FAILURE);
              }
            });

            sftp.on("FSTAT", (reqId, handle) => {
              const state = openFiles.get(fromHandle(handle));
              if (state?.fd === undefined) {
                sftp.status(reqId, STATUS_CODE.FAILURE);
                return;
              }
              const stats = fstatSync(state.fd);
              sftp.attrs(reqId, { mode: stats.mode, uid: 0, gid: 0, size: stats.size, atime: Date.now(), mtime: Date.now() });
            });

            sftp.on("READ", (reqId, handle, offset, length) => {
              const state = openFiles.get(fromHandle(handle));
              if (!state?.fd) {
                sftp.status(reqId, STATUS_CODE.FAILURE);
                return;
              }
              const buffer = Buffer.alloc(length);
              const bytesRead = readSync(state.fd, buffer, 0, length, offset);
              if (bytesRead === 0) sftp.status(reqId, STATUS_CODE.EOF);
              else sftp.data(reqId, buffer.subarray(0, bytesRead));
            });

            sftp.on("WRITE", (reqId, handle, offset, data) => {
              const state = openFiles.get(fromHandle(handle));
              if (!state?.writePath) {
                sftp.status(reqId, STATUS_CODE.FAILURE);
                return;
              }
              try {
                const fd = openSync(state.writePath, offset === 0 ? "w" : "r+");
                writeSync(fd, data, 0, data.length, offset);
                closeSync(fd);
                sftp.status(reqId, STATUS_CODE.OK);
              } catch {
                sftp.status(reqId, STATUS_CODE.FAILURE);
              }
            });

            sftp.on("CLOSE", (reqId, handle) => {
              const id = fromHandle(handle);
              const state = openFiles.get(id);
              if (state?.fd !== undefined) closeSync(state.fd);
              openFiles.delete(id);
              sftp.status(reqId, STATUS_CODE.OK);
            });

            sftp.on("OPENDIR", (reqId, dirPath) => {
              const id = handleCounter++;
              try {
                const entries = readdirSync(dirPath);
                openFiles.set(id, { dirEntries: entries, dirCursor: 0 });
                sftp.handle(reqId, toHandle(id));
              } catch {
                sftp.status(reqId, STATUS_CODE.FAILURE);
              }
            });

            sftp.on("READDIR", (reqId, handle) => {
              const state = openFiles.get(fromHandle(handle));
              if (!state?.dirEntries || state.dirCursor >= state.dirEntries.length) {
                sftp.status(reqId, STATUS_CODE.EOF);
                return;
              }
              const filename = state.dirEntries[state.dirCursor++];
              const stats = statSync(join(tempDir, filename));
              const mode = stats.isDirectory() ? 0o040755 : 0o100644;
              sftp.name(reqId, [
                {
                  filename,
                  longname: filename,
                  attrs: { mode, uid: 0, gid: 0, size: stats.size, atime: Date.now(), mtime: Date.now() },
                },
              ]);
            });
          });
        });
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no se pudo levantar el servidor de prueba");
    port = address.port;
  });

  afterAll(() => {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("connect() real autentica por password contra un servidor real", async () => {
    const transport = new NodeSshTransport();
    const connection = await transport.connect({
      host: "127.0.0.1",
      port,
      username: TEST_USER,
      auth: { kind: "password", value: TEST_PASSWORD },
    });
    await connection.close();
  });

  it("connect() con credenciales incorrectas rechaza, no cuelga", async () => {
    const transport = new NodeSshTransport();
    await expect(
      transport.connect({ host: "127.0.0.1", port, username: TEST_USER, auth: { kind: "password", value: "mal" } }),
    ).rejects.toThrow();
  });

  it("executeCommand real corre un proceso de verdad y trae stdout/exitCode reales", async () => {
    const transport = new NodeSshTransport();
    const connection = await transport.connect({
      host: "127.0.0.1",
      port,
      username: TEST_USER,
      auth: { kind: "password", value: TEST_PASSWORD },
    });

    const result = await connection.executeCommand('node -e "process.stdout.write(String(21 + 21))"');
    expect(result.stdout.trim()).toBe("42");
    expect(result.exitCode).toBe(0);

    await connection.close();
  });

  it("executeCommand real captura un exit code distinto de cero", async () => {
    const transport = new NodeSshTransport();
    const connection = await transport.connect({
      host: "127.0.0.1",
      port,
      username: TEST_USER,
      auth: { kind: "password", value: TEST_PASSWORD },
    });

    const result = await connection.executeCommand('node -e "process.exit(7)"');
    expect(result.exitCode).toBe(7);

    await connection.close();
  });

  it("readFile real lee un archivo real del disco por SFTP", async () => {
    const transport = new NodeSshTransport();
    const connection = await transport.connect({
      host: "127.0.0.1",
      port,
      username: TEST_USER,
      auth: { kind: "password", value: TEST_PASSWORD },
    });

    const content = await connection.readFile(join(tempDir, "existente.txt"));
    expect(content).toBe("contenido real");

    await connection.close();
  });

  it("writeFile real escribe un archivo real en disco, confirmado leyéndolo con fs directo", async () => {
    const transport = new NodeSshTransport();
    const connection = await transport.connect({
      host: "127.0.0.1",
      port,
      username: TEST_USER,
      auth: { kind: "password", value: TEST_PASSWORD },
    });

    const targetPath = join(tempDir, "escrito-por-ssh.txt");
    await connection.writeFile(targetPath, "hola desde KAN por SFTP real");

    expect(readFileSync(targetPath, "utf8")).toBe("hola desde KAN por SFTP real");

    await connection.close();
  });

  it("listDirectory real lista el contenido real del directorio temporal", async () => {
    const transport = new NodeSshTransport();
    const connection = await transport.connect({
      host: "127.0.0.1",
      port,
      username: TEST_USER,
      auth: { kind: "password", value: TEST_PASSWORD },
    });

    const entries = await connection.listDirectory(tempDir);
    expect(entries.map((e) => e.name)).toContain("existente.txt");
    expect(entries.find((e) => e.name === "existente.txt")?.isDirectory).toBe(false);

    await connection.close();
  });
});
