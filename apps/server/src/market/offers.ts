/**
 * GET /market/offers: sunucu hesaplı teklif karşılaştırması.
 * Navlun = sistem taşımacısı tarifesi (kamyon dolusu sayısıyla); teslim süresi = taşıyıcı bekleme + kamyon yolu.
 * Satış tarafı fiyatı `sellToOrder` ile aynı formülü kullanır (effectivePrice + bidCap), komisyon piyasa komisyonudur.
 */
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { applyBp, systemCarrierQuote, travelMinutes, wacRemovalCost } from "@capitalforge/economy";
import { roadDistanceKm, type OfferNote, type OfferRowDto, type OffersDto, type OffersQuery } from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import { pickupMinutes, paceTrip } from "../catalog/pace";
import type { DbOrTx } from "../db/client";
import { holdings, marketOrders } from "../db/schema";
import { dailyOf, profileByKey } from "../system/daily";
import { productBidCap } from "../system/pricing";
import { m } from "../lib/serialize";
import { companyBriefs, MIN } from "./common";
import { effectivePrice } from "./spot";

export interface FreightEstimate { freight: bigint; loads: number; km: number; etaMinutes: number; truckCapacityKg: number }

/** Yükü kamyon dolusu parçalara böler: tam kamyonlar + kalan (sistem taşımacısı her parçayı ayrı işle üstlenir) */
export function loadChunks(kg: number, capacityKg: number): number[] {
  const out: number[] = [];
  for (let left = kg; left > 0; left -= capacityKg) out.push(Math.min(left, capacityKg));
  return out;
}

/**
 * Sistem taşımacısı tarifesi ve süresi; aynı şehirde navlun ve süre 0.
 * Navlun = her kamyon dolusu parçanın sistem tarifesi toplamı (sistem taşımacısı bir işte en fazla bir kamyon alır).
 * Süre = taşıyıcı bekleme + kamyon yolu + yükleme/boşaltma (startShipment ile aynı).
 */
export function systemFreightEstimate(catalog: Catalog, fromCityId: string, toCityId: string, kg: number): FreightEstimate {
  const truck = catalog.vehicleModel("truck");
  if (fromCityId === toCityId) return { freight: 0n, loads: 0, km: 0, etaMinutes: 0, truckCapacityKg: truck.capacityKg };
  const km = roadDistanceKm(fromCityId, toCityId);
  const f = catalog.settings.freight;
  const chunks = loadChunks(kg, truck.capacityKg);
  const freight = chunks.reduce((a, c) => a + systemCarrierQuote(km, c, f.systemBaseFee, f.systemPerKm, truck.capacityKg), 0n);
  return {
    freight, loads: Math.max(1, chunks.length), km,
    etaMinutes: pickupMinutes(catalog) + paceTrip(catalog, travelMinutes(km, truck.speedKmh) + (f.handlingMinutes ?? 0)),
    truckCapacityKg: truck.capacityKg,
  };
}

export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;
export const floorDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

export interface StockRow { cityId: string; quality: number; availableKg: number; qtyKg: number; costTotal: bigint }

/** Şirketin bir ürünün tüm şehir/kalite stokları (kullanılabilir > 0) */
export async function stockRows(db: DbOrTx, companyId: string, productId: string): Promise<StockRow[]> {
  const rows = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.companyId, companyId), eq(holdings.productId, productId), gt(sql`${holdings.qtyKg} - ${holdings.reservedKg}`, 0)));
  return rows.map((r) => ({ cityId: r.cityId, quality: r.quality, availableKg: r.qtyKg - r.reservedKg, qtyKg: r.qtyKg, costTotal: r.costTotal }));
}

/** En çok kullanılabilir stok olan şehir (eşitlikte şehir kimliği) */
export function topStockCity(rows: StockRow[]): string | null {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.cityId, (by.get(r.cityId) ?? 0) + r.availableKg);
  let best: string | null = null;
  for (const [c, kg] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) if (best === null || kg > by.get(best)!) best = c;
  return best;
}

/** Sistem alım emrinde bugünkü doluluk > %50 mi */
export async function isSaturating(db: DbOrTx, o: { companyId: string; productId: string; isSystem: boolean }, systemKey: string | null | undefined, now: Date): Promise<boolean> {
  if (!o.isSystem) return false;
  const prof = profileByKey(systemKey);
  const nominal = prof?.buys[o.productId] ?? 0;
  if (!prof || nominal <= 0) return false;
  const d = await dailyOf(db, o.companyId, o.productId, now);
  return d.boughtKg * 2 > nominal;
}

type OrderRow = typeof marketOrders.$inferSelect;

