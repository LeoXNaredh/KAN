import type { KnownDeviceRecord } from "../entities/KnownDevice";

export interface DeviceStorePort {
  load(): KnownDeviceRecord[];
  save(records: KnownDeviceRecord[]): void;
}
