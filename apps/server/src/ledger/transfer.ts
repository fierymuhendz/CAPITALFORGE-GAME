import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, ledgerEntries, transfers } from "../db/schema";
import { type Leg, lockOrder, validateLegs } from "./plan";

export type TransferResult = { status: "applied" | "duplicate"; transferId: string };

/**
 * Tek veritabanı işleminde para hareketi:
 * 1. Bacakları doğrula (toplam sıfır).
 * 2. idempotency_key ile transferi oluştur; zaten varsa hiçbir şey yapmadan döner.
 * 3. Hesap satırlarını sabit sırayla kilitle (FOR UPDATE).
 * 4. Bakiyeleri güncelle; oyuncu bakiyesi negatife düşerse CHECK kısıtı işlemi geri alır.
 * 5. Defter satırlarını yaz.
 */
export async function transfer(db: Db, idempotencyKey: string, reason: string, legs: Leg[]): Promise<TransferResult> {
  validateLegs(legs);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(transfers)
      .values({ idempotencyKey, reason })
      .onConflictDoNothing({ target: transfers.idempotencyKey })
      .returning({ id: transfers.id });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select({ id: transfers.id })
        .from(transfers)
        .where(eq(transfers.idempotencyKey, idempotencyKey));
      return { status: "duplicate", transferId: existing!.id };
    }
    const transferId = inserted[0]!.id;

    const ids = lockOrder(legs);
    await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, ids)).orderBy(accounts.id).for("update");

    for (const leg of legs) {
      await tx
        .update(accounts)
        .set({ balance: sql`${accounts.balance} + ${leg.amount}` })
        .where(eq(accounts.id, leg.accountId));
    }
    await tx.insert(ledgerEntries).values(legs.map((l) => ({ transferId, accountId: l.accountId, amount: l.amount })));

    return { status: "applied", transferId };
  });
}
