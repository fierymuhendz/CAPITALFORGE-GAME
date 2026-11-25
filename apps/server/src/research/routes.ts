import type { FastifyInstance } from "fastify";
import { ResearchStartReq, id } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { researchView, startResearch } from "./research";

export function registerResearchRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/research", auth: "company",
    handler: async ({ company }) => researchView(deps.db, deps.catalog, company!.id),
  });
  route(app, deps, {
    method: "POST", url: "/research/:id/start", auth: "company", kind: "mutation", body: ResearchStartReq,
    handler: async ({ tx, uow, company, params, now }) => {
      if (!id.safeParse(params.id).success) fail("NOT_FOUND");
      return startResearch(tx, uow, deps.catalog, company!.id, params.id!, now);
    },
  });
}
