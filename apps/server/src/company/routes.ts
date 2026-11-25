import type { FastifyInstance } from "fastify";
import { FoundCompanyReq } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { route } from "../http/route";
import { foundCompany } from "./found";

/** Şirket kuruluşu. Şirket görünümü, tesisler ve fesih company modülünün diğer dosyalarında. */
export function registerCompanyFoundRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "POST", url: "/company", auth: "account", body: FoundCompanyReq, kind: "mutation", rateLimitPerMin: 10,
    handler: async ({ tx, uow, account, body, now }) => {
      if (account!.frozenAt) throw new Error("frozen");
      return foundCompany(tx, uow, deps.catalog, account!.id, body, now);
    },
  });
}
