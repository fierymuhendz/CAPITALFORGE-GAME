/** Modül B ortak yardımcıları: gün anahtarı, isim çözümü, referans fiyat, araştırma etkileri. */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { settleArrears } from "../finance/arrears";
import { z } from "zod";
import { uuid } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx, Tx } from "../db/client";
import { companies, inventoryMovements, priceRefs, research } from "../db/schema";
import { AppError, fail } from "../errors";
import type { UnitOfWork } from "../events/bus";

export type CompanyRow = typeof companies.$inferSelect;

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
export const dayStart = (d: Date): Date => new Date(`${dayKey(d)}T00:00:00.000Z`);
export const HOUR = 3_600_000;
export const MIN = 60_000;

export function needCompany(c: CompanyRow | null): CompanyRow {
  if (!c) fail("NO_COMPANY");
  return c;
}

/** Yol parametresi (uuid) doğrulama; geçersizse BAD_REQUEST */
export function uuidParam(v: unknown): string {
  const r = z.object({ id: uuid }).safeParse({ id: v });
  if (!r.success) throw new AppError("BAD_REQUEST", { issue: "id" });
  return r.data.id;
}

export interface CompanyBrief { id: string; name: string; isSystem: boolean; onTime: number; late: number; systemKey: string | null }

export async function companyBriefs(db: DbOrTx, ids: string[]): Promise<Map<string, CompanyBrief>> {
  const out = new Map<string, CompanyBrief>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const rows = await db
    .select({ id: companies.id, name: companies.name, isSystem: companies.isSystem, onTime: companies.onTimeDeliveries, late: companies.lateOrMissed, systemKey: companies.systemKey })
    .from(companies)
    .where(inArray(companies.id, uniq));
  for (const r of rows) out.set(r.id, r);
  return out;
}

export async function refPriceOf(db: DbOrTx, productId: string, cityId: string, catalog: Catalog): Promise<bigint> {
  const r = await db.select().from(priceRefs).where(and(eq(priceRefs.productId, productId), eq(priceRefs.cityId, cityId))).limit(1);
  return r[0]?.refPricePerKg ?? BigInt(catalog.product(productId).basePricePerKg);
}

export interface ResearchBonus { speedBp: number; fuelBp: number }

/** Araştırma etkileri (Modül A `research` tablosunu yazar; burada yalnızca okunur) */
export async function researchBonuses(db: DbOrTx, catalog: Catalog, companyId: string): Promise<ResearchBonus> {
  const rows = await db.select().from(research).where(eq(research.companyId, companyId));
  const out: ResearchBonus = { speedBp: 0, fuelBp: 0 };
  for (const r of rows) {
    const def = catalog.research.get(r.researchId);
    if (!def || r.level <= 0) continue;
    if (def.effect.kind === "speed") out.speedBp += def.effect.bpPerLevel * r.level;
    if (def.effect.kind === "fuel") out.fuelBp += def.effect.bpPerLevel * r.level;
  }
  return out;
}

/**
 * Nakit girişinden sonra gecikmiş borçlar (arrears) nakit yettiği kadar kapatılır.
 */
export async function afterCashIn(tx: Tx, uow: UnitOfWork, companyId: string, now: Date): Promise<void> {
  await settleArrears(tx, uow, companyId, now);
}

/** Stok hareketlerini ilgili defter işlemine bağlar (yönetici ters kaydı bu bağa dayanır) */
export async function linkMovements(tx: Tx, refType: string, refId: string, transactionId: string): Promise<void> {
  await tx
    .update(inventoryMovements)
    .set({ transactionId })
    .where(and(eq(inventoryMovements.refType, refType), eq(inventoryMovements.refId, refId), isNull(inventoryMovements.transactionId)));
}

/** Sayaç kontrollerinden (açık emir sayısı, filo, açık teklif) önce şirket satırını kilitler: eşzamanlı istekler sınırı aşamaz */
export async function lockCompanyRow(tx: Tx, companyId: string): Promise<void> {
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
}
