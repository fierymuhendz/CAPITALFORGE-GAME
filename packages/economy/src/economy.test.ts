import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CITIES, DEFAULT_SETTINGS, PLOTS, PRODUCTS, QUALITY_PRICE_BP, RECIPES, SYSTEM_PROFILES, BUILDING_TYPES,
} from "@capitalforge/shared";
import {
  allocate, applyBp, avgUnitCost, contractEscrows, deliveryPayment, landedCost, loanInstallment, mulDiv,
  outputQuality, planProduction, priceAnomaly, refPrice, settleInstallment, systemAsk, systemBid, systemBidCap,
  travelMinutes, wacRemovalCost, estimateOwnTrip,
} from "./index";

describe("para kuralları", () => {
  it("ağırlıklı ortalama maliyet kabul senaryosu: 100@10 + 200@13 → 12; 50@16, navlun 50 → kâr 150", () => {
    let qty = 0;
    let cost = 0n;
    qty += 100; cost += 100n * 10n;
    qty += 200; cost += 200n * 13n;
    expect(avgUnitCost(qty, cost)).toBe(12n);
    const cogs = wacRemovalCost(qty, cost, 50);
    qty -= 50; cost -= cogs;
    const revenue = 50n * 16n;
    const freight = 50n;
    expect(revenue - cogs - freight).toBe(150n);
    expect(qty).toBe(250);
    expect(avgUnitCost(qty, cost)).toBe(12n);
  });

  it("stoktan çıkışlar toplam maliyeti tam olarak tüketir (özellik)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.array(fc.integer({ min: 1, max: 5000 }), { maxLength: 30 }), (q0, c0, outs) => {
        let qty = q0; let cost = c0; let removed = 0n;
        for (const o of outs) {
          if (o > qty) break;
          const c = wacRemovalCost(qty, cost, o);
          expect(c >= 0n && c <= cost).toBe(true);
          removed += c; cost -= c; qty -= o;
        }
        if (qty > 0) removed += wacRemovalCost(qty, cost, qty);
        expect(removed).toBe(c0);
      }),
    );
  });

  it("allocate toplamı korur", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }), (t, w) => {
      expect(allocate(t, w).reduce((a, b) => a + b, 0n)).toBe(t);
    }));
  });

  it("mulDiv negatiflerde aşağı yuvarlar", () => {
    expect(mulDiv(-7n, 1n, 2n)).toBe(-4n);
    expect(mulDiv(7n, 1n, 2n)).toBe(3n);
    expect(applyBp(1000n, 100)).toBe(10n);
  });
});

describe("üretim", () => {
  const ctx = {
    batches: 1, plotYieldBp: 10000, cityYieldBp: 10000, researchYieldBp: 0, researchEfficiencyBp: 0,
    facilityQualityLevel: 1, researchQualityLevels: 0, laborAvailabilityBp: 10000, inputLots: [],
    prices: { energyPerKwh: 400n, waterPerM3: 1500n, wagePerHour: 15000n },
  };
  it("taban tarif çıktısı ve maliyeti", () => {
    const r = RECIPES.find((x) => x.id === "grow_fodder")!;
    const p = planProduction(r, ctx);
    expect(p.outputKg).toBe(2400);
    expect(p.minutes).toBe(r.minutes);
    expect(p.energyCost).toBe(40n * 400n);
    expect(p.laborCost).toBe(6n * 15000n);
  });
  it("verim, araştırma ve parti çıktıyı artırır; verimlilik enerjiyi azaltır", () => {
    const r = RECIPES.find((x) => x.id === "mill_flour")!;
    const p = planProduction(r, { ...ctx, batches: 2, cityYieldBp: 11000, researchYieldBp: 800, researchEfficiencyBp: 1000 });
    expect(p.outputKg).toBe(Math.floor(1500 * 2 * 1.1 * 1.08));
    expect(p.energyKwh).toBe(144);
    expect(p.inputs).toEqual([{ productId: "grain", kg: 4000 }]);
  });
  it("kalite: girdi ortalaması + tesis + araştırma, 1..5", () => {
    expect(outputQuality([], 1, 0)).toBe(2);
    expect(outputQuality([{ kg: 100, quality: 3 }, { kg: 100, quality: 4 }], 1, 0)).toBe(4);
    expect(outputQuality([{ kg: 100, quality: 1 }], 1, 0)).toBe(1);
    expect(outputQuality([{ kg: 100, quality: 5 }], 3, 2)).toBe(5);
    expect(outputQuality([], 2, 1)).toBe(4);
  });
});

describe("sözleşmeler", () => {
  const t = { qtyPerInstallmentKg: 5000, pricePerKg: 500n, installments: 3, penaltyBp: 1000, lateFeeBp: 1000 };
  it("emanet ve teminat", () => {
    const e = contractEscrows(t);
    expect(e.buyerEscrow).toBe(7_500_000n);
    expect(e.sellerDeposit).toBe(750_000n);
    expect(e.perInstallmentDeposit.reduce((a, b) => a + b, 0n)).toBe(750_000n);
  });
  it("eksik teslimde iade ve ceza", () => {
    const s = settleInstallment(5000, 3000, 500n, 1000, 250_000n);
    expect(s.status).toBe("partial");
    expect(s.refundToBuyer).toBe(1_000_000n);
    expect(s.penaltyToBuyer).toBe(100_000n);
    expect(s.depositReleasedToSeller).toBe(150_000n);
  });
  it("geç teslimde gecikme cezası", () => {
    const d = deliveryPayment(1000, 500n, true, 1000);
    expect(d.lateFee).toBe(50_000n);
    expect(d.net).toBe(450_000n);
  });
});

