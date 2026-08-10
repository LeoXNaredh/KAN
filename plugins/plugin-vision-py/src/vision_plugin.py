"""Plugin de referencia para `kan-plugin-sdk-py` (ADR-056, Fase 2) —
primer caso de prueba real del SDK. Detecta caras en el frame actual de
una cámara USB vía un Haar cascade ya empaquetado con `opencv-python`
(sin descargar pesos de modelo externos, para mantener el ejemplo simple
y determinístico).
"""

from typing import Any, Optional

from kan_plugin_sdk_py import (
    CapabilityDescriptor,
    CapabilityResult,
    DeviceDescriptor,
    KanDeviceDriverPlugin,
    PluginManifest,
    PluginPermissions,
)

from .frame_source import FrameSourcePort, OpenCvFrameSource

DEVICE_ID = "camera-usb-0"


def _load_face_cascade():
    import cv2

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    return cv2.CascadeClassifier(cascade_path)


class VisionPlugin(KanDeviceDriverPlugin):
    kind = "vision-py"

    def __init__(self, frame_source: Optional[FrameSourcePort] = None, camera_index: int = 0) -> None:
        self.manifest = PluginManifest(
            id="kan-plugin-vision-py",
            version="0.1.0",
            display_name="Visión artificial (OpenCV)",
            kind="device-driver",
            runtime="python-sidecar",
            permissions=PluginPermissions(devices=["camera-usb"], network=False, filesystem=[]),
        )
        self._frame_source = frame_source or OpenCvFrameSource(camera_index)
        self._face_cascade: Any = None

    async def discover(self) -> list[DeviceDescriptor]:
        # Nunca lanza — sin cámara disponible, discover() devuelve una lista
        # vacía (mismo criterio que el resto de los drivers de hardware:
        # "sin dispositivo conectado, discover() no debe tumbar nada").
        if self._frame_source.is_open or self._frame_source.open():
            return [DeviceDescriptor(id=DEVICE_ID, name="Cámara USB", kind=self.kind)]
        return []

    async def connect(self, device_id: str) -> None:
        if device_id != DEVICE_ID:
            raise ValueError(f"Dispositivo desconocido: {device_id}")
        if not self._frame_source.is_open and not self._frame_source.open():
            raise RuntimeError("No se pudo abrir la cámara.")

    async def disconnect(self, device_id: str) -> None:
        if device_id != DEVICE_ID:
            return
        self._frame_source.close()

    def get_capabilities(self, device_id: str) -> list[CapabilityDescriptor]:
        return [
            CapabilityDescriptor(
                name="detect_objects",
                description="Detecta caras en el frame actual de la cámara.",
                severity="read-only",
                supports_dry_run=False,
            )
        ]

    async def invoke(self, device_id: str, capability_name: str, input_value: Any) -> CapabilityResult:
        if device_id != DEVICE_ID:
            return CapabilityResult(success=False, error=f"Dispositivo desconocido: {device_id}")

        if capability_name != "detect_objects":
            return CapabilityResult(success=False, error=f"Capability desconocida: {capability_name}")

        frame = self._frame_source.read_frame()
        if frame is None:
            # Sin cámara conectada (o sin frame disponible todavía): resultado
            # limpio, no una excepción — mismo criterio que el resto de los
            # plugins de hardware ("sin dispositivo, no debe tumbar nada").
            return CapabilityResult(success=False, error="No se pudo leer un frame de la cámara.")

        if self._face_cascade is None:
            self._face_cascade = _load_face_cascade()

        import cv2

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = self._face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
        objects = [
            {"label": "face", "x": int(x), "y": int(y), "width": int(w), "height": int(h)}
            for (x, y, w, h) in detections
        ]
        return CapabilityResult(success=True, data={"objects": objects})


def create_plugin() -> KanDeviceDriverPlugin:
    return VisionPlugin()
