import { describe, expect, it } from "vitest";
import { buildMagicPacket, isValidMacAddress } from "./magicPacket";

describe("magicPacket", () => {
  it("isValidMacAddress acepta MACs con : y con -", () => {
    expect(isValidMacAddress("AA:BB:CC:DD:EE:FF")).toBe(true);
    expect(isValidMacAddress("aa-bb-cc-dd-ee-ff")).toBe(true);
  });

  it("isValidMacAddress rechaza formatos inválidos", () => {
    expect(isValidMacAddress("no-es-una-mac")).toBe(false);
    expect(isValidMacAddress("AA:BB:CC:DD:EE")).toBe(false);
    expect(isValidMacAddress("")).toBe(false);
  });

  it("buildMagicPacket arma 6 bytes 0xFF + la MAC repetida 16 veces (102 bytes)", () => {
    const packet = buildMagicPacket("AA:BB:CC:DD:EE:FF");
    expect(packet.length).toBe(102);
    for (let i = 0; i < 6; i++) expect(packet[i]).toBe(0xff);

    const expectedMacBytes = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    for (let rep = 0; rep < 16; rep++) {
      const offset = 6 + rep * 6;
      expect(Array.from(packet.subarray(offset, offset + 6))).toEqual(expectedMacBytes);
    }
  });

  it("buildMagicPacket tira con una MAC inválida", () => {
    expect(() => buildMagicPacket("invalida")).toThrow(/MAC address inválida/);
  });
});
