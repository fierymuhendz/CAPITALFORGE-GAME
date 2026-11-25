import { describe, expect, it } from "vitest";
import { capMinutes, scaleTravelMinutes, travelScaleBp } from "./pace";

describe("tempo", () => {
  it("capMinutes: tavan, 0 = kapalı, en az 1", () => {
    expect(capMinutes(450, 60)).toBe(60);
    expect(capMinutes(30, 60)).toBe(30);
    expect(capMinutes(450, 0)).toBe(450);
  });
  it("travelScaleBp: en uzun sefer tavanı aşmaz, kısa/uzun farkı korunur", () => {
    const longest = 290; // 250 km @ 60 km/s + 40 dk
    const s = travelScaleBp(60, longest);
    expect(scaleTravelMinutes(longest, s)).toBeLessThanOrEqual(60);
    const short = scaleTravelMinutes(70 + 40, s), long = scaleTravelMinutes(230, s);
    expect(short).toBeLessThan(long);
    expect(travelScaleBp(0, longest)).toBe(10000);
    expect(travelScaleBp(60, 50)).toBe(10000);
    expect(scaleTravelMinutes(0, s)).toBe(0);
    expect(scaleTravelMinutes(1, s)).toBe(1);
  });
});
