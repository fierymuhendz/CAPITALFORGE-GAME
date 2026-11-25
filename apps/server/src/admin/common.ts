/** Yönetici modülü ortak yardımcıları: denetim kaydı, kimlik doğrulama, JSON güvenliği. */
import { inArray } from "drizzle-orm";
import { uuid as uuidSchema } from "@capitalforge/shared";
import type { DbOrTx } from "../db/client";
import { adminAuditLog, companies } from "../db/schema";
import { fail } from "../errors";

/** bigint → metin (jsonb'ye yazılabilir hale getirir) */
export function jsonSafe<T>(v: T): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

export interface AuditEntry {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reasoning?: string | null;
  at: Date;
}

/** Denetim kaydı yaz. Para/iç ayrıntı sızdırmaz; parola vb. çağıran tarafından konmaz. */
export async function writeAudit(db: DbOrTx, e: AuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminAccountId: e.adminId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    before: e.before === undefined ? null : jsonSafe(e.before),
    after: e.after === undefined ? null : jsonSafe(e.after),
    reasoning: e.reasoning ?? null,
    createdAt: e.at,
  });
}

/** Yol parametresi UUID olmalı */
export function uuidParam(v: string | undefined): string {
  const r = uuidSchema.safeParse(v);
  if (!r.success) fail("BAD_REQUEST");
  return r.data;
}

/** LIKE desenini kaçışla */
export const likePattern = (q: string): string => `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

export async function companyNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const rows = await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, uniq));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** raw sql sonuçlarının tipi */
export type Row = Record<string, string | null>;
