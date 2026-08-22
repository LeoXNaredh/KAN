export interface DeviceSnapshotTicketClaim {
  ownerId: string;
  deviceId: string;
}

export interface MintedDeviceSnapshotTicket {
  ticket: string;
  expiresAt: string;
}

/**
 * Ticket de un solo uso para autorizar la subida/descarga de un snapshot de
 * dispositivo — mismo molde que `PluginPackageTicketPort`, reusado para las
 * dos direcciones (`POST /upload-url` y `GET /:id/download-url` en
 * `snapshotRoutes.ts`): el claim es idéntico (quién, para qué dispositivo),
 * solo cambia qué signed URL de Supabase Storage pide la ruta con él.
 */
export interface DeviceSnapshotTicketPort {
  mint(ownerId: string, deviceId: string): MintedDeviceSnapshotTicket;
  /** Un solo uso: consumirlo lo invalida, exista o no. `undefined` si no existía, ya se usó, o expiró. */
  consume(ticket: string): DeviceSnapshotTicketClaim | undefined;
}
