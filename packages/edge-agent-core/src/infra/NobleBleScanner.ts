import * as noble from "@abandonware/noble";
import type { BleDeviceScannerPort, BleScanEntry } from "../domain/ports/BleDeviceScannerPort";

/**
 * BLE central-mode real vía `@abandonware/noble` (ADR-060). Import estático
 * a propósito (igual que `onoff` en `OnoffGpioPort.ts` para Raspberry Pi):
 * el binding nativo (`@abandonware/bluetooth-hci-socket`) ya se intentó una
 * vez en este repo para `plugin-bluetooth-generic` y falló por falta de
 * Visual Studio C++ en la máquina de desarrollo (ver su README) —
 * `allowBuilds: false` en `pnpm-workspace.yaml` ya evita que pnpm intente
 * compilarlo, así que este import nunca revienta el proceso, solo carga la
 * capa JS sin binding funcional. Este archivo NUNCA se exporta desde el
 * índice principal de `@kan/edge-agent-core` (ver `src/ble.ts`) — solo
 * `apps/desktop` lo importa, con `import()` dinámico + try/catch en el
 * punto de construcción, mismo criterio que el registro de
 * `@kan/plugin-raspberry-pi`.
 */
export class NobleBleScanner implements BleDeviceScannerPort {
  isAvailable(): boolean {
    // Si esta clase se construyó, el import estático de arriba ya cargó sin
    // tirar — eso es lo único que este método necesita confirmar de forma
    // síncrona (mismo contrato que GpioPort.isAccessible()). Si el adaptador
    // BLE del SO no está encendido/emparejado, scan() simplemente no
    // encuentra nada, no hace falta anticiparlo acá.
    return true;
  }

  async scan(durationMs: number): Promise<BleScanEntry[]> {
    const seen = new Map<string, BleScanEntry>();
    const onDiscover = (peripheral: noble.Peripheral) => {
      seen.set(peripheral.id, {
        id: peripheral.id,
        name: peripheral.advertisement?.localName,
        serviceUuids: peripheral.advertisement?.serviceUuids ?? [],
      });
    };

    noble.on("discover", onDiscover);
    try {
      await noble.startScanningAsync([], true);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      await noble.stopScanningAsync();
    } finally {
      noble.removeListener("discover", onDiscover);
    }

    return Array.from(seen.values());
  }
}
