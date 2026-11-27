/** Piyasa görünümleri: defter, genel bakış, fiyat geçmişi. Başka şirketin nakdi/stoğu yanıtlara girmez. */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { MarketDto, MarketOverviewDto, PriceHistoryDto } from "@capitalforge/shared";
import { maxBig, minBig } from "@capitalforge/economy";
import type { Catalog } from "../catalog/catalog";
import type { Db } from "../db/client";
import { marketOrders, priceHistory, priceRefs, trades } from "../db/schema";
import { m } from "../lib/serialize";
import { companyBriefs, HOUR, refPriceOf } from "./common";
import { orderDto } from "./spot";

export async function marketView(db: Db, catalog: Catalog, cityId: string, productId: string, myId: string | null): Promise<MarketDto> {
  catalog.city(cityId);
  catalog.product(productId);
  const open = await db
    .select()
    .from(marketOrders)
    .where(and(eq(marketOrders.cityId, cityId), eq(marketOrders.productId, productId), eq(marketOrders.status, "open")))
    .orderBy(marketOrders.pricePerKg, marketOrders.createdAt);
  const names = await companyBriefs(db, open.map((o) => o.companyId));
  const nm = (id: string) => names.get(id)?.name ?? "?";
  const listings = open.filter((o) => o.side === "sell").map((o) => orderDto(o, nm(o.companyId), myId));
  const orders = open.filter((o) => o.side === "buy").reverse().map((o) => orderDto(o, nm(o.companyId), myId));
  const recent = await db
    .select()
    .from(trades)
    .where(and(eq(trades.cityId, cityId), eq(trades.productId, productId)))
    .orderBy(desc(trades.createdAt))
    .limit(30);
  return {
    cityId, productId, refPricePerKg: m(await refPriceOf(db, productId, cityId, catalog)), listings, orders,
    recentTrades: recent.map((t) => ({ at: t.createdAt.toISOString(), qtyKg: t.qtyKg, pricePerKg: m(t.pricePerKg), quality: t.quality, system: t.buyerIsSystem || t.sellerIsSystem })),
  };
}

export async function marketOverview(db: Db, catalog: Catalog, now: Date): Promise<MarketOverviewDto> {
  const book = await db
    .select({
      productId: marketOrders.productId, cityId: marketOrders.cityId, side: marketOrders.side, isSystem: marketOrders.isSystem,
      kg: sql<string>`sum(${marketOrders.remainingKg})::text`,
      minP: sql<string>`min(${marketOrders.pricePerKg})::text`, maxP: sql<string>`max(${marketOrders.pricePerKg})::text`,
    })
    .from(marketOrders)
    .where(eq(marketOrders.status, "open"))
    .groupBy(marketOrders.productId, marketOrders.cityId, marketOrders.side, marketOrders.isSystem);
  const vol = await db
    .select({ productId: trades.productId, cityId: trades.cityId, kg: sql<string>`sum(${trades.qtyKg})::text` })
    .from(trades)
    .where(gte(trades.createdAt, new Date(now.getTime() - 24 * HOUR)))
    .groupBy(trades.productId, trades.cityId);
  const rows: MarketOverviewDto["rows"] = [];
  const refs = new Map<string, bigint>();
  for (const r of await db.select().from(priceRefs)) refs.set(`${r.productId}|${r.cityId}`, r.refPricePerKg);
  for (const p of catalog.products.values()) {
    for (const c of catalog.cities.values()) {
      const mine = book.filter((b) => b.productId === p.id && b.cityId === c.id);
      const sells = mine.filter((b) => b.side === "sell");
      const buys = mine.filter((b) => b.side === "buy");
      const asks = sells.map((b) => BigInt(b.minP));
      const bids = buys.map((b) => BigInt(b.maxP));
      rows.push({
        productId: p.id, cityId: c.id,
        refPricePerKg: m(refs.get(`${p.id}|${c.id}`) ?? BigInt(p.basePricePerKg)),
        bestAsk: asks.length ? m(minBig(...asks)) : null,
        askKg: sells.reduce((a, b) => a + Number(b.kg), 0),
        bestBid: bids.length ? m(maxBig(...bids)) : null,
        bidKg: buys.reduce((a, b) => a + Number(b.kg), 0),
        systemBidRemainingKg: buys.filter((b) => b.isSystem).reduce((a, b) => a + Number(b.kg), 0),
        volume24hKg: Number(vol.find((v) => v.productId === p.id && v.cityId === c.id)?.kg ?? 0),
      });
    }
  }
  return { rows };
}

export async function priceHistoryView(db: Db, cityId: string, productId: string, hours: number, now: Date): Promise<PriceHistoryDto> {
  const rows = await db
    .select()
    .from(priceHistory)
    .where(and(eq(priceHistory.cityId, cityId), eq(priceHistory.productId, productId), gte(priceHistory.at, new Date(now.getTime() - hours * HOUR))))
    .orderBy(priceHistory.at);
  return {
    cityId, productId,
    points: rows.map((r) => ({ at: r.at.toISOString(), refPricePerKg: m(r.refPricePerKg), vwapPerKg: r.vwapPerKg === null ? null : m(r.vwapPerKg), volumeKg: r.volumeKg })),
  };
}
