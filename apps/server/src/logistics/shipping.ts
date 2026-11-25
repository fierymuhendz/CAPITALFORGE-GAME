/**
 * Sevkiyat çekirdeği: kalkış (kendi aracı, taşıma işi, konum değiştirme), varış görevi, teslim kanıtı.
 * Varışta navlun kuralı: sözleşme teslimine düşen pay `exp_freight`, transfer payı yükün maliyetine eklenir.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { allocate, applyBp, estimateOwnTrip, mulDiv } from "@capitalforge/economy";
import { roadDistanceKm } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import { minutesToMs, paceTrip } from "../catalog/pace";
import type { Tx } from "../db/client";
import { contractInstallments, freightJobs, sales, shipmentCargo, shipments, vehicles } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { UnitOfWork } from "../events/bus";
import { addXp } from "../company/found";
import { sameGroup } from "../fairplay/anomaly";
import { addStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { afterCashIn, companyBriefs, linkMovements, researchBonuses, type CompanyRow } from "../market/common";
import { applyContractDelivery, lockContract, lockInstallment, termsOf, type ContractRow, type InstRow } from "../contracts/contracts";

export type VehicleRow = typeof vehicles.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;

export interface CargoIn {
  ownerCompanyId: string; consigneeCompanyId: string; productId: string; quality: number; qtyKg: number;
  costBasis: bigint; installmentId: string | null;
}

export function mergeLines<T extends { productId: string; quality: number; qtyKg: number }>(lines: T[]): T[] {
  const out = new Map<string, T>();
  for (const l of lines) {
    const k = `${l.productId}|${l.quality}`;
    const cur = out.get(k);
    if (cur) cur.qtyKg += l.qtyKg;
    else out.set(k, { ...l });
  }
  return [...out.values()].sort((a, b) => `${a.productId}|${a.quality}`.localeCompare(`${b.productId}|${b.quality}`));
}

export async function lockVehicle(tx: Tx, id: string): Promise<VehicleRow> {
  const v = (await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update"))[0];
  if (!v) fail("NOT_FOUND");
  return v;
}

/** Sözleşme taksitine bağlı yük doğrulaması (satıcı = yük sahibi, navlun satıcıda, varış = teslim şehri) */
export async function validateLink(
  tx: Tx, company: CompanyRow, installmentId: string, lines: Array<{ productId: string; quality: number; qtyKg: number }>, destCityId: string, now: Date,
): Promise<{ contract: ContractRow; inst: InstRow }> {
  const probe = (await tx.select({ contractId: contractInstallments.contractId }).from(contractInstallments).where(eq(contractInstallments.id, installmentId)))[0];
  if (!probe) fail("NOT_FOUND");
  const contract = await lockContract(tx, probe.contractId);
  if (contract.sellerCompanyId !== company.id) fail("NOT_PARTY");
  if (contract.status !== "active") fail("CONTRACT_NOT_ACTIVE");
  const inst = await lockInstallment(tx, installmentId);
  if (inst.settledAt || now.getTime() < inst.windowOpensAt.getTime() || now.getTime() >= inst.graceEndsAt.getTime()) fail("INSTALLMENT_NOT_OPEN");
  const t = termsOf(contract);
  if (t.freightPayer !== "seller") fail("BAD_REQUEST", { issue: "freightPayer" });
  if (destCityId !== t.deliveryCityId) fail("BAD_REQUEST", { issue: "destCityId" });
  let total = 0;
  for (const l of lines) {
    if (l.productId !== t.productId) fail("BAD_REQUEST", { issue: "productId" });
    if (l.quality < t.minQuality) fail("QUALITY_TOO_LOW", { minQuality: t.minQuality });
    total += l.qtyKg;
  }
  if (total > inst.qtyDueKg - inst.qtyDeliveredKg) fail("BAD_REQUEST", { issue: "qtyKg" });
  return { contract, inst };
}

export interface StartArgs {
  vehicle: VehicleRow;
  carrierId: string;
  destCityId: string;
  cargo: CargoIn[];
  purpose: "own" | "freight_job" | "reposition";
  freightJobId: string | null;
  /** taşıma işi ücreti (satırlara paylaştırılır) */
  jobPay?: bigint;
  now: Date;
}

