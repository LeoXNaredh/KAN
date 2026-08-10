"""Doble de `BluetoothTransportPort` para tests — sin adaptador BLE real
(ADR-012 del lado Python, mismo criterio que `FakeFrameSource`)."""

from dataclasses import dataclass, field
from typing import Optional

from src.ble_transport import BleConnectionPort, BleDeviceInfo, BluetoothTransportPort


@dataclass
class FakeBleDevice:
    info: BleDeviceInfo
    # clave "service_uuid:characteristic_uuid" -> valor actual.
    characteristics: dict[str, bytes] = field(default_factory=dict)
    reachable: bool = True


def _key(service_uuid: str, characteristic_uuid: str) -> str:
    return f"{service_uuid}:{characteristic_uuid}"


class _FakeBleConnection(BleConnectionPort):
    def __init__(self, device: FakeBleDevice) -> None:
        self._device = device
        self._connected = True

    async def read_characteristic(self, service_uuid: str, characteristic_uuid: str) -> bytes:
        if not self._connected:
            raise RuntimeError("Conexión BLE cerrada")
        key = _key(service_uuid, characteristic_uuid)
        if key not in self._device.characteristics:
            raise RuntimeError(f"Característica desconocida: {service_uuid}/{characteristic_uuid}")
        return self._device.characteristics[key]

    async def write_characteristic(self, service_uuid: str, characteristic_uuid: str, value: bytes) -> None:
        if not self._connected:
            raise RuntimeError("Conexión BLE cerrada")
        self._device.characteristics[_key(service_uuid, characteristic_uuid)] = value

    async def disconnect(self) -> None:
        self._connected = False


class FakeBluetoothTransport(BluetoothTransportPort):
    def __init__(self, devices: Optional[list[FakeBleDevice]] = None) -> None:
        self._devices = devices or []

    async def scan(self, timeout_s: float) -> list[BleDeviceInfo]:
        return [d.info for d in self._devices]

    async def connect(self, address: str) -> BleConnectionPort:
        device = next((d for d in self._devices if d.info.address == address), None)
        if device is None or not device.reachable:
            raise RuntimeError(f"No se pudo conectar a {address}")
        return _FakeBleConnection(device)
