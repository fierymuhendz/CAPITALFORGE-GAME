import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BuyPlotReq, FacilityActionReq, uuid } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { buyPlot, startUpgrade } from "./build";
import { loadFacilities } from "./dto";

export function registerFacilityRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/facilities", auth: "company",
    handler: async ({ company, now }) => loadFacilities(deps.db, deps.catalog, company!.id, now),
  });
  route(app, deps, {
    method: "GET", url: "/facilities/:id", auth: "company", body: z.object({}),
    handler: async ({ company, params, now }) => {
      if (!uuid.safeParse(params.id).success) fail("NOT_FOUND");
      const r = await loadFacilities(deps.db, deps.catalog, company!.id, now, params.id!);
      if (!r[0]) fail("NOT_FOUND");
      return r[0];
    },
  });
  route(app, deps, {
    method: "POST", url: "/plots/:plotId/buy", auth: "company", kind: "mutation", body: BuyPlotReq,
    handler: async ({ tx, uow, company, params, body, now }) => buyPlot(tx, uow, deps.catalog, company!.id, params.plotId!, body, now),
  });
  route(app, deps, {
    method: "POST", url: "/facilities/:id/upgrade", auth: "company", kind: "mutation", body: FacilityActionReq,
    handler: async ({ tx, uow, company, params, now }) => {
      if (!uuid.safeParse(params.id).success) fail("NOT_FOUND");
      return startUpgrade(tx, uow, deps.catalog, company!.id, params.id!, "level", now);
    },
  });
  route(app, deps, {
    method: "POST", url: "/facilities/:id/quality", auth: "company", kind: "mutation", body: FacilityActionReq,
    handler: async ({ tx, uow, company, params, now }) => {
      if (!uuid.safeParse(params.id).success) fail("NOT_FOUND");
      return startUpgrade(tx, uow, deps.catalog, company!.id, params.id!, "quality", now);
    },
  });
}
