/**
 * Depodan lot seçimi (kalite bazlı satırlar). Kilitli kullanımda holdings satırları FOR UPDATE alınır.
 * Maliyet tahmini removeStock ile aynı kuraldır (packages/economy wacRemovalCost).
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { wacRemovalCost } from "@capitalforge/economy";
import type { DbOrTx } from "../db/client";
import { holdings } from "../db/schema";

export interface LotPick {
  quality: number;
  kg: number;
  estCost: bigint;
}
export interface LotSelection {
  lots: LotPick[];
  availableKg: number;
  missingKg: number;
  estCost: bigint;
}

/** order "desc": en yüksek kaliteden başla (üretim girdileri); "asc": en düşükten (inşaat çeliği). */
export async function selectLots(
  db: DbOrTx, companyId: string, cityId: string, productId: string, needKg: number, lock: boolean, order: "asc" | "desc" = "desc",
): Promise<LotSelection> {
  const q = db
    .select()
    .from(holdings)
    .where(and(eq(holdings.companyId, companyId), eq(holdings.cityId, cityId), eq(holdings.productId, productId), gt(sql`${holdings.qtyKg} - ${holdings.reservedKg}`, 0)))
    .orderBy(order === "desc" ? sql`${holdings.quality} desc` : sql`${holdings.quality} asc`);
  const rows = lock ? await q.for("update") : await q;
  const lots: LotPick[] = [];
  let left = needKg;
  let available = 0;
  let est = 0n;
  for (const r of rows) {
    const av = r.qtyKg - r.reservedKg;
    available += av;
    if (left <= 0) continue;
    const take = Math.min(av, left);
    const cost = wacRemovalCost(r.qtyKg, r.costTotal, take);
    lots.push({ quality: r.quality, kg: take, estCost: cost });
    est += cost;
    left -= take;
  }
  return { lots, availableKg: available, missingKg: Math.max(0, left), estCost: est };
}
