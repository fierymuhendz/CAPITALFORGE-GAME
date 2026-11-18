import { type FacilityType, upkeep } from "@capitalforge/economy";
import type { CompanyView, FacilityTypeId, RecipeIdString } from "@capitalforge/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, facilities, gameClock, productionJobs } from "../db/schema";
import { reliefAvailable } from "../relief/claim";

/** Oyuncunun şirket görünümü (yalnızca kendisine). Sunucu saati dahil: ilerleme istemci saatine bağlı değildir. */
export async function getCompanyView(db: Db, playerId: string): Promise<CompanyView> {
  const [clock] = await db.select({ tick: gameClock.tick }).from(gameClock).where(eq(gameClock.id, 1));
  const clockTick = Number(clock?.tick ?? 0n);
  const reliefOk = await reliefAvailable(db, playerId);

  const [company] = await db.select().from(companies).where(eq(companies.playerId, playerId));
  if (!company) return { company: null, facilities: [], jobs: [], clockTick, reliefAvailable: reliefOk };

  const facs = await db
    .select()
    .from(facilities)
    .where(eq(facilities.companyId, company.id))
    .orderBy(asc(facilities.createdAt), asc(facilities.id));
  const jobs = await db
    .select()
    .from(productionJobs)
    .where(and(eq(productionJobs.playerId, playerId), eq(productionJobs.status, "running")))
    .orderBy(asc(productionJobs.completesAtTick));

  return {
    company: { id: company.id, name: company.name, cityId: company.cityId, foundedAt: company.foundedAt.toISOString() },
    facilities: facs.map((f) => ({
      id: f.id,
      type: f.type as FacilityTypeId,
      level: f.level,
      cityId: f.cityId,
      plotX: f.plotX,
      plotY: f.plotY,
      status: f.status,
      purchasePrice: f.purchasePrice.toString(),
      upkeep: upkeep(f.type as FacilityType, BigInt(f.level), BigInt(facs.length)).toString(),
    })),
    jobs: jobs.map((j) => ({
        id: j.id,
        facilityId: j.facilityId,
        recipeId: j.recipeId as RecipeIdString,
        batches: j.batches,
        startedTick: Number(j.startedTick),
        completesAtTick: Number(j.completesAtTick),
        outputProductId: j.outputProductId,
        outputQty: j.outputQty.toString(),
    })),
    clockTick,
    reliefAvailable: reliefOk,
  };
}
