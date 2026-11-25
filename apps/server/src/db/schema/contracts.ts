import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

export const contracts = cf.table(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status").$type<"proposed" | "active" | "completed" | "cancelled" | "expired" | "declined">().notNull().default("proposed"),
    isSystem: boolean("is_system").notNull().default(false),
    proposerCompanyId: uuid("proposer_company_id").notNull(),
    proposerRole: text("proposer_role").$type<"seller" | "buyer">().notNull(),
    /** doğrudan teklifte karşı taraf; boşsa panoda herkese açık */
    counterpartyCompanyId: uuid("counterparty_company_id"),
    sellerCompanyId: uuid("seller_company_id"),
    buyerCompanyId: uuid("buyer_company_id"),
    productId: text("product_id").notNull(),
    minQuality: integer("min_quality").notNull(),
    qtyPerInstallmentKg: bigint("qty_per_installment_kg", { mode: "number" }).notNull(),
    pricePerKg: bigint("price_per_kg", { mode: "bigint" }).notNull(),
    deliveryCityId: text("delivery_city_id").notNull(),
    freightPayer: text("freight_payer").$type<"seller" | "buyer">().notNull(),
    installments: integer("installments").notNull(),
    firstDueAt: timestamp("first_due_at", { withTimezone: true }).notNull(),
    intervalHours: integer("interval_hours").notNull(),
    graceHours: integer("grace_hours").notNull(),
    penaltyBp: integer("penalty_bp").notNull(),
    lateFeeBp: integer("late_fee_bp").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    note: text("note"),
    /** kabulde dondurulan koşullar; asla güncellenmez */
    terms: jsonb("terms"),
    buyerEscrow: bigint("buyer_escrow", { mode: "bigint" }).notNull().default(sql`0`),
    sellerDeposit: bigint("seller_deposit", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
  },
  (t) => [
    index("contracts_status_idx").on(t.status, t.expiresAt),
    index("contracts_seller_idx").on(t.sellerCompanyId),
    index("contracts_buyer_idx").on(t.buyerCompanyId),
    index("contracts_proposer_idx").on(t.proposerCompanyId),
  ],
);

export const contractInstallments = cf.table(
  "contract_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id),
    seq: integer("seq").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    windowOpensAt: timestamp("window_opens_at", { withTimezone: true }).notNull(),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }).notNull(),
    qtyDueKg: bigint("qty_due_kg", { mode: "number" }).notNull(),
    qtyDeliveredKg: bigint("qty_delivered_kg", { mode: "number" }).notNull().default(0),
    qtyLateKg: bigint("qty_late_kg", { mode: "number" }).notNull().default(0),
    status: text("status").$type<"scheduled" | "open" | "fulfilled" | "partial" | "missed" | "cancelled">().notNull().default("scheduled"),
    escrowRemaining: bigint("escrow_remaining", { mode: "bigint" }).notNull(),
    depositShare: bigint("deposit_share", { mode: "bigint" }).notNull(),
    paidToSeller: bigint("paid_to_seller", { mode: "bigint" }).notNull().default(sql`0`),
    lateFees: bigint("late_fees", { mode: "bigint" }).notNull().default(sql`0`),
    penalty: bigint("penalty", { mode: "bigint" }).notNull().default(sql`0`),
    refundedToBuyer: bigint("refunded_to_buyer", { mode: "bigint" }).notNull().default(sql`0`),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settleTransactionId: uuid("settle_transaction_id"),
  },
  (t) => [
    uniqueIndex("installments_seq_uq").on(t.contractId, t.seq),
    index("installments_due_idx").on(t.graceEndsAt).where(sql`settled_at IS NULL`),
  ],
);

export const contractDeliveries = cf.table(
  "contract_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installmentId: uuid("installment_id").notNull().references(() => contractInstallments.id),
    contractId: uuid("contract_id").notNull(),
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull(),
    quality: integer("quality").notNull(),
    late: boolean("late").notNull(),
    shipmentId: uuid("shipment_id"),
    saleId: uuid("sale_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("deliveries_installment_idx").on(t.installmentId)],
);
