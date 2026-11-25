/**
 * Şirket defter hesaplarını (kod listesiyle) id sırasıyla kilitleyip bakiyelerini okur.
 * Kısmi ödeme kararları (bakım, taksit, borç kapama) bu kilit altında verilir; sıra post() ile aynıdır.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../db/client";
import { ledgerAccounts } from "../db/schema";

export async function lockAccounts(tx: Tx, companyId: string, codes: string[]): Promise<Record<string, bigint>> {
  const rows = await tx
    .select({ code: ledgerAccounts.code, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), inArray(ledgerAccounts.code, codes)))
    .orderBy(ledgerAccounts.id)
    .for("update");
  const out: Record<string, bigint> = {};
  for (const c of codes) out[c] = 0n;
  for (const r of rows) out[r.code] = r.balance;
  return out;
}
