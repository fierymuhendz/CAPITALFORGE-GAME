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

// ---------------- v3: karar ekranları (teklif karşılaştırma, tahmin ↔ gerçekleşen) ----------------

/**
 * GET /market/offers — sunucu hesaplı teklif karşılaştırması.
 * side=buy: tüm şehirlerdeki satış ilanları, `cityId` (teslim şehri) için teslim birim maliyetine göre sıralı.
 * side=sell: tüm şehirlerdeki alım emirleri; stok `fromCityId` (yoksa en çok stok olan şehir) şehrinden taşınır, net kg başına sıralı.
 */
export const OffersQuery = z.object({
  side: z.enum(["buy", "sell"]),
  productId: id,
  cityId: id,
  qtyKg: z.coerce.number().int().positive().max(MAX_QTY_KG),
  fromCityId: id.optional(),
  quality: z.coerce.number().int().min(1).max(5).optional(),
});

export type OfferNote = "PARTIAL" | "SPLIT_LOADS" | "SAME_CITY" | "NO_STOCK" | "QUALITY_PREMIUM" | "SATURATING";

export interface OfferRowDto {
  /** market_orders satırı */
  orderId: string;
  companyName: string; isSystem: boolean;
  /** ilanın/emrin şehri */
  cityId: string;
  km: number;
  quality: number;
  /** ilandaki/emirdeki kalan */
  availableKg: number;
  /** bu karşılaştırmada kullanılan miktar = min(istenen, kalan[, stok]) */
  fillKg: number;
  /** birim fiyat (sell tarafında kaliteye göre düzeltilmiş) */
  pricePerKg: string;
  /** mal bedeli = fillKg × fiyat */
  goods: string;
  /** navlun (sistem taşımacısı tarifesi, kamyon dolusu sayısıyla) — aynı şehirde 0 */
  freight: string;
  loads: number;
  truckCapacityKg: number;
  /** pazar komisyonu (satıcıdan kesilir; buy tarafında 0) */
  fee: string;
  /** buy: mal + navlun (ödenecek) ; sell: mal − komisyon − navlun (eline geçecek) */
  total: string;
  /** buy: teslim birim maliyeti ; sell: net birim gelir */
  perKg: string;
  /** sell tarafında: satılacak stokun ortalama maliyetiyle kâr; buy tarafında null */
  profit: string | null;
  /** teslim/tahsilat süresi (dk): taşıyıcı bekleme + yol */
  etaMinutes: number;
  arrivesAt: string;
  notes: OfferNote[];
}

export interface OffersDto {
  side: "buy" | "sell"; productId: string; cityId: string; qtyKg: number;
  /** sell tarafında stokun taşınacağı şehir ve oradaki kullanılabilir stok */
  fromCityId: string | null; stockKg: number; avgCostPerKg: string | null;
  rows: OfferRowDto[];
  /** en iyi satır (buy: en düşük perKg, sell: en yüksek perKg; eşitlikte erken varan) */
  bestOrderId: string | null;
  /** en hızlı satır */
  fastestOrderId: string | null;
}

/**
 * POST /market/listings/:id/buy gövdesine isteğe bağlı `deliverToCityId` eklenir:
 * aynı işlemde mal alınır ve teslim şehrine sistem taşımacısına açık taşıma işi (ücret = sistem tarifesi) açılır.
 */
export interface BuyResultDto {
  tradeId: string; saleId: string; gross: string; fee: string; cogs: string;
  freightJobId: string | null; freightPay: string | null; arrivesBy: string | null;
  outcomeId: string | null;
}

/** GET /contracts/:id/compare — teklifi kabul etmeden önce: sözleşme ↔ bugün spot satış */
export interface ContractCompareDto {
  contractId: string;
  myRole: "seller" | "buyer";
  perInstallment: { qtyKg: number; goods: string; freight: string; fees: string; net: string; perKg: string };
  total: { qtyKg: number; goods: string; freight: string; fees: string; net: string };
  schedule: { firstDueAt: string; intervalHours: number; installments: number; lastDueAt: string };
  /** taahhüt: satıcı teminatı, alıcı emaneti, bir taksit kaçarsa ceza */
  commitment: { sellerDeposit: string; buyerEscrow: string; penaltyPerMissed: string };
  /** satıcı: aynı miktarı bugün en iyi alım emrine satsa (net gelir). alıcı: bugün en ucuz ilandan alıp teslim şehrine getirtse (mal + navlun) */
  spotNow: null | { cityId: string; pricePerKg: string; fillKg: number; net: string; perKg: string };
  /** satıcı için: teslim şehrinde ve diğer şehirlerdeki stok */
  myStockKg: number;
  /** kendi üretim birim maliyeti tahmini (ortalama stok maliyeti), yoksa null */
  avgCostPerKg: string | null;
}

/** Tahmin ↔ gerçekleşen kaydı (GET /finance/outcomes) */
export interface OutcomeFiguresDto {
  qtyKg: number | null;
  revenue: string | null;
  goods: string | null;
  freight: string | null;
  fees: string | null;
  cost: string | null;
  profit: string | null;
  minutes: number | null;
  at: string | null;
}
export interface OutcomeDto {
  id: string;
  kind: "production" | "purchase" | "sale" | "freight_job" | "contract";
  refType: string; refId: string;
  productId: string | null; recipeId: string | null; cityId: string | null; destCityId: string | null;
  createdAt: string;
  status: "pending" | "settled" | "cancelled";
  expected: OutcomeFiguresDto;
  actual: OutcomeFiguresDto | null;
  saleIds: string[];
  ledgerTransactionIds: string[];
}
