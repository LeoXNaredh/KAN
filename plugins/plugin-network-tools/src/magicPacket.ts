const MAC_PATTERN = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

export function isValidMacAddress(mac: string): boolean {
  return MAC_PATTERN.test(mac);
}

function macToBytes(mac: string): number[] {
  const clean = mac.replace(/[:-]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < 12; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return bytes;
}

/** 6 bytes 0xFF + la MAC repetida 16 veces — el magic packet Wake-on-LAN clásico. */
export function buildMagicPacket(macAddress: string): Buffer {
  if (!isValidMacAddress(macAddress)) throw new Error(`MAC address inválida: ${macAddress}`);
  const macBytes = macToBytes(macAddress);
  const header = new Array<number>(6).fill(0xff);
  const payload: number[] = [];
  for (let i = 0; i < 16; i++) payload.push(...macBytes);
  return Buffer.from([...header, ...payload]);
}
