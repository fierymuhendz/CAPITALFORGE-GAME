/** Uyarı yazımı: dedupe_key benzersiz, aynı uyarı tekrar yazılmaz. */
import type { AdminAlertDto } from "@capitalforge/shared";
import type { DbOrTx } from "../db/client";
import { alerts } from "../db/schema";

export type AlertDetails = Record<string, string | number | boolean | null>;

export interface NewAlert {
  kind: AdminAlertDto["kind"];
  severity: "info" | "warn" | "high";
  productId?: string | null;
  cityId?: string | null;
  companyIds?: string[];
  details: AlertDetails;
  dedupeKey: string;
  at: Date;
}

/** Yeni yazıldıysa true */
export async function raiseAlert(db: DbOrTx, a: NewAlert): Promise<boolean> {
  const r = await db
    .insert(alerts)
    .values({
      kind: a.kind, severity: a.severity, productId: a.productId ?? null, cityId: a.cityId ?? null,
      companyIds: a.companyIds ?? [], details: a.details, dedupeKey: a.dedupeKey, createdAt: a.at,
    })
    .onConflictDoNothing()
    .returning({ id: alerts.id });
  return r.length > 0;
}
