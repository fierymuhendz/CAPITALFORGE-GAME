import { BP, toBig } from "./money";

export interface Comparable { pricePerKgQ2: bigint }

/** Medyan (alt medyan, tam sayı) */
export function medianBig(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}

export interface AnomalyResult {
  refPricePerKg: bigint | null;
  deviationBp: number | null;
  comparables: number;
  insufficientData: boolean;
  flagged: boolean;
}

/**
 * Fiyat sapması: işlem fiyatı (kalite 2'ye normalize, teslim şehrinde) ile
 * karşılaştırılabilir işlemlerin medyanı. Yetersiz veri ayrıca işaretlenir.
 */
export function priceAnomaly(priceQ2: bigint, comparables: bigint[], thresholdBp: number, minComparables: number): AnomalyResult {
  const ref = medianBig(comparables);
  const insufficientData = comparables.length < minComparables;
  if (ref === null || ref <= 0n) return { refPricePerKg: null, deviationBp: null, comparables: comparables.length, insufficientData: true, flagged: false };
  const deviationBp = Number(((priceQ2 - ref) * BP) / ref);
  return {
    refPricePerKg: ref,
    deviationBp,
    comparables: comparables.length,
    insufficientData,
    flagged: Math.abs(deviationBp) >= thresholdBp,
  };
}

/** Servet sıçraması: son 24 saatte net değer artışı oranı (bp) */
export function growthBp(before: bigint, after: bigint): number | null {
  if (before <= 0n) return null;
  return Number(((after - before) * BP) / toBig(before));
}
