import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BUILDING_TYPES, CITIES, DEFAULT_SETTINGS as S, PRODUCTS, QUALITY_PRICE_BP, RECIPES, RESEARCH, SYSTEM_PROFILES, VEHICLE_MODELS, roadDistanceKm,
} from "@capitalforge/shared";
import {
  batchesPerDay, chooseSupplier, planProduction, contractVsSpot, deadlinePremiumBp, estimateOwnTrip, loadFactorBp, paybackDays, qualityAdjusted, refPrice,
  roundTripValue, systemAsk, systemBid, systemBidCap, systemBidForQuality, systemCarrierQuote, systemContractPrice, systemFreightJobSpec, travelMinutes,
} from "./index";

const truck = VEHICLE_MODELS.find((v) => v.id === "truck")!;
const van = VEHICLE_MODELS.find((v) => v.id === "van")!;
const veh = (v: typeof truck) => ({ capacityKg: v.capacityKg, speedKmh: v.speedKmh, fuelPerKm: BigInt(v.fuelPerKm) });

describe("H1: kalite ölçekli alış üst sınırı", () => {
  it("kalite 2 fiyatı eskisiyle aynı, yüksek kalite prim taşır", () => {
    const cap = 432n;
    expect(systemBidForQuality(446n, 2, cap, QUALITY_PRICE_BP)).toBe(432n);
    expect(systemBidForQuality(446n, 5, cap, QUALITY_PRICE_BP)).toBe(qualityAdjusted(432n, 5, QUALITY_PRICE_BP));
    expect(systemBidForQuality(446n, 5, cap, QUALITY_PRICE_BP)).toBeGreaterThan(systemBidForQuality(446n, 3, cap, QUALITY_PRICE_BP));
  });
  it("arbitraj yok: normalleştirilmiş alış her ürün/şehir/kalitede en düşük sistem satışının altında (özellik)", () => {
    const products = PRODUCTS.filter((p) => SYSTEM_PROFILES.some((x) => (x.sells[p.id] ?? 0) > 0) && SYSTEM_PROFILES.some((x) => (x.buys[p.id] ?? 0) > 0));
    fc.assert(fc.property(fc.constantFrom(...products), fc.constantFrom(...CITIES), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 6000, max: 15000 }), fc.integer({ min: 0, max: 100 }), (p, c, q, drift, fillPct) => {
      const sellers = SYSTEM_PROFILES.filter((x) => (x.sells[p.id] ?? 0) > 0);
      const asks = sellers.map((s) => systemAsk(refPrice(p.basePricePerKg, CITIES.find((x) => x.id === s.cityId)!.priceBp[p.id] ?? 10000, drift), S.system.askBp, 0, 1));
      const minAsk = asks.reduce((a, b) => (b < a ? b : a));
      const cap = systemBidCap(minAsk);
      const bid = systemBid(refPrice(p.basePricePerKg, c.priceBp[p.id] ?? 10000, drift), S.system.bidBp, fillPct, 100, cap);
      const v = systemBidForQuality(bid, q, cap, QUALITY_PRICE_BP);
      // kaliteyi kalite 2 eşdeğerine çevir: alış ≤ cap < en düşük satış
      expect((v * BigInt(QUALITY_PRICE_BP[2]!)) / BigInt(QUALITY_PRICE_BP[q]!)).toBeLessThanOrEqual(cap + 1n);
      expect(cap).toBeLessThan(minAsk);
    }));
  });
  it("kalite çarpanları artar ve prim makul (q5 ≤ %30)", () => {
    for (let q = 2; q < 5; q++) expect(QUALITY_PRICE_BP[q + 1]!).toBeGreaterThan(QUALITY_PRICE_BP[q]!);
    expect(QUALITY_PRICE_BP[5]!).toBeLessThanOrEqual(13000);
  });
});

