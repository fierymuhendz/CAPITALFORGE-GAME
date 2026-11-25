/** İdempotency anahtarı temizliği: 7 günden eski anahtarlar günlük görevle silinir. */
import { lt } from "drizzle-orm";
import { idempotencyKeys } from "../db/schema";
import type { Deps } from "../deps";
import { registerTask } from "../scheduler/scheduler";

const DAY = 86_400_000;
export const IDEMPOTENCY_RETENTION_DAYS = 7;

export async function cleanupIdempotencyKeys(deps: Deps, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_DAYS * DAY);
  const del = await deps.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff)).returning({ k: idempotencyKeys.key });
  return del.length;
}

export function registerIdempotencyTasks(): void {
  registerTask({ name: "security.idempotency_cleanup", everyMs: DAY, run: cleanupIdempotencyKeys });
}
