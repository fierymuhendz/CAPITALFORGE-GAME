import { RECIPES, batchIO, completesAtTick, type RecipeId } from "@capitalforge/economy";
import type { ActionResult, StartProduction } from "@capitalforge/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ActionError } from "../actions/idempotency";
import { currentTick, runAction } from "../actions/run";
import type { Db } from "../db/client";
import { companies, facilities, inventories, productionJobs } from "../db/schema";

/**
 * Üretim başlat. Girdiler envanterden düşer (para hareketi yok). Kilit sırası:
 * facilities → production_jobs → inventories (ürün id artan). Sahiplik, kilit altında tesisin
 * şirketinin oyuncuya ait olmasıyla doğrulanır; başkasının tesisi (veya olmayan tesis) UNAUTHORIZED.
 * Tesis başına tek çalışan iş: önce kilitli kontrol, ikinci savunma kısmi UNIQUE indeksi.
 */
export function startProduction(db: Db, playerId: string, input: StartProduction): Promise<ActionResult> {
  return runAction(
    db,
    playerId,
    input.idempotencyKey,
    "startProduction",
    { facilityId: input.facilityId, recipeId: input.recipeId, batches: input.batches },
    async (tx) => {
      const recipe = RECIPES[input.recipeId as RecipeId];
      if (!recipe) throw new ActionError("UNKNOWN_RECIPE");

      const [facility] = await tx.select().from(facilities).where(eq(facilities.id, input.facilityId)).for("update");
      if (!facility) throw new ActionError("UNAUTHORIZED");
      const [company] = await tx
        .select({ playerId: companies.playerId })
        .from(companies)
        .where(eq(companies.id, facility.companyId));
      if (!company || company.playerId !== playerId) throw new ActionError("UNAUTHORIZED");

      if (facility.type !== recipe.facility) throw new ActionError("RECIPE_FACILITY_MISMATCH");
      if (facility.status !== "active") throw new ActionError("FACILITY_SUSPENDED");

      const running = await tx
        .select({ id: productionJobs.id })
        .from(productionJobs)
        .where(and(eq(productionJobs.facilityId, facility.id), eq(productionJobs.status, "running")))
        .for("update");
      if (running.length > 0) throw new ActionError("FACILITY_BUSY");

      const io = batchIO(recipe, BigInt(input.batches));

      // Girdileri ürün id'sine göre artan sırada kilitle ve düş.
      const need = [...io.inputs].sort((a, b) => (a.productId < b.productId ? -1 : 1));
      if (need.length > 0) {
        const held = await tx
          .select({ productId: inventories.productId, quantity: inventories.quantity })
          .from(inventories)
          .where(and(eq(inventories.playerId, playerId), inArray(inventories.productId, need.map((n) => n.productId))))
          .orderBy(asc(inventories.productId))
          .for("update");
        const have = new Map(held.map((h) => [h.productId, h.quantity]));
        for (const n of need) {
          if ((have.get(n.productId) ?? 0n) < n.qty) throw new ActionError("INSUFFICIENT_INVENTORY");
        }
        for (const n of need) {
          await tx
            .update(inventories)
            .set({ quantity: sql`${inventories.quantity} - ${n.qty}` })
            .where(and(eq(inventories.playerId, playerId), eq(inventories.productId, n.productId)));
        }
      }

      const tick = await currentTick(tx);
      const inserted = await tx
        .insert(productionJobs)
        .values({
          facilityId: facility.id,
          playerId,
          recipeId: recipe.id,
          batches: input.batches,
          startedTick: tick,
          completesAtTick: completesAtTick(recipe, tick),
          inputs: Object.fromEntries(io.inputs.map((n) => [n.productId, n.qty.toString()])),
          outputProductId: io.output.productId,
          outputQty: io.output.qty,
        })
        .onConflictDoNothing()
        .returning({ id: productionJobs.id });
      if (inserted.length === 0) throw new ActionError("FACILITY_BUSY");
      return { refId: inserted[0]!.id, amount: 0n };
    },
  );
}
