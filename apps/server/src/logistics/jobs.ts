/** Taşıma işi panosu: açma (emanet + yük rezervi), kabul, iptal, süre dolumu, DTO. */
import { randomUUID } from "node:crypto";
import { and, eq, lte, or } from "drizzle-orm";
import { applyBp, estimateOwnTrip, systemCarrierQuote } from "@capitalforge/economy";
import { roadDistanceKm, type AcceptFreightReq, type CancelReq, type FreightJobDto, type FreightJobReq } from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import { paceTrip } from "../catalog/pace";
import type { DbOrTx, Tx } from "../db/client";
import { freightJobs, vehicles } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { UnitOfWork } from "../events/bus";
import { releaseStock, removeStock, reserveStock } from "../inventory/holdings";
import { writeOutcome } from "../finance/outcomes";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { companyBriefs, researchBonuses, type CompanyRow } from "../market/common";
import { lockVehicle, mergeLines, startShipment, validateLink, type CargoIn } from "./shipping";

/** oyuncu ilanı ücret üst sınırı: sistem taşımacısı fiyatı × bu çarpan */
export const JOB_PAY_CAP_MULT = 3n;

export type JobRow = typeof freightJobs.$inferSelect;

export async function createFreightJob(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof FreightJobReq>, now: Date, opts?: { isSystem?: boolean },
): Promise<JobRow> {
  catalog.city(req.originCityId);
  catalog.city(req.destCityId);
  if (req.originCityId === req.destCityId) fail("SAME_CITY");
  const lines = mergeLines(req.cargo);
  const total = lines.reduce((a, l) => a + l.qtyKg, 0);
  const maxCap = Math.max(...[...catalog.vehicleModels.values()].map((v) => v.capacityKg));
  if (total > maxCap) fail("VEHICLE_CAPACITY");
  let consignee = company.id;
  if (req.contractInstallmentId) {
    const { contract } = await validateLink(tx, company, req.contractInstallmentId, lines, req.destCityId, now);
    if (req.consigneeCompanyId && req.consigneeCompanyId !== contract.buyerCompanyId) fail("BAD_REQUEST", { issue: "consigneeCompanyId" });
    consignee = contract.buyerCompanyId!;
  } else if (req.consigneeCompanyId && req.consigneeCompanyId !== company.id) {
    fail("BAD_REQUEST", { issue: "consigneeCompanyId" });
  }
  for (const l of lines) await reserveStock(tx, { companyId: company.id, cityId: req.originCityId, productId: l.productId, quality: l.quality }, l.qtyKg);
  const id = randomUUID();
  const pay = BigInt(req.payAmount);
  // Değer aktarımı sınırı: ilan ücreti sistem taşımacısı fiyatının 3 katını aşamaz
  if (!opts?.isSystem) {
    const f = catalog.settings.freight;
    const cap = JOB_PAY_CAP_MULT * systemCarrierQuote(roadDistanceKm(req.originCityId, req.destCityId), total, f.systemBaseFee, f.systemPerKm, catalog.vehicleModel("truck").capacityKg);
    if (pay > cap) fail("BAD_REQUEST", { issue: "payAmount", max: cap.toString() });
  }
  await post(tx, {
    kind: "freight_escrow", idempotencyKey: `freight-open:${id}`, refType: "freight_job", refId: id, at: now, memo: "Taşıma işi ücreti emaneti",
    lines: [{ account: co(company.id, "escrow"), amount: pay }, { account: co(company.id, "cash"), amount: -pay }],
  });
  const [row] = await tx
    .insert(freightJobs)
    .values({
      id, status: "open", isSystem: opts?.isSystem ?? false, shipperCompanyId: company.id, consigneeCompanyId: consignee,
      originCityId: req.originCityId, destCityId: req.destCityId, distanceKm: roadDistanceKm(req.originCityId, req.destCityId),
      cargo: lines, totalKg: total, payAmount: pay, installmentId: req.contractInstallmentId ?? null, allowSystemCarrier: req.allowSystemCarrier,
      deadlineAt: new Date(now.getTime() + req.deadlineHours * 3_600_000), createdAt: now,
    })
    .returning();
  uow.invalidate(company.id, "freight", "inventory", "finance", "company");
  uow.world("market");
  return row!;
}

