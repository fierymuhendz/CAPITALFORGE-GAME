import { PARAMS } from "./params";

/**
 * Kayan pencerede (volumeWindowTicks) oyuncu başına ÜRÜN başına hacim sınırı (alım + satım toplamı).
 * usedInWindow: oyuncunun son volumeWindowTicks tick'teki o ürün işlem adedi toplamı (sunucu tutar).
 * Pump-and-dump'ı kapatır: kısa sürede fiyatı itecek hacim yapılamaz, geri çekilme için NPC zamanı kalır.
 */
export function volumeAllowed(usedInWindow: bigint, qty: bigint): boolean {
  if (usedInWindow < 0n) throw new RangeError(`kullanılan hacim negatif olamaz: ${usedInWindow}`);
  if (qty <= 0n) return false;
  return usedInWindow + qty <= PARAMS.maxPlayerVolumePerWindow;
}
