/**
 * Biçimlendirme yardımcıları (yalnızca gösterim). Para API'de kuruş cinsinden ondalık metin
 * olarak taşınır ("1234500" = ₺12.345,00). Hesap asla istemcide yapılmaz.
 */
export type Locale = "tr" | "en";

export function formatMoney(kurus: string | bigint | number, locale: Locale, opts?: { compact?: boolean }): string {
  const v = typeof kurus === "bigint" ? kurus : BigInt(typeof kurus === "number" ? Math.round(kurus) : kurus);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const lira = Number(abs / 100n) + Number(abs % 100n) / 100;
  const nf = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
    minimumFractionDigits: opts?.compact ? 0 : 2,
    maximumFractionDigits: opts?.compact ? 1 : 2,
    notation: opts?.compact && lira >= 100_000 ? "compact" : "standard",
  });
  return `${neg ? "−" : ""}₺${nf.format(lira)}`;
}

/** kg → "2,4 t" / "850 kg" */
export function formatQty(kg: number | string, locale: Locale): string {
  const v = Number(kg);
  const nf = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1000) return `${nf.format(v / 1000)} t`;
  return `${nf.format(v)} kg`;
}

/** kuruş/kg → ton fiyatı metni */
export function formatPricePerTonne(kurusPerKg: string | number | bigint, locale: Locale): string {
  return `${formatMoney(BigInt(kurusPerKg) * 1000n, locale, { compact: false })}/t`;
}