export async function acceptFreightJob(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, carrier: CompanyRow, jobId: string, req: z.infer<typeof AcceptFreightReq>, now: Date,
): Promise<JobRow> {
  const job = (await tx.select().from(freightJobs).where(eq(freightJobs.id, jobId)).for("update"))[0];
  if (!job) fail("NOT_FOUND");
  if (job.status !== "open" || job.deadlineAt.getTime() <= now.getTime()) fail("FREIGHT_NOT_OPEN");
  if (job.shipperCompanyId === carrier.id) fail("OWN_ORDER");
  const v = await lockVehicle(tx, req.vehicleId);
  if (v.companyId !== carrier.id || v.status === "sold") fail("NOT_FOUND");
  if (v.status !== "idle") fail("VEHICLE_BUSY");
  if (v.cityId !== job.originCityId) fail("VEHICLE_WRONG_CITY");
  if (catalog.vehicleModel(v.modelId).capacityKg < job.totalKg) fail("VEHICLE_CAPACITY");
  const cargo: CargoIn[] = [];
  for (const l of mergeLines(job.cargo)) {
    const cost = await removeStock(
      tx, { companyId: job.shipperCompanyId, cityId: job.originCityId, productId: l.productId, quality: l.quality }, l.qtyKg,
      { kind: "shipment_load", refType: "freight_job", refId: job.id, at: now }, { fromReserved: true },
    );
    cargo.push({ ownerCompanyId: job.shipperCompanyId, consigneeCompanyId: job.consigneeCompanyId, productId: l.productId, quality: l.quality, qtyKg: l.qtyKg, costBasis: cost, installmentId: job.installmentId });
  }
  const { shipment, tripTotal } = await startShipment(tx, uow, catalog, {
    vehicle: v, carrierId: carrier.id, destCityId: job.destCityId, cargo, purpose: "freight_job", freightJobId: job.id, jobPay: job.payAmount, now,
  });
  if (!carrier.isSystem) {
    // tahmin ↔ gerçekleşen: taşıyıcının beklenen geliri (ücret), komisyonu, yakıt + sürücü maliyeti ve süresi
    const fee = applyBp(job.payAmount, catalog.settings.marketFeeBp);
    const products = [...new Set(mergeLines(job.cargo).map((l) => l.productId))];
    await writeOutcome(tx, {
      companyId: carrier.id, kind: "freight_job", refType: "freight_job", refId: job.id, productId: products.length === 1 ? products[0]! : null,
      cityId: job.originCityId, destCityId: job.destCityId,
      expected: {
        qtyKg: job.totalKg, revenue: job.payAmount, fees: fee, cost: tripTotal, profit: job.payAmount - fee - tripTotal,
        minutes: Math.round((shipment.arrivesAt.getTime() - now.getTime()) / 60_000), at: shipment.arrivesAt,
      },
      at: now,
    });
  }
  const [row] = await tx
    .update(freightJobs)
    .set({ status: "in_transit", carrierCompanyId: carrier.id, shipmentId: shipment.id, acceptedAt: now })
    .where(eq(freightJobs.id, job.id))
    .returning();
  await notify(tx, uow, job.shipperCompanyId, "freight_accepted", { jobId: job.id, carrier: carrier.name, cityId: job.destCityId }, now, "/play?tab=freight");
  uow.invalidate(job.shipperCompanyId, "freight", "shipments");
  uow.invalidate(carrier.id, "freight", "shipments");
  uow.world("market");
  return row!;
}