describe("sözleşme fiyatı ve spot/sözleşme kararı", () => {
  it("sözleşme fiyatı en düşük sistem satışının %95'ini asla aşmaz ve doygunlukla artar (özellik)", () => {
    fc.assert(fc.property(fc.bigInt({ min: 1n, max: 10n ** 6n }), fc.bigInt({ min: 1n, max: 10n ** 6n }), fc.integer({ min: 0, max: 12000 }), fc.integer({ min: 0, max: 10000 }), (bid, ask, rep, sat) => {
      const p = systemContractPrice(bid, ask, rep, sat);
      expect(p).toBeLessThanOrEqual(ask * 95n / 100n > 1n ? (ask * 9500n) / 10000n : 1n);
      expect(systemContractPrice(bid, null, rep, Math.min(10000, sat + 1000))).toBeGreaterThanOrEqual(systemContractPrice(bid, null, rep, sat));
    }));
  });
  it("tam sayı para: sonuçlar bigint, parametreyle çevrilir", () => {
    const base = { qtyPerInstallmentKg: 2000, installments: 3, missProbBp: 500, penaltyBp: 1000, depositDays: 3, dailyInterestBp: 40, contractFreightPerKg: 0n, spotFreightPerKg: 0n, spotFeeBp: 100 };
    const sat = contractVsSpot({ ...base, contractPricePerKg: 439n, spotPricePerKg: [290n, 290n, 290n] });
    const free = contractVsSpot({ ...base, contractPricePerKg: 407n, spotPricePerKg: [505n, 505n, 505n] });
    expect(sat.better).toBe("contract");
    expect(free.better).toBe("spot");
    expect(typeof sat.contractValue).toBe("bigint");
  });
  it("teslim edememe olasılığı arttıkça sözleşme değeri azalır (özellik)", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9000 }), fc.integer({ min: 1, max: 1000 }), (miss, dm) => {
      const mk = (m: number) => contractVsSpot({ qtyPerInstallmentKg: 1000, installments: 3, contractPricePerKg: 500n, spotPricePerKg: [400n], missProbBp: m, penaltyBp: 1000, depositDays: 3, dailyInterestBp: 40, contractFreightPerKg: 0n, spotFreightPerKg: 0n, spotFeeBp: 100 }).contractValue;
      expect(mk(miss + dm)).toBeLessThanOrEqual(mk(miss));
    }));
  });
});

describe("H4: taşımacılık tarifesi v3", () => {
  const quote = (km: number, kg: number) => systemCarrierQuote(km, kg, S.freight.systemBaseFee, S.freight.systemPerKm);
  it("km ve kg ile azalmaz, en az kalkış ücreti (özellik)", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 40000 }), fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 500 }), (km, kg, dk, dkg) => {
      expect(quote(km + dk, kg)).toBeGreaterThanOrEqual(quote(km, kg));
      expect(quote(km, kg + dkg)).toBeGreaterThanOrEqual(quote(km, kg));
      expect(quote(km, kg)).toBeGreaterThanOrEqual(BigInt(S.freight.systemBaseFee));
    }));
  });
  it("uzun yolda km başına ücret düşer (taper), kısmi yük dolu yükten ucuzdur, dolu kamyon kg başına en ucuz", () => {
    expect(quote(300, 12000) - quote(150, 12000)).toBeLessThan(quote(150, 12000) - BigInt(S.freight.systemBaseFee));
    expect(quote(100, 4000)).toBeLessThan(quote(100, 12000));
    const perKg = (kg: number) => Number(quote(100, kg)) / kg;
    expect(perKg(12000)).toBeLessThan(perKg(4000));
    expect(loadFactorBp(24000)).toBeLessThan(2 * loadFactorBp(12000));
  });
  it("dolu kamyon kârlı, 4 t kamyon işi dolu işin üçte birinden azını kazandırır (karar gerçek)", () => {
    const profit = (km: number, kg: number) => quote(km, kg) - estimateOwnTrip(km, veh(truck), 15000n, { handlingMinutes: 40 }).total;
    for (const km of [70, 90, 150, 250]) expect(profit(km, 12000)).toBeGreaterThan(0n);
    expect(profit(150, 4000)).toBeLessThan(profit(150, 12000) / 3n);
    expect(profit(250, 4000) * 2n).toBeLessThan(profit(250, 12000));
  });
  it("süre primi azalan, 24 sa nötr", () => {
    expect(deadlinePremiumBp(6)).toBeGreaterThan(deadlinePremiumBp(12));
    expect(deadlinePremiumBp(12)).toBeGreaterThan(deadlinePremiumBp(24));
    expect(deadlinePremiumBp(24)).toBe(0);
    expect(deadlinePremiumBp(48)).toBeLessThan(0);
  });
  it("yükleme süresi dakikayı artırır, maliyeti değiştirmez; varsayılan eski davranış", () => {
    const a = estimateOwnTrip(150, veh(truck), 15000n);
    const b = estimateOwnTrip(150, veh(truck), 15000n, { handlingMinutes: 40 });
    expect(a.minutes).toBe(travelMinutes(150, truck.speedKmh));
    expect(b.minutes).toBe(a.minutes + 40);
    expect(b.total).toBe(a.total);
    expect(estimateOwnTrip(0, veh(truck), 15000n, { handlingMinutes: 40 }).minutes).toBe(0);
  });
  it("sistem işi şablonu deterministik, hedef ≠ çıkış, karışım kamyonet ve tırı da içerir", () => {
    const ids = CITIES.map((c) => c.id);
    const seen = new Set<number>();
    for (const from of ids) for (let k = 0; k < 12; k++) for (let d = 0; d < 7; d++) {
      const j = systemFreightJobSpec(from, k, d, ids);
      expect(j.destCityId).not.toBe(from);
      expect(roadDistanceKm(from, j.destCityId)).toBeGreaterThan(0);
      expect(systemFreightJobSpec(from, k, d, ids)).toEqual(j);
      seen.add(j.kg);
    }
    expect(Math.min(...seen)).toBeLessThanOrEqual(van.capacityKg);
    expect(Math.max(...seen)).toBeGreaterThan(truck.capacityKg);
  });
  it("tur değeri: dönüş yükü saat başı kârı artırır; dönüş yükü yönüne göre en iyi rota çevrilir", () => {
    const pay = (km: number, kg: number) => quote(km, kg);
    const o = (km: number) => ({ km, kg: 12000, pay: pay(km, 12000) });
    const opts = { handlingMinutes: 40, waitMinutes: 240 };
    const empty = roundTripValue(o(150), null, veh(truck), 15000n, opts);
    const full = roundTripValue(o(150), o(150), veh(truck), 15000n, opts);
    expect(full.profitPerHour).toBeGreaterThan(empty.profitPerHour);
    const A = [roundTripValue(o(150), null, veh(truck), 15000n, opts), roundTripValue(o(90), o(90), veh(truck), 15000n, opts)];
    const B = [roundTripValue(o(150), o(150), veh(truck), 15000n, opts), roundTripValue(o(90), null, veh(truck), 15000n, opts)];
    expect(A[1]!.profitPerHour).toBeGreaterThan(A[0]!.profitPerHour);
    expect(B[0]!.profitPerHour).toBeGreaterThan(B[1]!.profitPerHour);
  });
});

