import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

/**
 * Tahmin ↔ gerçekleşen kaydı: karar anında sunucunun hesapladığı beklenen rakamlar.
 * Gerçekleşen rakamlar burada saklanmaz; GET /finance/outcomes gerçek kayıtlardan (iş, satış, defter) hesaplar.
 */
export const dealOutcomes = cf.table(
  "deal_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    kind: text("kind").$type<"production" | "purchase" | "sale" | "freight_job" | "contract">().notNull(),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    productId: text("product_id"),
    recipeId: text("recipe_id"),
    cityId: text("city_id"),
    destCityId: text("dest_city_id"),
    expected: jsonb("expected").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("deal_outcomes_uq").on(t.companyId, t.kind, t.refId),
    index("deal_outcomes_company_idx").on(t.companyId, t.createdAt),
  ],
);
