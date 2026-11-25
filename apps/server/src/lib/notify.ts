import type { NotificationDto } from "@capitalforge/shared";
import type { Tx } from "../db/client";
import { notifications } from "../db/schema";
import type { UnitOfWork } from "../events/bus";

/**
 * Bildirim yaz (işlem içinde) ve commit sonrası yayın için sıraya koy.
 * kind istemcide i18n anahtarıdır: notifications.<kind>.
 */
export async function notify(tx: Tx, uow: UnitOfWork, companyId: string, kind: string, params: Record<string, string | number>, at: Date, link?: string): Promise<void> {
  const [row] = await tx.insert(notifications).values({ companyId, kind, params, link: link ?? null, createdAt: at }).returning();
  const n: NotificationDto = { id: row!.id, at: at.toISOString(), kind, params, read: false, link: link ?? null };
  uow.notifications.push({ companyId, n });
  uow.invalidate(companyId, "notifications");
}
