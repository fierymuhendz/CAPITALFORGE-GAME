/**
 * Deneme dönemi tempo kuralı (saf): oyun süreleri `maxMinutes` ile sınırlanır; yol süreleri sıkıştırılır (düzleştirilmez).
 * maxMinutes <= 0 → sınır yok.
 */

/** Süre tavanı (üretim, inşaat, yükseltme, araştırma, bekleme). En az 1 dk (süre > 0 ise). */
export function capMinutes(minutes: number, maxMinutes: number): number {
  if (maxMinutes <= 0 || minutes <= maxMinutes) return minutes;
  return Math.max(1, maxMinutes);
}

/**
 * Yol ölçeği (bp, 10000 = değişmez): en uzun olası seferin (en yavaş araç + yükleme/boşaltma) süresi `maxMinutes` olsun.
 * Aşağı yuvarlanır, böylece ölçeklenmiş en uzun sefer tavanı aşmaz.
 */
export function travelScaleBp(maxMinutes: number, longestTripMinutes: number): number {
  if (maxMinutes <= 0 || longestTripMinutes <= 0 || longestTripMinutes <= maxMinutes) return 10000;
  return Math.max(1, Math.floor((maxMinutes * 10000) / longestTripMinutes));
}

/** Sefer dakikasını ölçekle (yukarı yuvarlı; 0 → 0, pozitif → en az 1). Kısa ve uzun sefer farkı korunur. */
export function scaleTravelMinutes(minutes: number, scaleBp: number): number {
  if (minutes <= 0) return 0;
  if (scaleBp >= 10000) return minutes;
  return Math.max(1, Math.ceil((minutes * scaleBp) / 10000));
}
