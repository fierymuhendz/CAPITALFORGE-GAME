import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  PARAMS,
  PRODUCT_IDS,
  executeAgainstPool,
  initialPool,
  poolMaxOrder,
  poolPrice,
  pumpProfit,
  replenish,
  type PoolState,
  type ProductId,
} from "./index";

const product = fc.constantFrom<ProductId>(...PRODUCT_IDS);
/** Rastgele ama makul havuz: derinliğin 0,2x-5x'i, fiyat referansın 0,2x-5x'i. */
const pool = product.chain((pid) =>
  fc
    .tuple(fc.integer({ min: 20, max: 500 }), fc.integer({ min: 20, max: 500 }))
    .map(([u, v]): { pid: ProductId; p: PoolState } => {
      const D = PARAMS.poolDepth[pid];
      const units = (D * BigInt(u)) / 100n;
      return { pid, p: { units, value: units * ((PARAMS.refPrice[pid] * BigInt(v)) / 100n) } };
    }),
);
const frac = fc.integer({ min: 1, max: 80 }); // geri yönlü emir de sınır içinde kalsın
const qtyOf = (p: PoolState, f: number): bigint => {
  const q = (poolMaxOrder(p) * BigInt(f)) / 100n;
  return q < 1n ? 1n : q;
};

describe("ortak havuz", () => {
  it("al sonra aynı miktarı sat ve sat sonra aynı miktarı al: kâr yok (her havuz durumu)", () => {
    fc.assert(
      fc.property(pool, frac, ({ p }, f) => {
        const q = qtyOf(p, f);
        const b = executeAgainstPool("buy", p, q);
        const s = executeAgainstPool("sell", b.newPool, q);
        const s0 = executeAgainstPool("sell", p, q);
        const b0 = executeAgainstPool("buy", s0.newPool, q);
        return b.playerDelta + s.playerDelta <= 0n && s0.playerDelta + b0.playerDelta <= 0n;
      }),
      { numRuns: 3000 },
    );
  });
  it("bölünmüş emir tek emirden ucuz değil (alım)", () => {
    fc.assert(
      fc.property(pool, frac, ({ p }, f) => {
        const q = qtyOf(p, f);
        if (q < 2n) return true;
        const half = q / 2n;
        const one = executeAgainstPool("buy", p, q);
        const a = executeAgainstPool("buy", p, half);
        const b = executeAgainstPool("buy", a.newPool, q - half);
        return -(a.playerDelta + b.playerDelta) >= -one.playerDelta - 2n; // yuvarlama payı
      }),
    );
  });
  it("k = units x value asla azalmaz; para yaratılmaz; vergi sınırları", () => {
    fc.assert(
      fc.property(pool, frac, fc.constantFrom<"buy" | "sell">("buy", "sell"), ({ p }, f, side) => {
        const q = qtyOf(p, f);
        const r = executeAgainstPool(side, p, q);
        const marketLeg = side === "buy" ? r.gross : -r.gross;
        return (
          r.newPool.units * r.newPool.value >= p.units * p.value &&
          r.playerDelta + marketLeg + r.tax === 0n &&
          r.tax >= 0n &&
          r.tax <= r.gross &&
          r.gross >= 0n &&
          (side === "buy" ? r.playerDelta < 0n : r.playerDelta >= 0n)
        );
      }),
      { numRuns: 3000 },
    );
  });
  it("alım fiyatı yükseltir, satım düşürür; ortalama fiyat taraflarda doğru", () => {
    fc.assert(
      fc.property(pool, frac, ({ p }, f) => {
        const q = qtyOf(p, f);
        const b = executeAgainstPool("buy", p, q);
        const s = executeAgainstPool("sell", p, q);
        return b.newPrice >= poolPrice(p) && s.newPrice <= poolPrice(p) && b.unitPrice >= s.unitPrice;
      }),
    );
  });
  it("emir sınırı ve geçersiz miktar reddedilir", () => {
    const p = initialPool("wheat");
    expect(() => executeAgainstPool("buy", p, 0n)).toThrow(RangeError);
    expect(() => executeAgainstPool("sell", p, poolMaxOrder(p) + 1n)).toThrow(RangeError);
  });
  it("replenish hedefe yaklaşır, aşmaz, hedefte sabittir", () => {
    fc.assert(
      fc.property(pool, fc.bigInt({ min: 0n, max: 200_000n }), ({ pid, p }, n) => {
        const D = PARAMS.poolDepth[pid];
        const V = D * PARAMS.refPrice[pid];
        const r = replenish(p, pid, n);
        const closer = (a: bigint, b: bigint, t: bigint) => abs(b - t) <= abs(a - t);
        const noCross = (a: bigint, b: bigint, t: bigint) => !((a - t) * (b - t) < 0n);
        return closer(p.units, r.units, D) && closer(p.value, r.value, V) && noCross(p.units, r.units, D) && noCross(p.value, r.value, V);
      }),
    );
    for (const pid of PRODUCT_IDS) expect(replenish(initialPool(pid), pid, 1000n)).toEqual(initialPool(pid));
  });
  it("tek yönlü etkiden sonra yenilenme aleyhine: önce al, bekle, sat <= hemen sat", () => {
    fc.assert(
      fc.property(product, frac, fc.bigInt({ min: 0n, max: 100_000n }), (pid, f, wait) => {
        const p0 = initialPool(pid);
        const q = qtyOf(p0, f);
        const b = executeAgainstPool("buy", p0, q);
        const now = executeAgainstPool("sell", b.newPool, q).playerDelta;
        const later = executeAgainstPool("sell", replenish(b.newPool, pid, wait), q).playerDelta;
        return later <= now;
      }),
    );
  });
  it("rastgele al/sat/bekle dizisi + tasfiye: net kâr <= 0 (denge havuzundan başlayan tek oyuncu)", () => {
    const op = fc.record({ buy: fc.boolean(), f: frac, wait: fc.integer({ min: 0, max: 5_000 }) });
    fc.assert(
      fc.property(product, fc.array(op, { minLength: 1, maxLength: 40 }), (pid, ops) => {
        let p = initialPool(pid);
        let held = 0n;
        let cash = 0n;
        for (const o of ops) {
          p = replenish(p, pid, BigInt(o.wait));
          if (o.buy) {
            const q = qtyOf(p, o.f);
            const r = executeAgainstPool("buy", p, q);
            cash += r.playerDelta;
            held += q;
            p = r.newPool;
          } else if (held > 0n) {
            let q = (held * BigInt(o.f)) / 100n;
            if (q < 1n) q = 1n;
            if (q > poolMaxOrder(p)) q = poolMaxOrder(p);
            const r = executeAgainstPool("sell", p, q);
            cash += r.playerDelta;
            held -= q;
            p = r.newPool;
          }
        }
        while (held > 0n) {
          const q = held < poolMaxOrder(p) ? held : poolMaxOrder(p);
          const r = executeAgainstPool("sell", p, q);
          cash += r.playerDelta;
          held -= q;
          p = r.newPool;
        }
        return cash <= 0n;
      }),
      { numRuns: 1500 },
    );
  }, 60_000);
  it("çok tick'li pump-and-dump her ürün, miktar, süre ve bekleme için kârsız", () => {
    fc.assert(
      fc.property(
        product,
        fc.bigInt({ min: 1n, max: 5_000n }),
        fc.integer({ min: 1, max: 3_000 }),
        fc.integer({ min: 0, max: 3_000 }),
        (pid, q, n, w) => pumpProfit(pid, q, n, w, 6_000) <= 0n,
      ),
      { numRuns: 300 },
    );
    for (const pid of PRODUCT_IDS)
      for (const q of [1n, 10n, 100n, 1000n])
        for (const n of [1, 5, 50, 500])
          for (const w of [0, 60, 3600])
            expect(pumpProfit(pid, q, n, w, 6_000)).toBeLessThanOrEqual(0n);
  }, 60_000);
});

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}
