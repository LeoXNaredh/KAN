# Guía de desarrollo de plugins

> Referencia: [Arquitectura de Plugins](04-arquitectura-plugins.md), ADR-004, ADR-008 y ADR-041 en [00-analisis-y-decisiones.md](00-analisis-y-decisiones.md).

Esta es la guía real para escribir un plugin de tipo **driver de dispositivo** para KAN — hoy la única forma soportada (los plugins de integración/procesamiento pesado descritos en `docs/04` §2 siguen sin implementar). El "API pública" de autoría de plugins es el paquete `@kan/plugin-sdk-ts` (más los tipos de `@kan/plugin-contract`) — no un endpoint HTTP.

## 1. El contrato mínimo

Un plugin extiende `KanDeviceDriverPlugin` de `@kan/plugin-sdk-ts` e implementa:

```ts
abstract discover(): Promise<DeviceDescriptor[]>;
abstract connect(deviceId: string): Promise<void>;
abstract disconnect(deviceId: string): Promise<void>;
abstract getCapabilities(deviceId: string): CapabilityDescriptor[];
abstract invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult>;
```

Además declara un `manifest: PluginManifest` (ver §2) y un `kind: string` (el kind de dispositivo que expone — se usa para asociar `manifest.permissions.devices`).

El ejemplo de referencia completo, corriendo en el monorepo, es `plugins/plugin-device-simulator`. El quickstart mínimo está en el [README de `@kan/plugin-sdk-ts`](../packages/plugin-sdk-ts/README.md).

## 2. El manifest

```ts
interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  kind: "device-driver" | "integration" | "processing";
  runtime: "in-process-ts" | "python-sidecar";
  permissions: PluginPermissions; // requerido, ver §3
  signature?: string;              // placeholder, ver §5
}
```

`capabilities` **no** vive en el manifest, a diferencia de lo que un ejemplo antiguo de `docs/04` sugería. `getCapabilities(deviceId)` ya las expone dinámicamente por dispositivo descubierto (dos dispositivos del mismo plugin pueden exponer capabilities distintas) — ponerlas también en el manifest sería una segunda fuente de verdad que puede divergir de la implementación real. El manifest declara *lo que el plugin necesita para operar* (permisos); *lo que el plugin puede hacer* siempre se pregunta en vivo.

## 3. Permisos — deny-by-default (ADR-008, ADR-041)

```ts
interface PluginPermissions {
  devices: string[];    // kinds de dispositivo que este plugin necesita controlar
  network: boolean;      // ¿hace conexiones de red salientes?
  filesystem: string[];  // declarativo — ej. "read:user-uploads" — sin enforcement real todavía
}
```

Es un campo **requerido** — no hay "sin permisos" implícito, tenés que declarar explícitamente lo que tu plugin toca. Usá el helper `definePermissions()` del SDK para tener chequeo de tipos al declararlo.

### Qué pasa en el Edge Agent con esto

1. La primera vez que tu plugin se registra, **no se habilita solo**. `PluginManager` lo deja en estado `"loaded"` (pendiente) y avisa por el bus (`plugin.permission_pending`) — nunca llama a `onLoad()`, nunca descubre dispositivos.
2. La app de escritorio muestra un modal con los permisos declarados (dispositivos/red/filesystem) — mismo patrón que un permiso de app móvil. El usuario Aprueba o Rechaza.
3. Si aprueba: `onLoad()` corre, el plugin queda `"enabled"`, sus dispositivos se descubren de inmediato (sin reiniciar la app), y el permiso otorgado se persiste localmente.
4. Si rechaza: el plugin queda deshabilitado. `onLoad()` nunca corre.
5. En arranques siguientes, si los permisos declarados **no cambiaron** desde el último otorgamiento, el plugin se habilita directo, sin volver a preguntar. Si tu nueva versión declara permisos distintos (ej. ahora también necesita red), se vuelve a pedir aprobación — igual que una actualización de app móvil que pide un permiso nuevo.

No hay excepción para plugins "oficiales"/bundled con la app — mismo contrato para todos (`docs/04` §3: "no hay dos estándares").

## 4. Severidad de capabilities — una capa distinta (ADR-004)

Los permisos de instalación (§3) deciden si tu plugin puede *existir* habilitado. Aparte de eso, cada capability individual declara una `severity: ActionSeverity`:

- `read-only` / `reversible` — se ejecutan directo.
- `irreversible-material` / `safety-critical` — quedan `pending_confirmation` hasta que el usuario confirma esa invocación puntual en la app de escritorio (nunca por chat remoto, ver ADR-010).

Son dos gates independientes: un plugin ya aprobado (§3) todavía puede tener una capability individual bloqueada por severidad (§4) en cada invocación.

## 5. Firma de paquetes — todavía no implementada

El manifest tiene un campo `signature?: string` reservado, sin verificación real todavía. `docs/09-roadmap.md` ubica el modelo de firma operativo en el Año 1 tardío, y la apertura de un marketplace público de terceros recién en el Año 2 — este incremento (P8) construye los fundamentos (manifest + gate de permisos + SDK + esta guía), no la firma criptográfica ni la tienda.

## 6. Checklist para un plugin nuevo

1. `manifest.id` único, `kind: "device-driver"`, `runtime: "in-process-ts"` (o `"python-sidecar"` si aplica — sin soporte todavía en el Edge Agent).
2. `manifest.permissions` declarado con `definePermissions()` — solo lo que realmente necesitás.
3. `discover()`/`connect()`/`disconnect()` implementados contra el hardware o protocolo real.
4. `getCapabilities(deviceId)` con `defineCapability()` por cada acción, severidad declarada honestamente (ver ADR-004 en docs/00 para el criterio).
5. `invoke()` valida su propio input además del `inputSchema` (defensa en profundidad, docs/16 P1) y nunca asume que el dispositivo sigue conectado.
6. Registralo en el host (hoy `apps/desktop/src/main/index.ts`) con `agent.registerPlugin(new TuPlugin())` — si tiene una dependencia nativa que puede no compilar en todas las plataformas, envolvé el `import` dinámico en `try/catch` (ver cómo lo hace `plugin-raspberry-pi`).
