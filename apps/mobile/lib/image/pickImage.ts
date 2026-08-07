import * as ImagePicker from "expo-image-picker";

// Mismos límites que ya aplica el servidor (apps/web/app/api/chat/route.ts,
// ADR-018) — duplicados a propósito, mismo criterio chico que ADR-031: no
// vale la pena un paquete compartido para dos constantes.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface PickedImage {
  data: string;
  mimeType: string;
}

export type PickImageResult =
  | { ok: true; image: PickedImage }
  | { ok: false; error: string }
  | { ok: false; canceled: true };

function toResult(asset: ImagePicker.ImagePickerAsset | undefined): PickImageResult {
  if (!asset?.base64) return { ok: false, error: "No se pudo leer la imagen seleccionada." };

  const mimeType = asset.mimeType ?? "image/jpeg";
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: `Tipo de imagen no soportado: ${mimeType}. Usa PNG, JPEG, WEBP o GIF.` };
  }
  // expo-image-picker ya devuelve el base64 sin el prefijo "data:...;base64,"
  // (a diferencia de FileReader.readAsDataURL en web, que sí lo incluye).
  if (asset.base64.length > MAX_IMAGE_BASE64_LENGTH) {
    return { ok: false, error: "La imagen supera el límite de 4 MB." };
  }

  return { ok: true, image: { data: asset.base64, mimeType } };
}

async function launch(
  requestPermission: () => Promise<ImagePicker.PermissionResponse>,
  launcher: () => Promise<ImagePicker.ImagePickerResult>,
  deniedMessage: string,
): Promise<PickImageResult> {
  const { granted } = await requestPermission();
  if (!granted) return { ok: false, error: deniedMessage };

  const result = await launcher();
  if (result.canceled) return { ok: false, canceled: true };

  return toResult(result.assets[0]);
}

export function pickFromLibrary(): Promise<PickImageResult> {
  return launch(
    ImagePicker.requestMediaLibraryPermissionsAsync,
    () => ImagePicker.launchImageLibraryAsync({ base64: true, mediaTypes: ["images"], quality: 0.8 }),
    "No se pudo acceder a tus fotos. Revisa los permisos de la app.",
  );
}

export function pickFromCamera(): Promise<PickImageResult> {
  return launch(
    ImagePicker.requestCameraPermissionsAsync,
    () => ImagePicker.launchCameraAsync({ base64: true, mediaTypes: ["images"], quality: 0.8 }),
    "No se pudo acceder a la cámara. Revisa los permisos de la app.",
  );
}
