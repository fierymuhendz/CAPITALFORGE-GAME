/**
 * Sistem fiyat kuralları (sunucu tarafı). Alış üst sınırı her zaman GÜNCEL referanslardan türetilir:
 * cap = systemBidCap(min over cities systemAsk(currentRef, askBp, 0, 1)). Böylece hangi sapmada olursa olsun
 * hiçbir sistem alış fiyatı herhangi bir güncel sistem satış fiyatının %80'ine ulaşamaz.
 */
import { eq } from "drizzle-orm";
import { systemAsk, systemBid, systemBidCap } from "@capitalforge/economy";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx } from "../db/client";
import { priceRefs } from "../db/schema";

export async function loadRefs(db: DbOrTx, productId: string): Promise<Map<string, bigint>> {
  const rows = await db.select().from(priceRefs).where(eq(priceRefs.productId, productId));
  return new Map(rows.map((r) => [r.cityId, r.refPricePerKg]));
}

export function bidCapFromRefs(refs: Map<string, bigint>, askBp: number): bigint | null {
  let min: bigint | null = null;
  for (const ref of refs.values()) {
    const a = systemAsk(ref, askBp, 0, 1);
    if (min === null || a < min) min = a;
  }
  return min === null ? null : systemBidCap(min);
}

export async function productBidCap(db: DbOrTx, catalog: Catalog, productId: string): Promise<bigint | null> {
  return bidCapFromRefs(await loadRefs(db, productId), catalog.settings.system.askBp);
}

/** Kalite 2 tabanlı sistem alış fiyatı (cap uygulanmış) */
export async function currentSystemBid(db: DbOrTx, catalog: Catalog, productId: string, cityId: string, filledTodayKg: number, dailyKg: number): Promise<bigint> {
  const refs = await loadRefs(db, productId);
  const ref = refs.get(cityId) ?? BigInt(catalog.product(productId).basePricePerKg);
  return systemBid(ref, catalog.settings.system.bidBp, filledTodayKg, dailyKg, bidCapFromRefs(refs, catalog.settings.system.askBp));
}
