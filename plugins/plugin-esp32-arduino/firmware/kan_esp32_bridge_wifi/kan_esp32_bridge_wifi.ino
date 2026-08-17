/*
 * kan_esp32_bridge_wifi — variante WiFi (TCP) de kan_esp32_bridge.ino.
 * Mismo protocolo, mismo parser, mismo principio de "puente tonto" (ver
 * ../kan_esp32_bridge/kan_esp32_bridge.ino y ../../PROTOCOL.md) — solo
 * cambia el transporte: TCP en vez de Serial. Requiere un ESP32 (WiFi.h no
 * existe en el core Arduino AVR clásico).
 *
 * SEGURIDAD (leer antes de usar): esta versión NO valida quién se conecta —
 * cualquier dispositivo en la misma red que sepa la IP:puerto puede mandar
 * comandos, incluyendo escrituras a pines conectados a hardware real. El
 * handshake de autorización todavía no está implementado, ni acá ni del
 * lado de Node (ver PROTOCOL.md "Seguridad (pendiente)"). No exponer este
 * puerto fuera de una red doméstica de confianza.
 *
 * Configuración:
 *   1. Completar WIFI_SSID / WIFI_PASSWORD abajo.
 *   2. Subir el sketch (Arduino IDE, placa ESP32 — Boards Manager).
 *   3. Abrir el Monitor Serial una vez: al conectar imprime la IP asignada
 *      por el router — esa IP (con TCP_PORT) es lo que va en
 *      KAN_ESP32_WIFI_HOSTS (ver README.md del paquete).
 */

#include <WiFi.h>

const char *WIFI_SSID = "TU_RED_WIFI";
const char *WIFI_PASSWORD = "TU_CONTRASENA";
const uint16_t TCP_PORT = 8266;
const size_t LINE_BUFFER_SIZE = 220;
const size_t MAX_SCAN_PINS = 24;

WiFiServer server(TCP_PORT);
WiFiClient client;

char lineBuffer[LINE_BUFFER_SIZE];
size_t lineLength = 0;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Conectado. IP: ");
  Serial.println(WiFi.localIP());
  server.begin();
}

void loop() {
  if (!client || !client.connected()) {
    client = server.available();
    lineLength = 0; // descarta cualquier línea parcial de un cliente anterior
    return;
  }

  while (client.available() > 0) {
    char c = (char)client.read();
    if (c == '\n') {
      lineBuffer[lineLength] = '\0';
      handleLine(lineBuffer);
      lineLength = 0;
    } else if (c != '\r' && lineLength < LINE_BUFFER_SIZE - 1) {
      lineBuffer[lineLength++] = c;
    }
  }
}

void sendLine(const char *line) {
  client.println(line);
}

void handleLine(const char *line) {
  char cmd[32];
  if (!extractString(line, "cmd", cmd, sizeof(cmd))) {
    sendLine("{\"ok\":false,\"error\":\"falta 'cmd'\"}");
    return;
  }

  if (strcmp(cmd, "ping") == 0) {
    sendLine("{\"ok\":true,\"device\":\"kan-esp32\"}");
    return;
  }

  if (strcmp(cmd, "read_all") == 0) {
    handleReadAll(line);
    return;
  }

  long pin;
  if (!extractInt(line, "pin", &pin)) {
    sendLine("{\"ok\":false,\"error\":\"falta 'pin'\"}");
    return;
  }

  char response[64];
  if (strcmp(cmd, "read_digital") == 0) {
    // No pinMode() acá: leer nunca debe reconfigurar el pin — un pin en
    // OUTPUT sosteniendo un relé/motor real no debe volverse INPUT solo
    // porque alguien lo leyó (ver ADR-058).
    int value = digitalRead((uint8_t)pin);
    snprintf(response, sizeof(response), "{\"ok\":true,\"value\":%d}", value);
    sendLine(response);
  } else if (strcmp(cmd, "read_analog") == 0) {
    int value = analogRead((uint8_t)pin);
    snprintf(response, sizeof(response), "{\"ok\":true,\"value\":%d}", value);
    sendLine(response);
  } else if (strcmp(cmd, "write_digital") == 0) {
    bool value;
    if (!extractBool(line, "value", &value)) {
      sendLine("{\"ok\":false,\"error\":\"falta 'value'\"}");
      return;
    }
    pinMode((uint8_t)pin, OUTPUT);
    digitalWrite((uint8_t)pin, value ? HIGH : LOW);
    sendLine("{\"ok\":true}");
  } else if (strcmp(cmd, "write_analog") == 0) {
    long value;
    if (!extractInt(line, "value", &value)) {
      sendLine("{\"ok\":false,\"error\":\"falta 'value'\"}");
      return;
    }
    pinMode((uint8_t)pin, OUTPUT);
    analogWrite((uint8_t)pin, (int)value);
    sendLine("{\"ok\":true}");
  } else {
    sendLine("{\"ok\":false,\"error\":\"comando desconocido\"}");
  }
}

