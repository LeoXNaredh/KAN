import pytest

from src.vision_plugin import DEVICE_ID, VisionPlugin

from .fake_frame_source import FakeFrameSource


@pytest.mark.asyncio
async def test_discover_sin_camara_devuelve_lista_vacia():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=False))
    assert await plugin.discover() == []


@pytest.mark.asyncio
async def test_discover_con_camara_devuelve_el_dispositivo():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    devices = await plugin.discover()
    assert len(devices) == 1
    assert devices[0].id == DEVICE_ID
    assert devices[0].kind == "vision-py"


@pytest.mark.asyncio
async def test_connect_con_device_id_desconocido_lanza():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    with pytest.raises(ValueError):
        await plugin.connect("otro-dispositivo")


@pytest.mark.asyncio
async def test_connect_sin_camara_disponible_lanza():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=False))
    with pytest.raises(RuntimeError):
        await plugin.connect(DEVICE_ID)


@pytest.mark.asyncio
async def test_connect_exitoso_no_lanza():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    await plugin.connect(DEVICE_ID)


def test_get_capabilities_expone_detect_objects_read_only():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    capabilities = plugin.get_capabilities(DEVICE_ID)
    assert len(capabilities) == 1
    assert capabilities[0].name == "detect_objects"
    assert capabilities[0].severity == "read-only"
    assert capabilities[0].supports_dry_run is False


@pytest.mark.asyncio
async def test_invoke_detect_objects_sin_frame_disponible():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=False))
    result = await plugin.invoke(DEVICE_ID, "detect_objects", {})
    assert result.success is False
    assert result.error is not None


@pytest.mark.asyncio
async def test_invoke_detect_objects_con_frame_negro_no_detecta_nada():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    await plugin.connect(DEVICE_ID)
    result = await plugin.invoke(DEVICE_ID, "detect_objects", {})
    assert result.success is True
    assert result.data == {"objects": []}


@pytest.mark.asyncio
async def test_invoke_capability_desconocida():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    result = await plugin.invoke(DEVICE_ID, "algo_que_no_existe", {})
    assert result.success is False


@pytest.mark.asyncio
async def test_invoke_device_id_desconocido():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    result = await plugin.invoke("otro-dispositivo", "detect_objects", {})
    assert result.success is False
