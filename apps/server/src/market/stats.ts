/**
 * Pazar istatistikleri (GET /market/stats) ve şehir karşılaştırması (GET /market/compare). Salt okunur, sunucu hesaplı.
 * Fiyata ve hacme yalnızca bağımsız işlemler girer (prices.ts ile aynı dışlamalar): ters kayıtla düzeltilmiş, aynı
 * bağlantı grubundaki ve fiyat anomalisi uyarılı işlemler dışlanır. Sistem işlemleri ayrı sayılır, fiyat/vwap'a girmez.
 */
import { and, eq, gt, ne, notInArray, sql } from "drizzle-orm";
import { applyBp } from "@capitalforge/economy";
import {
  type BookQuoteDto, type CompareCityDto, type LastTradeDto, type MarketCompareDto, type MarketCompareQuery, type MarketStatsDto,
  type MarketStatsQuery, type PriceBasis, type QualityVwapDto,
} from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx } from "../db/client";
import { marketOrders } from "../db/schema";
import { sameGroupExpr } from "../fairplay/anomaly";
import { productBidCap } from "../system/pricing";
import { m } from "../lib/serialize";
import { HOUR, refPriceOf } from "./common";
import { floorDiv, stockRows, systemFreightEstimate, topStockCity } from "./offers";
import { MIN_DISTINCT_PAIRS, referenceVwap } from "./prices";
import { effectivePrice } from "./spot";

type OrderRow = typeof marketOrders.$inferSelect;

interface TradeRow {
  cityId: string; price: bigint; qty: number; quality: number; buyer: string; seller: string; system: boolean; at: Date;
}

const MAX_TRADE_ROWS = 5_000;

/** Dönemdeki geçerli işlemler (en yeni önce). cityId null: tüm şehirler. */
async function loadTrades(db: DbOrTx, productId: string, cityId: string | null, since: Date): Promise<TradeRow[]> {
  const rows = (await db.execute(sql`
    SELECT t.city_id AS "cityId", t.price_per_kg::text AS price, t.qty_kg::text AS qty, t.quality AS quality,
           t.buyer_company_id::text AS buyer, t.seller_company_id::text AS seller,
           (t.buyer_is_system OR t.seller_is_system) AS system, t.created_at AS "at"
    FROM cf.trades t
    WHERE t.product_id = ${productId} AND t.created_at >= ${since.toISOString()}::timestamptz
      ${cityId === null ? sql`` : sql`AND t.city_id = ${cityId}`}
      AND NOT EXISTS (SELECT 1 FROM cf.ledger_transactions r WHERE r.reverses_id = t.transaction_id)
      AND ((t.buyer_is_system OR t.seller_is_system) OR (
        NOT ${sameGroupExpr("t.seller_company_id", "t.buyer_company_id")}
        AND NOT EXISTS (SELECT 1 FROM cf.alerts a WHERE a.kind = 'price_anomaly' AND a.details->>'tradeId' = t.id::text)))
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${MAX_TRADE_ROWS}`)) as unknown as Array<{
    cityId: string; price: string; qty: string; quality: number; buyer: string; seller: string; system: boolean; at: Date | string;
  }>;
  return rows.map((r) => ({
    cityId: r.cityId, price: BigInt(r.price), qty: Number(r.qty), quality: r.quality, buyer: r.buyer, seller: r.seller, system: r.system, at: new Date(r.at),
  }));
}

interface TradeAgg {
  playerVolumeKg: number; systemVolumeKg: number; tradeCount: number; p2pShareBp: number;
  lastPlayer: LastTradeDto | null; lastSystem: LastTradeDto | null;
  vwapByQuality: QualityVwapDto[]; vwapQ2: bigint | null; distinctPairs: number; lowData: boolean;
}

const toLast = (t: TradeRow): LastTradeDto => ({ pricePerKg: m(t.price), quality: t.quality, qtyKg: t.qty, at: t.at.toISOString() });

