/** Yönetici okuma uçları (genel bakış, arama, uyarılar, bağlantı grupları, denetim) ve hesap/zaman işlemleri. */
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import {
  AdminAckReq, AdminAlertsQuery, AdminAuditQuery, AdminOverviewQuery, AdminProductQuery, AdminResetPasswordReq, AdminSearchQuery, AdminTimeReq,
  type AdminAlertDto, type AdminAuditDto,
} from "@capitalforge/shared";
import { hashPassword } from "../auth/crypto";
import { accounts, adminAuditLog, alerts, sessions } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { runDue } from "../scheduler/scheduler";
import { listGroups, reviewGroup } from "../fairplay/connections";
import { companyNames, uuidParam, writeAudit } from "./common";
import { companyDetail, search } from "./directory";
import { productDetail, productMetrics } from "./metrics";

export function registerAdminRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/admin/overview", auth: "admin", body: AdminOverviewQuery,
    handler: async ({ body, now }) => ({
      rows: await productMetrics(deps.db, now, { productId: body.productId, cityId: body.cityId, byCity: body.byCity !== "0" }),
    }),
  });

  route(app, deps, {
    method: "GET", url: "/admin/products/:productId", auth: "admin", body: AdminProductQuery,
    handler: async ({ body, params, now }) => {
      if (!deps.catalog.products.has(params.productId ?? "")) fail("NOT_FOUND");
      return productDetail(deps.db, now, params.productId!, body.cityId ?? null);
    },
  });

  route(app, deps, {
    method: "GET", url: "/admin/search", auth: "admin", body: AdminSearchQuery,
    handler: async ({ body }) => search(deps.db, body.q),
  });

  route(app, deps, {
    method: "GET", url: "/admin/companies/:id", auth: "admin",
    handler: async ({ params }) => companyDetail(deps.db, uuidParam(params.id)),
  });

  // ---- uyarılar ----
  route(app, deps, {
    method: "GET", url: "/admin/alerts", auth: "admin", body: AdminAlertsQuery,
    handler: async ({ body }): Promise<AdminAlertDto[]> => {
      const conds = [];
      if (body.kind) conds.push(eq(alerts.kind, body.kind));
      if (body.status) conds.push(eq(alerts.status, body.status));
      const rows = await deps.db.select().from(alerts).where(conds.length ? and(...conds) : undefined).orderBy(desc(alerts.createdAt), desc(alerts.id)).limit(body.limit ?? 100);
      const names = await companyNames(deps.db, rows.flatMap((r) => r.companyIds));
      return rows.map((r) => ({
        id: r.id, at: r.createdAt.toISOString(), kind: r.kind as AdminAlertDto["kind"], severity: r.severity, productId: r.productId, cityId: r.cityId,
        companyIds: r.companyIds, companyNames: r.companyIds.map((c) => names.get(c) ?? ""),
        details: r.details as AdminAlertDto["details"], status: r.status,
      }));
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/alerts/:id/ack", auth: "admin", kind: "mutation", body: AdminAckReq,
    handler: async ({ tx, account, params, now }) => {
      const id = uuidParam(params.id);
      const a = (await tx.select().from(alerts).where(eq(alerts.id, id)).for("update").limit(1))[0];
      if (!a) fail("NOT_FOUND");
      if (a.status === "open") {
        await tx.update(alerts).set({ status: "acknowledged" }).where(eq(alerts.id, id));
        await writeAudit(tx, { adminId: account!.id, action: "alert.ack", targetType: "alert", targetId: id, at: now, before: { status: a.status }, after: { status: "acknowledged" } });
      }
      return { ok: true, status: a.status === "open" ? "acknowledged" : a.status };
    },
  });

  // ---- bağlantı grupları: yalnızca can_review_connections; her erişim denetim kaydına yazılır ----
  route(app, deps, {
    method: "GET", url: "/admin/connections", auth: "admin",
    handler: async ({ account, now }) => {
      if (!account!.canReviewConnections) fail("FORBIDDEN");
      const groups = await listGroups(deps.db);
      await writeAudit(deps.db, { adminId: account!.id, action: "connections.view", targetType: "connection_group", targetId: "*", at: now, after: { groups: groups.length } });
      return groups;
    },
  });

  route(app, deps, {
    method: "GET", url: "/admin/connections/:groupId", auth: "admin",
    handler: async ({ account, params, now }) => {
      if (!account!.canReviewConnections) fail("FORBIDDEN");
      const gid = params.groupId ?? "";
      if (!/^[0-9a-f]{12}$/.test(gid)) fail("BAD_REQUEST");
      const review = await reviewGroup(deps.db, deps.catalog, gid);
      await writeAudit(deps.db, { adminId: account!.id, action: "connections.view", targetType: "connection_group", targetId: gid, at: now, after: { rows: review.trades.length } });
      return review;
    },
  });

  // ---- denetim kaydı ----
  route(app, deps, {
    method: "GET", url: "/admin/audit", auth: "admin", body: AdminAuditQuery,
    handler: async ({ body }): Promise<AdminAuditDto> => {
      const q = deps.db
        .select({ l: adminAuditLog, u: accounts.username })
        .from(adminAuditLog)
        .leftJoin(accounts, eq(accounts.id, adminAuditLog.adminAccountId));
      const rows = await (body.action ? q.where(eq(adminAuditLog.action, body.action)) : q).orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id)).limit(body.limit ?? 100);
      return {
        rows: rows.map(({ l, u }) => ({
          id: l.id, at: l.createdAt.toISOString(), adminUsername: u ?? "", action: l.action, target: `${l.targetType}:${l.targetId}`,
          before: l.before, after: l.after, reasoning: l.reasoning,
        })),
      };
    },
  });

  // ---- şifre sıfırlama (yönetici hesapları hariç) ----
  route(app, deps, {
    method: "POST", url: "/admin/accounts/:id/reset-password", auth: "admin", kind: "mutation", body: AdminResetPasswordReq, rateLimitPerMin: 10,
    handler: async ({ tx, account, body, params, now }) => {
      const id = uuidParam(params.id);
      if (id !== body.accountId) fail("BAD_REQUEST", { issue: "accountId" });
      const a = (await tx.select().from(accounts).where(eq(accounts.id, id)).for("update").limit(1))[0];
      if (!a) fail("NOT_FOUND");
      if (a.role === "admin") fail("FORBIDDEN");
      await tx.update(accounts).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(accounts.id, id));
      // açık oturumlar sonlanır
      await tx.delete(sessions).where(eq(sessions.accountId, id));
      await writeAudit(tx, {
        adminId: account!.id, action: "account.reset_password", targetType: "account", targetId: id, at: now, reasoning: body.reasoning,
        after: { passwordReset: true, sessionsRevoked: true },
      });
      return { ok: true };
    },
  });

  // ---- test ortamında zaman ilerletme ----
  route(app, deps, {
    method: "POST", url: "/admin/time/advance", auth: "admin", body: AdminTimeReq, rateLimitPerMin: 20,
    handler: async ({ account, body }) => {
      if (!deps.config.allowTimeTravel) fail("TIME_TRAVEL_DISABLED");
      const total = body.minutes * 60_000;
      // En çok 200 adım: görevler adım adım çalışır, vadesi gelenler sırayla yerleşir
      const step = Math.max(15 * 60_000, Math.ceil(total / 200));
      let left = total;
      const ran: Record<string, number> = {};
      while (left > 0) {
        const s = Math.min(step, left);
        await deps.clock.advance(deps.db, s);
        for (const [k, v] of Object.entries(await runDue(deps, deps.clock.now(), true))) ran[k] = (ran[k] ?? 0) + Math.max(v, 0);
        left -= s;
      }
      await writeAudit(deps.db, { adminId: account!.id, action: "time.advance", targetType: "clock", targetId: "world", at: deps.clock.now(), after: { minutes: body.minutes } });
      return { now: deps.clock.now().toISOString(), ran };
    },
  });
}

