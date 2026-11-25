/**
 * Oyuncu Yönetimi: oyuncu arama, şirket ve nakit görünümü, hesabı askıya alma / yeniden etkinleştirme,
 * nakit ayarı (ekle / düş / tam bakiye). Yalnızca 2FA'lı yöneticiler (auth: "admin").
 *
 * Nakit ayarı tek bir defter işlemidir (nakit ↔ özkaynak, şirket bazında dengeli). İstek idempotencyKey taşır:
 * tekrar gönderilen istek aynı yanıtı döndürür, defter işlemi de aynı anahtarla ikinci kez yazılmaz.
 * Nakit hesabı satır kilidiyle okunur; "tam bakiye" eşzamanlı ayarlarda da doğru farkı yazar.
 * Her ayar denetim kaydına yönetici, gerekçe, zaman, önceki ve sonraki bakiye ile yazılır.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import {
  AdminBalanceReq, AdminPlayersQuery, AdminPlayerStatusReq,
  type AdminBalanceAdjustmentDto, type AdminBalanceResultDto, type AdminPlayerDetailDto, type AdminPlayerRowDto, type AdminPlayersDto,
} from "@capitalforge/shared";
import type { DbOrTx } from "../db/client";
import { accounts, adminAuditLog, companies, ledgerAccounts } from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { route } from "../http/route";
import { accountId as ledgerAccountId, co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { likePattern, uuidParam, writeAudit } from "./common";
import { freezeAccount } from "./enforce";

const BALANCE_ACTION = "player.balance_adjust";
const STATUS_ACTIONS = ["player.suspend", "player.reactivate"];

type AccountRow = typeof accounts.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

async function playerRows(db: DbOrTx, list: Array<{ a: AccountRow; c: CompanyRow | null }>): Promise<AdminPlayerRowDto[]> {
  const cids = list.map((x) => x.c?.id).filter((x): x is string => !!x);
  const cash = cids.length
    ? await db.select({ c: ledgerAccounts.companyId, b: ledgerAccounts.balance }).from(ledgerAccounts).where(and(inArray(ledgerAccounts.companyId, cids), eq(ledgerAccounts.code, "cash")))
    : [];
  const byCo = new Map(cash.map((r) => [r.c!, r.b]));
  return list.map(({ a, c }) => ({
    accountId: a.id, username: a.username, role: a.role, suspended: !!a.frozenAt, createdAt: a.createdAt.toISOString(),
    lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    company: c ? { id: c.id, name: c.name, sector: c.sector, homeCityId: c.homeCityId, level: c.level } : null,
    cash: c ? m(byCo.get(c.id) ?? 0n) : null,
  }));
}

async function loadPlayer(db: DbOrTx, accountId: string): Promise<{ a: AccountRow; c: CompanyRow | null }> {
  const r = (await db
    .select({ a: accounts, c: companies })
    .from(accounts)
    .leftJoin(companies, and(eq(companies.accountId, accounts.id), isNull(companies.dissolvedAt), eq(companies.isSystem, false)))
    .where(eq(accounts.id, accountId))
    .limit(1))[0];
  if (!r) fail("NOT_FOUND");
  return r;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : "0");

export function registerPlayerRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/admin/players", auth: "admin", body: AdminPlayersQuery,
    handler: async ({ body }): Promise<AdminPlayersDto> => {
      const q = body.q?.trim() ?? "";
      const base = deps.db
        .select({ a: accounts, c: companies })
        .from(accounts)
        .leftJoin(companies, and(eq(companies.accountId, accounts.id), isNull(companies.dissolvedAt), eq(companies.isSystem, false)));
      const pat = likePattern(q);
      const rows = await (q ? base.where(or(like(accounts.usernameLower, pat), like(companies.nameLower, pat))) : base)
        .orderBy(asc(accounts.usernameLower))
        .limit(100);
      return { rows: await playerRows(deps.db, rows) };
    },
  });

  route(app, deps, {
    method: "GET", url: "/admin/players/:accountId", auth: "admin",
    handler: async ({ params }): Promise<AdminPlayerDetailDto> => {
      const id = uuidParam(params.accountId);
      const p = await loadPlayer(deps.db, id);
      const audit = await deps.db
        .select({ l: adminAuditLog, u: accounts.username })
        .from(adminAuditLog)
        .leftJoin(accounts, eq(accounts.id, adminAuditLog.adminAccountId))
        .where(and(eq(adminAuditLog.targetType, "account"), eq(adminAuditLog.targetId, id), inArray(adminAuditLog.action, [BALANCE_ACTION, ...STATUS_ACTIONS])))
        .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
        .limit(100);
      const adjustments: AdminBalanceAdjustmentDto[] = audit
        .filter((x) => x.l.action === BALANCE_ACTION)
        .map(({ l, u }) => {
          const b = (l.before ?? {}) as Record<string, unknown>;
          const af = (l.after ?? {}) as Record<string, unknown>;
          const mode = af.mode === "add" || af.mode === "deduct" || af.mode === "set" ? af.mode : "set";
          return {
            id: l.id, at: l.createdAt.toISOString(), adminUsername: u ?? "", mode, amount: str(af.amount), delta: str(af.delta),
            before: str(b.cash), after: str(af.cash), reason: l.reasoning ?? "", transactionId: typeof af.transactionId === "string" ? af.transactionId : null,
          };
        });
      const statusHistory = audit
        .filter((x) => STATUS_ACTIONS.includes(x.l.action))
        .map(({ l, u }) => ({ at: l.createdAt.toISOString(), adminUsername: u ?? "", suspended: l.action === "player.suspend", reason: l.reasoning ?? "" }));
      return { player: (await playerRows(deps.db, [p]))[0]!, suspendedAt: p.a.frozenAt?.toISOString() ?? null, adjustments, statusHistory };
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/players/:accountId/status", auth: "admin", kind: "mutation", body: AdminPlayerStatusReq, rateLimitPerMin: 30,
    handler: async ({ tx, uow, account, body, params, now }) => {
      const id = uuidParam(params.accountId);
      // yönetici hesapları askıya alınamaz (freezeAccount FORBIDDEN döner); durum zaten istenen gibiyse CONFLICT
      const res = await freezeAccount({ tx, uow, now, adminId: account!.id }, id, body.suspended);
      await writeAudit(tx, {
        adminId: account!.id, action: body.suspended ? "player.suspend" : "player.reactivate", targetType: "account", targetId: id, at: now,
        reasoning: body.reason, before: res.before, after: res.after,
      });
      return { ok: true, suspended: body.suspended };
    },
  });

  route(app, deps, {
    method: "POST", url: "/admin/players/:accountId/balance", auth: "admin", kind: "mutation", body: AdminBalanceReq, rateLimitPerMin: 30,
    handler: async ({ tx, uow, account, body, params, now }): Promise<AdminBalanceResultDto> => {
      const id = uuidParam(params.accountId);
      const p = await loadPlayer(tx, id);
      if (!p.c) fail("NO_COMPANY");
      const cid = p.c.id;
      // nakit hesabını kilitle, güncel bakiyeyi oku (eşzamanlı ayarlar sıraya girer)
      const cashId = await ledgerAccountId(tx, co(cid, "cash"));
      const before = (await tx.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.id, cashId)).for("update").limit(1))[0]?.b ?? 0n;
      const amount = BigInt(body.amount);
      const delta = body.mode === "add" ? amount : body.mode === "deduct" ? -amount : amount - before;
      if (delta === 0n) fail("BAD_REQUEST", { issue: "no_change" });
      if (before + delta < 0n) fail("INSUFFICIENT_FUNDS", { missing: (-(before + delta)).toString() });
      const led = await post(tx, {
        kind: "admin_balance_adjust", idempotencyKey: `admin-balance:${account!.id}:${body.idempotencyKey}`, refType: "account", refId: id, at: now,
        memo: `Yönetici bakiye ayarı (${body.mode}): ${body.reason}`.slice(0, 500),
        lines: [{ account: co(cid, "cash"), amount: delta }, { account: co(cid, "equity"), amount: -delta }],
      });
      const after = (await tx.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.id, cashId)).limit(1))[0]?.b ?? 0n;
      await writeAudit(tx, {
        adminId: account!.id, action: BALANCE_ACTION, targetType: "account", targetId: id, at: now, reasoning: body.reason,
        before: { cash: before.toString(), companyId: cid },
        after: { cash: after.toString(), delta: delta.toString(), mode: body.mode, amount: amount.toString(), transactionId: led.id, companyId: cid },
      });
      await notify(tx, uow, cid, "admin_balance_adjusted", {}, now);
      uow.invalidate(cid, "finance", "company");
      return { companyId: cid, before: m(before), after: m(after), delta: m(delta), transactionId: led.id };
    },
  });
}
