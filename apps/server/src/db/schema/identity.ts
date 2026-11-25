import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cf } from "./_base";

export const accounts = cf.table(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    usernameLower: text("username_lower").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<"player" | "admin">().notNull().default("player"),
    locale: text("locale").$type<"tr" | "en">().notNull().default("tr"),
    graphics: text("graphics").$type<"auto" | "high" | "low" | "lite">().notNull().default("auto"),
    /** AES-GCM ile şifreli TOTP sırrı (anahtar sunucu sırrından türetilir) */
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    canReviewConnections: boolean("can_review_connections").notNull().default(false),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("accounts_username_lower_uq").on(t.usernameLower)],
);

export const sessions = cf.table(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    adminVerifiedAt: timestamp("admin_verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_account_idx").on(t.accountId)],
);

/** Ham IP saklanmaz: HMAC karması. Saklama süresi ayarlardan (ipRetentionDays). */
export const connectionRecords = cf.table(
  "connection_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    hits: integer("hits").notNull().default(1),
  },
  (t) => [uniqueIndex("conn_account_ip_uq").on(t.accountId, t.ipHash), index("conn_ip_idx").on(t.ipHash)],
);

export const adminSetupCodes = cf.table("admin_setup_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: uuid("used_by").references(() => accounts.id),
});

/** İstek düzeyinde tekrar koruması: aynı anahtar aynı sonucu döndürür. */
export const idempotencyKeys = cf.table(
  "idempotency_keys",
  {
    accountId: uuid("account_id").notNull(),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    status: integer("status").notNull(),
    response: jsonb("response").notNull(),
    /** istek gövdesi + gerçek yol karması; aynı anahtarla farklı istek → IDEMPOTENCY_MISMATCH (eski satırlarda null) */
    requestHash: text("request_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idem_uq").on(t.accountId, t.key)],
);

export const notifications = cf.table(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, string | number>>().notNull().default(sql`'{}'::jsonb`),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notif_company_idx").on(t.companyId, t.createdAt)],
);