describe("tedarikçi seçimi, geri dönüş, kapasite", () => {
  it("yakın pahalı / uzak ucuz: kısmi yükte yakın, dolu kamyonda uzak kazanır", () => {
    const offers = (q: number) => [{ id: "near", pricePerKg: 630n, km: 0, availableKg: 4000 }, { id: "far", pricePerKg: 480n, km: 180, availableKg: q }];
    const ch = (q: number) => chooseSupplier(offers(q), q, veh(truck), 13000n, { handlingMinutes: 40 })!.id;
    expect(ch(3000)).toBe("near");
    expect(ch(12000)).toBe("far");
    expect(chooseSupplier(offers(3000), 100_000, veh(truck), 13000n)).toBeNull();
  });
  it("paybackDays ve batchesPerDay", () => {
    expect(paybackDays(1000n, 100n)).toBe(10);
    expect(paybackDays(1001n, 100n)).toBe(11);
    expect(paybackDays(1000n, 0n)).toBeNull();
    expect(batchesPerDay(1, 1, 360)).toBe(4);
    expect(batchesPerDay(2, 2, 360)).toBe(16);
  });
});

describe("katalog v3 değişmezleri", () => {
  it("eski kimlikler silinmedi", () => {
    for (const id of ["seed", "fodder", "grain", "raw_milk", "flour", "packaged_milk", "cheese", "iron_ore", "coal", "steel"]) expect(PRODUCTS.some((p) => p.id === id)).toBe(true);
    for (const id of ["grow_fodder", "grow_grain", "milk_cows", "mine_iron", "mine_coal", "mill_flour", "pack_milk", "make_cheese", "smelt_steel"]) expect(RECIPES.some((r) => r.id === id)).toBe(true);
    for (const id of ["field", "barn", "mine", "food_plant", "steel_mill", "garage"]) expect(BUILDING_TYPES.some((b) => b.id === id)).toBe(true);
    for (const id of ["agronomy", "herd_health", "drilling", "lean_process", "quality_control", "eco_driving", "route_planning"]) expect(RESEARCH.some((r) => r.id === id)).toBe(true);
    for (const id of ["van", "truck", "semi"]) expect(VEHICLE_MODELS.some((v) => v.id === id)).toBe(true);
  });
  it("seviye kapasitesi artar ve seviye başına parti sayısı yükselir; seviye 1 kapasitesi talebi tek başına doldurmaz", () => {
    for (const b of BUILDING_TYPES.filter((x) => x.id !== "garage")) {
      for (let i = 1; i < b.levels.length; i++) expect(b.levels[i]!.lines * b.levels[i]!.maxBatches).toBeGreaterThan(b.levels[i - 1]!.lines * b.levels[i - 1]!.maxBatches);
    }
  });
  it("bina seviyesi bonusları: seviye başına artar, seviye 1 bonussuz, girdi tasarrufu ≤ %30", () => {
    for (const b of BUILDING_TYPES.filter((x) => x.id !== "garage")) {
      expect(b.levels[0]!.yieldBp ?? 0).toBe(0);
      for (let i = 1; i < b.levels.length; i++) {
        const p = b.levels[i - 1]!, c = b.levels[i]!;
        expect((c.yieldBp ?? 0) + (c.efficiencyBp ?? 0) + (c.inputSavingBp ?? 0)).toBeGreaterThan((p.yieldBp ?? 0) + (p.efficiencyBp ?? 0) + (p.inputSavingBp ?? 0));
        expect(c.inputSavingBp ?? 0).toBeLessThanOrEqual(3000);
      }
    }
  });
  it("planProduction seviye bonusları: çıktı artar, enerji/işçilik ve girdi azalır; bonussuz eski sonuç (özellik)", () => {
    const r = RECIPES.find((x) => x.id === "make_cheese")!;
    const ctx = { batches: 1, plotYieldBp: 10000, cityYieldBp: 10000, researchYieldBp: 0, researchEfficiencyBp: 0, facilityQualityLevel: 1, researchQualityLevels: 0, laborAvailabilityBp: 10000, inputLots: [], prices: { energyPerKwh: 400n, waterPerM3: 1500n, wagePerHour: 15000n } };
    const base = planProduction(r, ctx);
    expect(planProduction(r, { ...ctx, levelYieldBp: 0, levelEfficiencyBp: 0, levelInputSavingBp: 0 })).toEqual(base);
    fc.assert(fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 1, max: 4 }), (y, e, i, n) => {
      const p = planProduction(r, { ...ctx, batches: n, levelYieldBp: y, levelEfficiencyBp: e, levelInputSavingBp: i });
      const b = planProduction(r, { ...ctx, batches: n });
      expect(p.outputKg).toBeGreaterThanOrEqual(b.outputKg);
      expect(p.energyKwh).toBeLessThanOrEqual(b.energyKwh);
      expect(p.laborHours).toBeLessThanOrEqual(b.laborHours);
      expect(p.inputs[0]!.kg).toBeLessThanOrEqual(b.inputs[0]!.kg);
      expect(p.inputs[0]!.kg).toBeGreaterThanOrEqual(Math.ceil(b.inputs[0]!.kg * 0.7));
    }));
  });
  it("sistem bütçesi her profilde kalite 5 talebini karşılar", () => {
    for (const p of SYSTEM_PROFILES) {
      let need = 0n;
      for (const [pid, kg] of Object.entries(p.buys)) {
        const prod = PRODUCTS.find((x) => x.id === pid)!;
        const c = CITIES.find((x) => x.id === p.cityId)!;
        const sellers = SYSTEM_PROFILES.filter((x) => (x.sells[pid] ?? 0) > 0);
        const cap = sellers.length ? systemBidCap(sellers.map((s) => systemAsk(refPrice(prod.basePricePerKg, CITIES.find((x) => x.id === s.cityId)!.priceBp[pid] ?? 10000, 10000), S.system.askBp, 0, 1)).reduce((a, b) => (b < a ? b : a))) : null;
        need += systemBidForQuality(systemBid(refPrice(prod.basePricePerKg, c.priceBp[pid] ?? 10000, 10000), S.system.bidBp, 0, kg, cap), 5, cap, QUALITY_PRICE_BP) * BigInt(kg);
      }
      expect(BigInt(p.dailyBudget)).toBeGreaterThanOrEqual(need);
    }
  });
});
