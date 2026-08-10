"""Doble de `FrameSourcePort` para tests — sin cámara real (ADR-012 del
lado Python, mismo criterio que `FakeGpioPort`/`FakeSerialTransport`)."""

from typing import Optional

import numpy as np

from src.frame_source import FrameSourcePort


class FakeFrameSource(FrameSourcePort):
    def __init__(self, openable: bool = True, frame: Optional["np.ndarray"] = None) -> None:
        self._openable = openable
        self._opened = False
        # Frame negro 480x640 por defecto: el Haar cascade real nunca
        # detecta nada ahí, lo que hace el resultado de detect_objects
        # determinístico sin depender de qué tan bueno sea el detector.
        self._frame = frame if frame is not None else np.zeros((480, 640, 3), dtype=np.uint8)

    def open(self) -> bool:
        self._opened = self._openable
        return self._opened

    @property
    def is_open(self) -> bool:
        return self._opened

    def read_frame(self) -> Optional["np.ndarray"]:
        return self._frame if self._opened else None

    def close(self) -> None:
        self._opened = False
