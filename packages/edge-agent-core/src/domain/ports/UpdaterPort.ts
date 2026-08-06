export interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion?: string;
}

/**
 * Seam para actualizaciones automáticas (requisito 13 del Edge Agent).
 * La implementación real (electron-updater, firma de código, canal de
 * releases) se documenta como diferida a Fase 2 de empaquetado — ver plan
 * de este incremento. `NoopUpdater` es el único adaptador por ahora.
 */
export interface UpdaterPort {
  checkForUpdates(): Promise<UpdateCheckResult>;
}
