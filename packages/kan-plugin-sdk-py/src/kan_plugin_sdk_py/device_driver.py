"""Espejo a mano de packages/plugin-contract/src/deviceDriverPort.ts,
targetDescriptor.ts y packages/plugin-sdk-ts/src/KanDeviceDriverPlugin.ts.

Un plugin sidecar concreto (ej. `plugin-vision-py`) hereda de
`KanDeviceDriverPlugin` e implementa los métodos abstractos — el `runner`
(`runner.py`) es el único que habla el protocolo WS; el plugin nunca ve
un socket.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

from .capability import CapabilityDescriptor, CapabilityResult
from .manifest import PluginManifest
from .severity import ActionSeverity


@dataclass
class DeviceDescriptor:
    id: str
    name: str
    kind: str

    def to_wire(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "kind": self.kind}


@dataclass
class TargetDescriptor:
    target: str
    default_severity: ActionSeverity
    suggested_alias: Optional[str] = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"target": self.target, "defaultSeverity": self.default_severity}
        if self.suggested_alias is not None:
            wire["suggestedAlias"] = self.suggested_alias
        return wire


class KanDeviceDriverPlugin(ABC):
    """Base para plugins sidecar. Misma forma que `KanDeviceDriverPlugin.ts`
    del lado in-process — el Edge Agent no distingue un driver TS de un
    proxy hacia un sidecar Python, ambos implementan el mismo contrato."""

    manifest: PluginManifest

    async def on_load(self) -> None:
        """Se llama una vez, apenas el runner termina el handshake `sidecar_hello`."""
        return None

    async def on_unload(self) -> None:
        """Se llama al recibir `shutdown` del Edge Agent, antes de que el runner cierre el socket."""
        return None

    @abstractmethod
    async def discover(self) -> list[DeviceDescriptor]: ...

    @abstractmethod
    async def connect(self, device_id: str) -> None: ...

    @abstractmethod
    async def disconnect(self, device_id: str) -> None: ...

    @abstractmethod
    def get_capabilities(self, device_id: str) -> list[CapabilityDescriptor]: ...

    @abstractmethod
    async def invoke(self, device_id: str, capability_name: str, input_value: Any) -> CapabilityResult: ...

    def list_targets(self, device_id: str) -> list[TargetDescriptor]:
        """Vacío por defecto, igual que `KanDeviceDriverPlugin.ts` — la mayoría
        de los drivers no tienen targets configurables de antemano."""
        return []
