/**
 * Sistem şirketlerinin günlük sayaçları (system_daily) ve sert üst sınırlar.
 * Her sistem dolumu bu sınırdan geçer; nominal günlük miktar/bütçe asla aşılmaz.
 */
import { and, eq, sql } from "drizzle-orm";
import { SYSTEM_PROFILES, type SystemProfile } from "@capitalforge/shared";
import type { DbOrTx, Tx } from "../db/client";
import { companies, systemDaily } from "../db/schema";
import { fail } from "../errors";
import { dayKey } from "../market/common";

export function profileByKey(key: string | null | undefined): SystemProfile | null {
  return SYSTEM_PROFILES.find((p) => p.companyKey === key) ?? null;
}

export async function dailyOf(db: DbOrTx, companyId: string, productId: string, now: Date) {
  const r = await db
    .select()
    .from(systemDaily)
    .where(and(eq(systemDaily.companyId, companyId), eq(systemDaily.productId, productId), eq(systemDaily.day, dayKey(now))))
    .limit(1);
  return { boughtKg: r[0]?.boughtKg ?? 0, soldKg: r[0]?.soldKg ?? 0, spent: r[0]?.spent ?? 0n };
}

export async function spentToday(db: DbOrTx, companyId: string, now: Date): Promise<bigint> {
  const r = await db
    .select({ s: sql<string>`coalesce(sum(${systemDaily.spent}), 0)::text` })
    .from(systemDaily)
    .where(and(eq(systemDaily.companyId, companyId), eq(systemDaily.day, dayKey(now))));
  return BigInt(r[0]?.s ?? "0");
}

/**
 * Bir sistem dolumunu sayaçlara yazar. Şirket satırı kilitlenir (aynı şirketin dolumları sıralanır).
 * Sınır aşılırsa ORDER_CLOSED. Profil olmayan sistem şirketleri (taşımacı, banka) için sınır yok.
 */
export async function bookSystemFill(
  tx: Tx, companyId: string, productId: string, now: Date,
  side: "bought" | "sold", qtyKg: number, money: bigint,
): Promise<void> {
  const c = (await tx.select({ key: companies.systemKey }).from(companies).where(eq(companies.id, companyId)).for("update"))[0];
  const prof = profileByKey(c?.key);
  if (!prof) return;
  const d = await dailyOf(tx, companyId, productId, now);
  if (side === "bought") {
    const nominal = prof.buys[productId] ?? 0;
    if (d.boughtKg + qtyKg > nominal) fail("ORDER_CLOSED");
    const total = await spentToday(tx, companyId, now);
    if (total + money > BigInt(prof.dailyBudget)) fail("ORDER_CLOSED");
  } else {
    const nominal = prof.sells[productId] ?? 0;
    if (d.soldKg + qtyKg > nominal) fail("ORDER_CLOSED");
  }
  await tx
    .insert(systemDaily)
    .values({
      companyId, productId, day: dayKey(now),
      boughtKg: side === "bought" ? qtyKg : 0, soldKg: side === "sold" ? qtyKg : 0, spent: side === "bought" ? money : 0n,
    })
    .onConflictDoUpdate({
      target: [systemDaily.companyId, systemDaily.productId, systemDaily.day],
      set: {
        boughtKg: sql`${systemDaily.boughtKg} + ${side === "bought" ? qtyKg : 0}`,
        soldKg: sql`${systemDaily.soldKg} + ${side === "sold" ? qtyKg : 0}`,
        spent: sql`${systemDaily.spent} + ${(side === "bought" ? money : 0n).toString()}::bigint`,
      },
    });
}
