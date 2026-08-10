/** Extrae un paquete de plugin sidecar (`.tar.gz`) a un directorio destino ya existente (ADR-056). */
export interface PluginPackageExtractorPort {
  extract(archive: Buffer, destDir: string): Promise<void>;
}
