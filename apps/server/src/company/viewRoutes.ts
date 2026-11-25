import type { FastifyInstance } from "fastify";
import { CompanySearchQuery, DissolveReq } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { route } from "../http/route";
import { dissolveCompany } from "./dissolve";
import { publicProfile, searchCompanies } from "./profile";
import { companyView } from "./view";

export function registerCompanyViewRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/company", auth: "company",
    handler: async ({ company, now }) => companyView(deps.db, deps.catalog, company!, now),
  });
  route(app, deps, {
    method: "GET", url: "/companies/search", auth: "account", body: CompanySearchQuery,
    handler: async ({ body }) => searchCompanies(deps.db, body.q),
  });
  route(app, deps, {
    method: "GET", url: "/companies/:id", auth: "account",
    handler: async ({ params }) => publicProfile(deps.db, params.id!),
  });
  route(app, deps, {
    method: "POST", url: "/account/dissolve", auth: "company", kind: "mutation", body: DissolveReq, rateLimitPerMin: 5,
    handler: async ({ tx, uow, company, body, now }) => dissolveCompany(tx, uow, company!.id, body.confirmName, now),
  });
}
