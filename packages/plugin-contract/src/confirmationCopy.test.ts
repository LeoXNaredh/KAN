import { describe, expect, it } from "vitest";
import { describeConfirmationConsequence } from "./confirmationCopy";

describe("describeConfirmationConsequence", () => {
  it("da un texto humano para irreversible-material, sin jerga técnica", () => {
    const text = describeConfirmationConsequence("irreversible-material");
    expect(text).not.toMatch(/irreversible-material|severity|threshold/i);
    expect(text.length).toBeGreaterThan(0);
  });

  it("da un texto humano para safety-critical, sin jerga técnica", () => {
    const text = describeConfirmationConsequence("safety-critical");
    expect(text).not.toMatch(/safety-critical|severity|threshold/i);
    expect(text.length).toBeGreaterThan(0);
  });
});
