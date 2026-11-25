/** Filo: araç satın alma (garaj kapasitesi, model seviyesi), araç DTO'su, kendi aracıyla sevkiyat, tahmin. */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { estimateOwnTrip, systemCarrierQuote } from "@capitalforge/economy";
import {
  VEHICLES_WITHOUT_GARAGE, roadDistanceKm,
  type BuyVehicleReq, type FreightQuoteDto, type ShipmentDto, type ShipmentReq, type VehicleDto,
} from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx, Tx } from "../db/client";
import { facilities, shipmentCargo, shipments, vehicles } from "../db/schema";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { removeStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { m } from "../lib/serialize";
import { companyBriefs, lockCompanyRow, researchBonuses, type CompanyRow } from "../market/common";
import { lockVehicle, mergeLines, startShipment, validateLink, type CargoIn, type VehicleRow } from "./shipping";


export async function buyVehicle(tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof BuyVehicleReq>, now: Date): Promise<VehicleRow> {
  const model = catalog.vehicleModel(req.modelId);
  catalog.city(req.cityId);
  if (company.level < model.minCompanyLevel) fail("LEVEL_TOO_LOW", { required: model.minCompanyLevel });
  await lockCompanyRow(tx, company.id); // filo sayacı: eşzamanlı alımlar garaj sınırını aşamaz
  const garages = await tx
    .select()
    .from(facilities)
    .where(and(eq(facilities.companyId, company.id), eq(facilities.cityId, req.cityId), eq(facilities.type, "garage"), eq(facilities.state, "ready")))
    .orderBy(facilities.id)
    .for("update");
  const bt = catalog.buildingType("garage");
  const counts = await tx
    .select({ g: vehicles.garageFacilityId, n: sql<number>`count(*)::int` })
    .from(vehicles)
    .where(and(eq(vehicles.companyId, company.id), ne(vehicles.status, "sold")))
    .groupBy(vehicles.garageFacilityId);
  const used = (gid: string | null) => counts.find((c) => c.g === gid)?.n ?? 0;
  let garageId: string | null = null;
  if (garages.length) {
    let levelBlocked = false;
    for (const g of garages) {
      if (g.level < model.minGarageLevel) { levelBlocked = true; continue; }
      const slots = bt.vehicleSlots?.[g.level - 1] ?? 0;
      if (used(g.id) < slots) { garageId = g.id; break; }
    }
    if (!garageId) fail(levelBlocked ? "LEVEL_TOO_LOW" : "GARAGE_FULL");
  } else {
    if (model.id !== "van" || used(null) >= VEHICLES_WITHOUT_GARAGE) fail("GARAGE_FULL");
  }
  const [v] = await tx
    .insert(vehicles)
    .values({ companyId: company.id, modelId: model.id, cityId: req.cityId, status: "idle", garageFacilityId: garageId, purchasedAt: now })
    .returning();
  const price = BigInt(model.price);
  await post(tx, {
    kind: "vehicle_purchase", idempotencyKey: `vehicle-buy:${v!.id}`, refType: "vehicle", refId: v!.id, at: now, memo: `Araç ${model.id}`,
    lines: [{ account: co(company.id, "fixed_assets"), amount: price }, { account: co(company.id, "cash"), amount: -price }],
  });
  uow.invalidate(company.id, "company", "finance", "map", "shipments");
  uow.world("map");
  return v!;
}

export async function vehicleDtos(db: DbOrTx, rows: VehicleRow[]): Promise<VehicleDto[]> {
  const ids = rows.map((r) => r.currentShipmentId).filter((x): x is string => !!x);
  const ships = ids.length ? await db.select().from(shipments).where(inArray(shipments.id, ids)) : [];
  return rows.map((v) => {
    const s = ships.find((x) => x.id === v.currentShipmentId);
    return {
      id: v.id, modelId: v.modelId, cityId: v.cityId, status: v.status === "in_transit" ? "in_transit" : "idle",
      shipmentId: v.currentShipmentId, arrivesAt: s?.arrivesAt.toISOString() ?? null, destCityId: s?.destCityId ?? null, garageFacilityId: v.garageFacilityId,
    };
  });
}

/** Kendi aracıyla sevkiyat; yük boşsa konum değiştirme */
export async function ownShipment(tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof ShipmentReq>, now: Date) {
  const v = await lockVehicle(tx, req.vehicleId);
  if (v.companyId !== company.id || v.status === "sold") fail("NOT_FOUND");
  if (v.status !== "idle" || !v.cityId) fail("VEHICLE_BUSY");
  catalog.city(req.destCityId);
  if (v.cityId === req.destCityId) fail("SAME_CITY");
  const lines = mergeLines(req.cargo);
  const total = lines.reduce((a, l) => a + l.qtyKg, 0);
  if (total > catalog.vehicleModel(v.modelId).capacityKg) fail("VEHICLE_CAPACITY");
  let consignee = company.id;
  if (req.contractInstallmentId) {
    if (!lines.length) fail("BAD_REQUEST", { issue: "cargo" });
    const { contract } = await validateLink(tx, company, req.contractInstallmentId, lines, req.destCityId, now);
    consignee = contract.buyerCompanyId!;
  }
  const cargo: CargoIn[] = [];
  for (const l of lines) {
    const cost = await removeStock(tx, { companyId: company.id, cityId: v.cityId, productId: l.productId, quality: l.quality }, l.qtyKg, { kind: "shipment_load", refType: "vehicle", refId: v.id, at: now });
    cargo.push({ ownerCompanyId: company.id, consigneeCompanyId: consignee, productId: l.productId, quality: l.quality, qtyKg: l.qtyKg, costBasis: cost, installmentId: req.contractInstallmentId ?? null });
  }
  const { shipment } = await startShipment(tx, uow, catalog, {
    vehicle: v, carrierId: company.id, destCityId: req.destCityId, cargo, purpose: cargo.length ? "own" : "reposition", freightJobId: null, now,
  });
  return shipment;
}

export async function shipmentDto(db: DbOrTx, s: typeof shipments.$inferSelect, viewerId: string | null): Promise<ShipmentDto> {
  const cargo = await db.select().from(shipmentCargo).where(eq(shipmentCargo.shipmentId, s.id));
  const names = await companyBriefs(db, [s.carrierCompanyId]);
  const involved = viewerId !== null && (s.carrierCompanyId === viewerId || cargo.some((c) => c.ownerCompanyId === viewerId || c.consigneeCompanyId === viewerId));
  return {
    id: s.id, vehicleId: s.vehicleId, modelId: s.modelId, carrierCompanyId: s.carrierCompanyId, carrierName: names.get(s.carrierCompanyId)?.name ?? "?",
    originCityId: s.originCityId, destCityId: s.destCityId, distanceKm: s.distanceKm, departedAt: s.departedAt.toISOString(), arrivesAt: s.arrivesAt.toISOString(),
    deliveredAt: s.deliveredAt?.toISOString() ?? null, status: s.status, purpose: s.purpose, freightJobId: s.freightJobId,
    cargo: involved ? cargo.map((c) => ({ productId: c.productId, quality: c.quality, qtyKg: c.qtyKg, ownerCompanyId: c.ownerCompanyId, consigneeCompanyId: c.consigneeCompanyId, installmentId: c.installmentId })) : [],
    cost: viewerId === s.carrierCompanyId ? { fuel: m(s.fuelCost), driver: m(s.driverCost), total: m(s.fuelCost + s.driverCost) } : null,
    proof: involved ? ((s.proof as ShipmentDto["proof"]) ?? null) : null,
  };
}

/** GET /freight/quote */
export async function freightQuote(
  db: DbOrTx, catalog: Catalog, companyId: string | null, q: { originCityId: string; destCityId: string; kg: number; modelId?: string }, now: Date,
): Promise<FreightQuoteDto> {
  catalog.city(q.originCityId);
  catalog.city(q.destCityId);
  if (q.originCityId === q.destCityId) fail("SAME_CITY");
  const km = roadDistanceKm(q.originCityId, q.destCityId);
  const s = catalog.settings.freight;
  const bonus = companyId ? await researchBonuses(db, catalog, companyId) : { speedBp: 0, fuelBp: 0 };
  const mine = companyId
    ? await db.select().from(vehicles).where(and(eq(vehicles.companyId, companyId), eq(vehicles.status, "idle"), eq(vehicles.cityId, q.originCityId)))
    : [];
  const models = [...catalog.vehicleModels.values()].filter((md) => !q.modelId || md.id === q.modelId);
  return {
    originCityId: q.originCityId, destCityId: q.destCityId, kg: q.kg, distanceKm: km,
    systemQuote: m(systemCarrierQuote(km, q.kg, s.systemBaseFee, s.systemPerKm)),
    own: models.map((md) => {
      const loads = Math.max(1, Math.ceil(q.kg / md.capacityKg));
      const t = estimateOwnTrip(km, { capacityKg: md.capacityKg, speedKmh: md.speedKmh, fuelPerKm: BigInt(md.fuelPerKm) }, BigInt(catalog.city(q.originCityId).wage), {
        speedBonusBp: bonus.speedBp, fuelSavingBp: bonus.fuelBp, loadingHours: s.driverHoursPerTrip,
      });
      const veh = mine.find((x) => x.modelId === md.id);
      return {
        modelId: md.id, capacityKg: md.capacityKg, loadsNeeded: loads, minutes: t.minutes, fuel: m(t.fuel * BigInt(loads)), driver: m(t.driver * BigInt(loads)),
        total: m(t.total * BigInt(loads)), arrivesAt: new Date(now.getTime() + t.minutes * 60_000).toISOString(), vehicleId: veh && q.kg <= md.capacityKg ? veh.id : null,
      };
    }),
  };
}