/** Açık işi kapatır (iptal/süre dolumu): rezerv serbest, emanet iade. İş satırı kilitli olmalı. */
export async function closeOpenJob(tx: Tx, uow: UnitOfWork, job: JobRow, status: "cancelled" | "expired", now: Date): Promise<void> {
  for (const l of mergeLines(job.cargo)) {
    await releaseStock(tx, { companyId: job.shipperCompanyId, cityId: job.originCityId, productId: l.productId, quality: l.quality }, l.qtyKg);
  }
  await post(tx, {
    kind: "freight_refund", idempotencyKey: `freight-close:${job.id}`, refType: "freight_job", refId: job.id, at: now, memo: "Taşıma işi emanet iadesi",
    lines: [{ account: co(job.shipperCompanyId, "escrow"), amount: -job.payAmount }, { account: co(job.shipperCompanyId, "cash"), amount: job.payAmount }],
  });
  await tx.update(freightJobs).set({ status, closedAt: now }).where(eq(freightJobs.id, job.id));
  uow.invalidate(job.shipperCompanyId, "freight", "inventory", "finance", "company");
  uow.world("market");
}

export async function cancelFreightJob(tx: Tx, uow: UnitOfWork, company: CompanyRow, jobId: string, _req: z.infer<typeof CancelReq>, now: Date): Promise<void> {
  const job = (await tx.select().from(freightJobs).where(eq(freightJobs.id, jobId)).for("update"))[0];
  if (!job) fail("NOT_FOUND");
  if (job.shipperCompanyId !== company.id) fail("FORBIDDEN");
  if (job.status !== "open") fail("FREIGHT_NOT_OPEN");
  await closeOpenJob(tx, uow, job, "cancelled", now);
}

/** Süresi geçen açık işler (görev) */
export async function expireJobs(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db.select({ id: freightJobs.id }).from(freightJobs).where(and(eq(freightJobs.status, "open"), lte(freightJobs.deadlineAt, now))).limit(200);
  let n = 0;
  for (const d of due) {
    const uow = new UnitOfWork();
    const ok = await deps.db.transaction(async (tx) => {
      const job = (await tx.select().from(freightJobs).where(eq(freightJobs.id, d.id)).for("update", { skipLocked: true }))[0];
      if (!job || job.status !== "open") return false;
      await closeOpenJob(tx, uow, job, "expired", now);
      await notify(tx, uow, job.shipperCompanyId, "freight_expired", { jobId: job.id, cityId: job.originCityId }, now, "/play?tab=freight");
      return true;
    });
    if (ok) { uow.flush(deps.events); n++; }
  }
  return n;
}

