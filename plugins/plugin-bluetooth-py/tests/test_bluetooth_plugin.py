import pytest

from src.ble_transport import BleDeviceInfo
from src.bluetooth_plugin import ADAPTER_DEVICE_ID, BluetoothPlugin

from .fake_ble_transport import FakeBleDevice, FakeBluetoothTransport

DEVICE_A = FakeBleDevice(
    info=BleDeviceInfo(address="AA:BB:CC:DD:EE:01", name="Sensor A", rssi=-40),
    characteristics={"svc1:chr1": bytes.fromhex("a1b2")},
)
DEVICE_UNREACHABLE = FakeBleDevice(info=BleDeviceInfo(address="AA:BB:CC:DD:EE:02", name="Fuera de rango"), reachable=False)


@pytest.mark.asyncio
async def test_discover_devuelve_el_adaptador():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([]))
    devices = await plugin.discover()
    assert len(devices) == 1
    assert devices[0].id == ADAPTER_DEVICE_ID


@pytest.mark.asyncio
async def test_connect_con_device_id_desconocido_lanza():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([]))
    with pytest.raises(ValueError):
        await plugin.connect("otro-dispositivo")


def test_get_capabilities_expone_las_cuatro_capabilities_con_su_severidad():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([]))
    capabilities = {c.name: c for c in plugin.get_capabilities(ADAPTER_DEVICE_ID)}
    assert capabilities["scan_bluetooth_devices"].severity == "read-only"
    assert capabilities["read_characteristic"].severity == "read-only"
    assert capabilities["write_characteristic"].severity == "irreversible-material"
    assert capabilities["disconnect_bluetooth_device"].severity == "reversible"


@pytest.mark.asyncio
async def test_scan_bluetooth_devices_devuelve_los_perifericos_del_transporte():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    result = await plugin.invoke(ADAPTER_DEVICE_ID, "scan_bluetooth_devices", {})
    assert result.success is True
    assert result.data["devices"] == [{"address": "AA:BB:CC:DD:EE:01", "name": "Sensor A", "rssi": -40}]


@pytest.mark.asyncio
async def test_list_targets_refleja_el_ultimo_scan():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    assert plugin.list_targets(ADAPTER_DEVICE_ID) == []
    await plugin.invoke(ADAPTER_DEVICE_ID, "scan_bluetooth_devices", {})
    targets = plugin.list_targets(ADAPTER_DEVICE_ID)
    assert len(targets) == 1
    assert targets[0].target == "AA:BB:CC:DD:EE:01"
    assert targets[0].default_severity == "irreversible-material"


@pytest.mark.asyncio
async def test_read_characteristic_exitoso():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    result = await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "read_characteristic",
        {"address": DEVICE_A.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1"},
    )
    assert result.success is True
    assert result.data == {"value": "a1b2"}


@pytest.mark.asyncio
async def test_read_characteristic_sin_address_falla_con_error_claro():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    result = await plugin.invoke(ADAPTER_DEVICE_ID, "read_characteristic", {"serviceUuid": "svc1", "characteristicUuid": "chr1"})
    assert result.success is False
    assert "address" in result.error


@pytest.mark.asyncio
async def test_read_characteristic_periferico_fuera_de_rango():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_UNREACHABLE]))
    result = await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "read_characteristic",
        {"address": DEVICE_UNREACHABLE.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1"},
    )
    assert result.success is False


@pytest.mark.asyncio
async def test_write_characteristic_exitoso_y_read_posterior_ve_el_valor_nuevo():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    write_result = await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "write_characteristic",
        {"address": DEVICE_A.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1", "value": "ff"},
    )
    assert write_result.success is True

    read_result = await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "read_characteristic",
        {"address": DEVICE_A.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1"},
    )
    assert read_result.data == {"value": "ff"}


@pytest.mark.asyncio
async def test_write_characteristic_con_valor_no_hexadecimal_falla_sin_llamar_al_transporte():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    result = await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "write_characteristic",
        {"address": DEVICE_A.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1", "value": "no-es-hex"},
    )
    assert result.success is False


@pytest.mark.asyncio
async def test_disconnect_bluetooth_device_sin_conexion_previa_es_no_op_exitoso():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    result = await plugin.invoke(ADAPTER_DEVICE_ID, "disconnect_bluetooth_device", {"address": DEVICE_A.info.address})
    assert result.success is True


@pytest.mark.asyncio
async def test_disconnect_bluetooth_device_cierra_una_conexion_activa():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
    await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "read_characteristic",
        {"address": DEVICE_A.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1"},
    )
    result = await plugin.invoke(ADAPTER_DEVICE_ID, "disconnect_bluetooth_device", {"address": DEVICE_A.info.address})
    assert result.success is True

    # Tras desconectar, la próxima lectura reconecta de cero — sigue funcionando.
    read_result = await plugin.invoke(
        ADAPTER_DEVICE_ID,
        "read_characteristic",
        {"address": DEVICE_A.info.address, "serviceUuid": "svc1", "characteristicUuid": "chr1"},
    )
    assert read_result.success is True


@pytest.mark.asyncio
async def test_invoke_capability_desconocida():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([]))
    result = await plugin.invoke(ADAPTER_DEVICE_ID, "algo_que_no_existe", {})
    assert result.success is False


@pytest.mark.asyncio
async def test_invoke_device_id_desconocido():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([]))
    result = await plugin.invoke("otro-dispositivo", "scan_bluetooth_devices", {})
    assert result.success is False
