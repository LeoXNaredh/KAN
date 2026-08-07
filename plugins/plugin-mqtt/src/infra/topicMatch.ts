/**
 * ¿`topic` (un topic real, sin wildcards) cae bajo `filter` (lo que se pasó
 * a `subscribe_mqtt`, puede tener `+`/`#`)? Implementación estándar de MQTT:
 * `+` matchea exactamente un nivel, `#` matchea el resto (debe ser el
 * último segmento del filtro). mqtt.js no expone este matching — el cliente
 * solo emite un evento `message` global por conexión, así que el plugin
 * necesita decidir a qué handler(s) despachar cada mensaje entrante.
 */
export function matchesTopicFilter(filter: string, topic: string): boolean {
  const filterParts = filter.split("/");
  const topicParts = topic.split("/");

  for (let i = 0; i < filterParts.length; i++) {
    const part = filterParts[i];
    if (part === "#") return true;
    if (i >= topicParts.length) return false;
    if (part === "+") continue;
    if (part !== topicParts[i]) return false;
  }

  return filterParts.length === topicParts.length;
}