describe("navlun", () => {
  it("süre ve maliyet; düşük fiyat + navlun daha pahalı olabilir", () => {
    expect(travelMinutes(130, 65)).toBe(120);
    const truck = { capacityKg: 12000, speedKmh: 65, fuelPerKm: 2500 };
    const near = estimateOwnTrip(90, truck, 15000n);
    const far = estimateOwnTrip(250, truck, 15000n);
    const a = landedCost(10000, 500n, near.total);
    const b = landedCost(10000, 470n, far.total);
    expect(b.goods < a.goods).toBe(true);
    expect(b.total > a.total).toBe(true);
  });
});

describe("kredi", () => {
  it("eşit anaparalı taksitler anaparayı tam kapatır", () => {
    let out = 1_000_000n; let paid = 0;
    while (out > 0n) {
      const i = loanInstallment(1_000_000n, 7, paid, out, 40);
      out -= i.principalPart; paid++;
    }
    expect(paid).toBe(7);
  });
});

describe("sistem arbitrajı yok", () => {
  it("bir ürünü sistemden alıp herhangi bir şehirde sisteme satmak navlundan önce bile zarar", () => {
    const s = DEFAULT_SETTINGS.system;
    for (const p of PRODUCTS) {
      const sellers = SYSTEM_PROFILES.filter((x) => (x.sells[p.id] ?? 0) > 0);
      const buyers = SYSTEM_PROFILES.filter((x) => (x.buys[p.id] ?? 0) > 0);
      if (sellers.length === 0 || buyers.length === 0) continue;
      const baseAsk = (cityId: string) => systemAsk(refPrice(p.basePricePerKg, CITIES.find((c) => c.id === cityId)!.priceBp[p.id] ?? 10000, 15000), s.askBp, 0, 1);
      const lowDriftAsk = (cityId: string) => systemAsk(refPrice(p.basePricePerKg, CITIES.find((c) => c.id === cityId)!.priceBp[p.id] ?? 10000, 6000), s.askBp, 0, 1);
      const cap = systemBidCap(sellers.map((x) => lowDriftAsk(x.cityId)).reduce((a, b) => (b < a ? b : a)));
      for (const b of buyers) {
        const bid = systemBid(refPrice(p.basePricePerKg, CITIES.find((c) => c.id === b.cityId)!.priceBp[p.id] ?? 10000, 15000), s.bidBp, 0, 1, cap);
        for (const sl of sellers) {
          expect(bid < lowDriftAsk(sl.cityId)).toBe(true);
          expect(bid < baseAsk(sl.cityId)).toBe(true);
        }
      }
    }
  });
});

describe("fiyat sapması", () => {
  it("yeterli veriyle sapma ve yetersiz veri işareti", () => {
    const comps = [500n, 510n, 490n, 505n, 495n];
    const low = priceAnomaly(250n, comps, 3500, 5);
    expect(low.flagged).toBe(true);
    expect(low.deviationBp).toBe(-5000);
    expect(low.insufficientData).toBe(false);
    const ok = priceAnomaly(520n, comps, 3500, 5);
    expect(ok.flagged).toBe(false);
    const few = priceAnomaly(250n, [500n, 510n], 3500, 5);
    expect(few.insufficientData).toBe(true);
  });
});

describe("katalog tutarlılığı ve başlangıç dengesi", () => {
  it("her sektör için en az iki şehirde başlangıç parasıyla alınabilir seviye 1 arsa var", () => {
    const cash = DEFAULT_SETTINGS.startingCash;
    const cityOk = (pred: (p: (typeof PLOTS)[number]) => boolean) => new Set(PLOTS.filter((p) => p.minLevel === 1 && p.price <= cash * 0.4 && pred(p)).map((p) => p.cityId)).size;
    expect(cityOk(() => true)).toBeGreaterThanOrEqual(2);
    expect(cityOk((p) => p.deposit?.kind === "iron")).toBeGreaterThanOrEqual(2);
    expect(cityOk((p) => p.deposit?.kind === "coal")).toBeGreaterThanOrEqual(2);
  });
  it("tarifler var olan ürün ve binalara bağlı", () => {
    const pids = new Set(PRODUCTS.map((p) => p.id));
    const bids = new Set(BUILDING_TYPES.map((b) => b.id));
    for (const r of RECIPES) {
      expect(bids.has(r.buildingType)).toBe(true);
      expect(pids.has(r.output.productId)).toBe(true);
      for (const i of r.inputs) expect(pids.has(i.productId)).toBe(true);
    }
    expect(QUALITY_PRICE_BP.length).toBe(6);
  });
});
