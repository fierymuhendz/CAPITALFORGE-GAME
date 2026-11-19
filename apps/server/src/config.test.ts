import { describe, expect, it } from "vitest";
import { parseIntRange } from "./config";

const parse = (v: string | undefined) => parseIntRange("NEW_ACCOUNT_TRADE_DELAY_SECONDS", v, 600, 0, 86_400);

describe("parseIntRange (NEW_ACCOUNT_TRADE_DELAY_SECONDS)", () => {
  it("boşsa varsayılan 600", () => {
    expect(parse(undefined)).toBe(600);
    expect(parse("")).toBe(600);
  });
  it("0 (kapalı) ve üst sınır kabul edilir", () => {
    expect(parse("0")).toBe(0);
    expect(parse("86400")).toBe(86_400);
    expect(parse("120")).toBe(120);
  });
  it("geçersiz değer başlangıçta hata verir", () => {
    for (const bad of ["-1", "86401", "1.5", "abc", "1e3", "10 sn"]) {
      expect(() => parse(bad), bad).toThrow(/NEW_ACCOUNT_TRADE_DELAY_SECONDS/);
    }
  });
});
