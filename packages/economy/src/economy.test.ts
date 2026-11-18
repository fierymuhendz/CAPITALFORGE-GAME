import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyBpsCeil, applyBpsFloor, nextPrice, transactionTax, PARAMS } from "./index";

const money = fc.bigInt({ min: 0n, max: 10n ** 15n });

describe("money", () => {
  it("floor ≤ ceil ve aradaki fark en fazla 1 kuruş", () => {
    fc.assert(
      fc.property(money, fc.bigInt({ min: 0n, max: 10_000n }), (a, bps) => {
        const lo = applyBpsFloor(a, bps);
        const hi = applyBpsCeil(a, bps);
        return lo <= hi && hi - lo <= 1n;
      }),
    );
  });

  it("negatif tutarı reddeder", () => {
    expect(() => applyBpsFloor(-1n, 100n)).toThrow(RangeError);
  });
});

describe("pricing", () => {
  it("fiyat asgari fiyatın altına inmez", () => {
    fc.assert(
      fc.property(money, money, money, (p, d, s) => nextPrice(p, d, s) >= PARAMS.minPrice),
    );
  });

  it("tick başına değişim sınırı aşılmaz", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 100n, max: 10n ** 12n }), money, money, (p, d, s) => {
        const n = nextPrice(p, d, s);
        const diff = n > p ? n - p : p - n;
        return diff * 10_000n <= p * PARAMS.maxPriceStepBps;
      }),
    );
  });

  it("vergi asla negatif değildir ve brüt tutarı aşmaz", () => {
    fc.assert(fc.property(money, (g) => {
      const t = transactionTax(g);
      return t >= 0n && t <= g;
    }));
  });
});
