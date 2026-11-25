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

/**
 * Referans kayması (bp, 6000..15000): her saat hedefe %20 yaklaşır.
 * Hedef: bağımsız oyuncu işlemlerinin VWAP oranı; işlem yoksa 10000'e (taban) döner.
 * Sistem alıcıları doydukça hedef en fazla 1000 bp aşağı itilir; böylece fiyat kalıcı olarak
 * tabana çökmez, talep tazelendiğinde geri toparlanır.
 */
export function nextDriftBp(currentDriftBp: number, vwapRatioBp: number | null, systemSaturationBp: number): number {
  const push = Math.round(clampN(systemSaturationBp, 0, 10000) / 10);
  const target = (vwapRatioBp ?? 10000) - push;
  const next = currentDriftBp + Math.round((target - currentDriftBp) * 0.2);
  return clampN(next, 6000, 15000);
}

/**
 * Sistem alış fiyatı, kalite q için (H1 düzeltmesi). Üst sınır KALİTE 2 TABANINA uygulanır, sonra kalite çarpanı gelir:
 * fiyat = kalite çarpanı × min(taban alış, cap). Böylece cap'in koruduğu şey (kalite 2 alış < kalite 2 satış) aynen korunur
 * ve kalite 4–5 primi silinmez. Sistem yalnızca kalite 2 sattığı için sistemden al-sisteme sat döngüsü kalite primiyle
 * kârlı olamaz: kalite ancak üretimle (tesis kalitesi, araştırma) elde edilir.
 */
export function systemBidForQuality(bidQ2: bigint, quality: number, cap: bigint | null, qualityBp: readonly number[]): bigint {
  const base = cap !== null && bidQ2 > cap ? cap : bidQ2;
  return qualityAdjusted(base, quality, qualityBp);
}

/**
 * Sistem tekrarlayan alım sözleşmesi fiyatı (kuruş/kg, kalite 2 tabanı).
 * bid: doygunluksuz, cap'li sistem alış fiyatı. Prim (bp) = 300 taban + 1200 × pazar doygunluğu (0..10000, dünkü/bugünkü doluluk)
 * + (itibar − 9000) / 2 (itibar ≥ 9000 şart; en çok +500). Doygun pazarda spot düşerken sözleşme sabit kalır; doygun olmayan
 * pazarda prim küçüktür (spot rahatça yarışır). Üst sınır: en düşük sistem satış fiyatının %95'i, böylece sistemden al, sözleşmeye sat kârlı olmaz.
 */
export function systemContractPrice(bid: bigint, minSystemAsk: bigint | null, reputationBp: number, saturationBp: number): bigint {
  const sat = clampN(Math.round(saturationBp), 0, 10000);
  const rep = clampN(reputationBp, 9000, 10000);
  const premium = 300 + Math.floor((1200 * sat) / 10000) + Math.floor((rep - 9000) / 2);
  let v = applyBp(bid, 10000 + premium);
  if (minSystemAsk !== null) {
    const hard = applyBp(minSystemAsk, 9500);
    if (v > hard) v = hard;
  }
  return v < 1n ? 1n : v;
}