export async function jobDtos(db: DbOrTx, catalog: Catalog, rows: JobRow[], me: CompanyRow | null): Promise<FreightJobDto[]> {
  const ids = rows.flatMap((r) => [r.shipperCompanyId, r.consigneeCompanyId, r.carrierCompanyId].filter((x): x is string => !!x));
  const names = await companyBriefs(db, ids);
  const myVehicles = me ? await db.select().from(vehicles).where(and(eq(vehicles.companyId, me.id), eq(vehicles.status, "idle"))) : [];
  const bonus = me ? await researchBonuses(db, catalog, me.id) : { speedBp: 0, fuelBp: 0 };
  const loadingHours = catalog.settings.freight.driverHoursPerTrip;
  const handlingMinutes = catalog.settings.freight.handlingMinutes ?? 0;
  /** boş araçlarımdan en yüksek saat başı net veren: boş gidiş (konumdan kalkış şehrine) + yükleme + iş yolu */
  const bestForMe = (j: JobRow): { vehicleId: string; minutes: number; netPerHour: bigint } | null => {
    let best: { vehicleId: string; minutes: number; netPerHour: bigint } | null = null;
    for (const v of myVehicles) {
      if (!v.cityId) continue;
      const md = catalog.vehicleModel(v.modelId);
      if (md.capacityKg < j.totalKg) continue;
      const veh = { capacityKg: md.capacityKg, speedKmh: md.speedKmh, fuelPerKm: BigInt(md.fuelPerKm) };
      const repoKm = roadDistanceKm(v.cityId, j.originCityId);
      const repo = estimateOwnTrip(repoKm, veh, BigInt(catalog.city(v.cityId).wage), { speedBonusBp: bonus.speedBp, fuelSavingBp: bonus.fuelBp, loadingHours: 0 });
      const trip = estimateOwnTrip(j.distanceKm, veh, BigInt(catalog.city(j.originCityId).wage), { speedBonusBp: bonus.speedBp, fuelSavingBp: bonus.fuelBp, loadingHours, handlingMinutes });
      // araç boş gidiş + yükleme/boşaltma + iş yolu boyunca bağlı (yükleme/boşaltma = handlingMinutes, trip.minutes içinde)
      const minutes = paceTrip(catalog, repo.minutes + trip.minutes);
      if (minutes <= 0) continue;
      const netPerHour = ((j.payAmount - repo.total - trip.total) * 60n) / BigInt(minutes);
      if (!best || netPerHour > best.netPerHour || (netPerHour === best.netPerHour && minutes < best.minutes)) best = { vehicleId: v.id, minutes, netPerHour };
    }
    return best;
  };
  return rows.map((j) => {
    const mine = me && j.shipperCompanyId === me.id ? "shipper" : me && j.carrierCompanyId === me.id ? "carrier" : null;
    const party = !!me && (j.shipperCompanyId === me.id || j.consigneeCompanyId === me.id || j.carrierCompanyId === me.id);
    let est: string | null = null;
    if (me && j.status === "open" && j.shipperCompanyId !== me.id) {
      const cand = myVehicles.filter((v) => v.cityId === j.originCityId && catalog.vehicleModel(v.modelId).capacityKg >= j.totalKg);
      if (cand.length) {
        const best = cand
          .map((v) => {
            const md = catalog.vehicleModel(v.modelId);
            return estimateOwnTrip(j.distanceKm, { capacityKg: md.capacityKg, speedKmh: md.speedKmh, fuelPerKm: BigInt(md.fuelPerKm) }, BigInt(catalog.city(j.originCityId).wage), {
              speedBonusBp: bonus.speedBp, fuelSavingBp: bonus.fuelBp, loadingHours: catalog.settings.freight.driverHoursPerTrip,
            }).total;
          })
          .reduce((a, b) => (b < a ? b : a));
        est = m(best);
      }
    }
    const mine2 = me && j.status === "open" && j.shipperCompanyId !== me.id ? bestForMe(j) : null;
    return {
      id: j.id, status: j.status, isSystem: j.isSystem,
      // açık oyuncu ilanında ilan sahibi taraf olmayanlara görünmez (sistem işleri adıyla kalır)
      shipperCompanyId: party || j.isSystem ? j.shipperCompanyId : "", shipperName: party || j.isSystem ? names.get(j.shipperCompanyId)?.name ?? "?" : "",
      consigneeName: party ? names.get(j.consigneeCompanyId)?.name ?? "?" : "", originCityId: j.originCityId, destCityId: j.destCityId, distanceKm: j.distanceKm,
      // yük içeriği yalnızca taraflara açık; panoda yalnızca toplam kg görünür
      cargo: party ? j.cargo : [], totalKg: j.totalKg, payAmount: m(j.payAmount), deadlineAt: j.deadlineAt.toISOString(), createdAt: j.createdAt.toISOString(),
      carrierCompanyId: j.carrierCompanyId, carrierName: j.carrierCompanyId ? names.get(j.carrierCompanyId)?.name ?? null : null, shipmentId: party ? j.shipmentId : null,
      installmentId: party ? j.installmentId : null, allowSystemCarrier: j.allowSystemCarrier, mine, estCostForMe: est,
      estMinutesForMe: mine2?.minutes ?? null, netPerHourForMe: mine2 ? m(mine2.netPerHour) : null, bestVehicleIdForMe: mine2?.vehicleId ?? null,
    };
  });
}

export const mineJobsWhere = (companyId: string) => or(eq(freightJobs.shipperCompanyId, companyId), eq(freightJobs.carrierCompanyId, companyId));
