# @kan/plugin-ssh

Control remoto de otras PCs por SSH — **la superficie de riesgo más grande de todo el mapa de hardware de KAN**. A diferencia de un pin GPIO, un registro Modbus o una entidad de Home Assistant, un comando SSH puede hacer literalmente cualquier cosa en la máquina remota: leer cualquier archivo, borrar cualquier cosa, instalar software, apagar el sistema. El diseño entero de este plugin parte de esa asimetría.

## Capabilities

| Capability | Severidad | Target |
|---|---|---|
| `execute_command(command, timeoutMs?)` | **safety-critical** (el techo del sistema) | `command` — el string completo, no el programa |
| `read_file(path)` | read-only | `path` |
| `write_file(path, content)` | **safety-critical** | `path` |
| `list_directory(path)` | read-only | `path` |

### Por qué `execute_command` es `safety-critical` para todo lo no clasificado

Cualquier comando no reclasificado explícitamente en Safety Policy pide confirmación, sin excepción — es el nivel más restrictivo que existe en KAN (ADR-004). El target es el **string completo del comando**, no el programa (`ls` vs. `ls -la /home`): clasificar `"ls -la /home"` como `reversible` en Safety Policy **no** cubre `"ls -la /tmp"` ni ningún otro comando distinto, ni por accidente ni por diseño. Cada aprobación es para el comando exacto que el usuario revisó, nunca un patrón — evita que una clasificación laxa termine cubriendo, sin querer, algo mucho más peligroso que comparte el mismo primer token.

### Por qué `write_file` también es `safety-critical`, no `irreversible-material`

Escribir un archivo arbitrario en una máquina remota tiene el mismo techo de riesgo que ejecutar código: sobrescribir `~/.ssh/authorized_keys`, un crontab, o un archivo de servicio de systemd logra persistencia/escalamiento de privilegios sin necesitar `execute_command` en absoluto. Dejarlo en un nivel intermedio (`irreversible-material`, como `write_register` o `call_ha_service`) subestimaría ese riesgo — comparte el techo con `execute_command` a propósito.

### Por qué `read_file`/`list_directory` son read-only

Leer no cambia estado en la máquina remota — el sistema de severidad de KAN (ADR-004) es sobre reversibilidad de acciones físicas/de estado, no sobre confidencialidad. El riesgo real de leer un archivo sensible (ej. una clave privada) no lo cubre este mecanismo de confirmación; se mitiga en la configuración (qué hosts y usuarios permitís, con qué permisos de sistema de archivos tiene ese usuario remoto), no con un diálogo por cada lectura.

## Configuración — `KAN_SSH_HOSTS` (obligatoria)

`nombre|host:puerto|usuario|auth` separados por coma, donde `auth` es:
- `key|/ruta/a/clave_privada` — autenticación por clave (recomendado)
- `key|/ruta/a/clave_privada|passphrase` — clave cifrada
- `password|contraseña` — autenticación por password (desalentado, pero soportado)

```
KAN_SSH_HOSTS=servidor-casa|192.168.1.20:22|kan|key|/home/kan/.ssh/id_ed25519
KAN_SSH_HOSTS=servidor-casa|192.168.1.20:22|kan|key|/home/kan/.ssh/id_ed25519,nas|192.168.1.30:22|admin|password|contraseña-real
```

El puerto es opcional (default `22`). **Esta variable es obligatoria** en un sentido más estricto que el resto de los plugins de red: sin ella, este plugin literalmente no puede hacer nada — no hay ningún modo intermedio. El auth se separa con `|`, no `:`, para no chocar con rutas de Windows tipo `C:\ruta\clave` (que ya tienen dos puntos).

**Nunca escanea, nunca se elige un host en tiempo real desde el chat.** Es la única defensa real de este plugin — el resto de la seguridad depende de la Safety Policy del lado de KAN y de los permisos reales que tenga el usuario remoto en su propio sistema operativo (KAN no puede, ni debería, intentar sobrepasar eso).

## Sin verificación de host key (limitación conocida, documentada)

Este plugin no verifica la clave del host contra un `known_hosts` — confía en la clave que el servidor presente en la primera conexión (sin protección contra MITM en esa primera conexión). Para redes domésticas/de confianza esto es el mismo modelo que usan la mayoría de las herramientas de automatización SSH simples; para un entorno más hostil, sería necesario agregar `hostVerifier` (ver `ConnectConfig` de `ssh2`) con una huella conocida de antemano — no implementado en este incremento por no ser un pedido explícito.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { SshDevicePlugin } from "@kan/plugin-ssh";

await agent.registerPlugin(new SshDevicePlugin());
```

## Sin binding nativo — `cpu-features`/`nan` denegados a propósito

`ssh2` tiene `cpu-features`/`nan` como dependencias **opcionales** (aceleración de crypto nativa) — funciona igual en JS puro sin ellas. Están denegadas en `pnpm-workspace.yaml` (`allowBuilds`), mismo criterio que `@abandonware/noble`/`epoll` en ese archivo: son bindings nativos que necesitarían un toolchain de C++ no instalado en esta máquina de desarrollo, y no son necesarios para que el plugin funcione.

## Probarlo de verdad

1. Fijá `KAN_SSH_HOSTS` con una máquina real accesible por SSH (podés usar tu propia PC/servidor con OpenSSH habilitado).
2. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el host.
3. Desde el chat, pedí algo como `list_directory` en `/home` o `read_file` de un archivo que sepas que existe — no debería pedir confirmación (read-only).
4. Pedí `execute_command` con algo simple (ej. `echo hola`) — debería pedir confirmación en la app de escritorio (ADR-004), siempre, hasta que reclasifiques ese comando exacto en Safety Policy.
5. Probá `write_file` — mismo comportamiento, techo `safety-critical`.
6. Verificá en `GET /v1/audit` del Gateway que cada invocación quedó registrada — con SSH, este rastro de auditoría importa más que en cualquier otro plugin del mapa.
