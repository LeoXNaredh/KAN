export interface PairingCode {
  code: string;
  expiresAt: string;
}

export interface PairingClaim {
  ownerId: string;
  secret: string;
  /**
   * Config de plugins (`KAN_SSH_HOSTS`, `KAN_MQTT_BROKERS`, etc.) que el
   * usuario ya guardó desde /configuracion, si tenía alguna al momento de
   * aparear. Best-effort — un fallo al leerla nunca hace fallar el pairing
   * en sí, el Edge Agent puede pedirla de nuevo con `getPluginConfig()`.
   */
  pluginConfig?: Record<string, string>;
}

/**
 * Puerto de pairing de Edge Agents (docs/19, P2 incremento 3). Un
 * Edge Agent (ej. apps/desktop) nunca tiene sesión de Supabase — este es el
 * único mecanismo para asociarlo a un usuario: un código de un solo uso,
 * generado por un usuario logueado, que el agente reclama para obtener un
 * secreto de larga vida.
 */
export interface PairingPort {
  generateCode(userId: string): Promise<PairingCode>;
  /**
   * El Edge Agent reclama un código sin sesión de usuario — devuelve el
   * secreto en texto plano (una sola vez) y el `ownerId`. `undefined` si el
   * código no existe, ya se usó, o venció.
   */
  claim(code: string, edgeAgentId: string): Promise<PairingClaim | undefined>;
  /**
   * Resuelve el `ownerId` de un Edge Agent ya emparejado, a partir del
   * secreto que presenta en su `hello`. `undefined` si no coincide ningún
   * pairing activo (secreto inválido, o `edgeAgentId` no coincide con el
   * que reclamó ese secreto).
   */
  resolveOwner(secret: string, edgeAgentId: string): Promise<string | undefined>;
  /**
   * Config de plugins actualizada, para que un Edge Agent ya emparejado
   * pueda sincronizar sin tener que volver a aparear cada vez que el
   * usuario edita una conexión desde /configuracion. Misma autenticación
   * que `resolveOwner` (el secreto de pairing) — `undefined` si no resuelve
   * a ningún pairing activo.
   */
  getPluginConfig(secret: string, edgeAgentId: string): Promise<Record<string, string> | undefined>;
}
