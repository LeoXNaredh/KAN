"""Puerto de BLE central-mode sobre `bleak` — mismo criterio de nombres que
`FrameSourcePort` (plugin-vision-py): ABC + implementación real + fake
inyectable para tests, sin adaptador BLE real."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class BleDeviceInfo:
    address: str
    name: Optional[str] = None
    rssi: Optional[int] = None


class BleConnectionPort(ABC):
    @abstractmethod
    async def read_characteristic(self, service_uuid: str, characteristic_uuid: str) -> bytes: ...

    @abstractmethod
    async def write_characteristic(self, service_uuid: str, characteristic_uuid: str, value: bytes) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...


class BluetoothTransportPort(ABC):
    @abstractmethod
    async def scan(self, timeout_s: float) -> list[BleDeviceInfo]: ...

    @abstractmethod
    async def connect(self, address: str) -> BleConnectionPort: ...


class BleakBluetoothTransport(BluetoothTransportPort):
    """Implementación real — `bleak` se importa acá adentro (no a nivel de
    módulo), mismo criterio que `cv2` en `OpenCvFrameSource`: código que
    solo necesita el puerto (tests) no fuerza la dependencia."""

    async def scan(self, timeout_s: float) -> list[BleDeviceInfo]:
        from bleak import BleakScanner

        devices = await BleakScanner.discover(timeout=timeout_s)
        return [BleDeviceInfo(address=d.address, name=d.name, rssi=getattr(d, "rssi", None)) for d in devices]

    async def connect(self, address: str) -> BleConnectionPort:
        from bleak import BleakClient

        client = BleakClient(address)
        await client.connect()
        if not client.is_connected:
            raise RuntimeError(f"No se pudo conectar a {address}")
        return _BleakConnection(client)


class _BleakConnection(BleConnectionPort):
    def __init__(self, client) -> None:
        self._client = client

    async def read_characteristic(self, service_uuid: str, characteristic_uuid: str) -> bytes:
        # bleak resuelve la característica por su UUID solo (busca en todos
        # los servicios del periférico ya conectado) — `service_uuid` viaja
        # en la firma del puerto por paridad con la capability expuesta al
        # LLM (mismo shape que el plugin TS, que sí lo pide), no porque
        # bleak lo necesite.
        value = await self._client.read_gatt_char(characteristic_uuid)
        return bytes(value)

    async def write_characteristic(self, service_uuid: str, characteristic_uuid: str, value: bytes) -> None:
        await self._client.write_gatt_char(characteristic_uuid, value)

    async def disconnect(self) -> None:
        await self._client.disconnect()
