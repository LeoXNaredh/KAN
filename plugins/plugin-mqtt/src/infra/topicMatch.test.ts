import { describe, expect, it } from "vitest";
import { matchesTopicFilter } from "./topicMatch";

describe("matchesTopicFilter", () => {
  it("un filtro sin wildcards solo matchea el topic exacto", () => {
    expect(matchesTopicFilter("sensors/kitchen/temp", "sensors/kitchen/temp")).toBe(true);
    expect(matchesTopicFilter("sensors/kitchen/temp", "sensors/kitchen/humidity")).toBe(false);
    expect(matchesTopicFilter("sensors/kitchen/temp", "sensors/kitchen")).toBe(false);
  });

  it("'+' matchea exactamente un nivel", () => {
    expect(matchesTopicFilter("sensors/+/temp", "sensors/kitchen/temp")).toBe(true);
    expect(matchesTopicFilter("sensors/+/temp", "sensors/garage/temp")).toBe(true);
    expect(matchesTopicFilter("sensors/+/temp", "sensors/kitchen/sub/temp")).toBe(false);
    expect(matchesTopicFilter("sensors/+/temp", "sensors/temp")).toBe(false);
  });

  it("'#' matchea el resto de los niveles, incluyendo cero niveles adicionales (spec MQTT: 'sport/#' matchea 'sport')", () => {
    expect(matchesTopicFilter("sensors/#", "sensors/kitchen/temp")).toBe(true);
    expect(matchesTopicFilter("sensors/#", "sensors")).toBe(true);
    expect(matchesTopicFilter("sensors/#", "sensors/kitchen")).toBe(true);
    expect(matchesTopicFilter("#", "anything/at/all")).toBe(true);
  });

  it("combina '+' y '#' en el mismo filtro", () => {
    expect(matchesTopicFilter("sensors/+/#", "sensors/kitchen/temp/raw")).toBe(true);
    expect(matchesTopicFilter("sensors/+/#", "sensors/kitchen")).toBe(true);
  });

  it("un filtro más largo que el topic no matchea", () => {
    expect(matchesTopicFilter("sensors/kitchen/temp/raw", "sensors/kitchen/temp")).toBe(false);
  });
});
