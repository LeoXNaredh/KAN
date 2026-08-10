"""Bluetooth BLE central-mode real (fix de auditoría de backend #5) — misma
superficie de capabilities/targets que el plugin TS
`plugin-bluetooth-generic` (scan_bluetooth_devices, read_characteristic,
write_characteristic, disconnect_bluetooth_device), corriendo como sidecar
Python vía `bleak` en vez de un binding nativo de Node. `bleno` (Node) es
modo *peripheral*, no central — no sirve para escanear/conectarse a
periféricos, que es lo que este plugin necesita; Web Bluetooth es una API
de navegador, no aplica a un proceso Node en el main de Electron. Sidecar
Python + bleak era, de las tres opciones evaluadas, la única viable — y ya
estaba documentada como "Fase 2" en plugin-bluetooth-generic/README.md.
"""

from typing import Any, Optional

from kan_plugin_sdk_py import (
    CapabilityDescriptor,
    CapabilityResult,
    DeviceDescriptor,
    KanDeviceDriverPlugin,
    PluginManifest,
    PluginPermissions,
    TargetDescriptor,
)

from .ble_transport import BleakBluetoothTransport, BleConnectionPort, BleDeviceInfo, BluetoothTransportPort

ADAPTER_DEVICE_ID = "bluetooth-adapter"
DEFAULT_SCAN_TIMEOUT_S = 5.0


def _is_hex(value: str) -> bool:
    if not value or len(value) % 2 != 0:
        return False
    try:
        int(value, 16)
        return True
    except ValueError:
        return False


