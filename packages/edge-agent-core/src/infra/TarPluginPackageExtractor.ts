import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import type { PluginPackageExtractorPort } from "../domain/ports/PluginPackageExtractorPort";

/** Único módulo que toca `tar` real (ADR-056) — el formato de paquete de un plugin sidecar es `.tar.gz`. */
export class TarPluginPackageExtractor implements PluginPackageExtractorPort {
  async extract(archive: Buffer, destDir: string): Promise<void> {
    await mkdir(destDir, { recursive: true });
    await pipeline(Readable.from(archive), tar.x({ cwd: destDir }));
  }
}
