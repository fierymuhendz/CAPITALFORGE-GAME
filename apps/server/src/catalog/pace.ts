/** Tempo kuralı (settings.pace): süre tavanı ve yol sıkıştırması. Saf formüller packages/economy/pace.ts içinde. */
import { capMinutes, scaleTravelMinutes, travelMinutes, travelScaleBp } from "@capitalforge/economy";
import { roadDistanceKm } from "@capitalforge/shared";
import type { Catalog } from "./catalog";

export const paceMax = (c: Catalog): number => c.settings.pace?.maxMinutes ?? 0;

/** üretim, inşaat, yükseltme, araştırma, taşıyıcı bekleme */
export const paceDuration = (c: Catalog, minutes: number): number => capMinutes(minutes, paceMax(c));

/** yol ölçeği (bp): en uzun yol × en yavaş araç + yükleme/boşaltma = tavan */
/** sistem taşımacısı bekleme bütçesi: tavanın dörtte biri; bekleme + en uzun sefer ≤ tavan */
const pickupBudget = (max: number): number => (max > 0 ? Math.max(1, Math.floor(max / 4)) : 0);

export function paceTravelScaleBp(c: Catalog): number {
  const max0 = paceMax(c);
  if (max0 <= 0) return 10000;
  const max = max0 - pickupBudget(max0);
  // en uzun olası sefer: herhangi iki şehir arası yol mesafesi (çok duraklı rotalar dahil)
  const ids = [...c.cities.keys()];
  const km = Math.max(0, ...ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => roadDistanceKm(a, b))));
  const slowest = Math.min(...[...c.vehicleModels.values()].map((v) => v.speedKmh));
  return travelScaleBp(max, travelMinutes(km, slowest) + (c.settings.freight.handlingMinutes ?? 0));
}

/** sefer dakikası (yol + yükleme/boşaltma) → tempolu dakika */
export const paceTrip = (c: Catalog, minutes: number): number => scaleTravelMinutes(minutes, paceTravelScaleBp(c));

/** sistem taşımacısının üstlenme beklemesi (tempolu): tavan < 4 dk ise 0; aksi halde yolculuğa en az 1 dk bırakır */
export const pickupMinutes = (c: Catalog): number => {
  const max = paceMax(c);
  const raw = c.settings.freight.systemPickupAfterMinutes;
  if (max > 0 && max < 4) return 0;
  return max > 0 ? Math.min(paceDuration(c, raw), max - 1) : raw;
};
