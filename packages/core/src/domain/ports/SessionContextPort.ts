/**
 * Contexto de sesión (P05 del prompt maestro, ADR-055): qué dispositivo,
 * proyecto o tarea tiene el usuario activo AHORA MISMO — distinto de
 * MemoryContextPort, que guarda hechos de largo plazo entre conversaciones.
 * Puerto angosto sin `userId` — igual criterio que MemoryContextPort: quien
 * lo inyecta ya lo construye pre-escopeado (ver SessionContext).
 */
export interface SessionContextPort {
  getActiveDevice(): Promise<string | undefined>;
  setActiveDevice(deviceId: string): Promise<void>;
  getActiveProject(): Promise<string | undefined>;
  setActiveProject(projectId: string): Promise<void>;
  getCurrentTask(): Promise<string | undefined>;
  setCurrentTask(task: string): Promise<void>;
  /** Borra los tres campos — sin uso automático todavía (ver ADR-055), disponible para cuando exista una señal clara de "nueva sesión". */
  clear(): Promise<void>;
}