export async function offers(
  db: DbOrTx, catalog: Catalog, me: { id: string }, q: z.infer<typeof OffersQuery>, now: Date,
): Promise<OffersDto> {
  catalog.product(q.productId);
  catalog.city(q.cityId);
  if (q.fromCityId) catalog.city(q.fromCityId);
  const side = q.side;
  const orders: OrderRow[] = await db
    .select()
    .from(marketOrders)
    .where(
      and(
        eq(marketOrders.side, side === "buy" ? "sell" : "buy"), eq(marketOrders.status, "open"), eq(marketOrders.productId, q.productId),
        gt(marketOrders.remainingKg, 0), ne(marketOrders.companyId, me.id),
      ),
    );
  const names = await companyBriefs(db, orders.map((o) => o.companyId));
  const rows: OfferRowDto[] = [];
  const base = { side, productId: q.productId, cityId: q.cityId, qtyKg: q.qtyKg };

  if (side === "buy") {
    for (const o of orders) {
      const fill = Math.min(q.qtyKg, o.remainingKg);
      const fr = systemFreightEstimate(catalog, o.cityId, q.cityId, fill);
      const goods = BigInt(fill) * o.pricePerKg;
      const total = goods + fr.freight;
      const notes: OfferNote[] = [];
      if (fill < q.qtyKg) notes.push("PARTIAL");
      if (fr.loads > 1) notes.push("SPLIT_LOADS");
      if (o.cityId === q.cityId) notes.push("SAME_CITY");
      const brief = names.get(o.companyId);
      rows.push({
        orderId: o.id, companyName: brief?.name ?? "?", isSystem: brief?.isSystem ?? o.isSystem, cityId: o.cityId, km: fr.km, quality: o.quality,
        availableKg: o.remainingKg, fillKg: fill, pricePerKg: m(o.pricePerKg), goods: m(goods), freight: m(fr.freight), loads: fr.loads,
        truckCapacityKg: fr.truckCapacityKg, fee: "0", total: m(total), perKg: m(ceilDiv(total, BigInt(fill))), profit: null,
        etaMinutes: fr.etaMinutes, arrivesAt: new Date(now.getTime() + fr.etaMinutes * MIN).toISOString(), notes,
      });
    }
    rows.sort((a, b) => cmpBig(BigInt(a.perKg), BigInt(b.perKg)) || a.etaMinutes - b.etaMinutes || a.orderId.localeCompare(b.orderId));
    const out = rows.slice(0, 100);
    return {
      ...base, fromCityId: null, stockKg: 0, avgCostPerKg: null, rows: out,
      bestOrderId: out[0]?.orderId ?? null, fastestOrderId: fastest(out),
    };
  }

  // ---- satış tarafı
  const stock = await stockRows(db, me.id, q.productId);
  const origin = q.fromCityId ?? topStockCity(stock);
  const atOrigin = stock.filter((s) => s.cityId === origin);
  const pick = q.quality !== undefined
    ? atOrigin.find((s) => s.quality === q.quality)
    : [...atOrigin].sort((a, b) => b.quality - a.quality)[0];
  const from = origin ?? q.cityId; // stok yoksa karşılaştırma seçili şehirden varsayılır
  const bidCap = orders.some((o) => o.isSystem) ? await productBidCap(db, catalog, q.productId) : null;
  const feeBp = catalog.settings.marketFeeBp;
  for (const o of orders) {
    const eligible = !!pick && pick.quality >= o.quality;
    const quality = pick?.quality ?? q.quality ?? o.quality;
    const fill = eligible ? Math.min(q.qtyKg, o.remainingKg, pick.availableKg) : Math.min(q.qtyKg, o.remainingKg);
    const price = effectivePrice(o, quality, o.isSystem ? bidCap : null);
    const fr = systemFreightEstimate(catalog, from, o.cityId, fill);
    const goods = BigInt(fill) * price;
    const fee = applyBp(goods, feeBp);
    const total = goods - fee - fr.freight;
    const notes: OfferNote[] = [];
    if (fill < q.qtyKg) notes.push("PARTIAL");
    if (fr.loads > 1) notes.push("SPLIT_LOADS");
    if (from === o.cityId) notes.push("SAME_CITY");
    if (!eligible) notes.push("NO_STOCK");
    if (price > o.pricePerKg) notes.push("QUALITY_PREMIUM");
    const brief = names.get(o.companyId);
    if (await isSaturating(db, o, brief?.systemKey, now)) notes.push("SATURATING");
    const cogs = eligible ? wacRemovalCost(pick.qtyKg, pick.costTotal, fill) : null;
    rows.push({
      orderId: o.id, companyName: brief?.name ?? "?", isSystem: brief?.isSystem ?? o.isSystem, cityId: o.cityId, km: fr.km, quality,
      availableKg: o.remainingKg, fillKg: fill, pricePerKg: m(price), goods: m(goods), freight: m(fr.freight), loads: fr.loads,
      truckCapacityKg: fr.truckCapacityKg, fee: m(fee), total: m(total), perKg: m(floorDiv(total, BigInt(fill))),
      profit: cogs === null ? null : m(total - cogs), etaMinutes: fr.etaMinutes, arrivesAt: new Date(now.getTime() + fr.etaMinutes * MIN).toISOString(), notes,
    });
  }
  const noStock = (r: OfferRowDto) => (r.notes.includes("NO_STOCK") ? 1 : 0);
  rows.sort((a, b) => noStock(a) - noStock(b) || cmpBig(BigInt(b.perKg), BigInt(a.perKg)) || a.etaMinutes - b.etaMinutes || a.orderId.localeCompare(b.orderId));
  const out = rows.slice(0, 100);
  const pool = out.filter((r) => !r.notes.includes("NO_STOCK"));
  const usable = pool.length ? pool : out;
  return {
    ...base, fromCityId: origin, stockKg: pick?.availableKg ?? 0,
    avgCostPerKg: pick && pick.qtyKg > 0 ? m(pick.costTotal / BigInt(pick.qtyKg)) : null,
    rows: out, bestOrderId: usable[0]?.orderId ?? null, fastestOrderId: fastest(usable),
  };
}

const cmpBig = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** en kısa süre; eşitlikte daha iyi birim değer (satırlar zaten iyi → kötü sıralı) */
function fastest(rows: OfferRowDto[]): string | null {
  let best: OfferRowDto | null = null;
  for (const r of rows) if (!best || r.etaMinutes < best.etaMinutes) best = r;
  return best?.orderId ?? null;
}
