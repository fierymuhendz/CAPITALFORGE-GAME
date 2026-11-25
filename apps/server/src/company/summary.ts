import { and, eq, isNull, sql } from "drizzle-orm";
import type { CompanySummaryDto } from "@capitalforge/shared";
import { DEFAULT_SETTINGS } from "@capitalforge/shared";
import { nextLevelXp, reputationBp } from "@capitalforge/economy";
import type { DbOrTx } from "../db/client";
import { companies, ledgerAccounts, notifications } from "../db/schema";

export type CompanyRow = typeof companies.$inferSelect;

export async function balances(db: DbOrTx, companyId: string): Promise<Record<string, bigint>> {
  const rows = await db.select({ code: ledgerAccounts.code, b: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.companyId, companyId));
  const out: Record<string, bigint> = {};
  for (const r of rows) out[r.code] = r.b;
  return out;
}

export async function companySummary(db: DbOrTx, c: CompanyRow, levelXp: readonly number[] = DEFAULT_SETTINGS.levelXp): Promise<CompanySummaryDto> {
  const b = await balances(db, c.id);
  const unread = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.companyId, c.id), isNull(notifications.readAt)));
  return {
    id: c.id,
    name: c.name,
    sector: c.sector,
    homeCityId: c.homeCityId,
    level: c.level,
    xp: c.xp,
    nextLevelXp: nextLevelXp(c.xp, levelXp),
    reputationBp: reputationBp(c.onTimeDeliveries, c.lateOrMissed),
    cash: (b.cash ?? 0n).toString(),
    // arrears pasif hesaptır (alacak bakiyesi negatif); gösterimde pozitif borç
    arrears: (-(b.arrears ?? 0n)).toString(),
    unreadNotifications: unread[0]?.n ?? 0,
  };
}
