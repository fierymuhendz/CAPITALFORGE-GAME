import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
(t) => [
  // Büyük/küçük harf farkıyla ad taklidini engeller.
  uniqueIndex("players_username_lower_idx").on(sql`lower(${t.username})`),
]);

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
    // Oyuncu başına tek cüzdan.
    uniqueIndex("accounts_one_wallet_per_player_idx").on(t.playerId).where(sql`${t.kind} = 'player'`),
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

const bigintCol = (name: string) => bigint(name, { mode: "bigint" });

/** Ürünler. Fiyatın tek otoritesi bu tablodur; tick döngüsü günceller. */
export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    price: bigintCol("price").notNull(),
    pendingDemand: bigintCol("pending_demand").notNull().default(sql`0`),
    pendingSupply: bigintCol("pending_supply").notNull().default(sql`0`),
    tick: bigintCol("tick").notNull().default(sql`0`),
  },
  (t) => [
    check("products_price_min", sql`${t.price} >= 1`),
    check("products_pending_demand_nn", sql`${t.pendingDemand} >= 0`),
    check("products_pending_supply_nn", sql`${t.pendingSupply} >= 0`),
  ],
);

/** Oyuncu envanteri. Negatife düşemez. */
export const inventories = pgTable(
  "inventories",
  {
    playerId: uuid("player_id").notNull().references(() => players.id),
    productId: text("product_id").notNull().references(() => products.id),
    quantity: bigintCol("quantity").notNull().default(sql`0`),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.productId] }), check("inventory_non_negative", sql`${t.quantity} >= 0`)],
);

/**
 * Gerçekleşen ticaretler. (player_id, client_key) benzersizdir: satır önce "rezerve" edilir
 * (unit_price/gross/tax = 0, transfer_id NULL), aynı transaction içinde doldurulur.
 * Commit edilmiş satırda transfer_id her zaman doludur.
 */
export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id").notNull().references(() => players.id),
    clientKey: uuid("client_key").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    productId: text("product_id").notNull().references(() => products.id),
    quantity: bigintCol("quantity").notNull(),
    unitPrice: bigintCol("unit_price").notNull(),
    gross: bigintCol("gross").notNull(),
    tax: bigintCol("tax").notNull(),
    transferId: uuid("transfer_id").unique().references(() => transfers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_player_client_key_idx").on(t.playerId, t.clientKey),
    check("trades_quantity_positive", sql`${t.quantity} > 0`),
    check("trades_side", sql`${t.side} IN ('buy', 'sell')`),
    check("trades_amounts_non_negative", sql`${t.unitPrice} >= 0 AND ${t.gross} >= 0 AND ${t.tax} >= 0`),
    index("trades_player_created_idx").on(t.playerId, t.createdAt),
  ],
);

/** Fiyat geçmişi (grafik). Tick başına ürün başına bir satır. */
export const priceHistory = pgTable(
  "price_history",
  {
    productId: text("product_id").notNull().references(() => products.id),
    tick: bigintCol("tick").notNull(),
    price: bigintCol("price").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.tick] })],
);
