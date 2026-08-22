import { mkdir, readdir, readFile as fsReadFile, stat, writeFile as fsWriteFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProjectFileEntry } from "@kan/plugin-contract";

/**
 * Guarda el/los archivo(s) fuente de un sketch Arduino localmente en el
 * Edge Agent (docs/06, Plataforma B nivel 1 — "el usuario sube su .ino").
 * No hay forma de leer código fuente de vuelta desde el chip (a diferencia
 * de MicroPython): la fuente de verdad es lo último que se guardó/restauró
 * acá, nunca lo que hay actualmente flasheado.
 *
 * arduino-cli exige que el `.ino` principal de un sketch tenga el MISMO
 * nombre que su carpeta contenedora — para no trasladarle esa convención al
 * usuario, cualquier archivo que termine en `.ino` se renombra
 * automáticamente a `<deviceId>.ino` al guardarlo. Archivos compañeros
 * (`.h`/`.cpp`, válidos pero poco frecuentes en un sketch chico) se guardan
 * tal cual, aplanando subcarpetas — un sketch Arduino no las necesita.
 */
export class SketchStore {
  constructor(private readonly baseDir: string) {}

  sketchDir(deviceId: string): string {
    return join(this.baseDir, deviceId);
  }

  mainSketchFile(deviceId: string): string {
    return `${deviceId}.ino`;
  }

  mainSketchPath(deviceId: string): string {
    return join(this.sketchDir(deviceId), this.mainSketchFile(deviceId));
  }

  async listFiles(deviceId: string): Promise<ProjectFileEntry[]> {
    const dir = this.sketchDir(deviceId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      // Sin sketch guardado todavía — lista vacía, no un error (mismo criterio que un dispositivo recién descubierto sin snapshots).
      return [];
    }
    return Promise.all(
      names.map(async (name) => {
        const stats = await stat(join(dir, name));
        return { path: name, sizeBytes: stats.size };
      }),
    );
  }

  async readFile(deviceId: string, path: string): Promise<string> {
    return fsReadFile(join(this.sketchDir(deviceId), basename(path)), "utf-8");
  }

  async writeFile(deviceId: string, path: string, content: string): Promise<void> {
    const dir = this.sketchDir(deviceId);
    await mkdir(dir, { recursive: true });
    const fileName = path.toLowerCase().endsWith(".ino") ? this.mainSketchFile(deviceId) : basename(path);
    await fsWriteFile(join(dir, fileName), content, "utf-8");
  }
}
