import { type Money, applyBpsCeil, assertNonNegative } from "./money";
import { PARAMS } from "./params";

export interface Holding {
  price: Money;
  qty: bigint;
}

/**
 * Envanter değeri, SİSTEM LEHİNE: her birim fiyat − ceil(spread) (asgari minPrice) ile
 * değerlenir; vergi düşülmez. Ölçülen değer gerçekleştirilebilir değerden küçük
 * olmaz, ödenek için muhafazakâr yöndür. Hiçbir alım/satım ölçülen serveti artıramaz.
 */
export function inventoryValue(holdings: Holding[]): Money {
  let total = 0n;
  for (const h of holdings) {
    assertNonNegative(h.qty, "miktar");
    if (h.price < PARAMS.minPrice) throw new RangeError(`fiyat asgarinin altında: ${h.price}`);
    let unit = h.price - applyBpsCeil(h.price, PARAMS.spreadBps);
    if (unit < PARAMS.minPrice) unit = PARAMS.minPrice;
    total += unit * h.qty;
  }
  return total;
}

/** Asgari ödenek şartı: aktif (askıda olmayan) tesisi yok ve nakit + envanter değeri eşiğin altında. */
export function reliefEligible(s: {
  cash: Money;
  inventoryValue: Money;
  hasActiveFacility: boolean;
}): boolean {
  assertNonNegative(s.cash, "nakit");
  assertNonNegative(s.inventoryValue, "envanter değeri");
  if (s.hasActiveFacility) return false;
  return s.cash + s.inventoryValue < PARAMS.reliefThreshold;
}

/** Ödenek dönemi numarası (tick / reliefCooldownTicks); dönem başına en fazla bir talep. */
export function reliefPeriod(tick: bigint): bigint {
  if (tick < 0n) throw new RangeError(`tick negatif olamaz: ${tick}`);
  return tick / PARAMS.reliefCooldownTicks;
}
