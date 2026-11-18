import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FACILITY_TYPES,
  PARAMS,
  PRODUCT_IDS,
  RECIPES,
  RECIPE_IDS,
  batchIO,
  facilityPrice,
  inventoryValue,
  nextPrice,
  npcFlow,
  quoteTrade,
  reliefEligible,
  reliefPeriod,
  upkeep,
  upkeepPeriod,
} from "./index";

const ftype = fc.constantFrom(...FACILITY_TYPES);
const recipeId = fc.constantFrom(...RECIPE_IDS);
const product = fc.constantFrom(...PRODUCT_IDS);
const price = fc.bigInt({ min: PARAMS.minPrice, max: PARAMS.maxPrice });
const qty = fc.bigInt({ min: 1n, max: 10n ** 6n });

describe("tesis fiyatı ve bakım", () => {
  it("tesis fiyatı sahip sayısıyla kesin artar", () => {
    fc.assert(
      fc.property(ftype, fc.bigInt({ min: 0n, max: 40n }), (t, n) => facilityPrice(t, n + 1n) > facilityPrice(t, n)),
    );
  });
  it("ilk tesis taban fiyattır, negatif sayı reddedilir", () => {
    for (const t of FACILITY_TYPES) expect(facilityPrice(t, 0n)).toBe(PARAMS.facilityBasePrice[t]);
    expect(() => facilityPrice("farm", -1n)).toThrow(RangeError);
  });
  it("20. tesis fiyatı makul (başlangıç bakiyesinin altında kalmaz ama taşmaz)", () => {
    for (const t of FACILITY_TYPES) {
      const p = facilityPrice(t, PARAMS.maxFacilitiesPerCompany - 1n);
      expect(p).toBeGreaterThan(PARAMS.facilityBasePrice[t]);
      expect(p).toBeLessThan(10n ** 12n);
    }
  });
  it("bakım pozitif, seviyeyle doğrusal; geçersiz seviye reddedilir", () => {
    fc.assert(
      fc.property(ftype, fc.bigInt({ min: 1n, max: 100n }), (t, l) => {
        const u = upkeep(t, l);
        return u > 0n && u === upkeep(t, 1n) * l;
      }),
    );
    expect(() => upkeep("farm", 0n)).toThrow(RangeError);
  });
  it("bakım dönemi tick ile tekdüze", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 9n }), (t) => upkeepPeriod(t + 1n) >= upkeepPeriod(t)),
    );
  });
});

describe("tarifeler", () => {
  it("batch ile doğrusal; süre sabit", () => {
    fc.assert(
      fc.property(recipeId, fc.bigInt({ min: 1n, max: PARAMS.maxBatchesPerJob }), (id, b) => {
        const r = RECIPES[id];
        const io = batchIO(r, b);
        const one = batchIO(r, 1n);
        return (
          io.output.qty === one.output.qty * b &&
          io.inputs.every((l, i) => l.qty === one.inputs[i]!.qty * b && l.productId === r.inputs[i]!.productId)
        );
      }),
    );
  });
  it("geçersiz batch reddedilir", () => {
    expect(() => batchIO(RECIPES.grow_wheat, 0n)).toThrow(RangeError);
    expect(() => batchIO(RECIPES.grow_wheat, PARAMS.maxBatchesPerJob + 1n)).toThrow(RangeError);
  });
  it("her tarif kendi tesis türüne bağlı, bilinen ürünleri kullanır, süre pozitif", () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      expect(r.id).toBe(id);
      expect(FACILITY_TYPES).toContain(r.facility);
      expect(r.durationTicks).toBeGreaterThan(0n);
      for (const l of [...r.inputs, r.output]) {
        expect(PRODUCT_IDS as readonly string[]).toContain(l.productId);
        expect(l.qty).toBeGreaterThan(0n);
      }
    }
  });
  it("referans fiyatta her tarif zincir içinde kârlı (girdi < çıktı, sürtünme sonrası)", () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      const inCost = r.inputs.reduce(
        (a, l) => a + -quoteTrade("buy", PARAMS.refPrice[l.productId as keyof typeof PARAMS.refPrice], l.qty).playerDelta,
        0n,
      );
      const out = quoteTrade("sell", PARAMS.refPrice[r.output.productId as keyof typeof PARAMS.refPrice], r.output.qty).playerDelta;
      expect(out).toBeGreaterThan(inCost);
    }
  });
});

