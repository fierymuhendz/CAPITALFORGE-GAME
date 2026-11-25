/**
 * Modül B (piyasa, sözleşme, lojistik) için ek sorgu şemaları ve yanıt tipleri.
 * İstek gövdeleri schemas.ts'te, ana yanıt tipleri api.ts'tedir.
 */
import { z } from "zod";
import type { Iso, Money } from "./api";
import { MAX_QTY_KG, id, uuid } from "./schemas";

export const MarketQuery = z.object({ cityId: id, productId: id });
export const MarketHistoryQuery = z.object({ cityId: id, productId: id, hours: z.coerce.number().int().min(1).max(24 * 30).optional() });
export const BoardScopeQuery = z.object({ scope: z.enum(["board", "mine"]).default("mine") });
export const MineScopeQuery = z.object({ scope: z.enum(["mine"]).default("mine") });
export const FreightQuoteQuery = z.object({
  originCityId: id,
  destCityId: id,
  kg: z.coerce.number().int().positive().max(MAX_QTY_KG),
  modelId: id.optional(),
});
export const IdParam = z.object({ id: uuid });

/** GET /market/history */
export interface PriceHistoryDto {
  cityId: string; productId: string;
  points: Array<{ at: Iso; refPricePerKg: Money; vwapPerKg: Money | null; volumeKg: number }>;
}

/** GET /freight/quote */
export interface FreightQuoteDto {
  originCityId: string; destCityId: string; kg: number; distanceKm: number;
  /** sistem taşımacısı (Anadolu Lojistik) tarifesi: kamyon dolusu sayısıyla */
  systemQuote: Money;
  /** her araç modeli için kendi aracınla tahmini yolculuk (araştırma etkileri dahil) */
  own: Array<{
    modelId: string; capacityKg: number; loadsNeeded: number; minutes: number;
    fuel: Money; driver: Money; total: Money; arrivesAt: Iso;
    /** bu modelden boşta, kalkış şehrinde, kapasitesi yeten aracın var mı */
    vehicleId: string | null;
  }>;
}
