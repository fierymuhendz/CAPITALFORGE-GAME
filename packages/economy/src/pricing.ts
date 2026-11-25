import { BP, applyBp, mulDiv, toBig } from "./money";

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Referans fiyat (kuruş/kg, kalite 2): taban × şehir × kayma. En az 1. */
export function refPrice(basePricePerKg: bigint | number, cityBp: number, driftBp: number): bigint {
  const v = mulDiv(mulDiv(toBig(basePricePerKg), toBig(cityBp), BP), toBig(driftBp), BP);
  return v < 1n ? 1n : v;
}

/** Kaliteye göre fiyat: ref × kalite çarpanı */
export function qualityAdjusted(price: bigint, quality: number, qualityBp: readonly number[]): bigint {
  const q = qualityBp[quality] ?? 10000;
  const v = applyBp(price, q);
  return v < 1n ? 1n : v;
}

/** Kaliteden arındırılmış (kalite 2 eşdeğeri) fiyat */
export function qualityNormalized(price: bigint, quality: number, qualityBp: readonly number[]): bigint {
  const q = qualityBp[quality] ?? 10000;
  return mulDiv(price, BP, toBig(q));
}

/**
 * Sistem alış fiyatı: ref × bidBp, bugün doldurulan oranla %30'a kadar düşer.
 * Üst sınır: tüm şehirlerdeki en düşük taban sistem satış fiyatının %80'i (cap).
 */
export function systemBid(ref: bigint, bidBp: number, filledTodayKg: number, dailyKg: number, cap: bigint | null): bigint {
  const fill = dailyKg > 0 ? clampN(filledTodayKg / dailyKg, 0, 1) : 1;
  const satBp = 10000 - Math.round(3000 * fill);
  let v = applyBp(applyBp(ref, bidBp), satBp);
  if (cap !== null && v > cap) v = cap;
  return v < 1n ? 1n : v;
}

/** Sistem satış fiyatı: ref × askBp, bugün satılan oranla %20'ye kadar artar */
export function systemAsk(ref: bigint, askBp: number, soldTodayKg: number, dailyKg: number): bigint {
  const used = dailyKg > 0 ? clampN(soldTodayKg / dailyKg, 0, 1) : 1;
  return applyBp(applyBp(ref, askBp), 10000 + Math.round(2000 * used));
}

/** Sistem alış üst sınırı (ürün bazında): min taban satış × 8000 bp */
export function systemBidCap(minBaseAskAcrossCities: bigint): bigint {
  return applyBp(minBaseAskAcrossCities, 8000);
}

/** Oyuncu payına göre sistem bütçe/kapasite çarpanı (bp): 10000 − pay × damp, en az 2000 */
export function systemShareFactorBp(playerShareBp: number, shareDampBp: number): number {
  return Math.max(2000, 10000 - Math.round((playerShareBp * shareDampBp) / 10000));
}

/** Referans kayması: oyuncu VWAP oranına doğru %20 adımla; 6000..15000 */
export function nextDriftBp(currentDriftBp: number, vwapRatioBp: number | null, systemSaturationBp: number): number {
  let target = vwapRatioBp ?? currentDriftBp;
  // sistem alıcıları doydukça fiyat aşağı itilir
  target = target - Math.round(systemSaturationBp / 10);
  const next = currentDriftBp + Math.round((target - currentDriftBp) * 0.2);
  return clampN(next, 6000, 15000);
}
