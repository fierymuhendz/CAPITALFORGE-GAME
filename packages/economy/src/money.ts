/**
 * Para kuralları (tek yer). Para kuruş cinsinden bigint. float kullanılmaz.
 * Yuvarlama kuralı: aşağı yuvarlama (floor). Pay dağıtımında kalan son paya eklenir,
 * böylece parçaların toplamı her zaman bütüne eşittir.
 */
export const BP = 10_000n;

export function toBig(v: bigint | number | string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`tam sayı değil: ${v}`);
    return BigInt(v);
  }
  if (!/^-?\d+$/.test(v)) throw new Error(`geçersiz tutar: ${v}`);
  return BigInt(v);
}

/** floor(a × b / c), c > 0. Negatiflerde de aşağı (−∞) yuvarlar. */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c <= 0n) throw new Error("bölen pozitif olmalı");
  const n = a * b;
  const q = n / c;
  return n % c !== 0n && n < 0n ? q - 1n : q;
}

/** tutar × bp / 10000, aşağı yuvarlı */
export function applyBp(amount: bigint, bp: number | bigint): bigint {
  return mulDiv(amount, toBig(bp), BP);
}

/** miktar(kg) × birim fiyat(kuruş/kg) */
export function lineTotal(qtyKg: number, pricePerKg: bigint | number): bigint {
  return toBig(qtyKg) * toBig(pricePerKg);
}

/**
 * Ağırlıklı ortalama maliyet ile stoktan çıkış maliyeti.
 * Tümü çıkıyorsa kalan maliyetin tamamı, değilse floor(maliyet × çıkan / miktar).
 */
export function wacRemovalCost(qtyKg: number, costTotal: bigint, removeKg: number): bigint {
  if (removeKg <= 0 || !Number.isInteger(removeKg)) throw new Error("çıkış miktarı pozitif tam sayı olmalı");
  if (removeKg > qtyKg) throw new Error("stoktan fazla çıkış");
  if (removeKg === qtyKg) return costTotal;
  return mulDiv(costTotal, toBig(removeKg), toBig(qtyKg));
}

/** Ortalama birim maliyet (gösterim), kuruş/kg, aşağı yuvarlı; ton başına daha hassas değer için perKg=1000 */
export function avgUnitCost(qtyKg: number, costTotal: bigint, perKg = 1): bigint {
  if (qtyKg <= 0) return 0n;
  return mulDiv(costTotal, toBig(perKg), toBig(qtyKg));
}

/** Bir tutarı ağırlıklara göre böl; toplam korunur (kalan sonuncuya). */
export function allocate(total: bigint, weights: number[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0n));
  const out: bigint[] = [];
  let used = 0n;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) out.push(total - used);
    else {
      const part = mulDiv(total, toBig(w), toBig(sum));
      out.push(part);
      used += part;
    }
  });
  return out;
}

export function maxBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b > a ? b : a));
}
export function minBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b < a ? b : a));
}
