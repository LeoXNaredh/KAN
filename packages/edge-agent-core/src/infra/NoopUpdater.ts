import type { UpdateCheckResult, UpdaterPort } from "../domain/ports/UpdaterPort";

/** Placeholder hasta que exista infraestructura de releases (ver requisito 13). */
export class NoopUpdater implements UpdaterPort {
  async checkForUpdates(): Promise<UpdateCheckResult> {
    return { updateAvailable: false };
  }
}
