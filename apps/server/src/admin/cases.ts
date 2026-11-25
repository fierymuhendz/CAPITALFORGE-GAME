/** İnceleme dosyaları ve yaptırım uçları. Her adım admin_audit_log'a yazılır. */
import type { FastifyInstance } from "fastify";
import { desc, eq, inArray } from "drizzle-orm";
import { AdminCaseReq, AdminCasesQuery, AdminCloseReq, AdminEnforceReq, AdminNoteReq, type AdminCaseDto } from "@capitalforge/shared";
import type { DbOrTx } from "../db/client";
import { accounts, adminCaseEvents, adminCases, alerts } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { uuidParam, writeAudit } from "./common";
import { cancelContractAsAdmin, cancelOrderAsAdmin, freezeAccount, reverseTransaction, type EnforceResult } from "./enforce";

async function caseDtos(db: DbOrTx, rows: Array<typeof adminCases.$inferSelect>): Promise<AdminCaseDto[]> {
  if (rows.length === 0) return [];
  const events = await db.select().from(adminCaseEvents).where(inArray(adminCaseEvents.caseId, rows.map((r) => r.id))).orderBy(adminCaseEvents.createdAt, adminCaseEvents.id);
  const accIds = [...new Set([...rows.map((r) => r.openedBy), ...events.map((e) => e.byAccountId)])];
  const names = new Map((await db.select({ id: accounts.id, u: accounts.username }).from(accounts).where(inArray(accounts.id, accIds))).map((a) => [a.id, a.u]));
  return rows.map((c) => ({
    id: c.id, title: c.title, subjectType: c.subjectType, subjectId: c.subjectId, status: c.status,
    openedBy: names.get(c.openedBy) ?? "", openedAt: c.openedAt.toISOString(), closedAt: c.closedAt?.toISOString() ?? null, resolution: c.resolution,
    events: events.filter((e) => e.caseId === c.id).map((e) => ({
      at: e.createdAt.toISOString(), by: names.get(e.byAccountId) ?? "", kind: e.kind, text: e.text,
      ...(e.action ? { action: e.action } : {}), ...(e.targetId ? { targetId: e.targetId } : {}),
    })),
  }));
}

export function registerCaseRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/admin/cases", auth: "admin", body: AdminCasesQuery,
    handler: async ({ body }) => {
      const q = deps.db.select().from(adminCases);
      const rows = await (body.status ? q.where(eq(adminCases.status, body.status)) : q).orderBy(desc(adminCases.openedAt)).limit(200);
      return caseDtos(deps.db, rows);
    },
  });

  route(app, deps, {
    method: "GET", url: "/admin/cases/:id", auth: "admin",
    handler: async ({ params }) => {
      const rows = await deps.db.select().from(adminCases).where(eq(adminCases.id, uuidParam(params.id))).limit(1);
      if (!rows[0]) fail("NOT_FOUND");
      return (await caseDtos(deps.db, rows))[0];
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/cases", auth: "admin", kind: "mutation", body: AdminCaseReq,
    handler: async ({ tx, account, body, now }) => {
      const [c] = await tx.insert(adminCases).values({ title: body.title, subjectType: body.subjectType, subjectId: body.subjectId, openedBy: account!.id, openedAt: now }).returning();
      await tx.insert(adminCaseEvents).values({ caseId: c!.id, byAccountId: account!.id, kind: "opened", text: body.reasoning, createdAt: now });
      if (body.subjectType === "alert") {
        const aid = uuidParam(body.subjectId);
        await tx.update(alerts).set({ status: "case_opened" }).where(eq(alerts.id, aid));
      }
      await writeAudit(tx, {
        adminId: account!.id, action: "case.open", targetType: "case", targetId: c!.id, at: now, reasoning: body.reasoning,
        after: { subjectType: body.subjectType, subjectId: body.subjectId, title: body.title },
      });
      return (await caseDtos(tx, [c!]))[0];
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/cases/:id/notes", auth: "admin", kind: "mutation", body: AdminNoteReq,
    handler: async ({ tx, account, body, params, now }) => {
      const id = uuidParam(params.id);
      const c = (await tx.select().from(adminCases).where(eq(adminCases.id, id)).for("update").limit(1))[0];
      if (!c) fail("NOT_FOUND");
      if (c.status !== "open") fail("CONFLICT");
      await tx.insert(adminCaseEvents).values({ caseId: id, byAccountId: account!.id, kind: "note", text: body.text, createdAt: now });
      await writeAudit(tx, { adminId: account!.id, action: "case.note", targetType: "case", targetId: id, at: now, after: { text: body.text } });
      return (await caseDtos(tx, [c]))[0];
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/cases/:id/close", auth: "admin", kind: "mutation", body: AdminCloseReq,
    handler: async ({ tx, account, body, params, now }) => {
      const id = uuidParam(params.id);
      const c = (await tx.select().from(adminCases).where(eq(adminCases.id, id)).for("update").limit(1))[0];
      if (!c) fail("NOT_FOUND");
      if (c.status !== "open") fail("CONFLICT");
      const [upd] = await tx.update(adminCases).set({ status: "closed", closedAt: now, resolution: body.resolution }).where(eq(adminCases.id, id)).returning();
      await tx.insert(adminCaseEvents).values({ caseId: id, byAccountId: account!.id, kind: "closed", text: body.reasoning, createdAt: now });
      await writeAudit(tx, {
        adminId: account!.id, action: "case.close", targetType: "case", targetId: id, at: now, reasoning: body.reasoning,
        before: { status: "open" }, after: { status: "closed", resolution: body.resolution },
      });
      return (await caseDtos(tx, [upd!]))[0];
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/cases/:id/enforce", auth: "admin", kind: "mutation", body: AdminEnforceReq, rateLimitPerMin: 30,
    handler: async ({ tx, uow, account, body, params, now }) => {
      const id = uuidParam(params.id);
      const c = (await tx.select().from(adminCases).where(eq(adminCases.id, id)).for("update").limit(1))[0];
      if (!c) fail("NOT_FOUND");
      if (c.status !== "open") fail("CONFLICT");
      const ctx = { tx, uow, now, adminId: account!.id };
      let res: EnforceResult;
      switch (body.action) {
        case "freeze_account": res = await freezeAccount(ctx, body.targetId, true); break;
        case "unfreeze_account": res = await freezeAccount(ctx, body.targetId, false); break;
        case "reverse_transaction": res = await reverseTransaction(ctx, body.targetId); break;
        case "cancel_listing": res = await cancelOrderAsAdmin(ctx, body.targetId); break;
        case "cancel_contract": res = await cancelContractAsAdmin(ctx, body.targetId); break;
      }
      await tx.insert(adminCaseEvents).values({
        caseId: id, byAccountId: account!.id, kind: "enforcement", text: body.reasoning, action: body.action, targetId: res.targetId, createdAt: now,
      });
      await writeAudit(tx, {
        adminId: account!.id, action: `enforce.${body.action}`, targetType: res.targetType, targetId: res.targetId, at: now,
        reasoning: body.reasoning, before: res.before, after: { ...(res.after as object), caseId: id },
      });
      return { ok: true, action: body.action, targetId: res.targetId, result: res.after };
    },
  });
}
