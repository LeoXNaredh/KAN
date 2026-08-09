/**
 * Abstracción de envío de un magic packet Wake-on-LAN a un target ya
 * configurado. Sin dependencia nueva a propósito: el formato del magic
 * packet es trivial y estable (6 bytes 0xFF + 16 repeticiones de la MAC,
 * RFC histórico de AMD, sin cambios en décadas) — implementarlo a mano con
 * `dgram` nativo es más simple y auditable que sumar una librería externa
 * para 15 líneas de lógica. Testeable sin red real con un fake (ver
 * infra/FakeWolTransport.ts).
 */
export interface WolTransportPort {
  sendMagicPacket(macAddress: string, broadcastAddress: string, port: number): Promise<void>;
}
