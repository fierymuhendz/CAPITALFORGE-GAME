import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { FacilityActionReq, ProductionQuoteReq, ProductionStartReq, uuid } from "@capitalforge/shared";
import { productionJobs } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { jobDto } from "./dto";
import { quote } from "./quote";
import { startProduction } from "./start";

export function registerProductionRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "POST", url: "/production/quote", auth: "company", body: ProductionQuoteReq,
    handler: async ({ company, body, now }) => quote(deps.db, deps.catalog, company!.id, body, now),
  });
  route(app, deps, {
    method: "POST", url: "/production/start", auth: "company", kind: "mutation", body: ProductionStartReq,
    handler: async ({ tx, uow, company, body, now }) => {
      const job = await startProduction(tx, uow, deps.catalog, {
        companyId: company!.id, facilityId: body.facilityId, recipeId: body.recipeId, batches: body.batches, repeat: body.repeat, now,
      });
      return jobDto(job);
    },
  });
  route(app, deps, {
    method: "POST", url: "/production/:id/stop-repeat", auth: "company", kind: "mutation", body: FacilityActionReq,
    handler: async ({ tx, uow, company, params }) => {
      if (!uuid.safeParse(params.id).success) fail("NOT_FOUND");
      const [job] = await tx
        .update(productionJobs)
        .set({ repeat: false })
        .where(and(eq(productionJobs.id, params.id!), eq(productionJobs.companyId, company!.id)))
        .returning();
      if (!job) fail("NOT_FOUND");
      // Tekrar zinciri: iş bu arada bitip yerine halef başladıysa halef de durdurulur
      await tx
        .update(productionJobs)
        .set({ repeat: false })
        .where(and(eq(productionJobs.facilityId, job.facilityId), eq(productionJobs.recipeId, job.recipeId), eq(productionJobs.status, "running"), eq(productionJobs.companyId, company!.id)));
      uow.invalidate(company!.id, "facilities");
      return jobDto(job);
    },
  });
}
