/**
 * Yönetici genel bakışı: ürün × şehir metrikleri. Yalnızca okur.
 * Stok ve açık ilan/emir yalnızca oyuncu şirketlerini sayar (sistem payı ayrı gösterilir).
 */
import { sql, type SQL } from "drizzle-orm";
import { growthBp } from "@capitalforge/economy";
import type { AdminProductDetailDto, AdminProductMetricsDto } from "@capitalforge/shared";
import type { Db } from "../db/client";
import { m } from "../lib/serialize";
import type { Row } from "./common";

const HOUR = 3600_000;
const ts = (d: Date): SQL => sql`${d.toISOString()}::timestamptz`;

export interface MetricsFilter { productId?: string; cityId?: string; byCity: boolean }

const keyOf = (r: Row): string => `${r.product_id}|${r.city_id ?? ""}`;

function parts(a: string, f: MetricsFilter, cityCol = "city_id") {
  const where: SQL[] = [];
  if (f.productId) where.push(sql`AND ${sql.raw(a)}.product_id = ${f.productId}`);
  if (f.cityId) where.push(sql`AND ${sql.raw(a)}.${sql.raw(cityCol)} = ${f.cityId}`);
  return {
    sel: sql.raw(f.byCity ? `${a}.product_id AS product_id, ${a}.${cityCol} AS city_id` : `${a}.product_id AS product_id, NULL::text AS city_id`),
    grp: sql.raw(f.byCity ? `${a}.product_id, ${a}.${cityCol}` : `${a}.product_id`),
    where: sql.join(where, sql` `),
  };
}

export async function productMetrics(db: Db, now: Date, f: MetricsFilter): Promise<AdminProductMetricsDto["rows"]> {
  const run = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
  const t24 = new Date(now.getTime() - 24 * HOUR);
  const t7d = new Date(now.getTime() - 7 * 24 * HOUR);

  const h = parts("h", f);
  const stock = await run(sql`
    SELECT ${h.sel}, sum(h.qty_kg)::text AS kg
    FROM cf.holdings h JOIN cf.companies c ON c.id = h.company_id
    WHERE c.is_system = false ${h.where} GROUP BY ${h.grp}`);

  const o = parts("o", f);
  const orders = await run(sql`
    SELECT ${o.sel},
      coalesce(sum(o.remaining_kg) FILTER (WHERE o.side = 'sell'), 0)::text AS sell_kg,
      coalesce(sum(o.remaining_kg) FILTER (WHERE o.side = 'buy'), 0)::text AS buy_kg
    FROM cf.market_orders o
    WHERE o.status = 'open' AND o.is_system = false ${o.where} GROUP BY ${o.grp}`);

  const w = parts("w", f);
  const wait = await run(sql`
    SELECT ${w.sel}, (avg(extract(epoch FROM (w.first_fill_at - w.created_at))) / 3600)::text AS hours
    FROM cf.market_orders w
    WHERE w.side = 'sell' AND w.is_system = false AND w.first_fill_at IS NOT NULL AND w.created_at >= ${ts(t7d)} ${w.where}
    GROUP BY ${w.grp}`);

  const t = parts("t", f);
  const trades = await run(sql`
    SELECT ${t.sel},
      coalesce(sum(t.qty_kg) FILTER (WHERE t.created_at >= ${ts(t24)}), 0)::text AS vol24,
      coalesce(sum(t.gross) FILTER (WHERE t.created_at >= ${ts(t24)}), 0)::text AS gross24,
      coalesce(sum(t.qty_kg), 0)::text AS vol7d,
      coalesce(sum(t.qty_kg) FILTER (WHERE t.buyer_is_system OR t.seller_is_system), 0)::text AS sys7d
    FROM cf.trades t
    WHERE t.created_at >= ${ts(t7d)} ${t.where} GROUP BY ${t.grp}`);

  const r = parts("r", f);
  const refs = await run(sql`
    SELECT ${r.sel}, (sum(r.ref_price_per_kg) / count(*))::bigint::text AS ref
    FROM cf.price_refs r WHERE true ${r.where} GROUP BY ${r.grp}`);

  const p = parts("p", f);
  const old = await run(sql`
    SELECT ${p.sel}, (sum(p.ref_price_per_kg) / count(*))::bigint::text AS ref
    FROM (
      SELECT DISTINCT ON (product_id, city_id) product_id, city_id, ref_price_per_kg
      FROM cf.price_history
      WHERE at >= ${ts(new Date(now.getTime() - 30 * HOUR))} AND at <= ${ts(new Date(now.getTime() - 18 * HOUR))}
      ORDER BY product_id, city_id, abs(extract(epoch FROM (at - ${ts(t24)})))
    ) p WHERE true ${p.where} GROUP BY ${p.grp}`);

  const by = (rows: Row[]) => new Map(rows.map((x) => [keyOf(x), x]));
  const mStock = by(stock), mOrders = by(orders), mWait = by(wait), mTrades = by(trades), mOld = by(old);

  return refs
    .map((ref) => {
      const k = keyOf(ref);
      const tr = mTrades.get(k);
      const vol24 = BigInt(tr?.vol24 ?? "0");
      const vol7d = Number(tr?.vol7d ?? 0);
      const cur = BigInt(ref.ref ?? "0");
      const oldRef = mOld.get(k)?.ref;
      const hours = mWait.get(k)?.hours;
      return {
        productId: ref.product_id!,
        cityId: ref.city_id ?? null,
        inventoryKg: Number(mStock.get(k)?.kg ?? 0),
        openListingsKg: Number(mOrders.get(k)?.sell_kg ?? 0),
        openOrdersKg: Number(mOrders.get(k)?.buy_kg ?? 0),
        avgHoursToBuyer: hours === undefined || hours === null ? null : Math.round(Number(hours) * 100) / 100,
        refPricePerKg: m(cur),
        vwap24h: vol24 > 0n ? m(BigInt(tr!.gross24 ?? "0") / vol24) : null,
        volume24hKg: Number(vol24),
        volume7dKg: vol7d,
        systemShareBp: vol7d > 0 ? Math.round((Number(tr?.sys7d ?? 0) * 10000) / vol7d) : 0,
        priceChange24hBp: oldRef ? growthBp(BigInt(oldRef), cur) : null,
      };
    })
    .sort((a, b) => (a.productId === b.productId ? (a.cityId ?? "").localeCompare(b.cityId ?? "") : a.productId.localeCompare(b.productId)));
}

