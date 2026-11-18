/**
 * Para birimi: en küçük birim (kuruş) cinsinden bigint.
 * Kural: float ile para hesabı yapılmaz. Tüm yuvarlama bu dosyadan geçer.
 */
export type Money = bigint;

/** Basis point: 10_000 bp = %100. Oranlar tam sayı olarak tutulur. */
export type Bps = bigint;
export const BPS_SCALE = 10_000n;

export function assertNonNegative(value: Money, label = "tutar"): void {
  if (value < 0n) throw new RangeError(`${label} negatif olamaz: ${value}`);
}

/** a * bps / 10000, aşağı yuvarlar (sisteme para eklemeyen yön). */
export function applyBpsFloor(amount: Money, bps: Bps): Money {
  assertNonNegative(amount);
  assertNonNegative(bps, "oran");
  return (amount * bps) / BPS_SCALE;
}

/** a * bps / 10000, yukarı yuvarlar (ör. vergi ve ücret tahsilatı). */
export function applyBpsCeil(amount: Money, bps: Bps): Money {
  assertNonNegative(amount);
  assertNonNegative(bps, "oran");
  const product = amount * bps;
  return (product + BPS_SCALE - 1n) / BPS_SCALE;
}

export function formatMoney(amount: Money, currency = "TRY", locale = "tr-TR"): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const n = Number(`${whole}.${frac.toString().padStart(2, "0")}`);
  const text = new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  return negative ? `-${text}` : text;
}
