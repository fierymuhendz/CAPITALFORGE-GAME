import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PRODUCTS, RECIPES } from "@capitalforge/shared";
import { playerShareBp, systemShareFactorBp } from "./index";
import { CATALOG_TUNING, SCENARIOS, buildProfiles, roundTripAudit, runMarket, smallTradeAudit, type ScenarioSpec } from "../sim/market";

const short = (sc: ScenarioSpec): ScenarioSpec => ({ ...sc, hours: 96 });

describe("oyuncu payı ve sistem katsayısı", () => {
  it("pay 0..10000, hacimle artar; katsayı 2000..10000 ve payla azalır (özellik)", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 1, max: 100_000 }), (a, b, nominal) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const sLo = playerShareBp(lo, nominal), sHi = playerShareBp(hi, nominal);
      expect(sLo).toBeGreaterThanOrEqual(0);
      expect(sHi).toBeLessThanOrEqual(10000);
      expect(sHi).toBeGreaterThanOrEqual(sLo);
      const fLo = systemShareFactorBp(sLo, 8000), fHi = systemShareFactorBp(sHi, 8000);
      expect(fHi).toBeGreaterThanOrEqual(2000);
      expect(fLo).toBeLessThanOrEqual(10000);
      expect(fHi).toBeLessThanOrEqual(fLo);
    }));
  });
  it("oyuncu hacmi sıfırken sistem tam destek verir", () => {
    expect(playerShareBp(0, 5000)).toBe(0);
    expect(systemShareFactorBp(playerShareBp(0, 5000), 8000)).toBe(10000);
    expect(playerShareBp(5000, 5000)).toBe(5000);
  });
});

describe("pazar simülasyonu", () => {
  it("aynı tohumla aynı sonucu verir (deterministik)", () => {
    const a = runMarket(short(SCENARIOS[2]!));
    const b = runMarket(short(SCENARIOS[2]!));
    expect(a.totals).toEqual(b.totals);
    expect(a.industryProfit).toEqual(b.industryProfit);
  });
  it("para korunur ve sistemden al-sisteme sat kâr bırakmaz (her senaryo)", () => {
    for (const sc of SCENARIOS) {
      const r = runMarket(short(sc));
      const t = r.totals;
      expect(t.playerCash).toBe(t.sysPaid - t.sysReceived - t.fees - t.freight - t.ops - t.upkeep);
      expect(r.maxRoundTripPerKg < 0n).toBe(true);
      expect(r.bidAboveAsk).toBe(0);
      expect(r.minShareFactorBp).toBeGreaterThanOrEqual(2000);
    }
  });
  it("oyuncular arası işlem, sistem katsayısını düşürür; tek oyuncuda düşmez", () => {
    const solo = runMarket(short(SCENARIOS[0]!));
    const group = runMarket(short(SCENARIOS[2]!));
    expect(solo.minShareFactorBp).toBe(10000);
    expect(group.minShareFactorBp).toBeLessThan(10000);
  });
  it("kıtlıkta arpa/mısır hatları durur, fazla üretimde çelik üretimi artar", () => {
    const short1 = runMarket(SCENARIOS[2]!);
    const prod = (r: ReturnType<typeof runMarket>, w: "A" | "B", pid: string) => r.win[w].products.get(pid)?.producedKg ?? 0;
    expect(prod(short1, "B", "barley")).toBe(0);
    expect(prod(short1, "B", "compound_feed")).toBeLessThan(prod(short1, "A", "compound_feed"));
    const sur = runMarket(SCENARIOS[3]!);
    expect(prod(sur, "B", "steel")).toBeGreaterThan(prod(sur, "A", "steel"));
  });
  it("sistem küçük işlemle kapanmaz; sistem alış-satış turu zararlı", () => {
    const a = smallTradeAudit(CATALOG_TUNING, 25);
    expect(a.closed).toEqual([]);
    expect(roundTripAudit().worstPerKg < 0n).toBe(true);
  });
  it("katalog profilleri: her nihai mal günde en az 1 parti sistem talebi alır", () => {
    const profs = buildProfiles(CATALOG_TUNING).filter((p) => p.key.startsWith("retail_") || p.key.startsWith("industry_"));
    let checked = 0;
    for (const p of PRODUCTS.filter((x) => x.stage === "final")) {
      const rec = RECIPES.find((x) => !x.research && x.output.productId === p.id);
      const kg = profs.reduce((a, x) => a + (x.buys[p.id] ?? 0), 0);
      if (!rec || kg <= 0) continue;
      checked++;
      expect(kg / rec.output.kg, p.id).toBeGreaterThanOrEqual(1);
    }
    expect(checked).toBeGreaterThan(60);
  });
});
