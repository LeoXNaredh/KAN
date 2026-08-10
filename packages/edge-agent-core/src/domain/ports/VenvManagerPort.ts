export interface CreatedVenv {
  pythonExecutablePath: string;
}

/**
 * Crea el entorno Python aislado (venv puro, ADR-056 — sin Docker como
 * prerequisito en este incremento) de un plugin sidecar recién extraído,
 * e instala sus dependencias declaradas.
 */
export interface VenvManagerPort {
  create(pluginDir: string): Promise<CreatedVenv>;
  install(pythonExecutablePath: string, requirementsPath: string): Promise<void>;
}
