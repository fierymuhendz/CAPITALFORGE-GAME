import type { JobCompleted, RecipeIdString } from "@capitalforge/shared";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { inventories, productionJobs } from "../db/schema";

export const COMPLETION_BATCH = 500;

export interface CompletedJob extends JobCompleted {
  playerId: string;
}

/**
 * Tamamlama fazı (tick döngüsünün ikinci aşaması). Vadesi gelen (`completes_at_tick <= tick`) çalışan
 * işleri `FOR UPDATE SKIP LOCKED` ile en çok 500'lük partiler halinde `done` yapar ve çıktıyı aynı
 * transaction'da envantere ekler. İki işçi ya da tekrar eden tick aynı işi iki kez tamamlayamaz:
 * kilitli satırlar atlanır, tamamlananlar artık `running` değildir.
 * Kilit sırası: production_jobs → inventories, ikisi de (ürün id, oyuncu id) artan; ticker ürünleri
 * id sırasıyla kilitlediği için deadlock oluşmaz. Tamamlanan işleri (commit sonrası bildirim için) döner.
 */
export async function runCompletionPhase(db: Db, tick: bigint, maxBatches = 20): Promise<CompletedJob[]> {
  const all: CompletedJob[] = [];
  for (let i = 0; i < maxBatches; i++) {
    const batch = await db.transaction(async (tx) => {
      const jobs = await tx
        .select()
        .from(productionJobs)
        .where(and(eq(productionJobs.status, "running"), lte(productionJobs.completesAtTick, tick)))
        .orderBy(asc(productionJobs.outputProductId), asc(productionJobs.playerId), asc(productionJobs.id))
        .limit(COMPLETION_BATCH)
        .for("update", { skipLocked: true });
      if (jobs.length === 0) return [];

      // (ürün, oyuncu) başına topla; jobs zaten bu sırayla sıralı.
      const totals = new Map<string, { playerId: string; productId: string; qty: bigint }>();
      for (const j of jobs) {
        const k = `${j.outputProductId}\u0000${j.playerId}`;
        const cur = totals.get(k);
        if (cur) cur.qty += j.outputQty;
        else totals.set(k, { playerId: j.playerId, productId: j.outputProductId, qty: j.outputQty });
      }
      for (const t of totals.values()) {
        await tx
          .insert(inventories)
          .values({ playerId: t.playerId, productId: t.productId, quantity: t.qty })
          .onConflictDoUpdate({
            target: [inventories.playerId, inventories.productId],
            set: { quantity: sql`${inventories.quantity} + ${t.qty}` },
          });
      }
      await tx
        .update(productionJobs)
        .set({ status: "done", completedTick: tick })
        .where(inArray(productionJobs.id, jobs.map((j) => j.id)));

      return jobs.map(
        (j): CompletedJob => ({
          playerId: j.playerId,
          jobId: j.id,
          facilityId: j.facilityId,
          recipeId: j.recipeId as RecipeIdString,
          outputProductId: j.outputProductId,
          outputQty: j.outputQty.toString(),
          completedTick: Number(tick),
        }),
      );
    });
    all.push(...batch);
    if (batch.length < COMPLETION_BATCH) break;
  }
  return all;
}
