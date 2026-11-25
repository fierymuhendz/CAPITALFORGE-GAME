import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

export const companies = cf.table(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** sistem şirketlerinde null */
    accountId: uuid("account_id"),
    name: text("name").notNull(),
    nameLower: text("name_lower").notNull(),
    sector: text("sector").$type<"crop" | "livestock" | "mining" | "manufacturing" | "freight">().notNull(),
    homeCityId: text("home_city_id").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    systemKey: text("system_key"),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    onTimeDeliveries: integer("on_time_deliveries").notNull().default(0),
    lateOrMissed: integer("late_or_missed").notNull().default(0),
    nextUpkeepAt: timestamp("next_upkeep_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("companies_name_uq").on(t.nameLower).where(sql`dissolved_at IS NULL`),
    uniqueIndex("companies_account_uq").on(t.accountId).where(sql`dissolved_at IS NULL AND account_id IS NOT NULL`),
    uniqueIndex("companies_system_key_uq").on(t.systemKey),
    index("companies_upkeep_idx").on(t.nextUpkeepAt),
  ],
);

/** Başlangıç bağışı: şirket başına tek satır (birincil anahtar) → bir kez. */
export const starterGrants = cf.table("starter_grants", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  facilityId: uuid("facility_id"),
  vehicleId: uuid("vehicle_id"),
  transactionId: uuid("transaction_id"),
  details: jsonb("details").notNull(),
});

export const facilities = cf.table(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    plotId: text("plot_id").notNull(),
    cityId: text("city_id").notNull(),
    type: text("type").notNull(),
    level: integer("level").notNull().default(1),
    qualityLevel: integer("quality_level").notNull().default(1),
    /** constructing | ready */
    state: text("state").$type<"constructing" | "ready" | "demolished">().notNull().default("ready"),
    constructionEndsAt: timestamp("construction_ends_at", { withTimezone: true }),
    upgradeKind: text("upgrade_kind").$type<"level" | "quality">(),
    upgradeTarget: integer("upgrade_target"),
    upgradeEndsAt: timestamp("upgrade_ends_at", { withTimezone: true }),
    stalledReason: jsonb("stalled_reason").$type<{ code: "MISSING_INPUT" | "INSUFFICIENT_FUNDS" | "ARREARS"; productId?: string; recipeId?: string; at: string } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("facilities_plot_uq").on(t.plotId).where(sql`state <> 'demolished'`),
    index("facilities_company_idx").on(t.companyId),
    index("facilities_construction_idx").on(t.constructionEndsAt),
    index("facilities_upgrade_idx").on(t.upgradeEndsAt),
  ],
);

export const productionJobs = cf.table(
  "production_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    companyId: uuid("company_id").notNull(),
    cityId: text("city_id").notNull(),
    recipeId: text("recipe_id").notNull(),
    recipeVersion: integer("recipe_version").notNull(),
    /** başlangıçtaki tarif (yönetici sonradan değiştirse de bu iş bununla biter) */
    recipeSnapshot: jsonb("recipe_snapshot").notNull(),
    batches: integer("batches").notNull(),
    repeat: boolean("repeat").notNull().default(false),
    status: text("status").$type<"running" | "completed" | "cancelled">().notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outputProductId: text("output_product_id").notNull(),
    outputKg: bigint("output_kg", { mode: "number" }).notNull(),
    outputQuality: integer("output_quality").notNull(),
    costBreakdown: jsonb("cost_breakdown").notNull(),
    costTotal: bigint("cost_total", { mode: "bigint" }).notNull(),
    startTransactionId: uuid("start_transaction_id"),
    settleTransactionId: uuid("settle_transaction_id"),
  },
  (t) => [
    index("jobs_due_idx").on(t.endsAt).where(sql`status = 'running'`),
    index("jobs_facility_idx").on(t.facilityId),
    index("jobs_company_idx").on(t.companyId, t.startedAt),
  ],
);

export const holdings = cf.table(
  "holdings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    cityId: text("city_id").notNull(),
    productId: text("product_id").notNull(),
    quality: integer("quality").notNull(),
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull().default(0),
    reservedKg: bigint("reserved_kg", { mode: "number" }).notNull().default(0),
    costTotal: bigint("cost_total", { mode: "bigint" }).notNull().default(sql`0`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("holdings_uq").on(t.companyId, t.cityId, t.productId, t.quality),
    check("holdings_qty_ok", sql`qty_kg >= 0 AND reserved_kg >= 0 AND reserved_kg <= qty_kg AND cost_total >= 0`),
  ],
);

export const inventoryMovements = cf.table(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    cityId: text("city_id").notNull(),
    productId: text("product_id").notNull(),
    quality: integer("quality").notNull(),
    /** işaretli: giriş +, çıkış − */
    qtyKg: bigint("qty_kg", { mode: "number" }).notNull(),
    cost: bigint("cost", { mode: "bigint" }).notNull(),
    kind: text("kind").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    breakdown: jsonb("breakdown"),
    transactionId: uuid("transaction_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("movements_company_idx").on(t.companyId, t.productId, t.createdAt)],
);

export const research = cf.table(
  "research",
  {
    companyId: uuid("company_id").notNull(),
    researchId: text("research_id").notNull(),
    level: integer("level").notNull().default(0),
    targetLevel: integer("target_level"),
    endsAt: timestamp("ends_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.researchId] }), index("research_due_idx").on(t.endsAt)],
);

export const loans = cf.table(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    principal: bigint("principal", { mode: "bigint" }).notNull(),
    outstanding: bigint("outstanding", { mode: "bigint" }).notNull(),
    dailyInterestBp: integer("daily_interest_bp").notNull(),
    termDays: integer("term_days").notNull(),
    paidInstallments: integer("paid_installments").notNull().default(0),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }),
    lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"active" | "repaid" | "defaulted">().notNull().default("active"),
    interestPaid: bigint("interest_paid", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("loans_due_idx").on(t.nextDueAt).where(sql`status = 'active'`), index("loans_company_idx").on(t.companyId)],
);

/** Saatlik net değer görüntüsü (servet sıçraması uyarısı için) */
export const companySnapshots = cf.table(
  "company_snapshots",
  {
    companyId: uuid("company_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    cash: bigint("cash", { mode: "bigint" }).notNull(),
    netWorth: bigint("net_worth", { mode: "bigint" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.at] })],
);
