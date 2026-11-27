/**
 * Şirket kuruluşu: isim, şehir, sektör, arsa. Tek veritabanı işleminde:
 * şirket + hesap planı + başlangıç sermayesi + arsa alımı + başlangıç bağışı (bina, garajda kamyon,
 * ilk işin girdileri). Bağış starter_grants birincil anahtarıyla şirket başına bir kez verilir.
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { depositFits, type FoundCompanyReq, type Sector } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import { playtestMs } from "../catalog/pace";
import type { Tx } from "../db/client";
import { companies, facilities, plots, priceRefs, starterGrants, vehicles } from "../db/schema";
import { ensureCompanyAccounts } from "../db/seed";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { addStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";

export const STARTER_BUILDING: Record<Exclude<Sector, "manufacturing">, string> = {
  crop: "field",
  livestock: "barn",
  mining: "mine",
  freight: "garage",
};

export function starterBuildingFor(sector: Sector, choice?: "food_plant" | "steel_mill"): string {
  return sector === "manufacturing" ? (choice ?? "food_plant") : STARTER_BUILDING[sector];
}

export function starterInputsKey(sector: Sector, building: string): string {
  return sector === "manufacturing" ? `manufacturing_${building}` : sector;
}

/** Sonraki günlük bakım: Türkiye gece yarısı (21:00 UTC), ilk gün ücretsiz */
export function nextUpkeepAfter(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(21, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export async function foundCompany(
  tx: Tx,
  uow: UnitOfWork,
  catalog: Catalog,
  accountId: string,
  req: z.infer<typeof FoundCompanyReq>,
  now: Date,
): Promise<{ companyId: string; facilityId: string | null; vehicleId: string | null }> {
  const s = catalog.settings;
  const existing = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.accountId, accountId), isNull(companies.dissolvedAt)))
    .limit(1);
  if (existing[0]) fail("COMPANY_EXISTS");
  // Yeniden kurma bekleme süresi: son kapatılan şirketin kapanışından itibaren
  const lastClosed = (await tx
    .select({ at: companies.dissolvedAt })
    .from(companies)
    .where(and(eq(companies.accountId, accountId), isNotNull(companies.dissolvedAt)))
    .orderBy(desc(companies.dissolvedAt))
    .limit(1))[0]?.at;
  if (lastClosed) {
    const until = new Date(lastClosed.getTime() + playtestMs(catalog, s.refoundCooldownHours * 3_600_000));
    if (now.getTime() < until.getTime()) fail("COMPANY_COOLDOWN", { until: until.toISOString() });
  }
  // Başlangıç bağışı hesap başına bir kez: bu hesabın herhangi bir şirketi bağış aldıysa tekrar verilmez
  const grantedBefore = (await tx
    .select({ id: starterGrants.companyId })
    .from(starterGrants)
    .innerJoin(companies, eq(companies.id, starterGrants.companyId))
    .where(eq(companies.accountId, accountId))
    .limit(1))[0];
  catalog.city(req.cityId);
  const nameLower = req.name.trim().toLowerCase();
  const taken = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.nameLower, nameLower), isNull(companies.dissolvedAt))).limit(1);
  if (taken[0]) fail("COMPANY_NAME_TAKEN");

  const plot = (await tx.select().from(plots).where(eq(plots.id, req.plotId)).for("update"))[0];
  if (!plot || plot.cityId !== req.cityId) fail("NOT_FOUND", { plotId: req.plotId });
  if (plot.ownerCompanyId) fail("PLOT_TAKEN");
  if (plot.minLevel > 1) fail("LEVEL_TOO_LOW", { required: plot.minLevel });
  const startingCash = BigInt(s.startingCash);
  if (plot.price > startingCash) fail("INSUFFICIENT_FUNDS");

  const buildingType = starterBuildingFor(req.sector, req.starterBuilding);
  const bt = catalog.buildingType(buildingType);
  if (!depositFits(bt, plot.depositKind)) fail("PLOT_NOT_ELIGIBLE");

  const [company] = await tx
    .insert(companies)
    .values({
      accountId, name: req.name.trim(), nameLower, sector: req.sector, homeCityId: req.cityId,
      nextUpkeepAt: nextUpkeepAfter(now), createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!company) fail("COMPANY_NAME_TAKEN");
  const cid = company.id;
  await ensureCompanyAccounts(tx, cid);

  // 1) Başlangıç sermayesi
  await post(tx, {
    kind: "starting_capital", idempotencyKey: `capital:${cid}`, refType: "company", refId: cid, at: now,
    memo: "Başlangıç sermayesi",
    lines: [{ account: co(cid, "cash"), amount: startingCash }, { account: co(cid, "equity"), amount: -startingCash }],
  });

  // 2) Arsa alımı (sahiplik koşullu güncelleme: eşzamanlı alımda yalnızca biri kazanır)
  const own = await tx
    .update(plots)
    .set({ ownerCompanyId: cid, purchasedAt: now })
    .where(and(eq(plots.id, plot.id), isNull(plots.ownerCompanyId)))
    .returning({ id: plots.id });
  if (!own[0]) fail("PLOT_TAKEN");
  await post(tx, {
    kind: "plot_purchase", idempotencyKey: `plot:${plot.id}:${cid}`, refType: "plot", refId: plot.id, at: now,
    memo: `Arsa ${plot.id}`,
    lines: [{ account: co(cid, "fixed_assets"), amount: plot.price }, { account: co(cid, "cash"), amount: -plot.price }],
  });

  const grantStarter = async (): Promise<{ facilityId: string; vehicleId: string | null }> => {
    const [facility] = await tx
      .insert(facilities)
      .values({ companyId: cid, plotId: plot.id, cityId: plot.cityId, type: buildingType, level: 1, qualityLevel: 1, state: "ready", createdAt: now })
      .returning();
    let vehicleId: string | null = null;
    let grantValue = BigInt(bt.buildCost);
    if (req.sector === "freight") {
      const vm = catalog.vehicleModel("truck");
      const [v] = await tx
        .insert(vehicles)
        .values({ companyId: cid, modelId: vm.id, cityId: plot.cityId, status: "idle", garageFacilityId: facility!.id, purchasedAt: now })
        .returning();
      vehicleId = v!.id;
      grantValue += BigInt(vm.price);
    }
    const inputs = s.starterInputs[starterInputsKey(req.sector, buildingType)] ?? [];
    const grantTx = await post(tx, {
      kind: "starter_grant", idempotencyKey: `starter:${cid}`, refType: "company", refId: cid, at: now,
      memo: "Başlangıç bağışı",
      lines: [{ account: co(cid, "fixed_assets"), amount: grantValue }, { account: co(cid, "equity"), amount: -grantValue }],
    });
    let inputsValue = 0n;
    for (const inp of inputs) {
      const ref = (await tx.select().from(priceRefs).where(and(eq(priceRefs.productId, inp.productId), eq(priceRefs.cityId, plot.cityId))).limit(1))[0];
      const cost = (ref?.refPricePerKg ?? BigInt(catalog.product(inp.productId).basePricePerKg)) * BigInt(inp.kg);
      inputsValue += cost;
      await addStock(tx, { companyId: cid, cityId: plot.cityId, productId: inp.productId, quality: 2 }, inp.kg, cost, {
        kind: "starter_grant", refType: "company", refId: cid, at: now, transactionId: grantTx.id,
        breakdown: { inputs: [], energy: "0", water: "0", labor: "0", purchase: cost.toString(), total: cost.toString() },
      });
    }
    if (inputsValue > 0n) {
      await post(tx, {
        kind: "starter_grant_inputs", idempotencyKey: `starter-inputs:${cid}`, refType: "company", refId: cid, at: now,
        memo: "Başlangıç girdileri",
        lines: [{ account: co(cid, "inventory"), amount: inputsValue }, { account: co(cid, "equity"), amount: -inputsValue }],
      });
    }
    const g = await tx
      .insert(starterGrants)
      .values({
        companyId: cid, grantedAt: now, facilityId: facility!.id, vehicleId, transactionId: grantTx.id,
        details: { buildingType, vehicle: vehicleId ? "truck" : null, inputs, value: (grantValue + inputsValue).toString() },
      })
      .onConflictDoNothing()
      .returning({ c: starterGrants.companyId });
    if (!g[0]) throw new Error("başlangıç bağışı zaten verilmiş");
    return { facilityId: facility!.id, vehicleId };

  };

  // 3) Başlangıç bağışı: bina (+ garajda kamyon) + ilk işin girdileri (hesap başına bir kez)
  let facilityId: string | null = null;
  let vehicleId: string | null = null;
  if (!grantedBefore) {
    const r = await grantStarter();
    facilityId = r.facilityId;
    vehicleId = r.vehicleId;
  }

  await notify(tx, uow, cid, "welcome", { company: company.name, building: buildingType }, now, "/play?tab=facilities");
  uow.invalidate(cid, "company", "inventory", "facilities", "finance", "map");
  uow.world("map");
  return { companyId: cid, facilityId, vehicleId };
}

/** Deneyim ekle ve seviyeyi güncelle */
export async function addXp(tx: Tx, companyId: string, amount: number, levelXp: readonly number[]): Promise<void> {
  if (amount <= 0) return;
  const thresholds = `{${levelXp.join(",")}}`;
  await tx.execute(sql`
    UPDATE cf.companies SET xp = xp + ${amount},
      level = (SELECT count(*) FROM unnest(${thresholds}::int[]) t WHERE t <= xp + ${amount})
    WHERE id = ${companyId}
  `);
}
