# plugin-vision-py

Plugin de referencia para [`kan-plugin-sdk-py`](../../packages/kan-plugin-sdk-py) (ADR-056, Fase 2) — primer caso real de un plugin `runtime: "python-sidecar"`, y el fixture de integración que usa `PluginInstaller`/`SidecarProxyPlugin` (Fase 3) para probarse sin depender de un plugin de terceros.

## Qué hace

Detecta caras en el frame actual de una cámara USB (`detect_objects`, capability `read-only`) vía un Haar cascade ya empaquetado con `opencv-python` — sin descargar pesos de modelo externos, para mantener el ejemplo simple y determinístico. `discover()`/`connect()`/`invoke()` nunca lanzan si no hay cámara conectada; devuelven listas vacías o `CapabilityResult(success=False, ...)`, mismo criterio que el resto de los drivers de hardware del monorepo.

## Estructura (convención de paquete sidecar, ADR-056)

```
plugin-vision-py/
├── manifest.json     # runtime: "python-sidecar", permissions
├── requirements.txt   # kan-plugin-sdk-py + opencv-python-headless + numpy
├── main.py             # create_plugin() — lo importa kan_plugin_sdk_py.loader
└── src/
    ├── vision_plugin.py  # VisionPlugin(KanDeviceDriverPlugin)
    └── frame_source.py    # FrameSourcePort + OpenCvFrameSource (real, default)
```

## Tests

```bash
python -m venv .venv && .venv/Scripts/activate  # o source .venv/bin/activate
pip install -e ../../packages/kan-plugin-sdk-py opencv-python-headless numpy pytest pytest-asyncio websockets
pytest
```

- `tests/test_vision_plugin.py` — unitario, con `FakeFrameSource` (sin cámara real).
- `tests/test_integration_runner.py` — el test de mayor valor: levanta `kan_plugin_sdk_py.runner` real contra un host WS fake en loopback y ejercita `discover`/`connect`/`invoke` de punta a punta.

Sin cámara física disponible en esta sesión de desarrollo — la validación con una cámara USB real queda pendiente, mismo límite ya documentado en el resto de los plugins de hardware del monorepo (ESP32, G-code, Modbus, OPC-UA, CAN bus).
