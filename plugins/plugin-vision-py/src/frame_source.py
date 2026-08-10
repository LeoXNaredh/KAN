"""Puerto sobre `cv2.VideoCapture` — mismo criterio de nombres que
`FakeGpioPort`/`FakeSerialTransport` del lado TS (`ABC` + implementación
real + fake inyectable para tests, sin cámara real)."""

from abc import ABC, abstractmethod
from typing import Optional

import numpy as np


class FrameSourcePort(ABC):
    @abstractmethod
    def open(self) -> bool:
        """Intenta abrir la fuente de video. Nunca lanza — devuelve False si no hay cámara disponible."""

    @property
    @abstractmethod
    def is_open(self) -> bool: ...

    @abstractmethod
    def read_frame(self) -> Optional["np.ndarray"]:
        """Devuelve el frame más reciente en BGR, o None si no se pudo leer (sin cámara, cámara desconectada, etc.)."""

    @abstractmethod
    def close(self) -> None: ...


class OpenCvFrameSource(FrameSourcePort):
    """Implementación real — `cv2` se importa acá adentro (no a nivel de
    módulo) para que `FakeFrameSource` (y cualquier código que solo
    necesite el puerto) no fuerce la dependencia pesada de OpenCV."""

    def __init__(self, camera_index: int = 0) -> None:
        self._camera_index = camera_index
        self._capture = None

    def open(self) -> bool:
        import cv2

        capture = cv2.VideoCapture(self._camera_index)
        if not capture.isOpened():
            capture.release()
            return False
        self._capture = capture
        return True

    @property
    def is_open(self) -> bool:
        return self._capture is not None and self._capture.isOpened()

    def read_frame(self) -> Optional["np.ndarray"]:
        if self._capture is None:
            return None
        ok, frame = self._capture.read()
        return frame if ok else None

    def close(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None
