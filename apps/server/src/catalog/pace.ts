/**
 * Tempo kuralı (settings.pace): süre tavanı, yol sıkıştırması ve oyun testi kipi. Saf formüller packages/economy/pace.ts içinde.
 *
 * Oyun testi kipi (`pace.playtestSeconds` > 0): her oyun beklemesi min(özgün, tavan). Bu dosyadaki süre işlevleri
 * (paceDuration, paceTrip, pickupMinutes) tavanı zaten uygular ve KESİRLİ dakika döndürebilir (15 sn = 0,25 dk).
 * Çalışan işlerin kalan süresi `playtest.ts` içindeki görevle aynı tavana çekilir.
 * Oturum, güvenlik sınırları ve altyapı zamanlamaları bu kurala tabi değildir.
 */
import { capMinutes, capWaitMinutes, capWaitMs, scaleTravelMinutes, travelMinutes, travelScaleBp } from "@capitalforge/economy";
import { roadDistanceKm } from "@capitalforge/shared";
import type { Catalog } from "./catalog";

export const paceMax = (c: Catalog): number => c.settings.pace?.maxMinutes ?? 0;

/** oyun testi kipi tavanı (sn); 0 = kapalı */
export const playtestSeconds = (c: Catalog): number => {
  const v = (c.settings.pace as { playtestSeconds?: number } | undefined)?.playtestSeconds ?? 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** zaman damgasından türetilen beklemeler (soğuma, sistemin devralma beklemesi): min(ms, tavan) */
export const playtestMs = (c: Catalog, ms: number): number => capWaitMs(ms, playtestSeconds(c));

/** üretim, inşaat, yükseltme, araştırma, taşıyıcı bekleme (dk; oyun testi kipinde kesirli olabilir) */
export const paceDuration = (c: Catalog, minutes: number): number => capWaitMinutes(capMinutes(minutes, paceMax(c)), playtestSeconds(c));

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
export const paceTrip = (c: Catalog, minutes: number): number => capWaitMinutes(scaleTravelMinutes(minutes, paceTravelScaleBp(c)), playtestSeconds(c));

/** sistem taşımacısının üstlenme beklemesi (tempolu): tavan < 4 dk ise 0; aksi halde yolculuğa en az 1 dk bırakır */
export const pickupMinutes = (c: Catalog): number => {
  const max = paceMax(c);
  const raw = c.settings.freight.systemPickupAfterMinutes;
  if (max > 0 && max < 4) return 0;
  const base = max > 0 ? Math.min(capMinutes(raw, max), max - 1) : raw;
  return capWaitMinutes(base, playtestSeconds(c));
};

/** dakika → ms (kesirli dakikada tam ms) */
export const minutesToMs = (minutes: number): number => Math.round(minutes * 60_000);
