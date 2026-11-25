import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

/** side=sell: ilan (stok rezerve). side=buy: alım emri (bedel emanette). */
export const marketOrders = cf.table(
  "market_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    side: text("side").$type<"sell" | "buy">().notNull(),
    companyId: uuid("company_id").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    cityId: text("city_id").notNull(),
    productId: text("product_id").notNull(),
    /** sell: tam kalite; buy: en düşük kalite */
    quality: integer("quality").notNull(),
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull(),
    remainingKg: bigint("remaining_kg", { mode: "number" }).notNull(),
    pricePerKg: bigint("price_per_kg", { mode: "bigint" }).notNull(),
    /** buy: kalan emanet tutarı */
    escrowRemaining: bigint("escrow_remaining", { mode: "bigint" }).notNull().default(sql`0`),
    status: text("status").$type<"open" | "filled" | "cancelled">().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    firstFillAt: timestamp("first_fill_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("orders_book_idx").on(t.cityId, t.productId, t.side, t.status),
    index("orders_company_idx").on(t.companyId, t.status),
    check("orders_remaining_ok", sql`remaining_kg >= 0 AND remaining_kg <= qty_kg AND escrow_remaining >= 0`),
  ],
);

export const trades = cf.table(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    buyerCompanyId: uuid("buyer_company_id").notNull(),
    sellerCompanyId: uuid("seller_company_id").notNull(),
    buyerIsSystem: boolean("buyer_is_system").notNull(),
    sellerIsSystem: boolean("seller_is_system").notNull(),
    cityId: text("city_id").notNull(),
    productId: text("product_id").notNull(),
    quality: integer("quality").notNull(),
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull(),
    pricePerKg: bigint("price_per_kg", { mode: "bigint" }).notNull(),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
    fee: bigint("fee", { mode: "bigint" }).notNull(),
    transactionId: uuid("transaction_id").notNull(),
    saleId: uuid("sale_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("trades_pc_idx").on(t.productId, t.cityId, t.createdAt), index("trades_buyer_idx").on(t.buyerCompanyId), index("trades_seller_idx").on(t.sellerCompanyId)],
);

/** Her satış (anlık, sözleşme, sistem) için kâr kırılımı */
export const sales = cf.table(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sellerCompanyId: uuid("seller_company_id").notNull(),
    buyerCompanyId: uuid("buyer_company_id").notNull(),
    source: text("source").$type<"spot" | "contract" | "system">().notNull(),
    cityId: text("city_id").notNull(),
    productId: text("product_id").notNull(),
    quality: integer("quality").notNull(),
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull(),
    pricePerKg: bigint("price_per_kg", { mode: "bigint" }).notNull(),
    gross: bigint("gross", { mode: "bigint" }).notNull(),
    cogs: bigint("cogs", { mode: "bigint" }).notNull(),
    freight: bigint("freight", { mode: "bigint" }).notNull().default(sql`0`),
    fees: bigint("fees", { mode: "bigint" }).notNull().default(sql`0`),
    netProfit: bigint("net_profit", { mode: "bigint" }).notNull(),
    tradeId: uuid("trade_id"),
    contractId: uuid("contract_id"),
    installmentId: uuid("installment_id"),
    shipmentId: uuid("shipment_id"),
    transactionIds: uuid("transaction_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sales_seller_idx").on(t.sellerCompanyId, t.createdAt), index("sales_buyer_idx").on(t.buyerCompanyId, t.createdAt)],
);
