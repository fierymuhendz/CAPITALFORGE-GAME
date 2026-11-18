import { type Money, BPS_SCALE, applyBpsCeil, assertNonNegative } from "./money";
import { PARAMS } from "./params";

export type TradeSide = "buy" | "sell";

export interface TradeQuote {
  unitPrice: Money;
  gross: Money;
  tax: Money;
  /** Oyuncu bakiyesine etkisi: alımda negatif (-(gross+tax)), satımda pozitif (gross-tax). */
  playerDelta: Money;
}

function clampPrice(p: Money): Money {
  if (p < PARAMS.minPrice) return PARAMS.minPrice;
  if (p > PARAMS.maxPrice) return PARAMS.maxPrice;
  return p;
}

/**
 * Bir sonraki tick fiyatı. Talep arzı aşarsa fiyat artar, tersi azalır.
 * imbalanceBps = (d - s) * maxStep / (d + s + L). Payda likiditeyi içerir, bu yüzden
 * küçük hacim fiyatı az oynatır ve |adım| < maxStep olur.
 * Bölmeler sıfıra doğru keser. Sonuç [minPrice, maxPrice] aralığındadır.
 * Saf fonksiyon: zaman ve rastgelelik kullanmaz.
 */
export function nextPrice(
  price: Money,
  demand: bigint,
  supply: bigint,
  liquidity: bigint = PARAMS.liquidity,
): Money {
  assertNonNegative(price, "fiyat");
  assertNonNegative(demand, "talep");
  assertNonNegative(supply, "arz");
  assertNonNegative(liquidity, "likidite");
  const base = clampPrice(price);
  const denom = demand + supply + liquidity;
  if (denom === 0n) return base;
  const imbalanceBps = ((demand - supply) * PARAMS.maxPriceStepBps) / denom;
  return clampPrice(base + (base * imbalanceBps) / BPS_SCALE);
}

/** Alım/satım tutarından alınacak işlem vergisi (yukarı yuvarlanır). */
export function transactionTax(gross: Money): Money {
  return applyBpsCeil(gross, PARAMS.transactionTaxBps);
}

/**
 * İşlem teklifi. Alımda birim fiyat = fiyat + ceil(spread) (oyuncu fazla öder),
 * satımda = max(minPrice, fiyat - ceil(spread)) (oyuncu az alır). Vergi yukarı yuvarlanır;
 * satımda vergi brüt tutarı aşamaz. Yuvarlama hep sistemin lehinedir.
 */
export function quoteTrade(side: TradeSide, price: Money, quantity: bigint): TradeQuote {
  if (price < PARAMS.minPrice) throw new RangeError(`fiyat asgarinin altında: ${price}`);
  if (quantity <= 0n) throw new RangeError(`miktar pozitif olmalı: ${quantity}`);
  const spread = applyBpsCeil(price, PARAMS.spreadBps);
  let unitPrice: Money;
  if (side === "buy") {
    unitPrice = price + spread;
  } else {
    unitPrice = price - spread;
    if (unitPrice < PARAMS.minPrice) unitPrice = PARAMS.minPrice;
  }
  const gross = unitPrice * quantity;
  const rawTax = transactionTax(gross);
  const tax = rawTax > gross ? gross : rawTax;
  const playerDelta = side === "buy" ? -(gross + tax) : gross - tax;
  return { unitPrice, gross, tax, playerDelta };
}

/**
 * NPC talep/arz akışı (tick başına birim). Referans fiyatta ikisi de base. Fiyat referansın
 * altındaysa talep artar/arz azalır, üstündeyse tersi; böylece üretilen malın hep alıcısı olur
 * ve fiyat sıfıra kaymaz. Sapma ±%100'e kırpılır; kaydırma sıfıra doğru kesilir (simetrik).
 */
export function npcFlow(
  price: Money,
  refPrice: Money,
  base: bigint,
): { demand: bigint; supply: bigint } {
  if (price < 0n) throw new RangeError(`fiyat negatif olamaz: ${price}`);
  if (refPrice < 1n) throw new RangeError(`referans fiyat pozitif olmalı: ${refPrice}`);
  if (base < 0n) throw new RangeError(`base negatif olamaz: ${base}`);
  let devBps = ((refPrice - price) * BPS_SCALE) / refPrice;
  if (devBps > BPS_SCALE) devBps = BPS_SCALE;
  if (devBps < -BPS_SCALE) devBps = -BPS_SCALE;
  const shift = (base * PARAMS.npcSlopeBps * devBps) / (BPS_SCALE * BPS_SCALE);
  const demand = base + shift;
  const supply = base - shift;
  return { demand: demand < 0n ? 0n : demand, supply: supply < 0n ? 0n : supply };
}
