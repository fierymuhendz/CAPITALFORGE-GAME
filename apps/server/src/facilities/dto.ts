import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { FacilityDto, FacilityMapDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx } from "../db/client";
import { facilities, productionJobs } from "../db/schema";
import { m } from "../lib/serialize";
import { jobDto, type JobRow } from "../production/dto";

export type FacilityRow = typeof facilities.$inferSelect;

export function facilityStatus(f: FacilityRow, running: number, now: Date): FacilityMapDto["status"] {
  if (f.state === "constructing" && f.constructionEndsAt && f.constructionEndsAt > now) return "constructing";
  if (f.state === "constructing") return "constructing";
  if (f.upgradeEndsAt && f.upgradeEndsAt > now) return "upgrading";
  if (running > 0) return "working";
  return f.stalledReason ? "stalled" : "idle";
}

export function facilityDto(catalog: Catalog, f: FacilityRow, jobs: JobRow[], now: Date): FacilityDto {
  const ld = catalog.levelDef(f.type, f.level);
  const running = jobs.filter((j) => j.status === "running").length;
  return {
    id: f.id, plotId: f.plotId, cityId: f.cityId, type: f.type, level: f.level, qualityLevel: f.qualityLevel,
    status: facilityStatus(f, running, now),
    lines: ld.lines, maxBatches: ld.maxBatches, upkeepPerDay: m(ld.upkeepPerDay),
    constructionEndsAt: f.state === "constructing" ? f.constructionEndsAt?.toISOString() ?? null : null,
    upgrade: f.upgradeKind && f.upgradeTarget && f.upgradeEndsAt ? { kind: f.upgradeKind, target: f.upgradeTarget, endsAt: f.upgradeEndsAt.toISOString() } : null,
    jobs: jobs.map(jobDto),
    stalledReason: f.stalledReason ? { code: f.stalledReason.code, ...(f.stalledReason.productId ? { productId: f.stalledReason.productId } : {}) } : null,
    recipes: catalog.recipesFor(f.type).map((r) => r.id),
  };
}

/** Şirketin (yıkılmamış) tesisleri, çalışan işler + son tamamlananlarla */
export async function loadFacilities(db: DbOrTx, catalog: Catalog, companyId: string, now: Date, onlyId?: string): Promise<FacilityDto[]> {
  const fs = await db
    .select()
    .from(facilities)
    .where(and(eq(facilities.companyId, companyId), ne(facilities.state, "demolished"), onlyId ? eq(facilities.id, onlyId) : undefined))
    .orderBy(facilities.createdAt, facilities.id);
  if (fs.length === 0) return [];
  const ids = fs.map((f) => f.id);
  const running = await db.select().from(productionJobs).where(and(inArray(productionJobs.facilityId, ids), eq(productionJobs.status, "running")));
  const recent = await db
    .select()
    .from(productionJobs)
    .where(and(inArray(productionJobs.facilityId, ids), eq(productionJobs.status, "completed")))
    .orderBy(desc(productionJobs.completedAt))
    .limit(30);
  return fs.map((f) => {
    const mine = running.filter((j) => j.facilityId === f.id);
    const done = recent.filter((j) => j.facilityId === f.id).slice(0, 3);
    return facilityDto(catalog, f, [...mine, ...done], now);
  });
}
