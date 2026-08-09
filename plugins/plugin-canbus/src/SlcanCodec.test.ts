import { describe, expect, it } from "vitest";
import { bitrateToSlcanCommand, decodeFrame, encodeFrame, SLCAN_BITRATE_TO_CODE } from "./SlcanCodec";

describe("SlcanCodec", () => {
  describe("encodeFrame", () => {
    it("trama estándar (11 bits) — formato verificado byte a byte contra python-can (t + 3 hex + DLC + data hex, mayúsculas)", () => {
      const result = encodeFrame({ canId: 0x123, extended: false, data: [0xaa, 0xbb] });
      expect(result).toEqual({ ok: true, line: "t1232AABB" });
    });

    it("trama extendida (29 bits) — T + 8 hex + DLC + data hex", () => {
      const result = encodeFrame({ canId: 0x1abcdef0, extended: true, data: [0x01] });
      expect(result).toEqual({ ok: true, line: "T1ABCDEF0101" });
    });

    it("trama sin data (DLC=0) — solo prefijo + ID + '0'", () => {
      const result = encodeFrame({ canId: 0x001, extended: false, data: [] });
      expect(result).toEqual({ ok: true, line: "t0010" });
    });

    it("ID estándar se rellena a 3 hex incluso si es chico", () => {
      const result = encodeFrame({ canId: 0x01, extended: false, data: [] });
      expect(result).toEqual({ ok: true, line: "t0010" });
    });

    it("rechaza canId fuera de rango estándar (>0x7FF)", () => {
      const result = encodeFrame({ canId: 0x800, extended: false, data: [] });
      expect(result).toEqual({ ok: false, error: expect.stringContaining("fuera de rango") });
    });

    it("rechaza canId fuera de rango extendido (>0x1FFFFFFF)", () => {
      const result = encodeFrame({ canId: 0x20000000, extended: true, data: [] });
      expect(result).toEqual({ ok: false, error: expect.stringContaining("fuera de rango") });
    });

    it("rechaza más de 8 bytes de data (CAN clásico, sin FD)", () => {
      const result = encodeFrame({ canId: 0x100, extended: false, data: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
      expect(result).toEqual({ ok: false, error: expect.stringContaining("8 bytes") });
    });

    it("rechaza un byte de data fuera de 0-255", () => {
      const result = encodeFrame({ canId: 0x100, extended: false, data: [256] });
      expect(result.ok).toBe(false);
    });
  });

  describe("decodeFrame", () => {
    it("decodifica una trama estándar (round-trip con encodeFrame)", () => {
      const encoded = encodeFrame({ canId: 0x123, extended: false, data: [0xaa, 0xbb] });
      expect(encoded.ok).toBe(true);
      const decoded = decodeFrame((encoded as { line: string }).line);
      expect(decoded).toEqual({ canId: 0x123, extended: false, data: [0xaa, 0xbb] });
    });

    it("decodifica una trama extendida (round-trip con encodeFrame)", () => {
      const encoded = encodeFrame({ canId: 0x1abcdef0, extended: true, data: [0x01, 0x02, 0x03] });
      const decoded = decodeFrame((encoded as { line: string }).line);
      expect(decoded).toEqual({ canId: 0x1abcdef0, extended: true, data: [0x01, 0x02, 0x03] });
    });

    it("ignora líneas que no son tramas de datos (ACK vacío, eco de setup)", () => {
      expect(decodeFrame("")).toBeUndefined();
      expect(decodeFrame("z")).toBeUndefined();
      expect(decodeFrame("S6")).toBeUndefined();
    });

    it("devuelve undefined para una trama truncada (data incompleta)", () => {
      expect(decodeFrame("t1232AA")).toBeUndefined();
    });

    it("devuelve undefined para un DLC inválido (>8)", () => {
      expect(decodeFrame("t123F")).toBeUndefined();
    });
  });

  describe("bitrateToSlcanCommand — tabla verificada contra el código fuente real de python-can", () => {
    it("mapea los bitrates estándar a su código S", () => {
      expect(bitrateToSlcanCommand(500_000)).toBe("S6");
      expect(bitrateToSlcanCommand(250_000)).toBe("S5");
      expect(bitrateToSlcanCommand(1_000_000)).toBe("S8");
      expect(bitrateToSlcanCommand(83_300)).toBe("S9");
    });

    it("un bitrate no soportado no mapea a nada — no hay forma de adivinar un código inventado", () => {
      expect(bitrateToSlcanCommand(1_234_567)).toBeUndefined();
    });

    it("expone la tabla completa para validación de config (10 entradas, S0-S9)", () => {
      expect(SLCAN_BITRATE_TO_CODE.size).toBe(10);
    });
  });
});
