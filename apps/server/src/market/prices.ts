/** Saatlik referans fiyat güncellemesi: nextDriftBp + price_history. Saat dilimi başına bir kez çalışır. */
import { and, eq, sql } from "drizzle-orm";
import { nextDriftBp, qualityNormalized, refPrice } from "@capitalforge/economy";
import { QUALITY_PRICE_BP, SYSTEM_PROFILES } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { sameGroupExpr } from "../fairplay/anomaly";
import { companies, priceHistory, priceRefs, systemDaily } from "../db/schema";
import { dayKey, HOUR } from "./common";

export async function updatePriceRefs(deps: Deps, now: Date): Promise<number> {
  const bucket = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const done = await deps.db.select({ id: priceHistory.id }).from(priceHistory).where(eq(priceHistory.at, bucket)).limit(1);
  if (done[0]) return 0;
  const cat = deps.catalog;
  const since = new Date(now.getTime() - 24 * HOUR);
  // Referansa yalnızca bağımsız işlemler girer: aynı bağlantı grubundaki taraflar, fiyat sapması uyarısı olan
  // ve ters kayıtla düzeltilmiş işlemler dışlanır (yıkama ticareti referansı oynatamasın).
  const trRows = (await deps.db.execute(sql`
    SELECT t.product_id AS "productId", t.city_id AS "cityId", t.price_per_kg::text AS price, t.qty_kg AS qty, t.quality AS quality,
           t.buyer_company_id::text AS buyer, t.seller_company_id::text AS seller
    FROM cf.trades t
    WHERE t.created_at >= ${since.toISOString()}::timestamptz AND t.buyer_is_system = false AND t.seller_is_system = false
      AND NOT ${sameGroupExpr("t.seller_company_id", "t.buyer_company_id")}
      AND NOT EXISTS (SELECT 1 FROM cf.alerts a WHERE a.kind = 'price_anomaly' AND a.details->>'tradeId' = t.id::text)
      AND NOT EXISTS (SELECT 1 FROM cf.ledger_transactions r WHERE r.reverses_id = t.transaction_id)`)) as unknown as Array<{
    productId: string; cityId: string; price: string; qty: number; quality: number; buyer: string; seller: string;
  }>;
  const tr = trRows.map((t) => ({ ...t, price: BigInt(t.price), qty: Number(t.qty) }));
  const sysRows = await deps.db
    .select({ key: companies.systemKey, productId: systemDaily.productId, bought: systemDaily.boughtKg })
    .from(systemDaily)
    .innerJoin(companies, eq(companies.id, systemDaily.companyId))
    .where(eq(systemDaily.day, dayKey(now)));
  const refs = await deps.db.select().from(priceRefs);
  // 200+ ürün × 5 şehir: işlemler, sistem alımları ve profiller bir kez gruplanır; yazımlar toplu yapılır
  const trBy = new Map<string, typeof tr>();
  for (const t of tr) {
    const k = `${t.productId}|${t.cityId}`;
    const a = trBy.get(k);
    if (a) a.push(t); else trBy.set(k, [t]);
  }
  const boughtBy = new Map<string, number>();
  for (const s of sysRows) if (s.key) boughtBy.set(`${s.key}|${s.productId}`, (boughtBy.get(`${s.key}|${s.productId}`) ?? 0) + s.bought);
  const updates: Array<{ productId: string; cityId: string; drift: number; ref: bigint }> = [];
  const history: Array<typeof priceHistory.$inferInsert> = [];
  for (const r of refs) {
    const city = cat.cities.get(r.cityId);
    const prod = cat.products.get(r.productId);
    if (!city || !prod) continue;
    const { vwap, vol } = referenceVwap(trBy.get(`${r.productId}|${r.cityId}`) ?? []);
    const baseRef = refPrice(prod.basePricePerKg, city.priceBp[prod.id] ?? 10000, 10000);
    const ratioBp = vwap === null ? null : Number((vwap * 10000n) / baseRef);
    // sistem doygunluğu: bugün sistem alıcılarının doldurduğu / nominal günlük alım (bp)
    const profs = SYSTEM_PROFILES.filter((p) => p.cityId === r.cityId && (p.buys[r.productId] ?? 0) > 0);
    const nominal = profs.reduce((a, p) => a + (p.buys[r.productId] ?? 0), 0);
    const bought = profs.reduce((a, p) => a + (boughtBy.get(`${p.companyKey}|${r.productId}`) ?? 0), 0);
    const sat = nominal > 0 ? Math.min(10000, Math.round((bought * 10000) / nominal)) : 0;
    const drift = nextDriftBp(r.driftBp, ratioBp, sat);
    const ref = refPrice(prod.basePricePerKg, city.priceBp[prod.id] ?? 10000, drift);
    updates.push({ productId: r.productId, cityId: r.cityId, drift, ref });
    history.push({ productId: r.productId, cityId: r.cityId, at: bucket, refPricePerKg: ref, vwapPerKg: vwap, volumeKg: vol });
  }
  const CHUNK = 500;
  await deps.db.transaction(async (tx) => {
    for (let i = 0; i < updates.length; i += CHUNK) {
      const rows = updates.slice(i, i + CHUNK).map((u) => sql`(${u.productId}::text, ${u.cityId}::text, ${u.drift}::int, ${u.ref.toString()}::bigint)`);
      await tx.execute(sql`
        UPDATE cf.price_refs AS p SET drift_bp = v.drift, ref_price_per_kg = v.ref, updated_at = ${now.toISOString()}::timestamptz
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(pid, cid, drift, ref)
        WHERE p.product_id = v.pid AND p.city_id = v.cid`);
    }
    for (let i = 0; i < history.length; i += CHUNK) await tx.insert(priceHistory).values(history.slice(i, i + CHUNK));
  });
  const n = updates.length;
  return n;
}

/** Fiyatın etkili olması için pencere içinde en az bu kadar farklı alıcı-satıcı çifti gerekir */
export const MIN_DISTINCT_PAIRS = 3;
/** kırpma: hacmin alt ve üst %10'u atılır */
export const TRIM_PCT = 10;

/**
 * Kırpılmış VWAP (kalite 2'ye normalize): fiyata göre sıralı hacmin alt ve üst %10'u dışlanır.
 * Farklı alıcı-satıcı çifti sayısı yetersizse null (kayma korunur, doygunluk terimi yine uygulanır).
 */
export function referenceVwap(rows: Array<{ price: bigint; qty: number; quality: number; buyer: string; seller: string }>): { vwap: bigint | null; vol: number } {
  const total = rows.reduce((a, t) => a + t.qty, 0);
  const pairs = new Set(rows.map((t) => `${t.buyer}>${t.seller}`));
  if (pairs.size < MIN_DISTINCT_PAIRS || total <= 0) return { vwap: null, vol: total };
  const sorted = rows
    .map((t) => ({ p: qualityNormalized(t.price, t.quality, QUALITY_PRICE_BP), q: t.qty }))
    .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  const trim = Math.floor((total * TRIM_PCT) / 100);
  const lo = trim;
  const hi = total - trim;
  let pos = 0;
  let vol = 0;
  let num = 0n;
  for (const r of sorted) {
    const from = Math.max(pos, lo);
    const to = Math.min(pos + r.q, hi);
    if (to > from) {
      vol += to - from;
      num += r.p * BigInt(to - from);
    }
    pos += r.q;
  }
  return vol > 0 ? { vwap: num / BigInt(vol), vol } : { vwap: null, vol: total };
}
