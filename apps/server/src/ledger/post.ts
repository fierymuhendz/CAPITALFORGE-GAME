/**
 * Çift taraflı defter: tek giriş noktası. Her para hareketi buradan geçer.
 * - Satırların toplamı 0 olmalı (borç +, alacak −).
 * - idempotency_key benzersiz: aynı anahtarla ikinci çağrı hiçbir şey yazmaz, mevcut işlemi döndürür.
 * - Hesaplar id sırasıyla kilitlenir (deadlock önleme), bakiyeler aynı işlemde güncellenir.
 * - Şirket nakdi negatife düşecekse INSUFFICIENT_FUNDS.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from "../db/schema";
import { fail } from "../errors";
import { kindOf } from "./accounts";

export interface AccountRef {
  companyId: string | null;
  code: string;
}
export interface PostLine {
  account: AccountRef;
  amount: bigint;
}
export interface PostInput {
  kind: string;
  idempotencyKey: string;
  refType?: string;
  refId?: string;
  memo?: string;
  at: Date;
  lines: PostLine[];
  reversesId?: string;
}

const keyOf = (a: AccountRef) => `${a.companyId ?? "sys"}:${a.code}`;

export async function accountId(tx: Tx, ref: AccountRef): Promise<string> {
  const where = ref.companyId
    ? and(eq(ledgerAccounts.companyId, ref.companyId), eq(ledgerAccounts.code, ref.code))
    : and(isNull(ledgerAccounts.companyId), eq(ledgerAccounts.code, ref.code));
  const found = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where).limit(1);
  if (found[0]) return found[0].id;
  await tx
    .insert(ledgerAccounts)
    .values({ companyId: ref.companyId, code: ref.code, kind: kindOf(ref.companyId, ref.code) })
    .onConflictDoNothing();
  const again = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(where).limit(1);
  if (!again[0]) throw new Error(`hesap oluşturulamadı ${keyOf(ref)}`);
  return again[0].id;
}

export async function post(tx: Tx, input: PostInput): Promise<{ id: string; duplicate: boolean }> {
  // Aynı hesaptaki satırları birleştir, sıfırları at
  const merged = new Map<string, PostLine>();
  for (const l of input.lines) {
    const k = keyOf(l.account);
    const cur = merged.get(k);
    if (cur) cur.amount += l.amount;
    else merged.set(k, { account: l.account, amount: l.amount });
  }
  const lines = [...merged.values()].filter((l) => l.amount !== 0n);
  const sum = lines.reduce((a, l) => a + l.amount, 0n);
  if (sum !== 0n) throw new Error(`Defter dengesiz (${input.kind}): toplam ${sum}`);

  const inserted = await tx
    .insert(ledgerTransactions)
    .values({
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      memo: input.memo ?? "",
      reversesId: input.reversesId ?? null,
      createdAt: input.at,
    })
    .onConflictDoNothing()
    .returning({ id: ledgerTransactions.id });
  if (!inserted[0]) {
    const ex = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { id: ex[0]!.id, duplicate: true };
  }
  const txId = inserted[0].id;
  if (lines.length === 0) return { id: txId, duplicate: false };

  const ids = await Promise.all(lines.map((l) => accountId(tx, l.account)));
  const byId = new Map<string, bigint>();
  ids.forEach((id, i) => byId.set(id, (byId.get(id) ?? 0n) + lines[i]!.amount));
  const sorted = [...byId.keys()].sort();
  const locked = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code, companyId: ledgerAccounts.companyId, balance: ledgerAccounts.balance })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.id, sorted))
    .orderBy(ledgerAccounts.id)
    .for("update");
  for (const a of locked) {
    const delta = byId.get(a.id) ?? 0n;
    if (a.companyId && a.code === "cash" && a.balance + delta < 0n) {
      fail("INSUFFICIENT_FUNDS", { missing: (-(a.balance + delta)).toString() });
    }
  }
  for (const id of sorted) {
    await tx
      .update(ledgerAccounts)
      .set({ balance: sql`${ledgerAccounts.balance} + ${byId.get(id)!.toString()}::bigint` })
      .where(eq(ledgerAccounts.id, id));
  }
  await tx.insert(ledgerEntries).values(sorted.map((id) => ({ transactionId: txId, accountId: id, amount: byId.get(id)!, createdAt: input.at })));
  return { id: txId, duplicate: false };
}

/** Bakiye okuma (kilitlemeden) */
export async function balanceOf(tx: Tx, ref: AccountRef): Promise<bigint> {
  const where = ref.companyId
    ? and(eq(ledgerAccounts.companyId, ref.companyId), eq(ledgerAccounts.code, ref.code))
    : and(isNull(ledgerAccounts.companyId), eq(ledgerAccounts.code, ref.code));
  const r = await tx.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(where).limit(1);
  return r[0]?.b ?? 0n;
}

/** Bir işlemi ters kayıtla düzelt (orijinal kayıt değişmez). */
export async function reverse(tx: Tx, originalId: string, at: Date, memo: string): Promise<{ id: string; duplicate: boolean }> {
  const orig = await tx.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, originalId)).limit(1);
  if (!orig[0]) fail("NOT_FOUND");
  const entries = await tx
    .select({ amount: ledgerEntries.amount, companyId: ledgerAccounts.companyId, code: ledgerAccounts.code })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.transactionId, originalId));
  return post(tx, {
    kind: "reversal",
    idempotencyKey: `reverse:${originalId}`,
    refType: "ledger_transaction",
    refId: originalId,
    memo,
    at,
    reversesId: originalId,
    lines: entries.map((e) => ({ account: { companyId: e.companyId, code: e.code }, amount: -e.amount })),
  });
}

/** Şirket hesap kısayolu */
export const co = (companyId: string, code: string): AccountRef => ({ companyId, code });
export const sys = (code: string): AccountRef => ({ companyId: null, code });
