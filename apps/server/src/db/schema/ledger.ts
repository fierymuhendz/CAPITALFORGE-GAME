import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

export type AccountKind = "asset" | "liability" | "equity" | "revenue" | "expense";

/**
 * company_id null → saf sistem hesabı (world, utilities, ...). Şirket nakdi negatife düşemez.
 */
export const ledgerAccounts = cf.table(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id"),
    code: text("code").notNull(),
    kind: text("kind").$type<AccountKind>().notNull(),
    balance: bigint("balance", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [
    uniqueIndex("ledger_accounts_uq").on(sql`coalesce(${t.companyId}::text, 'sys')`, t.code),
    check("ledger_cash_nonneg", sql`company_id IS NULL OR code <> 'cash' OR balance >= 0`),
  ],
);

export const ledgerTransactions = cf.table(
  "ledger_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    memo: text("memo").notNull().default(""),
    /** ters kayıt ise orijinal işlem */
    reversesId: uuid("reverses_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("ledger_tx_idem_uq").on(t.idempotencyKey),
    index("ledger_tx_ref_idx").on(t.refType, t.refId),
    // pazar istatistiği ve sistem payı ters kayıtlı işlemleri dışlar
    index("ledger_tx_reverses_idx").on(t.reversesId).where(sql`${t.reversesId} IS NOT NULL`),
  ],
);

/** amount işaretli: borç (+), alacak (−). Her işlemin satırları toplamı 0. */
export const ledgerEntries = cf.table(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    transactionId: uuid("transaction_id").notNull().references(() => ledgerTransactions.id),
    accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("ledger_entries_tx_idx").on(t.transactionId), index("ledger_entries_account_idx").on(t.accountId, t.createdAt)],
);
