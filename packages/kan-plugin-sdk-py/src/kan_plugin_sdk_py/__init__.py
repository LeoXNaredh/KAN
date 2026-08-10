"""SDK Python para plugins sidecar de KAN (ADR-056).

Equivalente Python de `@kan/plugin-sdk-ts` — un plugin concreto hereda de
`KanDeviceDriverPlugin`, declara su `manifest` y expone `create_plugin()`
en un `main.py` (ver `loader.py`). `runner.py` es el único módulo que
habla el protocolo WS con el Edge Agent; el plugin nunca ve un socket.
"""

from .capability import CapabilityDescriptor, CapabilityResult
from .device_driver import DeviceDescriptor, KanDeviceDriverPlugin, TargetDescriptor
from .manifest import PluginManifest, PluginPermissions
from .severity import ActionSeverity, requires_confirmation

__all__ = [
    "ActionSeverity",
    "CapabilityDescriptor",
    "CapabilityResult",
    "DeviceDescriptor",
    "KanDeviceDriverPlugin",
    "PluginManifest",
    "PluginPermissions",
    "TargetDescriptor",
    "requires_confirmation",
]