/*
 * `read_all` — mismo criterio que la variante Serial: lee de una pasada los
 * pines que Node pida, nunca llama pinMode() (ADR-058).
 */
void handleReadAll(const char *line) {
  long digitalPins[MAX_SCAN_PINS];
  size_t digitalCount = extractIntArray(line, "digitalPins", digitalPins, MAX_SCAN_PINS);
  long analogPins[MAX_SCAN_PINS];
  size_t analogCount = extractIntArray(line, "analogPins", analogPins, MAX_SCAN_PINS);

  client.print("{\"ok\":true,\"digital\":{");
  for (size_t i = 0; i < digitalCount; i++) {
    if (i > 0) client.print(",");
    client.print("\"");
    client.print(digitalPins[i]);
    client.print("\":");
    client.print(digitalRead((uint8_t)digitalPins[i]));
  }
  client.print("},\"analog\":{");
  for (size_t i = 0; i < analogCount; i++) {
    if (i > 0) client.print(",");
    client.print("\"");
    client.print(analogPins[i]);
    client.print("\":");
    client.print(analogRead((uint8_t)analogPins[i]));
  }
  client.println("}}");
}

/* --- Mismo parser manual que la variante Serial (kan_esp32_bridge.ino) --- */

const char *findKey(const char *json, const char *key) {
  char needle[40];
  snprintf(needle, sizeof(needle), "\"%s\"", key);
  const char *found = strstr(json, needle);
  if (found == NULL) return NULL;
  const char *colon = strchr(found, ':');
  return colon == NULL ? NULL : colon + 1;
}

bool extractString(const char *json, const char *key, char *out, size_t outSize) {
  const char *value = findKey(json, key);
  if (value == NULL) return false;
  while (*value == ' ') value++;
  if (*value != '"') return false;
  value++;
  size_t i = 0;
  while (*value != '"' && *value != '\0' && i < outSize - 1) {
    out[i++] = *value++;
  }
  out[i] = '\0';
  return true;
}

bool extractInt(const char *json, const char *key, long *out) {
  const char *value = findKey(json, key);
  if (value == NULL) return false;
  while (*value == ' ') value++;
  char *end;
  *out = strtol(value, &end, 10);
  return end != value;
}

bool extractBool(const char *json, const char *key, bool *out) {
  const char *value = findKey(json, key);
  if (value == NULL) return false;
  while (*value == ' ') value++;
  if (strncmp(value, "true", 4) == 0) {
    *out = true;
    return true;
  }
  if (strncmp(value, "false", 5) == 0) {
    *out = false;
    return true;
  }
  return false;
}

/** Parsea `"key":[1,2,3]` — hasta `maxCount` enteros, silenciosamente trunca el resto (protocolo confía en Node para no mandar de más). */
size_t extractIntArray(const char *json, const char *key, long *out, size_t maxCount) {
  const char *value = findKey(json, key);
  if (value == NULL) return 0;
  while (*value == ' ') value++;
  if (*value != '[') return 0;
  value++;
  size_t count = 0;
  while (*value != ']' && *value != '\0' && count < maxCount) {
    while (*value == ' ' || *value == ',') value++;
    if (*value == ']' || *value == '\0') break;
    char *end;
    long parsed = strtol(value, &end, 10);
    if (end == value) break;
    out[count++] = parsed;
    value = end;
  }
  return count;
}
