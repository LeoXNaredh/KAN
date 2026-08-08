# Arquitectura de Plugins

> Referencia: ADR-003 (ejecución) y ADR-008 (permisos) en [00-analisis-y-decisiones.md](00-analisis-y-decisiones.md).

## 1. Filosofía

"Nunca desarrollar una funcionalidad específica dentro del Core si puede implementarse como plugin" (README). Un plugin es la única forma de añadir capacidades a KAN. El Core provee el "sistema operativo"; los plugins son las "aplicaciones".

## 2. Tipos de plugin

| Tipo | Dónde corre | Ejemplos | Comunicación con Core/Edge |
|---|---|---|---|
| **Skill/Integración** (in-process TS) | Core Cloud o Edge Agent | Telegram, WhatsApp, GitHub, Home Assistant | Llamada de función directa (mismo proceso), sandboxeado con permisos declarados |
| **Driver de dispositivo** (in-process TS) | Edge Agent | ESP32, Arduino, Raspberry Pi (protocolos simples: Serial/HTTP) | Llamada directa vía `DevicePort` |
| **Procesamiento pesado** (sidecar Python) | Proceso/contenedor separado, junto al Edge Agent o en Cloud según el caso | Visión artificial, CAD, PCB, CNC (G-code) | gRPC/WebSocket con `plugin-contract` versionado |

## 3. Manifest de plugin (contrato — `plugin-contract`)

Forma real implementada (P8, ADR-041):

```json
{
  "id": "kan-plugin-cnc-laser",
  "version": "1.2.0",
  "displayName": "CNC / Láser",
  "kind": "device-driver",
  "runtime": "python-sidecar",
  "permissions": {
    "devices": ["cnc", "laser-cutter"],
    "network": false,
    "filesystem": ["read:user-uploads"]
  },
  "signature": "..."
}
```

`capabilities` no vive en el manifest a propósito: `getCapabilities(deviceId)` ya las expone dinámicamente por dispositivo descubierto — ponerlas también acá sería una segunda fuente de verdad que puede divergir de la implementación real (justo lo que el SDK, §5, existe para evitar). `permissions` es requerido — el modelo deny-by-default de ADR-008 arranca desde ahí (ver `docs/plugin-development.md` para el flujo de aprobación completo). `signature` sigue siendo un placeholder sin verificación real (docs/09: firma operativa recién Año 1 tardío, marketplace público Año 2).

Este manifest es el mismo contrato tanto para plugins oficiales (`/plugins` del monorepo) como para plugins de terceros del marketplace futuro — no hay dos estándares.

## 4. Ciclo de vida

```
Publicado (firmado) → Descubierto (marketplace/registro) → Instalado (usuario aprueba permisos)
   → Habilitado → [Actualizado] → Deshabilitado → Desinstalado
```

- **Instalación**: el Plugin Manager (implementado P8, ADR-041) muestra al usuario los permisos solicitados y solo se activa tras aprobación explícita (todavía sin validar firma — ver §3). Sin marketplace ni empaquetado real todavía, "instalar" hoy es "el host lo registra en su código" (ej. `apps/desktop/src/main/index.ts`) — el modal de aprobación es el mismo que va a usar un plugin de terceros instalado desde un paquete cuando eso exista.
- **Actualización**: si una nueva versión pide permisos adicionales, se re-solicita aprobación (igual que apps móviles).
- **Aislamiento por fallo**: un plugin sidecar que crashea no debe tumbar el Edge Agent ni el Core — se reinicia de forma aislada y la tarea en curso se marca `failed` de forma controlada.

## 5. SDK de plugins

- **`@kan/plugin-sdk-ts`** (implementado): `KanPlugin`/`KanDeviceDriverPlugin` como clases base, `defineCapability()` para declarar capabilities con chequeo de tipos, `definePermissions()` (P8) para declarar `manifest.permissions`. Ver [README del paquete](../packages/plugin-sdk-ts/README.md) y la [guía de desarrollo de plugins](plugin-development.md).
- **`kan-plugin-sdk-py`** (sin implementar todavía): equivalente Python (basado en FastAPI/gRPC), mismos conceptos, para plugins de visión/CAD/robótica.
- El manifest deliberadamente no incluye `capabilities` (ver §3) — es la forma en que el SDK evita que manifest e implementación diverjan, no generándolo por anotaciones sino no duplicándolo.

## 6. Instalación selectiva ("ligero por defecto")

El README exige que un plugin nunca se descargue si el usuario no lo necesita. Esto se traduce en:
- El cliente (web/desktop/mobile) solo carga el código de UI de un plugin cuando el usuario lo instala (code-splitting dinámico).
- Los sidecars Python **no se empaquetan con el Edge Agent**: se descargan/activan (como contenedor Docker o entorno virtual) solo al instalar ese plugin específico.
- El catálogo de plugins disponibles se sirve como metadata ligera; el binario/paquete pesado se descarga bajo demanda.

## 7. Documentos relacionados

- [Arquitectura de Dispositivos](06-arquitectura-dispositivos.md) — cómo los plugins driver hablan con hardware real.
- [Arquitectura de Comunicación](07-arquitectura-comunicacion.md) — protocolo Core↔Plugin↔Edge Agent en detalle.
- [Guía de desarrollo de plugins](plugin-development.md) — cómo escribir un plugin nuevo con `@kan/plugin-sdk-ts`, de punta a punta (P8, ADR-041).
