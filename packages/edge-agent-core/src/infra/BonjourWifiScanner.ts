import Bonjour from "bonjour-service";
import type { WifiDeviceScannerPort, WifiScanEntry } from "../domain/ports/WifiDeviceScannerPort";

/**
 * mDNS pasivo real sobre `bonjour-service` (ADR-060) — puro JS, sin binding
 * nativo (a diferencia de BLE, siempre disponible en cualquier host).
 * `find(null, ...)` sin `type` escucha TODOS los anuncios de la red durante
 * la ventana de escaneo; `DeviceDiscoveryService` filtra/clasifica los tipos
 * que le interesan después — este adaptador no decide qué es relevante.
 */
export class BonjourWifiScanner implements WifiDeviceScannerPort {
  async scan(durationMs: number): Promise<WifiScanEntry[]> {
    const bonjour = new Bonjour();
    const seen = new Map<string, WifiScanEntry>();

    try {
      const browser = bonjour.find(null, (service) => {
        const serviceType = `_${service.type}._${service.protocol}`;
        seen.set(`${serviceType}|${service.name}`, {
          serviceType,
          name: service.name,
          address: service.addresses?.[0],
          host: service.host || service.fqdn,
        });
      });

      await new Promise((resolve) => setTimeout(resolve, durationMs));
      browser.stop();
    } finally {
      bonjour.destroy();
    }

    return Array.from(seen.values());
  }
}