/** rows: en yeni önce */
function aggregate(rows: TradeRow[]): TradeAgg {
  const player = rows.filter((t) => !t.system);
  const system = rows.filter((t) => t.system);
  const playerVolumeKg = player.reduce((a, t) => a + t.qty, 0);
  const systemVolumeKg = system.reduce((a, t) => a + t.qty, 0);
  const total = playerVolumeKg + systemVolumeKg;
  const byQ = new Map<number, { num: bigint; kg: number; n: number }>();
  for (const t of player) {
    const e = byQ.get(t.quality) ?? { num: 0n, kg: 0, n: 0 };
    e.num += t.price * BigInt(t.qty); e.kg += t.qty; e.n++;
    byQ.set(t.quality, e);
  }
  const vwapByQuality = [...byQ.entries()].sort((a, b) => a[0] - b[0]).map(([quality, e]) => ({
    quality, vwapPerKg: m(e.kg > 0 ? e.num / BigInt(e.kg) : 0n), volumeKg: e.kg, tradeCount: e.n,
  }));
  const distinctPairs = new Set(player.map((t) => `${t.buyer}>${t.seller}`)).size;
  const ref = referenceVwap(player.map((t) => ({ price: t.price, qty: t.qty, quality: t.quality, buyer: t.buyer, seller: t.seller })));
  return {
    playerVolumeKg, systemVolumeKg, tradeCount: rows.length,
    p2pShareBp: total > 0 ? Math.floor((playerVolumeKg * 10000) / total) : 0,
    lastPlayer: player[0] ? toLast(player[0]) : null, lastSystem: system[0] ? toLast(system[0]) : null,
    vwapByQuality, vwapQ2: ref.vwap, distinctPairs, lowData: distinctPairs < MIN_DISTINCT_PAIRS,
  };
}

const quote = (o: OrderRow, price: bigint): BookQuoteDto => ({
  orderId: o.id, source: o.isSystem ? "system" : "player", pricePerKg: m(price), quality: o.quality, remainingKg: o.remainingKg,
});

interface Priced { o: OrderRow; price: bigint }
const bestOf = (xs: Priced[], side: "buy" | "sell"): Priced | null => {
  let best: Priced | null = null;
  for (const x of xs) {
    if (!best) { best = x; continue; }
    const better = side === "buy" ? x.price > best.price : x.price < best.price;
    const tie = x.price === best.price && x.o.createdAt.getTime() < best.o.createdAt.getTime();
    if (better || tie) best = x;
  }
  return best;
};

