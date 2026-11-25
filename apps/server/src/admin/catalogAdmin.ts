/**
 * Katalog ve ayar düzenleme. Her değişiklik: catalog_items.version++, catalog_history, admin_audit_log
 * (önce/sonra, gerekçe, etkilenen kayıt sayısı), işlem kesinleştikten sonra deps.catalog.reload.
 * Çalışan işler ve kabul edilmiş sözleşmeler kendi anlık görüntüleriyle devam eder (burada dokunulmaz).
 */
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import {
  AdminProductPatchReq, AdminRecipePatchReq, AdminSettingReq, DEFAULT_SETTINGS,
  type AdminCatalogDto, type AdminChangeResultDto, type RecipeDef,
} from "@capitalforge/shared";
import type { Tx } from "../db/client";
import { catalogHistory, catalogItems, idempotencyKeys, marketOrders, priceRefs, settings } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route, type Ctx } from "../http/route";
import { writeAudit } from "./common";

/**
 * Tek veritabanı işlemi + (varsa) istek düzeyinde idempotency; kesinleşmeden sonra katalog yeniden yüklenir.
 * (route(kind:"mutation") işlem içinde çalıştığı için reload'u kesinleşmeden sonra yapamaz.)
 */
async function catalogTx<T extends object>(deps: Deps, ctx: Ctx<{ idempotencyKey?: string }>, scope: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const key = ctx.body.idempotencyKey;
  const accountId = ctx.account!.id;
  const out = await deps.db.transaction(async (tx) => {
    if (key) {
      const ins = await tx.insert(idempotencyKeys).values({ accountId, key, scope, status: 0, response: {} }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
      if (!ins[0]) {
        const prev = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.accountId, accountId), eq(idempotencyKeys.key, key))).limit(1);
        return { replay: true as const, value: (prev[0]?.response ?? {}) as T };
      }
    }
    const value = await fn(tx);
    if (key) await tx.update(idempotencyKeys).set({ status: 200, response: value }).where(and(eq(idempotencyKeys.accountId, accountId), eq(idempotencyKeys.key, key)));
    return { replay: false as const, value };
  });
  if (!out.replay) await deps.catalog.reload(deps.db);
  else ctx.reply.header("x-cf-replay", "1");
  return out.value;
}

// ---- Ayar doğrulama: şekil varsayılan değere uymalı ----
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function conforms(def: unknown, val: unknown, path: string): boolean {
  if (typeof def === "number") return typeof val === "number" && Number.isSafeInteger(val) && val >= 0 && val <= 1_000_000_000_000 && (!path.endsWith("Bp") || val <= 100_000);
  if (typeof def === "string") return typeof val === "string" && val.length <= 200;
  if (typeof def === "boolean") return typeof val === "boolean";
  if (Array.isArray(def)) {
    if (!Array.isArray(val) || val.length > 64) return false;
    const tpl = def.length > 0 ? def[0] : path.startsWith("starterInputs.") ? { productId: "", kg: 0 } : undefined;
    if (tpl === undefined) return val.length === 0;
    return val.every((v) => conforms(tpl, v, path + "[]"));
  }
  if (isObj(def)) {
    if (!isObj(val)) return false;
    const dk = Object.keys(def).sort(), vk = Object.keys(val).sort();
    if (dk.length !== vk.length || dk.some((k, i) => k !== vk[i])) return false;
    return dk.every((k) => conforms(def[k], val[k], path ? `${path}.${k}` : k));
  }
  return false;
}

/** alan bazlı değer aralıkları [min, max] */
const RANGES: Record<string, [number, number]> = {
  startingCash: [100_000, 100_000_000_000], marketFeeBp: [0, 3000], ipRetentionDays: [1, 365],
  "anomaly.thresholdBp": [100, 100_000], "anomaly.minComparables": [1, 100], "anomaly.windowHours": [1, 720],
  "loan.dailyInterestBp": [0, 1000], "freight.driverHoursPerTrip": [0, 24],
};

function checkRanges(top: string, value: unknown): void {
  const walk = (path: string, v: unknown) => {
    const r = RANGES[path];
    if (r && typeof v === "number" && (v < r[0] || v > r[1])) fail("BAD_REQUEST", { issue: path });
    if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(`${path}.${k}`, x);
  };
  walk(top, value);
  if (top === "levelXp") {
    const a = value as number[];
    if (a.length < 2 || a[0] !== 0 || a.some((x, i) => i > 0 && x <= a[i - 1]!)) fail("BAD_REQUEST", { issue: "levelXp" });
  }
  if (top === "loan" && (value as { termsDays: number[] }).termsDays.some((d) => d < 1 || d > 30)) fail("BAD_REQUEST", { issue: "loan.termsDays" });
}