describe("NPC akışı", () => {
  it("referans fiyatta talep = arz = base", () => {
    fc.assert(
      fc.property(price, fc.bigInt({ min: 0n, max: 10n ** 6n }), (ref, base) => {
        const f = npcFlow(ref, ref, base);
        return f.demand === base && f.supply === base;
      }),
    );
  });
  it("fiyat düştükçe net talep artar, yükseldikçe net arz artar; negatif olmaz", () => {
    fc.assert(
      fc.property(price, price, fc.bigInt({ min: 0n, max: 10n ** 6n }), (ref, p, base) => {
        const f = npcFlow(p, ref, base);
        const net = f.demand - f.supply;
        return f.demand >= 0n && f.supply >= 0n && (p < ref ? net >= 0n : p > ref ? net <= 0n : net === 0n);
      }),
    );
  });
  it("NPC akışı dahil fiyat adımı maxPriceStepBps'i aşmaz ve [min,max] içinde kalır", () => {
    const vol = fc.bigInt({ min: 0n, max: 10n ** 9n });
    fc.assert(
      fc.property(product, price, vol, vol, (pid, p, d, s) => {
        const f = npcFlow(p, PARAMS.refPrice[pid], PARAMS.npcBase[pid]);
        const n = nextPrice(p, d + f.demand, s + f.supply);
        const diff = n > p ? n - p : p - n;
        return diff * 10_000n <= p * PARAMS.maxPriceStepBps && n >= PARAMS.minPrice && n <= PARAMS.maxPrice;
      }),
    );
  });
  it("yalnız NPC varken fiyat referansa doğru yakınsar (uzaklaşmaz)", () => {
    for (const pid of PRODUCT_IDS) {
      const ref = PARAMS.refPrice[pid];
      for (const start of [ref / 2n, ref * 2n]) {
        let p = start;
        for (let i = 0; i < 20_000; i++) {
          const f = npcFlow(p, ref, PARAMS.npcBase[pid]);
          p = nextPrice(p, f.demand, f.supply);
        }
        const d = p > ref ? p - ref : ref - p;
        expect(d * 100n).toBeLessThanOrEqual(ref * 10n); // %10 içinde (düşük fiyatta tam sayı ölü bölgesi)
      }
    }
  });
});

describe("kârsızlık (spread/vergi/maxStep ayarı)", () => {
  it("tek tick al-sat: NPC akışı ve ek talep/arz dahil kâr yok", () => {
    const vol = fc.bigInt({ min: 0n, max: 10n ** 9n });
    fc.assert(
      fc.property(product, price, qty, vol, vol, (pid, p, q, xd, xs) => {
        const buy = quoteTrade("buy", p, q);
        const f = npcFlow(p, PARAMS.refPrice[pid], PARAMS.npcBase[pid]);
        const p2 = nextPrice(p, q + xd + f.demand, xs + f.supply);
        const sell = quoteTrade("sell", p2, q);
        return buy.playerDelta + sell.playerDelta <= 0n;
      }),
      { numRuns: 2000 },
    );
  });
  it("maxPriceStepBps, gidiş-dönüş sürtünmesini aşmaz (analitik sınır)", () => {
    // (1+step)(1-s)(1-t) <= (1+s)(1+t) bp cinsinden, ölçek 1e12
    const S = 10_000n;
    const lhs = (S + PARAMS.maxPriceStepBps) * (S - PARAMS.spreadBps) * (S - PARAMS.transactionTaxBps);
    const rhs = (S + PARAMS.spreadBps) * (S + PARAMS.transactionTaxBps) * S;
    expect(lhs).toBeLessThanOrEqual(rhs);
  });
});

describe("asgari ödenek", () => {
  const money = fc.bigInt({ min: 0n, max: 10n ** 12n });
  const holdings = fc.array(fc.record({ price, qty: fc.bigInt({ min: 0n, max: 10n ** 6n }) }), { maxLength: 5 });
  it("tesisi olan asla uygun değil", () => {
    fc.assert(fc.property(money, money, (c, v) => !reliefEligible({ cash: c, inventoryValue: v, hasFacility: true })));
  });
  it("eşik ve üstü uygun değil", () => {
    expect(reliefEligible({ cash: PARAMS.reliefThreshold, inventoryValue: 0n, hasFacility: false })).toBe(false);
    expect(reliefEligible({ cash: PARAMS.reliefThreshold - 1n, inventoryValue: 0n, hasFacility: false })).toBe(true);
  });
  it("envanter değeri satış fiyatını (price−spread) aşmaz", () => {
    fc.assert(
      fc.property(holdings, (h) => {
        const realizable = h.reduce((a, x) => a + (x.qty === 0n ? 0n : quoteTrade("sell", x.price, x.qty).gross), 0n);
        return inventoryValue(h) === realizable;
      }),
    );
  });
  it("istismar döngüsü yok: alım veya satım ölçülen serveti (nakit + envanter) artıramaz", () => {
    fc.assert(
      fc.property(price, qty, fc.constantFrom<"buy" | "sell">("buy", "sell"), (p, q, side) => {
        const t = quoteTrade(side, p, q);
        // alımda envanter +q, satımda envanter −q; nakit playerDelta kadar değişir
        const invDelta = inventoryValue([{ price: p, qty: q }]);
        const measuredDelta = side === "buy" ? t.playerDelta + invDelta : t.playerDelta - invDelta;
        return measuredDelta <= 0n;
      }),
      { numRuns: 3000 },
    );
  });
  it("ödenek tutarı eşikten küçük: bir talep tek başına eşiği aşırtıp tekrar tekrar uygun bırakmaz mantığı", () => {
    // Uygun oyuncu (<eşik) + ödenek < 2×eşik; ardışık talep için ölçülen servet kaybı gerekir (yukarıdaki özellik).
    expect(PARAMS.reliefAmount).toBeLessThan(PARAMS.reliefThreshold);
    expect(PARAMS.reliefAmount).toBeLessThan(facilityPrice("farm", 0n));
  });
  it("ödenek dönemi günde bir", () => {
    expect(reliefPeriod(0n)).toBe(0n);
    expect(reliefPeriod(PARAMS.reliefCooldownTicks - 1n)).toBe(0n);
    expect(reliefPeriod(PARAMS.reliefCooldownTicks)).toBe(1n);
  });
});
