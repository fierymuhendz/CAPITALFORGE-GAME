import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Hesaplar: oyuncu cüzdanları ve sistem hesapları (ör. "system:tax", "system:mint").
 * Bakiye kuruş cinsinden bigint'tir. Oyuncu hesapları negatife düşemez.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id").references(() => players.id),
    kind: text("kind", { enum: ["player", "system"] }).notNull(),
    code: text("code").unique(),
    balance: bigint("balance", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [
    check("player_balance_non_negative", sql`${t.kind} <> 'player' OR ${t.balance} >= 0`),
    index("accounts_player_idx").on(t.playerId),
  ],
);

/** Bir para hareketinin başlığı. idempotency_key aynı isteğin iki kez işlenmesini engeller. */
export const transfers = pgTable("transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Çift taraflı defter. Her transfer için satırların amount toplamı sıfırdır.
 * Pozitif = hesaba giren, negatif = hesaptan çıkan.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    transferId: uuid("transfer_id").notNull().references(() => transfers.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
  },
  (t) => [
    check("amount_non_zero", sql`${t.amount} <> 0`),
    index("ledger_account_idx").on(t.accountId),
    index("ledger_transfer_idx").on(t.transferId),
  ],
);
