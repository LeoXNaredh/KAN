"""Convención de paquete (ADR-056): todo plugin sidecar expone un
`main.py` en la raíz de su directorio con una función `create_plugin()`
que devuelve una instancia de `KanDeviceDriverPlugin`. Sin campo de
"entry point" que mantener sincronizado con nada más — convención sobre
configuración, igual que el resto de este SDK.
"""

import importlib.util
import sys
from pathlib import Path

from .device_driver import KanDeviceDriverPlugin


class PluginLoadError(Exception):
    """Import roto, `create_plugin` ausente, o `create_plugin()` no devuelve un `KanDeviceDriverPlugin`."""


def load_plugin(plugin_dir: Path) -> KanDeviceDriverPlugin:
    main_path = plugin_dir / "main.py"
    if not main_path.is_file():
        raise PluginLoadError(f"No se encontró {main_path} — todo plugin sidecar necesita un main.py en la raíz.")

    spec = importlib.util.spec_from_file_location("kan_plugin_main", main_path)
    if spec is None or spec.loader is None:
        raise PluginLoadError(f"No se pudo cargar el módulo desde {main_path}.")

    module = importlib.util.module_from_spec(spec)
    # El plugin puede tener imports relativos a su propio directorio (ej. `from src.vision_plugin import ...`).
    plugin_dir_str = str(plugin_dir)
    if plugin_dir_str not in sys.path:
        sys.path.insert(0, plugin_dir_str)

    try:
        spec.loader.exec_module(module)
    except Exception as error:  # noqa: BLE001 — cualquier excepción de un plugin de terceros se traduce a PluginLoadError
        raise PluginLoadError(f"Error importando {main_path}: {error}") from error

    if not hasattr(module, "create_plugin"):
        raise PluginLoadError(f"{main_path} no define create_plugin().")

    try:
        plugin = module.create_plugin()
    except Exception as error:  # noqa: BLE001
        raise PluginLoadError(f"create_plugin() de {main_path} lanzó una excepción: {error}") from error

    if not isinstance(plugin, KanDeviceDriverPlugin):
        raise PluginLoadError(f"create_plugin() de {main_path} no devolvió un KanDeviceDriverPlugin.")

    return plugin
