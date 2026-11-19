import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyBpsCeil,
  applyBpsFloor,
  nextPrice,
  quoteTrade,
  transactionTax,
  PARAMS,
  type TradeSide,
} from "./index";

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

const price = fc.bigInt({ min: PARAMS.minPrice, max: PARAMS.maxPrice });
const qty = fc.bigInt({ min: 1n, max: 10n ** 9n });
const volume = fc.bigInt({ min: 0n, max: 10n ** 12n });
const side = fc.constantFrom<TradeSide>("buy", "sell");

describe("pricing", () => {
  it("fiyat her zaman [minPrice, maxPrice] aralığında", () => {
    fc.assert(
      fc.property(money, volume, volume, fc.bigInt({ min: 0n, max: 10n ** 9n }), (p, d, s, l) => {
        const n = nextPrice(p, d, s, l);
        return n >= PARAMS.minPrice && n <= PARAMS.maxPrice;
      }),
    );
  });

  it("tick başına değişim maxPriceStepBps sınırını aşmaz", () => {
    fc.assert(
      fc.property(price, volume, volume, (p, d, s) => {
        const n = nextPrice(p, d, s);
        const diff = n > p ? n - p : p - n;
        return diff * 10_000n <= p * PARAMS.maxPriceStepBps;
      }),
    );
  });

  it("al, sonraki tick sat: hiçbir miktarda kâr yok (tek oyuncu tüm talebi oluşturur)", () => {
    fc.assert(
      fc.property(price, qty, (p, q) => {
        const buy = quoteTrade("buy", p, q);
        const p2 = nextPrice(p, q, 0n); // en kötü durum: tüm talep bu oyuncudan, arz yok
        const sell = quoteTrade("sell", p2, q);
        return buy.playerDelta + sell.playerDelta <= 0n;
      }),
    );
  });

  it("al-sat kârsızlığı başkalarının ek talebiyle de bozulmaz", () => {
    fc.assert(
      fc.property(price, qty, volume, volume, (p, q, extraD, s) => {
        const buy = quoteTrade("buy", p, q);
        const p2 = nextPrice(p, q + extraD, s);
        const sell = quoteTrade("sell", p2, q);
        return buy.playerDelta + sell.playerDelta <= 0n;
      }),
    );
  });

  it("işlem para yaratmaz: sistem tarafı (market + vergi) toplamı >= oyuncu alacağı", () => {
    fc.assert(
      fc.property(side, price, qty, (sd, p, q) => {
        const t = quoteTrade(sd, p, q);
        // defter: oyuncu + market + vergi = 0; market buy'da +gross, sell'de -gross
        const market = sd === "buy" ? t.gross : -t.gross;
        const tax = t.tax;
        return t.playerDelta + market + tax === 0n && tax >= 0n;
      }),
    );
  });

  it("vergi negatif değildir ve brüt tutarı aşmaz (quoteTrade dahil)", () => {
    fc.assert(
      fc.property(side, price, qty, (sd, p, q) => {
        const t = quoteTrade(sd, p, q);
        return t.tax >= 0n && t.tax <= t.gross && t.unitPrice >= PARAMS.minPrice;
      }),
    );
  });

  it("alımda playerDelta negatif, satımda en fazla brüt kadar pozitif", () => {
    fc.assert(
      fc.property(price, qty, (p, q) => {
        return quoteTrade("buy", p, q).playerDelta < 0n && quoteTrade("sell", p, q).playerDelta >= 0n;
      }),
    );
  });

  it("geçersiz miktar reddedilir", () => {
    expect(() => quoteTrade("buy", 100n, 0n)).toThrow(RangeError);
    expect(() => quoteTrade("sell", 100n, -1n)).toThrow(RangeError);
  });
});

describe("vergi", () => {
  it("vergi asla negatif değildir ve brüt tutarı aşmaz", () => {
    fc.assert(fc.property(money, (g) => {
      const t = transactionTax(g);
      return t >= 0n && t <= g;
    }));
  });
});
