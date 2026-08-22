import { mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalProcessPort } from "./externalProcess";
import { runOrThrow } from "./externalProcess";

export type FlashTool = "esptool" | "avrdude";

export interface FlashToolConfig {
  tool: FlashTool;
  port: string;
  timeoutMs: number;
  /** esptool: chip target (`--chip`), default `esp32`. */
  chip?: string;
  /** esptool: cuántos bytes leer de flash (`read_flash` no acepta "todo", hay que darle un tamaño), default 4 MiB. */
  flashSizeBytes?: number;
  /** avrdude: programador (`-c`), default `arduino`. */
  programmer?: string;
  /** avrdude: variante de chip (`-p`), default `atmega328p`. */
  part?: string;
  /** avrdude: baud rate (`-b`), default `115200`. */
  baudRate?: string;
}

const DEFAULT_CHIP = "esp32";
const DEFAULT_FLASH_SIZE_BYTES = 4 * 1024 * 1024;
const DEFAULT_PROGRAMMER = "arduino";
const DEFAULT_PART = "atmega328p";
const DEFAULT_BAUD_RATE = "115200";

async function withTempImageFile<T>(fn: (filePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "kan-flash-"));
  const filePath = join(dir, "image.bin");
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Dump completo del flash (docs/06, Plataforma B nivel 2) — "restaurable
 * pero no legible como código" (a diferencia del `.ino` de nivel 1). Tanto
 * `esptool.py` como `avrdude` escriben el resultado a un archivo real, nunca
 * a stdout: evita depender de que `ManagedProcess`/`ExternalProcessPort`
 * capturen stdout binario (hoy no lo hacen — solo stderr, para logs).
 */
export async function readFlashImage(externalProcess: ExternalProcessPort, config: FlashToolConfig): Promise<Buffer> {
  return withTempImageFile(async (filePath) => {
    if (config.tool === "esptool") {
      const chip = config.chip ?? DEFAULT_CHIP;
      const sizeHex = `0x${(config.flashSizeBytes ?? DEFAULT_FLASH_SIZE_BYTES).toString(16)}`;
      await runOrThrow(
        externalProcess,
        "esptool.py",
        ["--chip", chip, "--port", config.port, "read_flash", "0x0", sizeHex, filePath],
        { timeoutMs: config.timeoutMs },
      );
    } else {
      await runOrThrow(externalProcess, "avrdude", buildAvrdudeArgs(config, `flash:r:${filePath}:raw`), {
        timeoutMs: config.timeoutMs,
      });
    }
    return fsReadFile(filePath);
  });
}

export async function writeFlashImage(externalProcess: ExternalProcessPort, config: FlashToolConfig, image: Buffer): Promise<void> {
  return withTempImageFile(async (filePath) => {
    await fsWriteFile(filePath, image);
    if (config.tool === "esptool") {
      const chip = config.chip ?? DEFAULT_CHIP;
      await runOrThrow(externalProcess, "esptool.py", ["--chip", chip, "--port", config.port, "write_flash", "0x0", filePath], {
        timeoutMs: config.timeoutMs,
      });
    } else {
      await runOrThrow(externalProcess, "avrdude", buildAvrdudeArgs(config, `flash:w:${filePath}:raw`), {
        timeoutMs: config.timeoutMs,
      });
    }
  });
}

function buildAvrdudeArgs(config: FlashToolConfig, memoryOperation: string): string[] {
  return [
    "-c",
    config.programmer ?? DEFAULT_PROGRAMMER,
    "-p",
    config.part ?? DEFAULT_PART,
    "-P",
    config.port,
    "-b",
    config.baudRate ?? DEFAULT_BAUD_RATE,
    "-U",
    memoryOperation,
  ];
}

/**
 * Resuelve la config de flasheo desde variables de entorno — configuración
 * de una vez por instalación (misma placa siempre), no por request, mismo
 * criterio que `KAN_ESP32_WIFI_HOSTS`. `KAN_ESP32_FLASH_TOOL` default
 * `esptool` (encaja con el resto del plugin, pensado ESP32-first);
 * cambiala a `avrdude` para un Arduino AVR clásico (Uno/Nano/Mega, sin
 * WiFi).
 */
export function resolveFlashToolConfig(port: string, timeoutMs: number): FlashToolConfig {
  return {
    tool: process.env.KAN_ESP32_FLASH_TOOL === "avrdude" ? "avrdude" : "esptool",
    port,
    timeoutMs,
    chip: process.env.KAN_ESP32_ESPTOOL_CHIP,
    flashSizeBytes: process.env.KAN_ESP32_FLASH_SIZE_BYTES ? Number(process.env.KAN_ESP32_FLASH_SIZE_BYTES) : undefined,
    programmer: process.env.KAN_ESP32_AVRDUDE_PROGRAMMER,
    part: process.env.KAN_ESP32_AVRDUDE_PART,
    baudRate: process.env.KAN_ESP32_AVRDUDE_BAUD,
  };
}
