"""Espejo a mano de packages/plugin-contract/src/capability.ts.

`input_schema` viaja como dict JSON Schema tal cual — la validación real
sigue ocurriendo del lado TypeScript (`CapabilityRegistry` en el Edge
Agent, vía `validateAgainstSchema`) antes de que `invoke` llegue al
sidecar por el protocolo WS; este SDK no reimplementa esa validación.
"""

from dataclasses import dataclass
from typing import Any, Optional

from .severity import ActionSeverity


@dataclass
class CapabilityDescriptor:
    name: str
    description: str
    severity: ActionSeverity
    supports_dry_run: bool
    input_schema: Optional[dict[str, Any]] = None
    target_param: Optional[str] = None

    def to_wire(self) -> dict[str, Any]:
        """Forma exacta que espera `CapabilityDescriptor` del lado TS (camelCase)."""
        wire: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "severity": self.severity,
            "supportsDryRun": self.supports_dry_run,
        }
        if self.input_schema is not None:
            wire["inputSchema"] = self.input_schema
        if self.target_param is not None:
            wire["targetParam"] = self.target_param
        return wire


@dataclass
class CapabilityResult:
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"success": self.success}
        if self.data is not None:
            wire["data"] = self.data
        if self.error is not None:
            wire["error"] = self.error
        return wire
