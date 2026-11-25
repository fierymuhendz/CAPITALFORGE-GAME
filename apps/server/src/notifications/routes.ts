import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { NotificationsReadReq, type NotificationDto } from "@capitalforge/shared";
import { notifications } from "../db/schema";
import type { Deps } from "../deps";
import { route } from "../http/route";

export function registerNotificationRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/notifications", auth: "company",
    handler: async ({ company }): Promise<NotificationDto[]> => {
      const rows = await deps.db.select().from(notifications).where(eq(notifications.companyId, company!.id)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(50);
      return rows.map((n) => ({ id: n.id, at: n.createdAt.toISOString(), kind: n.kind, params: n.params, read: !!n.readAt, link: n.link }));
    },
  });
  route(app, deps, {
    method: "POST", url: "/notifications/read", auth: "company", kind: "mutation", body: NotificationsReadReq,
    handler: async ({ tx, uow, company, body, now }) => {
      const base = and(eq(notifications.companyId, company!.id), isNull(notifications.readAt));
      const r = body.all
        ? await tx.update(notifications).set({ readAt: now }).where(base).returning({ id: notifications.id })
        : body.ids?.length
          ? await tx.update(notifications).set({ readAt: now }).where(and(base, inArray(notifications.id, body.ids))).returning({ id: notifications.id })
          : [];
      uow.invalidate(company!.id, "notifications", "company");
      return { read: r.length };
    },
  });
}
