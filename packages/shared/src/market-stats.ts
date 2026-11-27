/** Pazar istatistikleri ve şehir karşılaştırması: sorgu şemaları ve yanıt tipleri (para string, kuruş). */
import { z } from "zod";
import type { Iso, Money } from "./api";
import { id } from "./schemas";

export const MARKET_STATS_MAX_HOURS = 168;
export const MARKET_COMPARE_MAX_KG = 1_000_000;

export const MarketStatsQuery = z.object({
  productId: id,
  cityId: id,
  hours: z.coerce.number().int().min(1).max(MARKET_STATS_MAX_HOURS).default(24),
});

export const MarketCompareQuery = z.object({
  productId: id,
  qtyKg: z.coerce.number().int().min(1).max(MARKET_COMPARE_MAX_KG),
  quality: z.coerce.number().int().min(1).max(5).optional(),
  fromCityId: id.optional(),
});

export type BookSourceDto = "system" | "player";

export interface BookQuoteDto {
  orderId: string;
  source: BookSourceDto;
  /** sistem alış emrinde: emrin kalitesine göre efektif fiyat (cap uygulanmış) */
  pricePerKg: Money;
  quality: number;
  remainingKg: number;
}

export interface LastTradeDto { pricePerKg: Money; quality: number; qtyKg: number; at: Iso }

export interface QualityVwapDto { quality: number; vwapPerKg: Money; volumeKg: number; tradeCount: number }

export type PriceBasis = "vwap" | "reference";

export interface MarketStatsDto {
  productId: string;
  cityId: string;
  hours: number;
  bestBid: BookQuoteDto | null;
  bestAsk: BookQuoteDto | null;
  bestPlayerBid: BookQuoteDto | null;
  bestPlayerAsk: BookQuoteDto | null;
  bestSystemBid: BookQuoteDto | null;
  bestSystemAsk: BookQuoteDto | null;
  lastPlayerTrade: LastTradeDto | null;
  lastSystemTrade: LastTradeDto | null;
  playerVolumeKg: number;
  systemVolumeKg: number;
  tradeCount: number;
  /** oyuncu-oyuncu kg / toplam kg (baz puan); işlem yoksa 0 */
  p2pShareBp: number;
  vwapByQuality: QualityVwapDto[];
  /** kalite 2'ye normalize, kırpılmış VWAP (fiyat referansıyla aynı yöntem); lowData iken null */
  vwapQ2PerKg: Money | null;
  refPricePerKg: Money;
  /** dönemde farklı alıcı-satıcı çifti sayısı */
  distinctPairs: number;
  minDistinctPairs: number;
  lowData: boolean;
  priceBasis: PriceBasis;
}

export interface CompareCityDto {
  cityId: string;
  bestBid: BookQuoteDto | null;
  /** bu miktarın bu emirle dolacak kısmı */
  fillKg: number;
  gross: Money | null;
  fee: Money | null;
  /** seçili çıkış şehri yoksa null */
  freight: Money | null;
  km: number | null;
  etaMinutes: number | null;
  loads: number | null;
  net: Money | null;
  netPerKg: Money | null;
  vwapQ2PerKg: Money | null;
  refPricePerKg: Money;
  lowData: boolean;
  priceBasis: PriceBasis;
  p2pShareBp: number;
}

export interface MarketCompareDto {
  productId: string;
  qtyKg: number;
  quality: number;
  fromCityId: string | null;
  marketFeeBp: number;
  rows: CompareCityDto[];
  /** net getirisi en yüksek şehir (eşitlikte şehir kimliği) */
  bestCityId: string | null;
}