class BluetoothPlugin(KanDeviceDriverPlugin):
    kind = "bluetooth-py"

    def __init__(self, transport: Optional[BluetoothTransportPort] = None) -> None:
        self.manifest = PluginManifest(
            id="kan-plugin-bluetooth-py",
            version="0.1.0",
            display_name="Bluetooth (BLE genérico, sidecar Python)",
            kind="device-driver",
            runtime="python-sidecar",
            permissions=PluginPermissions(devices=["bluetooth-generic"], network=False, filesystem=[]),
        )
        self._transport = transport or BleakBluetoothTransport()
        self._connections: dict[str, BleConnectionPort] = {}
        self._last_scan: list[BleDeviceInfo] = []

    async def discover(self) -> list[DeviceDescriptor]:
        return [DeviceDescriptor(id=ADAPTER_DEVICE_ID, name="Adaptador Bluetooth", kind=self.kind)]

    async def connect(self, device_id: str) -> None:
        if device_id != ADAPTER_DEVICE_ID:
            raise ValueError(f"Dispositivo desconocido: {device_id}")

    async def disconnect(self, device_id: str) -> None:
        if device_id != ADAPTER_DEVICE_ID:
            return
        for connection in self._connections.values():
            try:
                await connection.disconnect()
            except Exception:  # noqa: BLE001 — mejor esfuerzo al desconectar todo, un periférico ya caído no debe frenar a los demás
                pass
        self._connections.clear()

    def get_capabilities(self, device_id: str) -> list[CapabilityDescriptor]:
        return [
            CapabilityDescriptor(
                name="scan_bluetooth_devices",
                description="Escanea periféricos Bluetooth (BLE) cercanos.",
                severity="read-only",
                supports_dry_run=False,
            ),
            CapabilityDescriptor(
                name="read_characteristic",
                description="Lee una característica GATT de un periférico BLE.",
                severity="read-only",
                supports_dry_run=False,
                input_schema={
                    "type": "object",
                    "properties": {
                        "address": {"type": "string"},
                        "serviceUuid": {"type": "string"},
                        "characteristicUuid": {"type": "string"},
                    },
                    "required": ["address", "serviceUuid", "characteristicUuid"],
                },
                target_param="address",
            ),
            CapabilityDescriptor(
                name="write_characteristic",
                description="Escribe una característica GATT de un periférico BLE (valor en hexadecimal).",
                severity="irreversible-material",
                supports_dry_run=False,
                input_schema={
                    "type": "object",
                    "properties": {
                        "address": {"type": "string"},
                        "serviceUuid": {"type": "string"},
                        "characteristicUuid": {"type": "string"},
                        "value": {"type": "string"},
                    },
                    "required": ["address", "serviceUuid", "characteristicUuid", "value"],
                },
                target_param="address",
            ),
            CapabilityDescriptor(
                name="disconnect_bluetooth_device",
                description="Desconecta un periférico BLE previamente conectado.",
                severity="reversible",
                supports_dry_run=False,
                input_schema={
                    "type": "object",
                    "properties": {"address": {"type": "string"}},
                    "required": ["address"],
                },
                target_param="address",
            ),
        ]

    def list_targets(self, device_id: str) -> list[TargetDescriptor]:
        return [
            TargetDescriptor(target=d.address, suggested_alias=d.name, default_severity="irreversible-material")
            for d in self._last_scan
        ]

    async def invoke(self, device_id: str, capability_name: str, input_value: Any) -> CapabilityResult:
        if device_id != ADAPTER_DEVICE_ID:
            return CapabilityResult(success=False, error=f"Dispositivo desconocido: {device_id}")

        args = input_value if isinstance(input_value, dict) else {}

        if capability_name == "scan_bluetooth_devices":
            try:
                self._last_scan = await self._transport.scan(DEFAULT_SCAN_TIMEOUT_S)
                return CapabilityResult(
                    success=True,
                    data={
                        "devices": [
                            {"address": d.address, "name": d.name, "rssi": d.rssi} for d in self._last_scan
                        ]
                    },
                )
            except Exception as error:  # noqa: BLE001 — cualquier falla del adaptador/driver del SO se reporta, no tumba el sidecar
                return CapabilityResult(success=False, error=str(error))

        if capability_name == "read_characteristic":
            return await self._read_characteristic(args)

        if capability_name == "write_characteristic":
            return await self._write_characteristic(args)

        if capability_name == "disconnect_bluetooth_device":
            return await self._disconnect_device(args)

        return CapabilityResult(success=False, error=f"Capability desconocida: {capability_name}")

    async def _read_characteristic(self, args: dict[str, Any]) -> CapabilityResult:
        address, service_uuid, characteristic_uuid, error = self._validate_uuids(args)
        if error:
            return CapabilityResult(success=False, error=error)
        try:
            connection = await self._connection_for(address)
            value = await connection.read_characteristic(service_uuid, characteristic_uuid)
            return CapabilityResult(success=True, data={"value": value.hex()})
        except Exception as err:  # noqa: BLE001
            return CapabilityResult(success=False, error=str(err))

    async def _write_characteristic(self, args: dict[str, Any]) -> CapabilityResult:
        address, service_uuid, characteristic_uuid, error = self._validate_uuids(args)
        if error:
            return CapabilityResult(success=False, error=error)
        value_hex = args.get("value")
        if not isinstance(value_hex, str) or not _is_hex(value_hex):
            return CapabilityResult(
                success=False, error="'value' debe ser un string hexadecimal de longitud par (ej. \"01\", \"a1b2\")"
            )
        try:
            connection = await self._connection_for(address)
            await connection.write_characteristic(service_uuid, characteristic_uuid, bytes.fromhex(value_hex))
            return CapabilityResult(success=True, data={})
        except Exception as err:  # noqa: BLE001
            return CapabilityResult(success=False, error=str(err))

    async def _disconnect_device(self, args: dict[str, Any]) -> CapabilityResult:
        address = args.get("address")
        if not isinstance(address, str) or not address.strip():
            return CapabilityResult(success=False, error="'address' debe ser un string no vacío")
        connection = self._connections.pop(address, None)
        if connection is None:
            return CapabilityResult(success=True, data={})
        await connection.disconnect()
        return CapabilityResult(success=True, data={})

    def _validate_uuids(self, args: dict[str, Any]) -> tuple[str, str, str, Optional[str]]:
        address = args.get("address")
        service_uuid = args.get("serviceUuid")
        characteristic_uuid = args.get("characteristicUuid")
        if not isinstance(address, str) or not address.strip():
            return "", "", "", "'address' debe ser un string no vacío"
        if not isinstance(service_uuid, str) or not service_uuid.strip():
            return "", "", "", "'serviceUuid' debe ser un string no vacío"
        if not isinstance(characteristic_uuid, str) or not characteristic_uuid.strip():
            return "", "", "", "'characteristicUuid' debe ser un string no vacío"
        return address, service_uuid, characteristic_uuid, None

    async def _connection_for(self, address: str) -> BleConnectionPort:
        existing = self._connections.get(address)
        if existing is not None:
            return existing
        connection = await self._transport.connect(address)
        self._connections[address] = connection
        return connection


def create_plugin() -> KanDeviceDriverPlugin:
    return BluetoothPlugin()
