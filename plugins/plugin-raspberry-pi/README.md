# @kan/plugin-raspberry-pi

Driver de GPIO nativo de una Raspberry Pi (ADR-038). Mismo `DeviceDriverPort` que `@kan/plugin-esp32-arduino`/`@kan/plugin-device-simulator` — nada en el Edge Agent, el Gateway o el chat necesita saber que este dispositivo es la propia máquina donde corre KAN.

**A diferencia de `@kan/plugin-esp32-arduino`, acá no hay firmware que flashear ni cable/WiFi a otro dispositivo.** El "dispositivo" es el header GPIO de 40 pines de la Raspberry Pi donde corre el Edge Agent — este plugin solo tiene sentido si `apps/desktop` corre **en la propia Pi** (docs/06: *"la Pi puede correr su propio mini Edge Agent"*). Si lo corrés en otra máquina, `discover()` simplemente no encuentra nada — no rompe nada, pero tampoco hace nada.

## Numeración de pines: BCM, no la del header físico

Todos los números de pin que usan las capabilities de este plugin son **números BCM** (los que asigna el SoC Broadcom — ej. "GPIO17"), no la numeración física del header de 40 pines ni la de WiringPi. Es la convención que usa `onoff` y la mayoría del ecosistema Node/Pi. Antes de cablear algo, confirmá el pin BCM correcto con el [pinout oficial de Raspberry Pi](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#gpio) o `pinout` en la terminal de la Pi (paquete `python3-gpiozero`).

Pines expuestos (propósito general, ver `src/pinMap.ts`): `4, 5, 6, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27`. Quedan afuera a propósito los que suelen estar reservados por interfaces habilitadas por defecto o vía `raspi-config`: `0`/`1` (ID EEPROM de HATs), `2`/`3` (I2C), `7`-`11` (SPI0), `14`/`15` (UART).

## Capabilities

- `read_digital_pin(pin)` — read-only
- `write_digital_pin(pin, value: boolean)` — irreversible-material por defecto

**Sin `read_analog_pin` ni PWM en esta versión** — la Pi no tiene ADC en el header GPIO (a diferencia del ESP32), y PWM real necesitaría otra librería (`onoff` es solo digital). Alcance futuro si aparece un caso de uso real.

## Permisos

En Raspberry Pi OS moderno, el usuario por defecto (`pi` o el que creaste al flashear) suele pertenecer al grupo `gpio` y puede acceder a `/sys/class/gpio` sin `sudo`. Si `Gpio.accessible` (que expone `onoff`) da `false`, confirmá tu grupo con `groups $(whoami)` — si falta `gpio`, agregalo con `sudo usermod -aG gpio $(whoami)` y volvé a iniciar sesión.

## Uso

`onoff` trae una dependencia nativa transitiva (`epoll`, para detección de interrupciones — este driver no la usa, pero igual hay que compilarla; ver `pnpm-workspace.yaml`'s `allowBuilds`). Por eso `apps/desktop` lo registra con import dinámico + `try/catch`, no un `import` estático — si el binding no carga en tu máquina, el resto del Edge Agent (simulador incluido) sigue funcionando igual:

```ts
try {
  const { RaspberryPiGpioPlugin } = await import("@kan/plugin-raspberry-pi");
  await agent.registerPlugin(new RaspberryPiGpioPlugin());
} catch (error) {
  logger.warn(`No se pudo cargar el plugin de Raspberry Pi: ${error}`);
}
```

En cualquier máquina que no sea una Pi (o si el binding no logró cargar), `discover()` no encuentra nada — sin romper el resto de la app.

## Probarlo con hardware real

1. Conectá un LED con una resistencia en serie (~220Ω) entre un pin GPIO de propósito general (ej. BCM 17, header físico pin 11) y un pin GND (ej. header físico pin 6, o cualquier otro marcado GND).
2. Arrancá `apps/desktop` **en la propia Raspberry Pi** (`pnpm dev` en `apps/desktop`, con Raspberry Pi OS Desktop o una pantalla/VNC — Electron necesita un display).
3. En "Dispositivos" debería aparecer "Raspberry Pi (GPIO)". Abrí su panel **Safety Policy** y clasificá el pin 17 (alias "LED de prueba", severidad `reversible` para no tener que confirmar cada vez).
4. Pedile a KAN por chat "prendé el LED del pin 17" — si el LED enciende de verdad, el driver está funcionando contra hardware real.
5. Si `discover()` no encuentra el dispositivo: confirmá que estás corriendo en la Pi (no en tu PC de desarrollo) y revisá el permiso de grupo `gpio` de arriba.
