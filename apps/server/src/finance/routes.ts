import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AccountingQuery, AccountingTxQuery, BeforeQuery, FacilityActionReq, LoanReq, RepayReq, uuid } from "@capitalforge/shared";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { m } from "../lib/serialize";
import { payArrearsManually } from "./arrears";
import { repayLoan, takeLoan } from "./loans";
import { outcomesFor } from "./outcomes";
import { accounting, accountingTransactions } from "./accounting";
import { financeDto, ledgerLines, saleTrace, salesList } from "./report";

const isUuid = (v: string) => uuid.safeParse(v).success;

export function registerFinanceRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/finance", auth: "company",
    handler: async ({ company, now, reply }) => { reply.header("cache-control", "private, no-store"); return financeDto(deps.db, deps.catalog, company!, now); },
  });
  // Şirket Muhasebesi: şirket yalnızca oturumdan; yanıtlar şirkete özel, ara önbelleklerde saklanmaz
  route(app, deps, {
    method: "GET", url: "/finance/accounting", auth: "company", body: AccountingQuery,
    handler: async ({ company, body, now, reply }) => {
      reply.header("cache-control", "private, no-store");
      return accounting(deps.db, company!.id, body.period, now);
    },
  });
  route(app, deps, {
    method: "GET", url: "/finance/accounting/transactions", auth: "company", body: AccountingTxQuery,
    handler: async ({ company, body, now, reply }) => {
      reply.header("cache-control", "private, no-store");
      return accountingTransactions(deps.db, company!.id, body, now);
    },
  });
  route(app, deps, {
    method: "GET", url: "/finance/ledger", auth: "company", body: BeforeQuery,
    handler: async ({ company, body, reply }) => { reply.header("cache-control", "private, no-store"); return ledgerLines(deps.db, company!.id, body.before ? new Date(body.before) : undefined); },
  });
  route(app, deps, {
    method: "GET", url: "/finance/outcomes", auth: "company", body: BeforeQuery,
    handler: async ({ company, body, reply }) => { reply.header("cache-control", "private, no-store"); return outcomesFor(deps.db, company!.id, body.before ? new Date(body.before) : undefined); },
  });
  route(app, deps, {
    method: "GET", url: "/finance/sales", auth: "company", body: BeforeQuery,
    handler: async ({ company, body, reply }) => { reply.header("cache-control", "private, no-store"); return salesList(deps.db, company!.id, body.before ? new Date(body.before) : undefined); },
  });
  route(app, deps, {
    method: "GET", url: "/finance/sales/:id", auth: "company", body: z.object({}),
    handler: async ({ company, params, reply }) => {
      if (!isUuid(params.id!)) fail("NOT_FOUND");
      reply.header("cache-control", "private, no-store");
      return saleTrace(deps.db, company!.id, params.id!);
    },
  });
  route(app, deps, {
    method: "POST", url: "/finance/loans", auth: "company", kind: "mutation", body: LoanReq,
    handler: async ({ tx, uow, company, body, now }) => takeLoan(tx, uow, deps.catalog, company!.id, body, now),
  });
  route(app, deps, {
    method: "POST", url: "/finance/loans/:id/repay", auth: "company", kind: "mutation", body: RepayReq,
    handler: async ({ tx, uow, company, body, params, now }) => {
      if (!isUuid(params.id!)) fail("NOT_FOUND");
      return repayLoan(tx, uow, company!.id, params.id!, body, now);
    },
  });
  route(app, deps, {
    method: "POST", url: "/finance/arrears/pay", auth: "company", kind: "mutation", body: FacilityActionReq,
    handler: async ({ tx, uow, company, now }) => {
      const paid = await payArrearsManually(tx, uow, company!.id, now);
      return { paid: m(paid) };
    },
  });
}

