import type { DeviceStorePort } from "../domain/ports/DeviceStorePort";
import type { KnownDeviceRecord } from "../domain/entities/KnownDevice";
import { JsonFileConfigStore } from "./JsonFileConfigStore";

const DEVICES_KEY = "devices";

/**
 * Persistencia de la memoria de dispositivos (requisito: que KAN no
 * empiece de cero en cada reinicio) — un archivo propio en el directorio de
 * datos del usuario, mismo lugar que `vid-pid-custom.json`, en vez de una
 * clave más dentro de `config.json` (no mezclar el registro de hardware
 * visto con pairing/plugin config). Reusa `JsonFileConfigStore` tal cual
 * (mismo patrón de escritura debounced/async, sin duplicarlo) — acá solo se
 * fija una única clave dentro de ese archivo.
 */
export class JsonFileDeviceStore implements DeviceStorePort {
  private readonly store: JsonFileConfigStore;

  constructor(filePath: string) {
    this.store = new JsonFileConfigStore(filePath);
  }

  load(): KnownDeviceRecord[] {
    return this.store.get<KnownDeviceRecord[]>(DEVICES_KEY) ?? [];
  }

  save(records: KnownDeviceRecord[]): void {
    this.store.set(DEVICES_KEY, records);
  }
}