/** Aracı yola çıkarır: sevkiyat satırı, yük satırları, yakıt + sürücü gideri. Yük stoğu çağıran tarafından düşülmüştür. */
export async function startShipment(tx: Tx, uow: UnitOfWork, catalog: Catalog, a: StartArgs): Promise<{ shipment: ShipmentRow; tripTotal: bigint }> {
  const model = catalog.vehicleModel(a.vehicle.modelId);
  const origin = a.vehicle.cityId!;
  const km = roadDistanceKm(origin, a.destCityId);
  const bonus = await researchBonuses(tx, catalog, a.carrierId);
  const trip = estimateOwnTrip(km, { capacityKg: model.capacityKg, speedKmh: model.speedKmh, fuelPerKm: BigInt(model.fuelPerKm) }, BigInt(catalog.city(origin).wage), {
    speedBonusBp: bonus.speedBp, fuelSavingBp: bonus.fuelBp, loadingHours: catalog.settings.freight.driverHoursPerTrip,
    handlingMinutes: catalog.settings.freight.handlingMinutes ?? 0,
  });
  const id = randomUUID();
  const tripMinutes = paceTrip(catalog, trip.minutes);
  const arrivesAt = new Date(a.now.getTime() + minutesToMs(tripMinutes));
  const own = a.purpose === "own";
  const led = await post(tx, {
    kind: "shipment_depart", idempotencyKey: `ship-depart:${id}`, refType: "shipment", refId: id, at: a.now,
    memo: `Sevkiyat ${origin} → ${a.destCityId}`,
    lines: [{ account: co(a.carrierId, own ? "prepaid_freight" : "exp_fleet"), amount: trip.total }, { account: co(a.carrierId, "cash"), amount: -trip.total }],
  });
  const [shipment] = await tx
    .insert(shipments)
    .values({
      id, vehicleId: a.vehicle.id, modelId: a.vehicle.modelId, carrierCompanyId: a.carrierId, purpose: a.purpose, freightJobId: a.freightJobId,
      originCityId: origin, destCityId: a.destCityId, distanceKm: km, capacityKg: model.capacityKg, departedAt: a.now, arrivesAt,
      fuelCost: trip.fuel, driverCost: trip.driver, departTransactionId: led.id,
    })
    .returning();
  if (a.cargo.length) {
    const shares = allocate(a.jobPay ?? trip.total, a.cargo.map((c) => c.qtyKg));
    await tx.insert(shipmentCargo).values(
      a.cargo.map((c, i) => ({
        shipmentId: id, ownerCompanyId: c.ownerCompanyId, consigneeCompanyId: c.consigneeCompanyId, productId: c.productId,
        quality: c.quality, qtyKg: c.qtyKg, costBasis: c.costBasis, freightAllocated: shares[i]!, installmentId: c.installmentId,
      })),
    );
  }
  await tx.update(vehicles).set({ status: "in_transit", cityId: null, currentShipmentId: id }).where(eq(vehicles.id, a.vehicle.id));
  uow.invalidate(a.carrierId, "shipments", "finance", "company", "map", "inventory");
  uow.world("map");
  return { shipment: shipment!, tripTotal: trip.total };
}

/** Vadesi gelen sevkiyatları yerleştirir (görev) */
export async function processArrivals(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(eq(shipments.status, "in_transit"), lte(shipments.arrivesAt, now)))
    .orderBy(shipments.arrivesAt)
    .limit(200);
  let n = 0;
  for (const d of due) if (await arriveShipment(deps, d.id, now)) n++;
  return n;
}

