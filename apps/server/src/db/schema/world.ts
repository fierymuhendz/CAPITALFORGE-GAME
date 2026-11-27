import { sql } from "drizzle-orm";
import { bigint, integer, jsonb, primaryKey, text, timestamp, index, date, uuid } from "drizzle-orm/pg-core";
import type { DepositKind } from "@capitalforge/shared";
import { cf } from "./_base";

/**
 * Katalog: ürün, şehir, bina türü, tarif, araştırma, araç modeli. Metin kimlikli, veri JSON.
 * Varsayılanlar koddan eklenir (eksikse); yönetici düzenlemesi version'ı artırır, geçmiş catalog_history'de.
 */
export const catalogItems = cf.table(
  "catalog_items",
  {
    kind: text("kind").$type<"city" | "product" | "building_type" | "recipe" | "research" | "vehicle_model">().notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull().default(1),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

export const catalogHistory = cf.table("catalog_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  itemId: text("item_id").notNull(),
  version: integer("version").notNull(),
  before: jsonb("before"),
  after: jsonb("after").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  changedBy: uuid("changed_by"),
  reasoning: text("reasoning"),
});

export const settings = cf.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

export const plots = cf.table(
  "plots",
  {
    id: text("id").primaryKey(),
    cityId: text("city_id").notNull(),
    gx: integer("gx").notNull(),
    gz: integer("gz").notNull(),
    price: bigint("price", { mode: "bigint" }).notNull(),
    minLevel: integer("min_level").notNull(),
    sizeHa: integer("size_ha").notNull(),
    fertilityBp: integer("fertility_bp").notNull(),
    pastureBp: integer("pasture_bp").notNull(),
    depositKind: text("deposit_kind").$type<DepositKind>(),
    depositRichnessBp: integer("deposit_richness_bp"),
    distanceToCenterKm: integer("distance_to_center_km").notNull(),
    ownerCompanyId: uuid("owner_company_id"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }),
  },
  (t) => [index("plots_city_idx").on(t.cityId)],
);

/** Test ortamında saat ilerletme (üretimde her zaman 0). */
export const worldClock = cf.table("world_clock", {
  id: integer("id").primaryKey(),
  offsetMs: bigint("offset_ms", { mode: "number" }).notNull().default(0),
});

export const meta = cf.table("meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Ürün-şehir referans fiyatı (saatlik güncellenir) */
export const priceRefs = cf.table(
  "price_refs",
  {
    productId: text("product_id").notNull(),
    cityId: text("city_id").notNull(),
    driftBp: integer("drift_bp").notNull().default(10000),
    refPricePerKg: bigint("ref_price_per_kg", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.cityId] })],
);

export const priceHistory = cf.table(
  "price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: text("product_id").notNull(),
    cityId: text("city_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    refPricePerKg: bigint("ref_price_per_kg", { mode: "bigint" }).notNull(),
    vwapPerKg: bigint("vwap_per_kg", { mode: "bigint" }),
    volumeKg: bigint("volume_kg", { mode: "number" }).notNull().default(0),
  },
  (t) => [index("price_hist_idx").on(t.productId, t.cityId, t.at)],
);

/** Sistem şirketlerinin günlük sayaçları (bütçe ve kapasite sınırı) */
export const systemDaily = cf.table(
  "system_daily",
  {
    companyId: uuid("company_id").notNull(),
    productId: text("product_id").notNull(),
    day: date("day").notNull(),
    boughtKg: bigint("bought_kg", { mode: "number" }).notNull().default(0),
    soldKg: bigint("sold_kg", { mode: "number" }).notNull().default(0),
    spent: bigint("spent", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.productId, t.day] })],
);
