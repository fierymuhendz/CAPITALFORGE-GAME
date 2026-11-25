/**
 * Üretim başlatma (elle veya tekrar modunda). Kilit sırası: tesis satırı → stok → defter.
 * Defter: wip +(girdi + enerji + su + ücret), inventory −girdi, cash −(enerji + su + ücret).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { CostBreakdownDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { facilities, productionJobs } from "../db/schema";
import { AppError, fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { removeStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { writeOutcome } from "../finance/outcomes";
import { m } from "../lib/serialize";
import { evaluateProduction } from "./eval";
import { estimateSale } from "./quote";

export interface StartInput {
  companyId: string;
  facilityId: string;
  recipeId: string;
  batches: number;
  repeat: boolean;
  now: Date;
}

export async function startProduction(tx: Tx, uow: UnitOfWork, catalog: Catalog, p: StartInput): Promise<typeof productionJobs.$inferSelect> {
  const facility = (await tx.select().from(facilities).where(and(eq(facilities.id, p.facilityId), eq(facilities.companyId, p.companyId))).for("update"))[0];
  if (!facility || facility.state === "demolished") fail("NOT_FOUND");
  const ev = await evaluateProduction(tx, catalog, p.companyId, facility, p.recipeId, p.batches, true);
  const first = ev.blockers[0];
  if (first) {
    const d: Record<string, string | number> = {};
    if (first.productId) d.productId = first.productId;
    if (first.missingKg !== undefined) d.missingKg = first.missingKg;
    if (first.missing) d.missing = first.missing;
    throw new AppError(first.code as never, d);
  }
  if (ev.plan.outputKg < 1) fail("BAD_REQUEST", { issue: "output" });

  const jobId = randomUUID();
  const used: CostBreakdownDto["inputs"] = [];
  let inputsCost = 0n;
  for (const inp of ev.inputs) {
    for (const lot of inp.lots) {
      const cost = await removeStock(
        tx, { companyId: p.companyId, cityId: facility.cityId, productId: inp.productId, quality: lot.quality }, lot.kg,
        { kind: "production_input", refType: "production_job", refId: jobId, at: p.now },
      );
      inputsCost += cost;
      used.push({ productId: inp.productId, quality: lot.quality, qtyKg: lot.kg, cost: m(cost) });
    }
  }
  const { plan } = ev;
  const total = inputsCost + ev.operatingCost;
  const breakdown: CostBreakdownDto = {
    inputs: used, energy: m(plan.energyCost), water: m(plan.waterCost), labor: m(plan.laborCost), total: m(total),
  };
  const startTx = await post(tx, {
    kind: "production_start", idempotencyKey: `prod-start:${jobId}`, refType: "production_job", refId: jobId, at: p.now,
    memo: `Üretim: ${ev.recipe.id} × ${p.batches}`,
    lines: [
      { account: co(p.companyId, "wip"), amount: total },
      { account: co(p.companyId, "inventory"), amount: -inputsCost },
      { account: co(p.companyId, "cash"), amount: -ev.operatingCost },
    ],
  });
  const [job] = await tx
    .insert(productionJobs)
    .values({
      id: jobId, facilityId: facility.id, companyId: p.companyId, cityId: facility.cityId, recipeId: ev.recipe.id,
      recipeVersion: ev.recipe.version, recipeSnapshot: { ...ev.recipe }, batches: p.batches, repeat: p.repeat, status: "running",
      startedAt: p.now, endsAt: new Date(p.now.getTime() + plan.minutes * 60_000),
      outputProductId: ev.recipe.output.productId, outputKg: plan.outputKg, outputQuality: plan.outputQuality,
      costBreakdown: breakdown, costTotal: total, startTransactionId: startTx.id,
    })
    .returning();
  // tahmin ↔ gerçekleşen: teklifin aynı hesabı (maliyet, süre, en iyi alıcıya satış tahmini)
  const est = await estimateSale(tx, catalog, p.companyId, facility.cityId, ev.recipe.output.productId, plan.outputQuality, plan.outputKg, total, plan.minutes);
  await writeOutcome(tx, {
    companyId: p.companyId, kind: "production", refType: "production_job", refId: jobId, productId: ev.recipe.output.productId, recipeId: ev.recipe.id, cityId: facility.cityId,
    expected: {
      qtyKg: plan.outputKg, cost: total, minutes: plan.minutes, at: job!.endsAt,
      revenue: est ? BigInt(est.revenue) : null, fees: est ? BigInt(est.fee) : null, profit: est ? BigInt(est.profit) : null,
    },
    at: p.now,
  });
  await tx.update(facilities).set({ stalledReason: null }).where(eq(facilities.id, facility.id));
  uow.invalidate(p.companyId, "company", "inventory", "facilities", "finance");
  uow.world("map");
  return job!;
}
