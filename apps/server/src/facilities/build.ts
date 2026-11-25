/**
 * Arsa alımı + inşaat, seviye yükseltme, kalite iyileştirme. Hepsi tek işlem:
 * tesis/arsa satırı kilidi → çelik stoğu (removeStock) → defter. Nakit ve seviye ayrı ayrı denetlenir.
 * Çelik, binanın bulunduğu şehirdeki depodan düşer (en düşük kaliteden başlayarak).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { BuyPlotReq, FacilityDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { companies, facilities, plots } from "../db/schema";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { rawBalances } from "../finance/report";
import { removeStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { m } from "../lib/serialize";
import { selectLots } from "../production/lots";
import { facilityDto } from "./dto";

const MIN = 60_000;

/** Çeliği şehir deposundan düşer; yetersizse INSUFFICIENT_STEEL. Döndürür: toplam çelik maliyeti. */
async function consumeSteel(tx: Tx, companyId: string, cityId: string, kg: number, refType: string, refId: string, now: Date): Promise<bigint> {
  if (kg <= 0) return 0n;
  const sel = await selectLots(tx, companyId, cityId, "steel", kg, true, "asc");
  if (sel.missingKg > 0) fail("INSUFFICIENT_STEEL", { requiredKg: kg, availableKg: sel.availableKg });
  let cost = 0n;
  for (const lot of sel.lots) {
    cost += await removeStock(tx, { companyId, cityId, productId: "steel", quality: lot.quality }, lot.kg, { kind: "construction_steel", refType, refId, at: now });
  }
  return cost;
}

async function precheckCash(tx: Tx, companyId: string, need: bigint): Promise<void> {
  const cash = (await rawBalances(tx, companyId)).cash ?? 0n;
  if (cash < need) fail("INSUFFICIENT_FUNDS", { missing: m(need - cash) });
}

async function freshLevel(tx: Tx, companyId: string): Promise<number> {
  const c = (await tx.select({ level: companies.level }).from(companies).where(eq(companies.id, companyId)).limit(1))[0];
  return c?.level ?? 1;
}

export async function buyPlot(tx: Tx, uow: UnitOfWork, catalog: Catalog, companyId: string, plotId: string, req: z.infer<typeof BuyPlotReq>, now: Date): Promise<FacilityDto> {
  const bt = catalog.buildingType(req.buildingType);
  const plot = (await tx.select().from(plots).where(eq(plots.id, plotId)).for("update"))[0];
  if (!plot) fail("NOT_FOUND");
  if (plot.ownerCompanyId) fail("PLOT_TAKEN");
  const level = await freshLevel(tx, companyId);
  if (plot.minLevel > level) fail("LEVEL_TOO_LOW", { required: plot.minLevel });
  if (bt.requiresDeposit && !plot.depositKind) fail("PLOT_NOT_ELIGIBLE");
  const cashNeed = plot.price + BigInt(bt.buildCost);
  await precheckCash(tx, companyId, cashNeed);

  const own = await tx
    .update(plots)
    .set({ ownerCompanyId: companyId, purchasedAt: now })
    .where(and(eq(plots.id, plot.id), isNull(plots.ownerCompanyId)))
    .returning({ id: plots.id });
  if (!own[0]) fail("PLOT_TAKEN");
  const [fac] = await tx
    .insert(facilities)
    .values({
      companyId, plotId: plot.id, cityId: plot.cityId, type: bt.id, level: 1, qualityLevel: 1, state: "constructing",
      constructionEndsAt: new Date(now.getTime() + bt.buildMinutes * MIN), createdAt: now,
    })
    .returning();
  const steelCost = await consumeSteel(tx, companyId, plot.cityId, bt.buildSteelKg, "facility", fac!.id, now);
  await post(tx, {
    kind: "plot_purchase", idempotencyKey: `plot-buy:${plot.id}:${companyId}`, refType: "plot", refId: plot.id, at: now, memo: `Arsa ${plot.id}`,
    lines: [{ account: co(companyId, "fixed_assets"), amount: plot.price }, { account: co(companyId, "cash"), amount: -plot.price }],
  });
  await post(tx, {
    kind: "construction", idempotencyKey: `construct:${fac!.id}`, refType: "facility", refId: fac!.id, at: now, memo: `İnşaat ${bt.id}`,
    lines: [
      { account: co(companyId, "fixed_assets"), amount: BigInt(bt.buildCost) + steelCost },
      { account: co(companyId, "cash"), amount: -BigInt(bt.buildCost) },
      { account: co(companyId, "inventory"), amount: -steelCost },
    ],
  });
  uow.invalidate(companyId, "company", "inventory", "facilities", "finance", "map");
  uow.world("map");
  return facilityDto(catalog, fac!, [], now);
}

export async function startUpgrade(tx: Tx, uow: UnitOfWork, catalog: Catalog, companyId: string, facilityId: string, kind: "level" | "quality", now: Date): Promise<FacilityDto> {
  const f = (await tx.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.companyId, companyId))).for("update"))[0];
  if (!f || f.state === "demolished") fail("NOT_FOUND");
  if (f.state !== "ready") fail("BUILDING_NOT_READY");
  if (f.upgradeKind) fail("BUILDING_BUSY");
  const bt = catalog.buildingType(f.type);
  let cost: bigint, steelKg: number, minutes: number, target: number;
  if (kind === "level") {
    target = f.level + 1;
    if (!bt.levels.some((l) => l.level === target)) fail("MAX_LEVEL");
    const level = await freshLevel(tx, companyId);
    if (level < target) fail("LEVEL_TOO_LOW", { required: target });
    const ld = catalog.levelDef(f.type, f.level);
    cost = BigInt(ld.upgradeCost); steelKg = ld.upgradeSteelKg; minutes = ld.upgradeMinutes;
  } else {
    const idx = f.qualityLevel - 1;
    const c = bt.qualityUpgradeCosts[idx];
    if (c === undefined) fail("MAX_LEVEL");
    target = f.qualityLevel + 1;
    cost = BigInt(c); steelKg = 0; minutes = bt.qualityUpgradeMinutes;
  }
  await precheckCash(tx, companyId, cost);
  const steelCost = await consumeSteel(tx, companyId, f.cityId, steelKg, "facility", f.id, now);
  await post(tx, {
    kind: kind === "level" ? "facility_upgrade" : "quality_upgrade", idempotencyKey: `upgrade:${f.id}:${kind}:${target}`,
    refType: "facility", refId: f.id, at: now, memo: kind === "level" ? `Yükseltme → seviye ${target}` : `Kalite iyileştirme → ${target}`,
    lines: [
      { account: co(companyId, "fixed_assets"), amount: cost + steelCost },
      { account: co(companyId, "cash"), amount: -cost },
      { account: co(companyId, "inventory"), amount: -steelCost },
    ],
  });
  const [u] = await tx
    .update(facilities)
    .set({ upgradeKind: kind, upgradeTarget: target, upgradeEndsAt: new Date(now.getTime() + minutes * MIN) })
    .where(eq(facilities.id, f.id))
    .returning();
  uow.invalidate(companyId, "company", "inventory", "facilities", "finance", "map");
  uow.world("map");
  return facilityDto(catalog, u!, [], now);
}
