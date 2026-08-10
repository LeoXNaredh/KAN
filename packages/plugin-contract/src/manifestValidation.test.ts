import { describe, expect, it } from "vitest";
import { validatePluginManifest } from "./manifestValidation";

const validManifest = {
  id: "kan-plugin-vision-py",
  version: "0.1.0",
  displayName: "Visión artificial (OpenCV)",
  kind: "device-driver",
  runtime: "python-sidecar",
  permissions: { devices: ["camera-usb"], network: false, filesystem: [] },
};

describe("validatePluginManifest", () => {
  it("acepta un manifest válido", () => {
    const result = validatePluginManifest(validManifest);
    expect(result.ok).toBe(true);
  });

  it("acepta un manifest válido con signature opcional", () => {
    const result = validatePluginManifest({ ...validManifest, signature: "abc" });
    expect(result.ok).toBe(true);
  });

  it("rechaza si falta un campo requerido", () => {
    const { id: _id, ...withoutId } = validManifest;
    const result = validatePluginManifest(withoutId);
    expect(result.ok).toBe(false);
  });

  it("rechaza un kind desconocido", () => {
    const result = validatePluginManifest({ ...validManifest, kind: "algo-inventado" });
    expect(result.ok).toBe(false);
  });

  it("rechaza un runtime desconocido", () => {
    const result = validatePluginManifest({ ...validManifest, runtime: "in-browser" });
    expect(result.ok).toBe(false);
  });

  it("rechaza permissions con forma incorrecta", () => {
    const result = validatePluginManifest({ ...validManifest, permissions: { devices: "no-es-array" } });
    expect(result.ok).toBe(false);
  });

  it("rechaza un input que no es un objeto", () => {
    const result = validatePluginManifest("no soy un manifest");
    expect(result.ok).toBe(false);
  });

  it("rechaza undefined", () => {
    const result = validatePluginManifest(undefined);
    expect(result.ok).toBe(false);
  });
});
