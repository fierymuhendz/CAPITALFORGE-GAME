import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

export const adminAuditLog = cf.table(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminAccountId: uuid("admin_account_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reasoning: text("reasoning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_at_idx").on(t.createdAt)],
);

export const adminCases = cf.table("admin_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  status: text("status").$type<"open" | "closed">().notNull().default("open"),
  openedBy: uuid("opened_by").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  resolution: text("resolution"),
});

export const adminCaseEvents = cf.table(
  "admin_case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => adminCases.id),
    byAccountId: uuid("by_account_id").notNull(),
    kind: text("kind").$type<"opened" | "note" | "enforcement" | "closed">().notNull(),
    text: text("text").notNull(),
    action: text("action"),
    targetId: text("target_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("case_events_idx").on(t.caseId, t.createdAt)],
);

export const alerts = cf.table(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    severity: text("severity").$type<"info" | "warn" | "high">().notNull(),
    productId: text("product_id"),
    cityId: text("city_id"),
    companyIds: uuid("company_ids").array().notNull().default(sql`'{}'::uuid[]`),
    details: jsonb("details").notNull(),
    status: text("status").$type<"open" | "acknowledged" | "case_opened">().notNull().default("open"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("alerts_dedupe_uq").on(t.dedupeKey), index("alerts_kind_idx").on(t.kind, t.createdAt)],
);
