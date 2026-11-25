/**
 * Stok yardımcıları. Stok hareketinin defter karşılığını (inventory hesabı) ÇAĞIRAN yazar;
 * bu modül yalnızca holdings + inventory_movements tutarlılığını sağlar.
 * Ağırlıklı ortalama maliyet kuralı packages/economy (wacRemovalCost) içindedir.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { wacRemovalCost } from "@capitalforge/economy";
import type { Tx } from "../db/client";
import { holdings, inventoryMovements } from "../db/schema";
import { fail } from "../errors";

export interface HoldingKey {
  companyId: string;
  cityId: string;
  productId: string;
  quality: number;
}
export interface MovementMeta {
  kind: string;
  refType?: string;
  refId?: string;
  breakdown?: unknown;
  transactionId?: string | null;
  at: Date;
}

const whereKey = (k: HoldingKey) =>
  and(eq(holdings.companyId, k.companyId), eq(holdings.cityId, k.cityId), eq(holdings.productId, k.productId), eq(holdings.quality, k.quality));

/** Satırı kilitler; yoksa sıfır satır oluşturur. */
export async function lockHolding(tx: Tx, k: HoldingKey) {
  await tx.insert(holdings).values({ ...k, qtyKg: 0, reservedKg: 0, costTotal: 0n }).onConflictDoNothing();
  const r = await tx.select().from(holdings).where(whereKey(k)).for("update");
  return r[0]!;
}

export async function addStock(tx: Tx, k: HoldingKey, qtyKg: number, cost: bigint, meta: MovementMeta): Promise<void> {
  if (!Number.isInteger(qtyKg) || qtyKg <= 0) throw new Error("addStock: miktar pozitif tam sayı olmalı");
  if (cost < 0n) throw new Error("addStock: maliyet negatif olamaz");
  const h = await lockHolding(tx, k);
  await tx
    .update(holdings)
    .set({ qtyKg: h.qtyKg + qtyKg, costTotal: h.costTotal + cost, updatedAt: meta.at })
    .where(eq(holdings.id, h.id));
  await tx.insert(inventoryMovements).values({
    ...k, qtyKg, cost, kind: meta.kind, refType: meta.refType ?? null, refId: meta.refId ?? null,
    breakdown: meta.breakdown ?? null, transactionId: meta.transactionId ?? null, createdAt: meta.at,
  });
}

/**
 * Stoktan çıkış, ağırlıklı ortalama maliyetle. fromReserved=true ise rezerve miktardan düşer
 * (ilan satışı, taşıma yüklemesi). Döndürür: çıkan maliyet.
 */
export async function removeStock(tx: Tx, k: HoldingKey, qtyKg: number, meta: MovementMeta, opts?: { fromReserved?: boolean }): Promise<bigint> {
  if (!Number.isInteger(qtyKg) || qtyKg <= 0) throw new Error("removeStock: miktar pozitif tam sayı olmalı");
  const h = await lockHolding(tx, k);
  const available = opts?.fromReserved ? h.reservedKg : h.qtyKg - h.reservedKg;
  if (available < qtyKg) fail("INSUFFICIENT_STOCK", { productId: k.productId, availableKg: available, requiredKg: qtyKg });
  const cost = wacRemovalCost(h.qtyKg, h.costTotal, qtyKg);
  await tx
    .update(holdings)
    .set({
      qtyKg: h.qtyKg - qtyKg,
      reservedKg: opts?.fromReserved ? h.reservedKg - qtyKg : h.reservedKg,
      costTotal: h.costTotal - cost,
      updatedAt: meta.at,
    })
    .where(eq(holdings.id, h.id));
  await tx.insert(inventoryMovements).values({
    ...k, qtyKg: -qtyKg, cost: -cost, kind: meta.kind, refType: meta.refType ?? null, refId: meta.refId ?? null,
    breakdown: meta.breakdown ?? null, transactionId: meta.transactionId ?? null, createdAt: meta.at,
  });
  return cost;
}

export async function reserveStock(tx: Tx, k: HoldingKey, qtyKg: number): Promise<void> {
  const h = await lockHolding(tx, k);
  if (h.qtyKg - h.reservedKg < qtyKg) fail("INSUFFICIENT_STOCK", { productId: k.productId, availableKg: h.qtyKg - h.reservedKg, requiredKg: qtyKg });
  await tx.update(holdings).set({ reservedKg: h.reservedKg + qtyKg }).where(eq(holdings.id, h.id));
}

export async function releaseStock(tx: Tx, k: HoldingKey, qtyKg: number): Promise<void> {
  const h = await lockHolding(tx, k);
  if (h.reservedKg < qtyKg) throw new Error("releaseStock: rezerveden fazla serbest bırakma");
  await tx.update(holdings).set({ reservedKg: h.reservedKg - qtyKg }).where(eq(holdings.id, h.id));
}

/**
 * Bir ürün için kullanılabilir stoktan en yüksek kaliteden başlayarak (veya minQuality üstü)
 * lot seçimi. Döndürür: [{quality, kg}] — çağıran bunları removeStock ile düşer.
 */
export async function pickLots(tx: Tx, companyId: string, cityId: string, productId: string, needKg: number, minQuality = 1, lock = true): Promise<Array<{ quality: number; kg: number }> | null> {
  const q = tx
    .select()
    .from(holdings)
    .where(and(eq(holdings.companyId, companyId), eq(holdings.cityId, cityId), eq(holdings.productId, productId), gt(holdings.qtyKg, 0), sql`${holdings.quality} >= ${minQuality}`))
    .orderBy(sql`${holdings.quality} desc`);
  const rows = lock ? await q.for("update") : await q;
  const out: Array<{ quality: number; kg: number }> = [];
  let left = needKg;
  for (const r of rows) {
    const av = r.qtyKg - r.reservedKg;
    if (av <= 0) continue;
    const take = Math.min(av, left);
    out.push({ quality: r.quality, kg: take });
    left -= take;
    if (left === 0) break;
  }
  return left === 0 ? out : null;
}

export async function availableKg(tx: Tx, companyId: string, cityId: string, productId: string, minQuality = 1): Promise<number> {
  const r = await tx
    .select({ s: sql<string>`coalesce(sum(${holdings.qtyKg} - ${holdings.reservedKg}), 0)` })
    .from(holdings)
    .where(and(eq(holdings.companyId, companyId), eq(holdings.cityId, cityId), eq(holdings.productId, productId), sql`${holdings.quality} >= ${minQuality}`));
  return Number(r[0]?.s ?? 0);
}