export async function productDetail(db: Db, now: Date, productId: string, cityId: string | null): Promise<AdminProductDetailDto> {
  const run = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
  const metrics = await productMetrics(db, now, { productId, cityId: cityId ?? undefined, byCity: true });
  const cityFilter = cityId ? sql`AND h.city_id = ${cityId}` : sql``;
  const holders = await run(sql`
    SELECT h.company_id, c.name, c.is_system::text AS is_system, h.city_id, h.quality::text AS quality, h.qty_kg::text AS qty,
           h.reserved_kg::text AS reserved, (h.cost_total / h.qty_kg)::text AS avg_cost
    FROM cf.holdings h JOIN cf.companies c ON c.id = h.company_id
    WHERE h.product_id = ${productId} AND h.qty_kg > 0 ${cityFilter}
    ORDER BY h.qty_kg DESC LIMIT 100`);
  const tradeCity = cityId ? sql`AND t.city_id = ${cityId}` : sql``;
  const trades = await run(sql`
    SELECT t.id, (extract(epoch FROM t.created_at) * 1000)::bigint::text AS at_ms, t.city_id, t.quality::text AS quality, t.qty_kg::text AS qty, t.price_per_kg::text AS price,
           b.name AS buyer, s.name AS seller, t.buyer_is_system::text AS bsys, t.seller_is_system::text AS ssys
    FROM cf.trades t JOIN cf.companies b ON b.id = t.buyer_company_id JOIN cf.companies s ON s.id = t.seller_company_id
    WHERE t.product_id = ${productId} ${tradeCity}
    ORDER BY t.created_at DESC LIMIT 50`);
  const trueStr = (v: string | null | undefined) => v === "true";
  return {
    productId, cityId, metrics,
    holders: holders.map((x) => ({
      companyId: x.company_id!, companyName: x.name!, isSystem: trueStr(x.is_system), cityId: x.city_id!, quality: Number(x.quality),
      qtyKg: Number(x.qty), reservedKg: Number(x.reserved), avgCostPerKg: x.avg_cost ?? "0",
    })),
    recentTrades: trades.map((x) => ({
      id: x.id!, at: new Date(Number(x.at_ms)).toISOString(), cityId: x.city_id!, quality: Number(x.quality), qtyKg: Number(x.qty), pricePerKg: x.price!,
      buyerName: x.buyer!, sellerName: x.seller!, buyerIsSystem: trueStr(x.bsys), sellerIsSystem: trueStr(x.ssys),
    })),
  };
}
