/**
 * Girdi ayrıştırma (yalnızca kullanıcı metnini birimlere çevirir; para hesabı değildir).
 * Tam sayı aritmetiği BigInt ile; kesirli sonuç = geçersiz.
 */
function parseDecimal(text: string, maxDecimals: number): { s: bigint; d: number } | null {
  const m = /^(\d{1,12})(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > maxDecimals) return null;
  return { s: BigInt(m[1]! + frac), d: frac.length };
}
function safe(n: bigint): number | null {
  return n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
}

export type QtyUnit = "kg" | "t";
export type PriceUnit = "kg" | "t";

/** metin → kg (tam sayı) */
export function parseKg(text: string, unit: QtyUnit): number | null {
  const p = parseDecimal(text, unit === "t" ? 3 : 0);
  if (!p) return null;
  const num = unit === "t" ? p.s * 1000n : p.s;
  const den = 10n ** BigInt(p.d);
  return num % den === 0n ? safe(num / den) : null;
}
export function kgToText(kg: number | null, unit: QtyUnit): string {
  if (kg === null) return "";
  return unit === "kg" ? String(kg) : String(kg / 1000).replace(".", ",");
}

/** ₺/kg veya ₺/t metni → kuruş/kg (tam sayı) */
export function parsePricePerKg(text: string, unit: PriceUnit): number | null {
  const p = parseDecimal(text, unit === "t" ? 1 : 2);
  if (!p) return null;
  const num = p.s * 100n;
  const den = 10n ** BigInt(p.d) * (unit === "t" ? 1000n : 1n);
  return num % den === 0n ? safe(num / den) : null;
}
export function perKgToText(kurusPerKg: number | null, unit: PriceUnit): string {
  if (kurusPerKg === null) return "";
  return unit === "kg" ? (kurusPerKg / 100).toFixed(2).replace(".", ",") : String(kurusPerKg * 10);
}

/** ₺ metni → kuruş (tam sayı) */
export function parseLira(text: string): number | null {
  const p = parseDecimal(text, 2);
  if (!p) return null;
  const num = p.s * 100n;
  const den = 10n ** BigInt(p.d);
  return num % den === 0n ? safe(num / den) : null;
}
export function kurusToText(k: number | null): string {
  return k === null ? "" : (k / 100).toFixed(2).replace(".", ",");
}

/** Yerel saat <input type=datetime-local> değeri ↔ ISO */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function localInputToIso(v: string): string | null {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
