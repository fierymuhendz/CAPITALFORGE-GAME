import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { accounts, ledgerEntries, transfers } from "../db/schema";
import { type Leg, lockOrder, validateLegs } from "./plan";

export type TransferResult = { status: "applied" | "duplicate"; transferId: string };

/**
 * Para hareketi çekirdeği: çağıranın açtığı transaction (tx) içinde çalışır, kendi transaction'ını açmaz.
 * 1. Bacakları doğrula (toplam sıfır).
 * 2. idempotency_key ile transferi oluştur; zaten varsa hiçbir şey yapmadan döner.
 * 3. Hesap satırlarını sabit (id) sırasıyla kilitle (FOR UPDATE).
 * 4. Yalnızca oyuncu hesaplarının balance alanını güncelle (CHECK negatif bakiyeyi engeller).
 *    Sistem hesaplarının balance alanı güncellenmez; bakiyeleri ledger_entries toplamından türetilir
 *    (tek satırlık sıcak nokta kilidini önler).
 * 5. Defter satırlarını yaz.
 */
export async function applyTransfer(tx: Tx, idempotencyKey: string, reason: string, legs: Leg[]): Promise<TransferResult> {
  validateLegs(legs);
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
  const known = await tx.select({ id: accounts.id, kind: accounts.kind }).from(accounts).where(inArray(accounts.id, ids));
  if (known.length !== ids.length) throw new Error("Bilinmeyen hesap");
  // Yalnızca oyuncu hesapları kilitlenir (id sırasıyla); sistem hesapları kilitlenmez ve güncellenmez.
  const locked = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(inArray(accounts.id, ids), eq(accounts.kind, "player")))
    .orderBy(accounts.id)
    .for("update");
  const playerIds = new Set(locked.map((a) => a.id));

  for (const leg of legs) {
    if (!playerIds.has(leg.accountId)) continue;
    await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} + ${leg.amount}` })
      .where(eq(accounts.id, leg.accountId));
  }
  await tx.insert(ledgerEntries).values(legs.map((l) => ({ transferId, accountId: l.accountId, amount: l.amount })));

  return { status: "applied", transferId };
}

/** Tek başına para hareketi: kendi transaction'ını açıp applyTransfer'i sarar. */
export async function transfer(db: Db, idempotencyKey: string, reason: string, legs: Leg[]): Promise<TransferResult> {
  validateLegs(legs);
  return db.transaction((tx) => applyTransfer(tx, idempotencyKey, reason, legs));
}
