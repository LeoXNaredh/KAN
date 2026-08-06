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

```json
{
  "id": "kan-plugin-cnc-laser",
  "version": "1.2.0",
  "displayName": "CNC / Láser",
  "runtime": "python-sidecar",
  "entrypoint": "kan_plugin_cnc.main:app",
  "capabilities": [
    {
      "name": "cut_file",
      "description": "Corta un archivo vectorial en la máquina indicada",
      "severity": "irreversible-material",
      "supportsDryRun": true,
      "inputSchema": { "...": "JSON Schema" }
    }
  ],
  "permissions": {
    "devices": ["cnc", "laser-cutter"],
    "network": false,
    "filesystem": ["read:user-uploads"]
  },
  "signature": "..."
}
```

Este manifest es el mismo contrato tanto para plugins oficiales (`/plugins` del monorepo) como para plugins de terceros del marketplace futuro — no hay dos estándares.

## 4. Ciclo de vida

```
Publicado (firmado) → Descubierto (marketplace/registro) → Instalado (usuario aprueba permisos)
   → Habilitado → [Actualizado] → Deshabilitado → Desinstalado
```

- **Instalación**: el Plugin Manager valida la firma, muestra al usuario los permisos solicitados en lenguaje natural ("Este plugin podrá: controlar tu cortadora láser, leer archivos que subas"), y solo se activa tras aprobación explícita.
- **Actualización**: si una nueva versión pide permisos adicionales, se re-solicita aprobación (igual que apps móviles).
- **Aislamiento por fallo**: un plugin sidecar que crashea no debe tumbar el Edge Agent ni el Core — se reinicia de forma aislada y la tarea en curso se marca `failed` de forma controlada.

## 5. SDK de plugins

- **`@kan/plugin-sdk-ts`**: clase base `KanPlugin`, decoradores para declarar `capabilities`, helpers para emitir progreso/telemetría, acceso tipado a `DevicePort` cuando corre en el Edge Agent.
- **`kan-plugin-sdk-py`**: equivalente Python (basado en FastAPI/gRPC), mismos conceptos, para plugins de visión/CAD/robótica.
- Ambos SDKs generan el manifest a partir de anotaciones en el código (evita que el manifest y la implementación diverjan).

## 6. Instalación selectiva ("ligero por defecto")

El README exige que un plugin nunca se descargue si el usuario no lo necesita. Esto se traduce en:
- El cliente (web/desktop/mobile) solo carga el código de UI de un plugin cuando el usuario lo instala (code-splitting dinámico).
- Los sidecars Python **no se empaquetan con el Edge Agent**: se descargan/activan (como contenedor Docker o entorno virtual) solo al instalar ese plugin específico.
- El catálogo de plugins disponibles se sirve como metadata ligera; el binario/paquete pesado se descarga bajo demanda.

## 7. Documentos relacionados

- [Arquitectura de Dispositivos](06-arquitectura-dispositivos.md) — cómo los plugins driver hablan con hardware real.
- [Arquitectura de Comunicación](07-arquitectura-comunicacion.md) — protocolo Core↔Plugin↔Edge Agent en detalle.
