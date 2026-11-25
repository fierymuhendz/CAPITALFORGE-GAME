/** GET /company: şirket görünümü (tesisler, araçlar, araştırma, 7 günlük sonuç, sıradaki adımlar). */
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { CompanyDto, VehicleDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { Db } from "../db/client";
import { holdings, loans, productionJobs, research, sales, shipments, vehicles } from "../db/schema";
import { loadFacilities } from "../facilities/dto";
import { pnl } from "../finance/report";
import { companySummary, type CompanyRow } from "./summary";

const count = async (q: PromiseLike<Array<{ n: number }>>): Promise<number> => (await q)[0]?.n ?? 0;

export async function companyView(db: Db, catalog: Catalog, c: CompanyRow, now: Date): Promise<CompanyDto> {
  const summary = await companySummary(db, c, catalog.settings.levelXp);
  const facilities = await loadFacilities(db, catalog, c.id, now);
  const vs = await db.select().from(vehicles).where(and(eq(vehicles.companyId, c.id), ne(vehicles.status, "sold"))).orderBy(vehicles.purchasedAt, vehicles.id);
  const shipIds = vs.map((v) => v.currentShipmentId).filter((x): x is string => !!x);
  const ships = shipIds.length ? await db.select().from(shipments).where(inArray(shipments.id, shipIds)) : [];
  const vehicleDtos: VehicleDto[] = vs.map((v) => {
    const sh = ships.find((s) => s.id === v.currentShipmentId && s.status === "in_transit") ?? null;
    return {
      id: v.id, modelId: v.modelId, cityId: sh ? null : v.cityId, status: sh ? "in_transit" : "idle", shipmentId: sh?.id ?? null,
      arrivesAt: sh?.arrivesAt.toISOString() ?? null, destCityId: sh?.destCityId ?? null, garageFacilityId: v.garageFacilityId,
    };
  });
  const rs = await db.select().from(research).where(eq(research.companyId, c.id));
  const researchOut = [...catalog.research.values()].map((d) => {
    const r = rs.find((x) => x.researchId === d.id);
    return { researchId: d.id, level: r?.level ?? 0, inProgress: r?.targetLevel && r.endsAt ? { targetLevel: r.targetLevel, endsAt: r.endsAt.toISOString() } : null };
  });
  const p = await pnl(db, c.id, now, 7);

  // Sıradaki adımlar
  const steps: CompanyDto["nextSteps"] = [];
  const arrears = BigInt(summary.arrears);
  if (arrears > 0n) steps.push({ key: "pay_arrears", params: { amount: summary.arrears } });
  for (const f of facilities) if (f.status === "stalled") steps.push({ key: "fix_stalled", params: { facility: f.type, reason: f.stalledReason?.code ?? "" } });
  const producers = facilities.filter((f) => f.lines > 0 && f.status !== "constructing");
  const jobs = await count(db.select({ n: sql<number>`count(*)::int` }).from(productionJobs).where(eq(productionJobs.companyId, c.id)));
  const stock = await count(db.select({ n: sql<number>`count(*)::int` }).from(holdings).where(and(eq(holdings.companyId, c.id), gt(holdings.qtyKg, 0))));
  const running = facilities.reduce((a, f) => a + f.jobs.filter((j) => j.status === "running").length, 0);
  if (jobs === 0 && producers[0]) steps.push({ key: "first_job", params: { facility: producers[0].type, recipe: producers[0].recipes[0] ?? "" } });
  if (jobs > 0 && stock > 0) {
    const sold = await count(db.select({ n: sql<number>`count(*)::int` }).from(sales).where(eq(sales.sellerCompanyId, c.id)));
    if (sold === 0) steps.push({ key: "first_sale" });
  }
  if (jobs > 0 && stock === 0 && running === 0 && producers.length > 0) steps.push({ key: "empty_warehouse" });
  if (c.sector === "freight") {
    const ships = await count(db.select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.carrierCompanyId, c.id)));
    if (ships === 0) steps.push({ key: "first_freight" });
  }
  const activeLoans = await count(db.select({ n: sql<number>`count(*)::int` }).from(loans).where(and(eq(loans.companyId, c.id), eq(loans.status, "active"))));
  if (BigInt(summary.cash) < BigInt(catalog.settings.startingCash) / 10n && activeLoans === 0) steps.push({ key: "take_loan" });
  const up = facilities.find((f) => f.status !== "constructing" && f.status !== "upgrading" && !f.upgrade && f.level < c.level && catalog.buildingType(f.type).levels.some((l) => l.level === f.level + 1));
  if (up) steps.push({ key: "upgrade_facility", params: { facility: up.type, level: up.level + 1 } });
  if (c.level >= 2 && rs.every((r) => r.level === 0 && !r.targetLevel)) steps.push({ key: "start_research" });

  return {
    ...summary,
    createdAt: c.createdAt.toISOString(),
    facilities,
    vehicles: vehicleDtos,
    research: researchOut,
    stats: { revenue7d: p.revenue, profit7d: p.netProfit, onTimeDeliveries: c.onTimeDeliveries, lateOrMissed: c.lateOrMissed },
    nextSteps: steps.slice(0, 5),
  };
}

