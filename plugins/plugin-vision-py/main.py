"""Entry point que `kan_plugin_sdk_py.loader.load_plugin()` importa —
convención fija (ADR-056): todo plugin sidecar expone `create_plugin()` acá."""

from src.vision_plugin import create_plugin

__all__ = ["create_plugin"]
