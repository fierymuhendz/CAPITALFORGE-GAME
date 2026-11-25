import type { CostBreakdownDto, ProductionJobDto } from "@capitalforge/shared";
import type { productionJobs } from "../db/schema";

export type JobRow = typeof productionJobs.$inferSelect;

export function jobDto(j: JobRow): ProductionJobDto {
  return {
    id: j.id, facilityId: j.facilityId, recipeId: j.recipeId, batches: j.batches, repeat: j.repeat, status: j.status,
    startedAt: j.startedAt.toISOString(), endsAt: j.endsAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null,
    output: { productId: j.outputProductId, qtyKg: j.outputKg, quality: j.outputQuality },
    cost: j.costBreakdown as CostBreakdownDto,
  };
}
