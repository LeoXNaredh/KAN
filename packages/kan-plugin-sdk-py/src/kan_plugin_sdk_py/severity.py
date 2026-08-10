"""Espejo a mano de packages/plugin-contract/src/severity.ts (ADR-004, docs/00)."""

from typing import Literal

ActionSeverity = Literal["read-only", "reversible", "irreversible-material", "safety-critical"]


def requires_confirmation(severity: ActionSeverity) -> bool:
    return severity in ("irreversible-material", "safety-critical")