/** Kendi bağlantı grubumdaki (ortak IP karması) diğer şirketler: en iyi teklifte "bağımsız alıcı" gibi görünmesinler */
async function groupMates(db: DbOrTx, myId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT gcb.id::text AS id
    FROM cf.companies gcs
    JOIN cf.connection_records grs ON grs.account_id = gcs.account_id
    JOIN cf.connection_records grb ON grb.ip_hash = grs.ip_hash AND grb.account_id <> grs.account_id
    JOIN cf.companies gcb ON gcb.account_id = grb.account_id
    WHERE gcs.id = ${myId}::uuid`)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function openOrders(db: DbOrTx, productId: string, cityId: string | null, myId: string | null): Promise<OrderRow[]> {
  const mates = myId ? await groupMates(db, myId) : [];
  return db
    .select()
    .from(marketOrders)
    .where(and(
      eq(marketOrders.productId, productId), eq(marketOrders.status, "open"), gt(marketOrders.remainingKg, 0),
      ...(cityId ? [eq(marketOrders.cityId, cityId)] : []), ...(myId ? [ne(marketOrders.companyId, myId)] : []), ...(mates.length ? [notInArray(marketOrders.companyId, mates)] : []),
    ));
}

export async function marketStats(
  db: DbOrTx, catalog: Catalog, q: z.infer<typeof MarketStatsQuery>, myId: string | null, now: Date,
): Promise<MarketStatsDto> {
  catalog.product(q.productId);
  catalog.city(q.cityId);
  const orders = await openOrders(db, q.productId, q.cityId, myId);
  const cap = orders.some((o) => o.isSystem && o.side === "buy") ? await productBidCap(db, catalog, q.productId) : null;
  const priced = (side: "buy" | "sell", system?: boolean): Priced[] =>
    orders
      .filter((o) => o.side === side && (system === undefined || o.isSystem === system))
      .map((o) => ({ o, price: effectivePrice(o, o.quality, o.isSystem ? cap : null) }));
  const pick = (side: "buy" | "sell", system?: boolean): BookQuoteDto | null => {
    const b = bestOf(priced(side, system), side);
    return b ? quote(b.o, b.price) : null;
  };
  const agg = aggregate(await loadTrades(db, q.productId, q.cityId, new Date(now.getTime() - q.hours * HOUR)));
  const refPrice = await refPriceOf(db, q.productId, q.cityId, catalog);
  const priceBasis: PriceBasis = agg.vwapQ2 !== null ? "vwap" : "reference";
  return {
    productId: q.productId, cityId: q.cityId, hours: q.hours,
    bestBid: pick("buy"), bestAsk: pick("sell"),
    bestPlayerBid: pick("buy", false), bestPlayerAsk: pick("sell", false), bestSystemBid: pick("buy", true), bestSystemAsk: pick("sell", true),
    lastPlayerTrade: agg.lastPlayer, lastSystemTrade: agg.lastSystem,
    playerVolumeKg: agg.playerVolumeKg, systemVolumeKg: agg.systemVolumeKg, tradeCount: agg.tradeCount, p2pShareBp: agg.p2pShareBp,
    vwapByQuality: agg.vwapByQuality, vwapQ2PerKg: agg.vwapQ2 === null ? null : m(agg.vwapQ2),
    refPricePerKg: m(refPrice), distinctPairs: agg.distinctPairs, minDistinctPairs: MIN_DISTINCT_PAIRS, lowData: agg.lowData, priceBasis,
  };
}

export async function marketCompare(
  db: DbOrTx, catalog: Catalog, q: z.infer<typeof MarketCompareQuery>, me: { id: string } | null, now: Date,
): Promise<MarketCompareDto> {
  catalog.product(q.productId);
  if (q.fromCityId) catalog.city(q.fromCityId);
  const quality = q.quality ?? 2;
  const origin = q.fromCityId ?? (me ? topStockCity(await stockRows(db, me.id, q.productId)) : null);
  const orders = (await openOrders(db, q.productId, null, me?.id ?? null)).filter((o) => o.side === "buy" && o.quality <= quality);
  const cap = orders.some((o) => o.isSystem) ? await productBidCap(db, catalog, q.productId) : null;
  const feeBp = catalog.settings.marketFeeBp;
  const trades = await loadTrades(db, q.productId, null, new Date(now.getTime() - 24 * HOUR));
  const rows: CompareCityDto[] = [];
  for (const city of [...catalog.cities.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const best = bestOf(orders.filter((o) => o.cityId === city.id).map((o) => ({ o, price: effectivePrice(o, quality, o.isSystem ? cap : null) })), "buy");
    const agg = aggregate(trades.filter((t) => t.cityId === city.id));
    const ref = await refPriceOf(db, q.productId, city.id, catalog);
    const row: CompareCityDto = {
      cityId: city.id, bestBid: best ? quote(best.o, best.price) : null, fillKg: 0, gross: null, fee: null, freight: null, km: null, etaMinutes: null,
      loads: null, net: null, netPerKg: null, vwapQ2PerKg: agg.vwapQ2 === null ? null : m(agg.vwapQ2), refPricePerKg: m(ref), lowData: agg.lowData,
      priceBasis: agg.vwapQ2 !== null ? "vwap" : "reference", p2pShareBp: agg.p2pShareBp,
    };
    if (best) {
      const fill = Math.min(q.qtyKg, best.o.remainingKg);
      const gross = BigInt(fill) * best.price;
      const fee = applyBp(gross, feeBp);
      row.fillKg = fill; row.gross = m(gross); row.fee = m(fee);
      if (origin) {
        const fr = systemFreightEstimate(catalog, origin, city.id, fill);
        const net = gross - fee - fr.freight;
        row.freight = m(fr.freight); row.km = fr.km; row.etaMinutes = fr.etaMinutes; row.loads = fr.loads;
        row.net = m(net); row.netPerKg = m(floorDiv(net, BigInt(fill)));
      }
    }
    rows.push(row);
  }
  let bestCityId: string | null = null;
  let bestNet: bigint | null = null;
  for (const r of rows) {
    if (r.netPerKg === null) continue;
    const v = BigInt(r.netPerKg);
    if (bestNet === null || v > bestNet) { bestNet = v; bestCityId = r.cityId; }
  }
  return { productId: q.productId, qtyKg: q.qtyKg, quality, fromCityId: origin, marketFeeBp: feeBp, rows, bestCityId };
}
