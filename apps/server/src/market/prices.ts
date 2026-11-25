/** Saatlik referans fiyat güncellemesi: nextDriftBp + price_history. Saat dilimi başına bir kez çalışır. */
import { and, eq, gte } from "drizzle-orm";
import { nextDriftBp, qualityNormalized, refPrice } from "@capitalforge/economy";
import { QUALITY_PRICE_BP, SYSTEM_PROFILES } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { companies, priceHistory, priceRefs, systemDaily, trades } from "../db/schema";
import { dayKey, HOUR } from "./common";

export async function updatePriceRefs(deps: Deps, now: Date): Promise<number> {
  const bucket = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const done = await deps.db.select({ id: priceHistory.id }).from(priceHistory).where(eq(priceHistory.at, bucket)).limit(1);
  if (done[0]) return 0;
  const cat = deps.catalog;
  const since = new Date(now.getTime() - 24 * HOUR);
  const tr = await deps.db
    .select({ productId: trades.productId, cityId: trades.cityId, price: trades.pricePerKg, qty: trades.qtyKg, quality: trades.quality })
    .from(trades)
    .where(and(gte(trades.createdAt, since), eq(trades.buyerIsSystem, false), eq(trades.sellerIsSystem, false)));
  const sysRows = await deps.db
    .select({ key: companies.systemKey, productId: systemDaily.productId, bought: systemDaily.boughtKg })
    .from(systemDaily)
    .innerJoin(companies, eq(companies.id, systemDaily.companyId))
    .where(eq(systemDaily.day, dayKey(now)));
  const refs = await deps.db.select().from(priceRefs);
  let n = 0;
  await deps.db.transaction(async (tx) => {
    for (const r of refs) {
      const city = cat.cities.get(r.cityId);
      const prod = cat.products.get(r.productId);
      if (!city || !prod) continue;
      const mine = tr.filter((t) => t.productId === r.productId && t.cityId === r.cityId);
      let vol = 0;
      let num = 0n;
      for (const t of mine) {
        vol += t.qty;
        num += qualityNormalized(t.price, t.quality, QUALITY_PRICE_BP) * BigInt(t.qty);
      }
      const vwap = vol > 0 ? num / BigInt(vol) : null;
      const baseRef = refPrice(prod.basePricePerKg, city.priceBp[prod.id] ?? 10000, 10000);
      const ratioBp = vwap === null ? null : Number((vwap * 10000n) / baseRef);
      // sistem doygunluğu: bugün sistem alıcılarının doldurduğu / nominal günlük alım (bp)
      const profs = SYSTEM_PROFILES.filter((p) => p.cityId === r.cityId && (p.buys[r.productId] ?? 0) > 0);
      const nominal = profs.reduce((a, p) => a + (p.buys[r.productId] ?? 0), 0);
      const bought = sysRows.filter((s) => s.productId === r.productId && profs.some((p) => p.companyKey === s.key)).reduce((a, s) => a + s.bought, 0);
      const sat = nominal > 0 ? Math.min(10000, Math.round((bought * 10000) / nominal)) : 0;
      const drift = nextDriftBp(r.driftBp, ratioBp, sat);
      const ref = refPrice(prod.basePricePerKg, city.priceBp[prod.id] ?? 10000, drift);
      await tx.update(priceRefs).set({ driftBp: drift, refPricePerKg: ref, updatedAt: now }).where(and(eq(priceRefs.productId, r.productId), eq(priceRefs.cityId, r.cityId)));
      await tx.insert(priceHistory).values({ productId: r.productId, cityId: r.cityId, at: bucket, refPricePerKg: ref, vwapPerKg: vwap, volumeKg: vol });
      n++;
    }
  });
  return n;
}
