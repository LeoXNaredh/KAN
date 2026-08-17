/*
 * kan_esp32_bridge — firmware de referencia para @kan/plugin-esp32-arduino.
 *
 * Puente "tonto" entre KAN y el hardware: ejecuta lo que se le pide por
 * Serial y nada más. NO decide qué es seguro — eso vive enteramente del
 * lado de Node (SafetyPolicyStore + PermissionManager, @kan/edge-agent-core).
 * Este sketch nunca debe ganar lógica de confirmación/seguridad propia.
 *
 * Protocolo: ver ../../PROTOCOL.md (una línea JSON por comando/respuesta,
 * 115200 baud). Parser manual de propósito, sin librerías externas
 * (ArduinoJson etc.) — el protocolo es intencionalmente plano y simple para
 * no forzar al usuario a instalar nada extra en el Arduino IDE.
 *
 * Flasheo:
 *   1. Arduino IDE: instalar el soporte de placas "esp32" (Espressif) desde
 *      el Boards Manager si es un ESP32, o usar el core "Arduino AVR" si es
 *      un Arduino clásico (UNO/Nano/Mega).
 *   2. Seleccionar la placa y el puerto correctos.
 *   3. Subir este sketch tal cual.
 *   4. Anotar el puerto COM/tty asignado — se usa como KAN_ESP32_PORT o se
 *      descubre automáticamente al conectar (ver README.md del paquete).
 *
 * Alternativa por línea de comandos (arduino-cli):
 *   arduino-cli compile --fqbn esp32:esp32:esp32 kan_esp32_bridge
 *   arduino-cli upload -p COM3 --fqbn esp32:esp32:esp32 kan_esp32_bridge
 */

const long BAUD_RATE = 115200;
const size_t LINE_BUFFER_SIZE = 220;
const size_t MAX_SCAN_PINS = 24;

char lineBuffer[LINE_BUFFER_SIZE];
size_t lineLength = 0;

void setup() {
  Serial.begin(BAUD_RATE);
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      lineBuffer[lineLength] = '\0';
      handleLine(lineBuffer);
      lineLength = 0;
    } else if (c != '\r' && lineLength < LINE_BUFFER_SIZE - 1) {
      lineBuffer[lineLength++] = c;
    }
  }
}

void handleLine(const char *line) {
  char cmd[32];
  if (!extractString(line, "cmd", cmd, sizeof(cmd))) {
    Serial.println("{\"ok\":false,\"error\":\"falta 'cmd'\"}");
    return;
  }

  if (strcmp(cmd, "ping") == 0) {
    Serial.println("{\"ok\":true,\"device\":\"kan-esp32\"}");
    return;
  }

  if (strcmp(cmd, "read_all") == 0) {
    handleReadAll(line);
    return;
  }

  long pin;
  if (!extractInt(line, "pin", &pin)) {
    Serial.println("{\"ok\":false,\"error\":\"falta 'pin'\"}");
    return;
  }

  if (strcmp(cmd, "read_digital") == 0) {
    // No pinMode() acá: leer nunca debe reconfigurar el pin — un pin en
    // OUTPUT sosteniendo un relé/motor real no debe volverse INPUT solo
    // porque alguien lo leyó (ver ADR-058).
    int value = digitalRead((uint8_t)pin);
    Serial.print("{\"ok\":true,\"value\":");
    Serial.print(value);
    Serial.println("}");
  } else if (strcmp(cmd, "read_analog") == 0) {
    int value = analogRead((uint8_t)pin);
    Serial.print("{\"ok\":true,\"value\":");
    Serial.print(value);
    Serial.println("}");
  } else if (strcmp(cmd, "write_digital") == 0) {
    bool value;
    if (!extractBool(line, "value", &value)) {
      Serial.println("{\"ok\":false,\"error\":\"falta 'value'\"}");
      return;
    }
    pinMode((uint8_t)pin, OUTPUT);
    digitalWrite((uint8_t)pin, value ? HIGH : LOW);
    Serial.println("{\"ok\":true}");
  } else if (strcmp(cmd, "write_analog") == 0) {
    long value;
    if (!extractInt(line, "value", &value)) {
      Serial.println("{\"ok\":false,\"error\":\"falta 'value'\"}");
      return;
    }
    pinMode((uint8_t)pin, OUTPUT);
    analogWrite((uint8_t)pin, (int)value);
    Serial.println("{\"ok\":true}");
  } else {
    Serial.println("{\"ok\":false,\"error\":\"comando desconocido\"}");
  }
}

/*
 * `read_all` — lee de una sola pasada todos los pines que Node le pida
 * (Node ya sabe cuáles existen vía ESP32_PIN_MAP; el firmware sigue sin
 * mapa propio, ver PROTOCOL.md). Nunca llama pinMode(): es puramente de
 * lectura, no reconfigura nada (ADR-058).
 */
void handleReadAll(const char *line) {
  long digitalPins[MAX_SCAN_PINS];
  size_t digitalCount = extractIntArray(line, "digitalPins", digitalPins, MAX_SCAN_PINS);
  long analogPins[MAX_SCAN_PINS];
  size_t analogCount = extractIntArray(line, "analogPins", analogPins, MAX_SCAN_PINS);

  Serial.print("{\"ok\":true,\"digital\":{");
  for (size_t i = 0; i < digitalCount; i++) {
    if (i > 0) Serial.print(",");
    Serial.print("\"");
    Serial.print(digitalPins[i]);
    Serial.print("\":");
    Serial.print(digitalRead((uint8_t)digitalPins[i]));
  }
  Serial.print("},\"analog\":{");
  for (size_t i = 0; i < analogCount; i++) {
    if (i > 0) Serial.print(",");
    Serial.print("\"");
    Serial.print(analogPins[i]);
    Serial.print("\":");
    Serial.print(analogRead((uint8_t)analogPins[i]));
  }
  Serial.println("}}");
}

/* --- Parser manual minimalista para el subconjunto plano de JSON que usa el protocolo --- */

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
