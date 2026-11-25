/**
 * Üretim bitişi (zamanlayıcı): running → completed aynı işlemde, FOR UPDATE SKIP LOCKED ile tam bir kez.
 * Defter: inventory +toplam, wip −toplam. Çıktı bitişte işin BAŞLANGIÇ tarif anlık görüntüsündeki
 * ürünle ve işin hesaplanmış miktar/kalitesiyle girer. Tekrar modunda yeni iş katalogdaki GÜNCEL tarifle başlar.
 */
import { and, eq, lte } from "drizzle-orm";
import type { CostBreakdownDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { facilities, productionJobs } from "../db/schema";
import type { Deps } from "../deps";
import { withTx } from "../deps";
import { AppError } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { addXp } from "../company/found";
import { addStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { startProduction } from "./start";

type StallCode = "MISSING_INPUT" | "INSUFFICIENT_FUNDS" | "ARREARS";

function stallFrom(err: unknown): { code: StallCode; productId?: string } {
  if (err instanceof AppError) {
    if (err.code === "INSUFFICIENT_STOCK") return { code: "MISSING_INPUT", productId: typeof err.details?.productId === "string" ? err.details.productId : undefined };
    if (err.code === "INSUFFICIENT_FUNDS") return { code: "INSUFFICIENT_FUNDS" };
    if (err.code === "ARREARS_OUTSTANDING") return { code: "ARREARS" };
  }
  return { code: "MISSING_INPUT" };
}

export async function settleJob(tx: Tx, uow: UnitOfWork, catalog: Catalog, jobId: string, now: Date): Promise<boolean> {
  const job = (
    await tx
      .select()
      .from(productionJobs)
      .where(and(eq(productionJobs.id, jobId), eq(productionJobs.status, "running"), lte(productionJobs.endsAt, now)))
      .for("update", { skipLocked: true })
  )[0];
  if (!job) return false;
  const breakdown = job.costBreakdown as CostBreakdownDto;
  const snap = job.recipeSnapshot as { id: string; output: { productId: string } };
  const settle = await post(tx, {
    kind: "production_settle", idempotencyKey: `prod-settle:${job.id}`, refType: "production_job", refId: job.id, at: now,
    memo: `Üretim tamam: ${snap.id}`,
    lines: [{ account: co(job.companyId, "inventory"), amount: job.costTotal }, { account: co(job.companyId, "wip"), amount: -job.costTotal }],
  });
  await addStock(tx, { companyId: job.companyId, cityId: job.cityId, productId: snap.output.productId, quality: job.outputQuality }, job.outputKg, job.costTotal, {
    kind: "production_output", refType: "production_job", refId: job.id, breakdown, transactionId: settle.id, at: now,
  });
  await tx.update(productionJobs).set({ status: "completed", completedAt: job.endsAt, settleTransactionId: settle.id }).where(eq(productionJobs.id, job.id));
  await addXp(tx, job.companyId, catalog.settings.xp.productionJob, catalog.settings.levelXp);
  await notify(tx, uow, job.companyId, "production_done", {
    recipe: snap.id, product: snap.output.productId, qtyKg: job.outputKg, quality: job.outputQuality, city: job.cityId,
  }, now, "/play?tab=facilities");
  uow.invalidate(job.companyId, "company", "inventory", "facilities", "finance");
  uow.world("map");

  if (job.repeat) {
    const fac = (await tx.select().from(facilities).where(eq(facilities.id, job.facilityId)).limit(1))[0];
    if (fac && fac.state === "ready") {
      try {
        await tx.transaction((sp) =>
          startProduction(sp, uow, catalog, { companyId: job.companyId, facilityId: job.facilityId, recipeId: job.recipeId, batches: job.batches, repeat: true, now }),
        );
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        const reason = stallFrom(err);
        await tx
          .update(facilities)
          .set({ stalledReason: { ...reason, recipeId: job.recipeId, at: now.toISOString() } })
          .where(eq(facilities.id, job.facilityId));
        await notify(tx, uow, job.companyId, "line_stalled", {
          facility: fac.type, city: fac.cityId, reason: reason.code, product: reason.productId ?? "", recipe: job.recipeId,
        }, now, "/play?tab=facilities");
      }
    }
  }
  return true;
}

export async function settleDueJobs(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: productionJobs.id })
    .from(productionJobs)
    .where(and(eq(productionJobs.status, "running"), lte(productionJobs.endsAt, now)))
    .orderBy(productionJobs.endsAt)
    .limit(200);
  let n = 0;
  for (const d of due) {
    try {
      if (await withTx(deps, (tx, uow) => settleJob(tx, uow, deps.catalog, d.id, now))) n++;
    } catch (err) {
      deps.log.error({ err, jobId: d.id }, "üretim bitişi işlenemedi");
    }
  }
  return n;
}
