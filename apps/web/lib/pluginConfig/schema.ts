/**
 * Metadata pura (sin lógica) de qué `KAN_*` puede configurarse desde
 * /configuracion — mismo formato que cada plugin ya documenta en su propio
 * README y en `apps/desktop/.env.example`, así que no hay parsing nuevo que
 * mantener acá ni del lado del Gateway/Edge Agent. Dos plugins no aparecen
 * (`plugin-device-simulator`, `plugin-raspberry-pi`): ninguno de los dos
 * lee ningún `KAN_*`, escanean solos. `plugin-bluetooth-generic` tampoco
 * aparece: no se registra en `apps/desktop` todavía (sin transporte real,
 * ver el comentario en `apps/desktop/src/main/index.ts`).
 */
export interface PluginConfigField {
  /** Nombre exacto de la variable — es la key real que el plugin lee (`process.env.<envVar>`). */
  envVar: string;
  label: string;
  /**
   * "list": valores separados por coma, cada uno editable/eliminable como
   * una fila (ej. `KAN_SSH_HOSTS`). "scalar": un solo valor de texto (ej.
   * `KAN_ESP32_PORT`) — no todos los plugins usan listas.
   */
  type: "list" | "scalar";
  example: string;
}

export interface PluginConfigSchema {
  pluginId: string;
  displayName: string;
  description: string;
  fields: PluginConfigField[];
}

export const PLUGIN_CONFIG_SCHEMA: PluginConfigSchema[] = [
  {
    pluginId: "kan-plugin-ssh",
    displayName: "SSH — control remoto de PCs",
    description: "Allowlist de hosts. execute_command y write_file piden confirmación por defecto (safety-critical).",
    fields: [
      {
        envVar: "KAN_SSH_HOSTS",
        label: "Hosts",
        type: "list",
        example: "servidor-casa|192.168.1.20:22|kan|key|/home/kan/.ssh/id_ed25519",
      },
    ],
  },
  {
    pluginId: "kan-plugin-modbus",
    displayName: "Modbus",
    description: "PLCs y automatización industrial — TCP o RTU serial.",
    fields: [{ envVar: "KAN_MODBUS_TARGETS", label: "Targets", type: "list", example: "plc1|tcp|192.168.1.50:502" }],
  },
  {
    pluginId: "kan-plugin-opcua",
    displayName: "OPC-UA",
    description: "Protocolo industrial. Usuario/contraseña opcional — anónimo por defecto.",
    fields: [
      { envVar: "KAN_OPCUA_TARGETS", label: "Targets", type: "list", example: "plc1|opc.tcp://192.168.1.60:4840" },
    ],
  },
  {
    pluginId: "kan-plugin-home-assistant",
    displayName: "Home Assistant",
    description: "Token de acceso de larga vida, generado desde tu perfil de usuario en HA.",
    fields: [
      {
        envVar: "KAN_HOME_ASSISTANT_INSTANCES",
        label: "Instancias",
        type: "list",
        example: "casa|http://homeassistant.local:8123|eyJhbGciOi...",
      },
    ],
  },
  {
    pluginId: "kan-plugin-mqtt",
    displayName: "MQTT",
    description: "Cualquier broker MQTT — dispositivos IoT.",
    fields: [{ envVar: "KAN_MQTT_BROKERS", label: "Brokers", type: "list", example: "mqtt://192.168.1.10:1883" }],
  },
  {
    pluginId: "kan-plugin-network-tools",
    displayName: "Wake-on-LAN / SNMP",
    description: "Despertar PCs por la red y monitoreo SNMP de solo lectura.",
    fields: [
      { envVar: "KAN_WOL_TARGETS", label: "Wake-on-LAN", type: "list", example: "server1|AA:BB:CC:DD:EE:FF" },
      { envVar: "KAN_SNMP_TARGETS", label: "SNMP", type: "list", example: "switch1|192.168.1.1" },
    ],
  },
  {
    pluginId: "kan-plugin-http-generic",
    displayName: "HTTP genérico",
    description: "Cualquier API REST sin un plugin dedicado.",
    fields: [
      {
        envVar: "KAN_HTTP_ENDPOINTS",
        label: "Endpoints",
        type: "list",
        example: "clima|https://api.clima.example.com",
      },
    ],
  },
  {
    pluginId: "kan-plugin-ws-generic",
    displayName: "WebSocket genérico",
    description: "Cualquier servidor WebSocket sin un plugin dedicado.",
    fields: [{ envVar: "KAN_WS_ENDPOINTS", label: "Endpoints", type: "list", example: "sensores|ws://192.168.1.20:8080" }],
  },
  {
    pluginId: "kan-plugin-serial-generic",
    displayName: "Puerto serial genérico",
    description: "Dispositivos ASCII/binario sin protocolo fijo cubierto por otro plugin.",
    fields: [{ envVar: "KAN_SERIAL_TARGETS", label: "Puertos", type: "list", example: "sensor1|COM3|115200" }],
  },
  {
    pluginId: "kan-plugin-canbus",
    displayName: "CAN Bus",
    description: "Adaptadores USB-CAN compatibles SLCAN (CANable, CANtact, USBtin, CANUSB).",
    fields: [{ envVar: "KAN_CANBUS_TARGETS", label: "Canales", type: "list", example: "obd|COM4|500000" }],
  },
  {
    pluginId: "kan-plugin-esp32-arduino",
    displayName: "ESP32 / Arduino",
    description: "Sin ningún campo de acá, escanea todos los puertos seriales disponibles probando un ping.",
    fields: [
      { envVar: "KAN_ESP32_PORT", label: "Puerto serial fijo (opcional)", type: "scalar", example: "COM3" },
      { envVar: "KAN_ESP32_WIFI_HOSTS", label: "Hosts WiFi/TCP", type: "list", example: "192.168.1.50:8266" },
    ],
  },
  {
    pluginId: "kan-plugin-gcode",
    displayName: "Impresión 3D / CNC (G-code)",
    description: "Un puerto serial fijo (nunca escanea) y/o un bridge serial-a-red.",
    fields: [
      { envVar: "KAN_GCODE_SERIAL_PORT", label: "Puerto serial", type: "scalar", example: "COM3" },
      { envVar: "KAN_GCODE_WIFI_HOST", label: "Host del bridge WiFi/TCP", type: "scalar", example: "192.168.1.40" },
      { envVar: "KAN_GCODE_WIFI_PORT", label: "Puerto del bridge WiFi/TCP", type: "scalar", example: "23" },
      { envVar: "KAN_GCODE_BAUD_RATE", label: "Baud rate (opcional, default 115200)", type: "scalar", example: "115200" },
    ],
  },
];
