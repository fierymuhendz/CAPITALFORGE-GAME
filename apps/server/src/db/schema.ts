import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
    /** Ortak piyasa havuzu: birim rezervi ve sanal değer rezervi. price = value / units (türetilmiş, tutarlı yazılır). */
    poolUnits: bigintCol("pool_units").notNull().default(sql`1`),
    poolValue: bigintCol("pool_value").notNull().default(sql`1`),
    tick: bigintCol("tick").notNull().default(sql`0`),
  },
  (t) => [
    check("products_price_min", sql`${t.price} >= 1`),
    check("products_pool_units_min", sql`${t.poolUnits} >= 1`),
    check("products_pool_value_min", sql`${t.poolValue} >= 1`),
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
    /** İşlemin yapıldığı oyun saati (game_clock.tick); hacim sınırı penceresi için. */
    tick: bigintCol("tick").notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trades_player_client_key_idx").on(t.playerId, t.clientKey),
    check("trades_quantity_positive", sql`${t.quantity} > 0`),
    check("trades_side", sql`${t.side} IN ('buy', 'sell')`),
    check("trades_amounts_non_negative", sql`${t.unitPrice} >= 0 AND ${t.gross} >= 0 AND ${t.tax} >= 0`),
    index("trades_player_created_idx").on(t.playerId, t.createdAt),
    index("trades_volume_idx").on(t.playerId, t.productId, t.tick),
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

/** Oyun saati: tek satır (id=1). Fiyat tick'iyle aynı transaction'da artar; üretim süreleri buna göre ölçülür. */
export const gameClock = pgTable(
  "game_clock",
  {
    id: integer("id").primaryKey().default(1),
    tick: bigintCol("tick").notNull().default(sql`0`),
  },
  (t) => [check("game_clock_single_row", sql`${t.id} = 1`), check("game_clock_tick_nn", sql`${t.tick} >= 0`)],
);

/** Şirketler. v1'de oyuncu başına bir şirket (player_id UNIQUE); ad büyük/küçük harf duyarsız benzersizdir. */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id").notNull().unique().references(() => players.id),
    name: text("name").notNull(),
    cityId: text("city_id").notNull().default("merkez"),
    foundedAt: timestamp("founded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_name_lower_idx").on(sql`lower(${t.name})`)],
);

/** Tesisler. (city_id, plot_x, plot_y) benzersiz: aynı arsa iki kez satılamaz. */
export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    type: text("type").notNull(),
    level: integer("level").notNull().default(1),
    cityId: text("city_id").notNull().default("merkez"),
    plotX: integer("plot_x").notNull(),
    plotY: integer("plot_y").notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    purchasePrice: bigintCol("purchase_price").notNull(),
    /** Bakımı ödenmiş son dönem (upkeepPeriodTicks cinsinden dönem numarası). */
    upkeepPaidPeriod: bigintCol("upkeep_paid_period").notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("facilities_plot_idx").on(t.cityId, t.plotX, t.plotY),
    index("facilities_company_idx").on(t.companyId),
    check("facilities_level_positive", sql`${t.level} >= 1`),
    check("facilities_plot_bounds", sql`${t.plotX} >= 0 AND ${t.plotX} < 16 AND ${t.plotY} >= 0 AND ${t.plotY} < 16`),
    check("facilities_status", sql`${t.status} IN ('active', 'suspended')`),
    check("facilities_price_positive", sql`${t.purchasePrice} > 0`),
  ],
);

/** Üretim işleri. Tesis başına aynı anda tek çalışan iş (kısmi UNIQUE). */
export const productionJobs = pgTable(
  "production_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    playerId: uuid("player_id").notNull().references(() => players.id),
    recipeId: text("recipe_id").notNull(),
    batches: integer("batches").notNull(),
    startedTick: bigintCol("started_tick").notNull(),
    completesAtTick: bigintCol("completes_at_tick").notNull(),
    status: text("status", { enum: ["running", "done"] }).notNull().default("running"),
    /** Düşülen girdiler: { productId: "miktar" } */
    inputs: jsonb("inputs").$type<Record<string, string>>().notNull(),
    outputProductId: text("output_product_id").notNull().references(() => products.id),
    outputQty: bigintCol("output_qty").notNull(),
    completedTick: bigintCol("completed_tick"),
  },
  (t) => [
    uniqueIndex("production_jobs_one_running_idx").on(t.facilityId).where(sql`${t.status} = 'running'`),
    index("production_jobs_due_idx").on(t.completesAtTick).where(sql`${t.status} = 'running'`),
    index("production_jobs_player_idx").on(t.playerId),
    check("production_jobs_batches", sql`${t.batches} BETWEEN 1 AND 10`),
    check("production_jobs_output_positive", sql`${t.outputQty} > 0`),
    check("production_jobs_status", sql`${t.status} IN ('running', 'done')`),
  ],
);

/**
 * Ticaret dışı niyetler için genel idempotency tablosu. (player_id, client_key) PK.
 * Satır, işin kendisiyle aynı transaction'da yazılır; iş hata ile geri alınırsa satır da gider.
 */
export const playerActions = pgTable(
  "player_actions",
  {
    playerId: uuid("player_id").notNull().references(() => players.id),
    clientKey: uuid("client_key").notNull(),
    kind: text("kind").notNull(),
    payloadHash: text("payload_hash").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.clientKey] })],
);

/** Asgari ödenek talepleri. PK (player_id, period): dönem başına en fazla bir. */
export const reliefClaims = pgTable(
  "relief_claims",
  {
    playerId: uuid("player_id").notNull().references(() => players.id),
    period: bigintCol("period").notNull(),
    amount: bigintCol("amount").notNull(),
    transferId: uuid("transfer_id").notNull().references(() => transfers.id),
    /** Talebin yapıldığı oyun saati; kayan bekleme (reliefCooldownTicks) buna göre denetlenir. */
    claimedTick: bigintCol("claimed_tick").notNull().default(sql`0`),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.period] }), check("relief_amount_positive", sql`${t.amount} > 0`)],
);
