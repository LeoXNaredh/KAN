# `@kan/plugin-sdk-ts`

SDK para escribir un plugin de tipo **driver de dispositivo** para KAN — la única forma soportada de darle a KAN control sobre un dispositivo físico nuevo (ESP32, Raspberry Pi, MQTT, G-code, Bluetooth, o el que sigas). Ver la guía completa en [`docs/plugin-development.md`](../../docs/plugin-development.md) del monorepo.

## Quickstart

```ts
import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";

export class MyDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "my-device";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-my-device",
    version: "0.1.0",
    displayName: "Mi Dispositivo",
    kind: "device-driver",
    runtime: "in-process-ts",
    // Deny-by-default (ADR-008): el usuario aprueba esto explícitamente
    // antes de que el plugin se habilite — ver "Permisos" abajo.
    permissions: definePermissions({ devices: ["my-device"], network: false, filesystem: [] }),
  };

  async discover(): Promise<DeviceDescriptor[]> {
    return [{ id: "my-device-1", name: "Mi Dispositivo #1", kind: this.kind }];
  }

  async connect(deviceId: string): Promise<void> {
    /* abrir la conexión real */
  }

  async disconnect(deviceId: string): Promise<void> {
    /* cerrarla */
  }

  getCapabilities(deviceId: string) {
    return [
      defineCapability({
        name: "do_something",
        description: "Hace algo",
        severity: "reversible",
        supportsDryRun: false,
      }),
    ];
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    return { success: true, data: {} };
  }
}
```

## Permisos (deny-by-default, ADR-008)

`manifest.permissions` es **requerido** — no hay valor por defecto implícito. Declará solo lo que tu plugin necesita:

```ts
interface PluginPermissions {
  devices: string[];    // kinds de dispositivo que necesitás controlar
  network: boolean;     // ¿hace conexiones de red salientes (TCP/MQTT/HTTP)?
  filesystem: string[]; // ej. "read:user-uploads" — declarativo por ahora
}
```

El Edge Agent nunca habilita un plugin automáticamente: la primera vez que se registra, queda pendiente hasta que el usuario lo aprueba explícitamente en la app de escritorio (mismo modelo que los permisos de una app móvil). Si una versión nueva declara permisos distintos a los ya aprobados, se vuelve a pedir aprobación. Ver `docs/plugin-development.md` para el flujo completo.

## Severidad de capabilities vs. permisos de instalación

Son dos capas distintas, no una:
- **Permisos de instalación** (esto, ADR-008): decide si el plugin puede *existir* habilitado.
- **Severidad por capability** (ADR-004, `ActionSeverity`): decide si *una invocación puntual* (`irreversible-material`/`safety-critical`) necesita confirmación humana en el momento, ya con el plugin habilitado.

## Referencia

- `KanPlugin` — clase base de cualquier plugin (`manifest`, `onLoad`/`onUnload`).
- `KanDeviceDriverPlugin` — base para drivers de dispositivo (`discover`/`connect`/`disconnect`/`getCapabilities`/`invoke`, `listTargets` opcional).
- `defineCapability(descriptor)` — helper de identidad tipada para declarar una `CapabilityDescriptor`.
- `definePermissions(permissions)` — helper de identidad tipada para declarar `manifest.permissions`.
- Ejemplo de referencia completo: `plugins/plugin-device-simulator` en el monorepo.
