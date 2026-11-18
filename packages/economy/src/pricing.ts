import { type Money, BPS_SCALE, applyBpsCeil, assertNonNegative } from "./money";
import { PARAMS } from "./params";

/**
 * Bir sonraki tick fiyatı. Talep arzı aşarsa fiyat artar, tersi azalır.
 * Değişim, dengesizlik oranıyla orantılıdır ve maxPriceStepBps ile sınırlanır.
 * Saf fonksiyon: zaman ve rastgelelik kullanmaz.
 */
export function nextPrice(price: Money, demand: bigint, supply: bigint): Money {
  assertNonNegative(price, "fiyat");
  assertNonNegative(demand, "talep");
  assertNonNegative(supply, "arz");
  const total = demand + supply;
  if (total === 0n) return price < PARAMS.minPrice ? PARAMS.minPrice : price;

  // (talep - arz) / (talep + arz) ∈ [-1, 1], bp cinsinden ölçeklenir
  const imbalanceBps = ((demand - supply) * PARAMS.maxPriceStepBps) / total;
  const next = price + (price * imbalanceBps) / BPS_SCALE;
  return next < PARAMS.minPrice ? PARAMS.minPrice : next;
}

/** Alım/satım tutarından alınacak işlem vergisi (yukarı yuvarlanır). */
export function transactionTax(gross: Money): Money {
  return applyBpsCeil(gross, PARAMS.transactionTaxBps);
}
