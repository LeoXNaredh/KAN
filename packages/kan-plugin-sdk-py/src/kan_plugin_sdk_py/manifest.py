"""Espejo a mano de packages/plugin-contract/src/manifest.ts.

`signature` sigue siendo un placeholder sin verificación real (mismo
límite documentado del lado TS) — no se firma nada acá todavía.
"""

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

PluginKind = Literal["device-driver", "integration", "processing"]
PluginRuntime = Literal["in-process-ts", "python-sidecar"]


@dataclass
class PluginPermissions:
    devices: list[str] = field(default_factory=list)
    network: bool = False
    filesystem: list[str] = field(default_factory=list)

    def to_wire(self) -> dict[str, Any]:
        return {"devices": self.devices, "network": self.network, "filesystem": self.filesystem}


@dataclass
class PluginManifest:
    id: str
    version: str
    display_name: str
    kind: PluginKind
    runtime: PluginRuntime
    permissions: PluginPermissions
    signature: Optional[str] = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "id": self.id,
            "version": self.version,
            "displayName": self.display_name,
            "kind": self.kind,
            "runtime": self.runtime,
            "permissions": self.permissions.to_wire(),
        }
        if self.signature is not None:
            wire["signature"] = self.signature
        return wire

    @staticmethod
    def from_wire(data: dict[str, Any]) -> "PluginManifest":
        permissions_data = data.get("permissions", {})
        return PluginManifest(
            id=data["id"],
            version=data["version"],
            display_name=data["displayName"],
            kind=data["kind"],
            runtime=data["runtime"],
            permissions=PluginPermissions(
                devices=list(permissions_data.get("devices", [])),
                network=bool(permissions_data.get("network", False)),
                filesystem=list(permissions_data.get("filesystem", [])),
            ),
            signature=data.get("signature"),
        )