export async function arriveShipment(deps: Deps, shipmentId: string, now: Date): Promise<boolean> {
  const uow = new UnitOfWork();
  const cat = deps.catalog;
  const ok = await deps.db.transaction(async (tx) => {
    const sh = (
      await tx.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.status, "in_transit"), lte(shipments.arrivesAt, now))).for("update", { skipLocked: true })
    )[0];
    if (!sh) return false;
    const at = sh.arrivesAt;
    const lines = await tx.select().from(shipmentCargo).where(eq(shipmentCargo.shipmentId, sh.id)).orderBy(shipmentCargo.installmentId, shipmentCargo.id);
    const job = sh.freightJobId ? (await tx.select().from(freightJobs).where(eq(freightJobs.id, sh.freightJobId)).for("update"))[0] ?? null : null;

    let expTotal = 0n;
    let capTotal = 0n;
    let shareTotal = 0n;
    const delivered: Array<{ productId: string; qtyKg: number; to: string }> = [];
    for (const l of lines) {
      let deliverQty = 0;
      let contract: ContractRow | null = null;
      if (l.installmentId) {
        const probe = (await tx.select({ contractId: contractInstallments.contractId }).from(contractInstallments).where(eq(contractInstallments.id, l.installmentId)))[0];
        if (probe) {
          contract = await lockContract(tx, probe.contractId);
          const inst = await lockInstallment(tx, l.installmentId);
          if (contract.status === "active" && !inst.settledAt && at.getTime() < inst.graceEndsAt.getTime() && l.quality >= termsOf(contract).minQuality) {
            deliverQty = Math.min(l.qtyKg, inst.qtyDueKg - inst.qtyDeliveredKg);
          }
        }
      }
      const share = l.freightAllocated;
      const fd = deliverQty > 0 ? mulDiv(share, BigInt(deliverQty), BigInt(l.qtyKg)) : 0n;
      const cd = deliverQty === 0 ? 0n : deliverQty === l.qtyKg ? l.costBasis : mulDiv(l.costBasis, BigInt(deliverQty), BigInt(l.qtyKg));
      if (deliverQty > 0 && contract) {
        await applyContractDelivery(tx, uow, cat, {
          contractId: contract.id, installmentId: l.installmentId!, qtyKg: deliverQty, quality: l.quality, at,
          source: { kind: "cargo", costBasis: cd, shipmentId: sh.id }, freight: fd,
        });
        delivered.push({ productId: l.productId, qtyKg: deliverQty, to: contract.buyerCompanyId! });
      }
      const rest = l.qtyKg - deliverQty;
      if (rest > 0) {
        // transfer (veya sözleşmeye işlenemeyen artan yük): sahibin varış deposuna, navlun payı maliyete eklenir
        const restFreight = share - fd;
        const to = l.installmentId ? l.ownerCompanyId : l.consigneeCompanyId;
        await addStock(tx, { companyId: to, cityId: sh.destCityId, productId: l.productId, quality: l.quality }, rest, l.costBasis - cd + restFreight, {
          kind: "shipment_arrival", refType: "shipment", refId: sh.id, at,
        });
        capTotal += restFreight;
        delivered.push({ productId: l.productId, qtyKg: rest, to });
      }
      expTotal += fd;
      shareTotal += share;
    }

    // Navlun yerleşimi: tek işlem
    let arriveTx: string | null = null;
    if (lines.length && shareTotal > 0n) {
      const payerId = lines[0]!.ownerCompanyId;
      const ledLines = [
        { account: co(payerId, job ? "escrow" : "prepaid_freight"), amount: -shareTotal },
        { account: co(payerId, "exp_freight"), amount: expTotal },
        { account: co(payerId, "inventory"), amount: capTotal },
      ];
      if (job) {
        // piyasa komisyonu navlun ilanı ücretinden de alınır (taşıyıcı öder)
        const jobFee = applyBp(job.payAmount, cat.settings.marketFeeBp);
        ledLines.push(
          { account: co(sh.carrierCompanyId, "cash"), amount: job.payAmount - jobFee }, { account: co(sh.carrierCompanyId, "exp_fees"), amount: jobFee },
          { account: co(sh.carrierCompanyId, "revenue_freight"), amount: -job.payAmount },
        );
      }
      const led = await post(tx, { kind: "shipment_arrive", idempotencyKey: `ship-arrive:${sh.id}`, refType: "shipment", refId: sh.id, at, memo: "Navlun yerleşimi", lines: ledLines });
      arriveTx = led.id;
      await linkMovements(tx, "shipment", sh.id, led.id);
      await tx.update(sales).set({ transactionIds: sql`array_append(${sales.transactionIds}, ${led.id}::uuid)` }).where(eq(sales.shipmentId, sh.id));
    }

    // Teslim kanıtı
    const names = await companyBriefs(tx, delivered.map((d) => d.to));
    const receivedBy = [...new Set(delivered.map((d) => names.get(d.to)?.name ?? "?"))].join(", ");
    const agg = new Map<string, number>();
    for (const d of delivered) agg.set(d.productId, (agg.get(d.productId) ?? 0) + d.qtyKg);
    const proofLines = [...agg.entries()].map(([productId, qtyKg]) => ({ productId, qtyKg }));
    const hash = createHash("sha256").update(JSON.stringify({ id: sh.id, at: at.toISOString(), receivedBy, lines: proofLines })).digest("hex");
    await tx
      .update(shipments)
      .set({ status: "delivered", deliveredAt: at, arriveTransactionId: arriveTx, proof: { deliveredAt: at.toISOString(), receivedBy, lines: proofLines, hash } })
      .where(eq(shipments.id, sh.id));
    await tx.update(vehicles).set({ status: "idle", cityId: sh.destCityId, currentShipmentId: null }).where(eq(vehicles.id, sh.vehicleId));

    if (job) {
      await tx.update(freightJobs).set({ status: "delivered", closedAt: at }).where(eq(freightJobs.id, job.id));
      if (job.payAmount >= BigInt(cat.settings.xp.minJobValue) && !(await sameGroup(tx, job.shipperCompanyId, sh.carrierCompanyId))) {
        await addXp(tx, sh.carrierCompanyId, cat.settings.xp.freightJob, cat.settings.levelXp);
      }
      await notify(tx, uow, sh.carrierCompanyId, "freight_delivered", { jobId: job.id, pay: job.payAmount.toString(), cityId: sh.destCityId, role: "carrier" }, now, "/play?tab=freight");
      await notify(tx, uow, job.shipperCompanyId, "freight_delivered", { jobId: job.id, pay: job.payAmount.toString(), cityId: sh.destCityId, role: "shipper" }, now, "/play?tab=freight");
      await afterCashIn(tx, uow, sh.carrierCompanyId, now);
    }
    const arrivedFor = new Set(lines.flatMap((l) => [l.ownerCompanyId, l.consigneeCompanyId]));
    for (const cid of arrivedFor) {
      await notify(tx, uow, cid, "shipment_arrived", { shipmentId: sh.id, cityId: sh.destCityId }, now, "/play?tab=shipments");
      uow.invalidate(cid, "shipments", "inventory", "finance", "contracts", "freight", "company");
    }
    uow.invalidate(sh.carrierCompanyId, "shipments", "freight", "finance", "map", "company");
    uow.world("map");
    return true;
  });
  if (ok) uow.flush(deps.events);
  return ok;
}

