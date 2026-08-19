import { describe, expect, it } from "vitest";
import { extractPrimaryNumericValue } from "./extractPrimaryNumericValue";

describe("extractPrimaryNumericValue", () => {
  it("un número directo se devuelve tal cual", () => {
    expect(extractPrimaryNumericValue(23.4)).toBe(23.4);
  });

  it("un objeto con exactamente un campo numérico devuelve ese campo", () => {
    expect(extractPrimaryNumericValue({ temperatureC: 23.4 })).toBe(23.4);
  });

  it("un objeto con varios campos numéricos no elige ninguno (undefined)", () => {
    expect(extractPrimaryNumericValue({ temperatureC: 23.4, humidity: 55 })).toBeUndefined();
  });

  it("un objeto sin ningún campo numérico devuelve undefined", () => {
    expect(extractPrimaryNumericValue({ status: "ok" })).toBeUndefined();
  });

  it("valores no numéricos/no-objeto devuelven undefined", () => {
    expect(extractPrimaryNumericValue("23.4")).toBeUndefined();
    expect(extractPrimaryNumericValue(null)).toBeUndefined();
    expect(extractPrimaryNumericValue(undefined)).toBeUndefined();
    expect(extractPrimaryNumericValue(true)).toBeUndefined();
  });

  it("NaN/Infinity no cuentan como numéricos", () => {
    expect(extractPrimaryNumericValue(NaN)).toBeUndefined();
    expect(extractPrimaryNumericValue(Infinity)).toBeUndefined();
    expect(extractPrimaryNumericValue({ value: NaN })).toBeUndefined();
  });
});