export function registerCatalogRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/admin/catalog", auth: "admin",
    handler: async (): Promise<AdminCatalogDto> => {
      const items = await deps.db.select().from(catalogItems).where(sql`${catalogItems.kind} IN ('recipe', 'product')`).orderBy(catalogItems.kind, catalogItems.id);
      const dto = (kind: string) => items.filter((i) => i.kind === kind).map((i) => ({ id: i.id, version: i.version, data: i.data, updatedAt: i.updatedAt.toISOString() }));
      const rows = await deps.db.select().from(settings);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const out: AdminCatalogDto["settings"] = {};
      for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
        const r = byKey.get(k);
        out[k] = { value: r ? r.value : def, updatedAt: r ? r.updatedAt.toISOString() : null };
      }
      return { recipes: dto("recipe"), products: dto("product"), settings: out };
    },
  });

  route(app, deps, {
    method: "PATCH", url: "/admin/catalog/recipes/:id", auth: "admin", body: AdminRecipePatchReq, rateLimitPerMin: 30,
    handler: async (ctx): Promise<AdminChangeResultDto> => {
      const id = ctx.params.id ?? "";
      const b = ctx.body;
      return catalogTx(deps, ctx, `PATCH /admin/catalog/recipes/${id}`, async (tx) => {
        const row = (await tx.select().from(catalogItems).where(and(eq(catalogItems.kind, "recipe"), eq(catalogItems.id, id))).for("update").limit(1))[0];
        if (!row) fail("NOT_FOUND");
        const before = row.data as RecipeDef;
        const next: RecipeDef = { ...before, output: { ...before.output } };
        if (b.minutes !== undefined) next.minutes = b.minutes;
        if (b.laborHours !== undefined) next.laborHours = b.laborHours;
        if (b.energyKwh !== undefined) next.energyKwh = b.energyKwh;
        if (b.waterM3 !== undefined) next.waterM3 = b.waterM3;
        if (b.outputKg !== undefined) next.output.kg = b.outputKg;
        if (b.inputs !== undefined) {
          const known = new Set((await tx.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.kind, "product"))).map((r) => r.id));
          if (b.inputs.some((i) => !known.has(i.productId)) || new Set(b.inputs.map((i) => i.productId)).size !== b.inputs.length) fail("BAD_REQUEST", { issue: "inputs" });
          next.inputs = b.inputs;
        }
        if (JSON.stringify(next) === JSON.stringify(before)) fail("BAD_REQUEST", { issue: "no_change" });
        const jobs = (await tx.execute(sql`
          SELECT count(*)::int AS running, (count(*) FILTER (WHERE repeat))::int AS repeating
          FROM cf.production_jobs WHERE recipe_id = ${id} AND status = 'running'`)) as unknown as Array<{ running: number; repeating: number }>;
        const affected = { runningJobs: Number(jobs[0]?.running ?? 0), repeatingJobs: Number(jobs[0]?.repeating ?? 0) };
        const version = row.version + 1;
        await tx.update(catalogItems).set({ data: next, version, updatedAt: ctx.now, updatedBy: ctx.account!.id }).where(and(eq(catalogItems.kind, "recipe"), eq(catalogItems.id, id)));
        await tx.insert(catalogHistory).values({ kind: "recipe", itemId: id, version, before, after: next, changedAt: ctx.now, changedBy: ctx.account!.id, reasoning: b.reasoning });
        await writeAudit(tx, {
          adminId: ctx.account!.id, action: "catalog.recipe.update", targetType: "recipe", targetId: id, at: ctx.now, reasoning: b.reasoning,
          before: { version: row.version, data: before }, after: { version, data: next, affected },
        });
        return { id, version, affected };
      });
    },
  });

  route(app, deps, {
    method: "PATCH", url: "/admin/catalog/products/:id", auth: "admin", body: AdminProductPatchReq, rateLimitPerMin: 30,
    handler: async (ctx): Promise<AdminChangeResultDto> => {
      const id = ctx.params.id ?? "";
      const b = ctx.body;
      return catalogTx(deps, ctx, `PATCH /admin/catalog/products/${id}`, async (tx) => {
        const row = (await tx.select().from(catalogItems).where(and(eq(catalogItems.kind, "product"), eq(catalogItems.id, id))).for("update").limit(1))[0];
        if (!row) fail("NOT_FOUND");
        const before = row.data as { basePricePerKg: number };
        if (before.basePricePerKg === b.basePricePerKg) fail("BAD_REQUEST", { issue: "no_change" });
        const next = { ...before, basePricePerKg: b.basePricePerKg };
        const refs = await tx.select({ n: sql<number>`count(*)::int` }).from(priceRefs).where(eq(priceRefs.productId, id));
        const open = await tx.select({ n: sql<number>`count(*)::int` }).from(marketOrders).where(and(eq(marketOrders.productId, id), eq(marketOrders.status, "open")));
        const affected = { priceRefs: Number(refs[0]?.n ?? 0), openOrders: Number(open[0]?.n ?? 0) };
        const version = row.version + 1;
        await tx.update(catalogItems).set({ data: next, version, updatedAt: ctx.now, updatedBy: ctx.account!.id }).where(and(eq(catalogItems.kind, "product"), eq(catalogItems.id, id)));
        await tx.insert(catalogHistory).values({ kind: "product", itemId: id, version, before, after: next, changedAt: ctx.now, changedBy: ctx.account!.id, reasoning: b.reasoning });
        await writeAudit(tx, {
          adminId: ctx.account!.id, action: "catalog.product.update", targetType: "product", targetId: id, at: ctx.now, reasoning: b.reasoning,
          before: { version: row.version, basePricePerKg: before.basePricePerKg }, after: { version, basePricePerKg: b.basePricePerKg, affected },
        });
        return { id, version, affected };
      });
    },
  });

  route(app, deps, {
    method: "PATCH", url: "/admin/settings", auth: "admin", body: AdminSettingReq, rateLimitPerMin: 30,
    handler: async (ctx): Promise<AdminChangeResultDto> => {
      const b = ctx.body;
      if (b.value === undefined) fail("BAD_REQUEST", { issue: "value" });
      const path = b.key.split(".");
      const top = path[0]!;
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, top)) fail("BAD_REQUEST", { issue: "key" });
      return catalogTx(deps, ctx, `PATCH /admin/settings`, async (tx) => {
        const cur = (await tx.select().from(settings).where(eq(settings.key, top)).for("update").limit(1))[0];
        const before = structuredClone(cur ? cur.value : (DEFAULT_SETTINGS as Record<string, unknown>)[top]);
        const next = structuredClone(before);
        let after: unknown;
        if (path.length === 1) after = b.value;
        else {
          let node: unknown = next;
          for (const p of path.slice(1, -1)) node = isObj(node) ? node[p] : undefined;
          const last = path[path.length - 1]!;
          if (!isObj(node) || !Object.prototype.hasOwnProperty.call(node, last)) fail("BAD_REQUEST", { issue: "key" });
          node[last] = b.value;
          after = next;
        }
        const def = (DEFAULT_SETTINGS as Record<string, unknown>)[top];
        if (!conforms(def, after, top)) fail("BAD_REQUEST", { issue: "value" });
        checkRanges(top, after);
        if (top === "starterInputs") {
          const known = new Set((await tx.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.kind, "product"))).map((r) => r.id));
          for (const list of Object.values(after as Record<string, Array<{ productId: string }>>)) if (list.some((i) => !known.has(i.productId))) fail("BAD_REQUEST", { issue: "productId" });
        }
        if (JSON.stringify(before) === JSON.stringify(after)) fail("BAD_REQUEST", { issue: "no_change" });
        await tx
          .insert(settings)
          .values({ key: top, value: after as object, updatedAt: ctx.now, updatedBy: ctx.account!.id })
          .onConflictDoUpdate({ target: settings.key, set: { value: after as object, updatedAt: ctx.now, updatedBy: ctx.account!.id } });
        await writeAudit(tx, {
          adminId: ctx.account!.id, action: "settings.update", targetType: "setting", targetId: b.key, at: ctx.now, reasoning: b.reasoning,
          before: path.length === 1 ? before : getPath(before, path.slice(1)), after: path.length === 1 ? after : getPath(after, path.slice(1)),
        });
        return { id: b.key, version: 0, affected: {} };
      });
    },
  });
}

function getPath(v: unknown, path: string[]): unknown {
  let n = v;
  for (const p of path) n = isObj(n) ? n[p] : undefined;
  return n;
}
