import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SshDevicePlugin } from "./index";
import { FakeSshTransport } from "./infra/FakeSshTransport";

const HOST_ENTRY = "pc1|192.168.1.10:22|kan|password|secreto";

describe("SshDevicePlugin", () => {
  const originalHosts = process.env.KAN_SSH_HOSTS;

  afterEach(() => {
    if (originalHosts === undefined) delete process.env.KAN_SSH_HOSTS;
    else process.env.KAN_SSH_HOSTS = originalHosts;
  });

  beforeEach(() => {
    delete process.env.KAN_SSH_HOSTS;
  });

  it("discover() devuelve lista vacía sin KAN_SSH_HOSTS configurado (allowlist obligatoria)", async () => {
    const plugin = new SshDevicePlugin(new FakeSshTransport());
    expect(await plugin.discover()).toEqual([]);
  });

  it("discover() reporta solo los hosts alcanzables, ignora los que rechazan la conexión", async () => {
    process.env.KAN_SSH_HOSTS = `${HOST_ENTRY},roto|192.168.1.99:22|kan|password|secreto`;
    const transport = new FakeSshTransport({ "192.168.1.99:22": { reachable: false } });
    const plugin = new SshDevicePlugin(transport);

    const devices = await plugin.discover();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toContain("pc1");
    expect(devices[0].name).toContain("kan@192.168.1.10:22");
  });

  it("el nombre del dispositivo nunca incluye la contraseña", async () => {
    process.env.KAN_SSH_HOSTS = HOST_ENTRY;
    const plugin = new SshDevicePlugin(new FakeSshTransport());

    const [device] = await plugin.discover();
    expect(device.name).not.toContain("secreto");
  });

  it("discover() ignora entradas sin auth (menos de 4 partes)", async () => {
    process.env.KAN_SSH_HOSTS = `malo|192.168.1.1:22|kan,ok|${HOST_ENTRY.split("|").slice(1).join("|")}`;
    const plugin = new SshDevicePlugin(new FakeSshTransport());

    // "ok" reusa host/auth de HOST_ENTRY pero con nombre distinto — igual debe descubrirse.
    const devices = await plugin.discover();
    expect(devices.map((d) => d.id)).toEqual(["ssh_ok"]);
  });

  it("discover() ignora entradas con un método de auth desconocido", async () => {
    process.env.KAN_SSH_HOSTS = "malo|192.168.1.1:22|kan|huella_digital|x";
    const plugin = new SshDevicePlugin(new FakeSshTransport());

    expect(await plugin.discover()).toEqual([]);
  });

  it("sin puerto explícito, usa el default 22", async () => {
    process.env.KAN_SSH_HOSTS = "pc1|192.168.1.10|kan|password|secreto";
    const plugin = new SshDevicePlugin(new FakeSshTransport());

    const [device] = await plugin.discover();
    expect(device.name).toContain("192.168.1.10:22");
  });

  it("soporta auth por clave (con y sin passphrase) además de password", async () => {
    process.env.KAN_SSH_HOSTS = "pc1|192.168.1.10:22|kan|key|/home/kan/.ssh/id_ed25519,pc2|192.168.1.11:22|kan|key|/home/kan/.ssh/id_rsa|frase-secreta";
    const plugin = new SshDevicePlugin(new FakeSshTransport());

    const devices = await plugin.discover();
    expect(devices).toHaveLength(2);
  });

  it("expone 4 capabilities con la severidad correcta — execute_command y write_file en el techo (safety-critical)", () => {
    const plugin = new SshDevicePlugin(new FakeSshTransport());
    const capabilities = plugin.getCapabilities("any");

    expect(capabilities.map((c) => c.name)).toEqual(["execute_command", "read_file", "write_file", "list_directory"]);
    expect(capabilities.map((c) => c.severity)).toEqual(["safety-critical", "read-only", "safety-critical", "read-only"]);
    expect(capabilities.find((c) => c.name === "execute_command")?.targetParam).toBe("command");
    expect(capabilities.find((c) => c.name === "write_file")?.targetParam).toBe("path");
  });

  it("invoke() sobre un dispositivo nunca descubierto da error claro", async () => {
    const plugin = new SshDevicePlugin(new FakeSshTransport());
    const result = await plugin.invoke("ssh_desconocido", "execute_command", { command: "ls" });
    expect(result).toEqual({ success: false, error: "Dispositivo desconocido: ssh_desconocido" });
  });

  describe("con un host descubierto y conectado", () => {
    let plugin: SshDevicePlugin;
    let deviceId: string;

    beforeEach(async () => {
      process.env.KAN_SSH_HOSTS = HOST_ENTRY;
      const transport = new FakeSshTransport({
        "192.168.1.10:22": {
          commandHandler: (command) => {
            if (command === "whoami") return { stdout: "kan\n", stderr: "", exitCode: 0 };
            if (command === "false") return { stdout: "", stderr: "", exitCode: 1 };
            return { stdout: "", stderr: `comando desconocido: ${command}`, exitCode: 127 };
          },
          files: { "/etc/hostname": "mi-pc\n" },
          directories: {
            "/home/kan": [
              { name: "archivo.txt", isDirectory: false },
              { name: "carpeta", isDirectory: true },
            ],
          },
        },
      });
      plugin = new SshDevicePlugin(transport);
      const [device] = await plugin.discover();
      deviceId = device.id;
      await plugin.connect(deviceId);
    });

    it("execute_command devuelve stdout/stderr/exitCode reales", async () => {
      const result = await plugin.invoke(deviceId, "execute_command", { command: "whoami" });
      expect(result).toEqual({ success: true, data: { stdout: "kan\n", stderr: "", exitCode: 0 } });
    });

    it("execute_command con exit code distinto de 0 sigue siendo success:true (el comando corrió, solo falló)", async () => {
      const result = await plugin.invoke(deviceId, "execute_command", { command: "false" });
      expect(result).toEqual({ success: true, data: { stdout: "", stderr: "", exitCode: 1 } });
    });

    it("read_file devuelve el contenido real", async () => {
      const result = await plugin.invoke(deviceId, "read_file", { path: "/etc/hostname" });
      expect(result).toEqual({ success: true, data: { content: "mi-pc\n" } });
    });

    it("read_file sobre un archivo inexistente da error claro, no throw", async () => {
      const result = await plugin.invoke(deviceId, "read_file", { path: "/no/existe" });
      expect(result.success).toBe(false);
    });

    it("write_file escribe y read_file posterior confirma el contenido", async () => {
      const writeResult = await plugin.invoke(deviceId, "write_file", { path: "/tmp/nuevo.txt", content: "hola KAN" });
      expect(writeResult).toEqual({ success: true, data: {} });

      const readResult = await plugin.invoke(deviceId, "read_file", { path: "/tmp/nuevo.txt" });
      expect(readResult).toEqual({ success: true, data: { content: "hola KAN" } });
    });

    it("write_file rechaza sin 'content' string", async () => {
      const result = await plugin.invoke(deviceId, "write_file", { path: "/tmp/x" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/content/);
    });

    it("list_directory devuelve las entradas reales con isDirectory correcto", async () => {
      const result = await plugin.invoke(deviceId, "list_directory", { path: "/home/kan" });
      expect(result.success).toBe(true);
      const entries = (result.data as { entries: Array<{ name: string; isDirectory: boolean }> }).entries;
      expect(entries).toEqual([
        { name: "archivo.txt", isDirectory: false },
        { name: "carpeta", isDirectory: true },
      ]);
    });

    it("execute_command/read_file/write_file/list_directory rechazan sin el campo requerido", async () => {
      const results = await Promise.all([
        plugin.invoke(deviceId, "execute_command", {}),
        plugin.invoke(deviceId, "read_file", {}),
        plugin.invoke(deviceId, "write_file", { content: "x" }),
        plugin.invoke(deviceId, "list_directory", {}),
      ]);
      results.forEach((result) => expect(result.success).toBe(false));
    });

    it("invoke rechaza una capability desconocida", async () => {
      const result = await plugin.invoke(deviceId, "no_existe", { command: "ls" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/desconocida/);
    });

    it("execute_command/read_file fallan con error claro si el dispositivo está desconectado", async () => {
      await plugin.disconnect(deviceId);

      const results = await Promise.all([
        plugin.invoke(deviceId, "execute_command", { command: "whoami" }),
        plugin.invoke(deviceId, "read_file", { path: "/etc/hostname" }),
      ]);
      results.forEach((result) => expect(result).toEqual({ success: false, error: "Dispositivo no conectado" }));
    });
  });
});
