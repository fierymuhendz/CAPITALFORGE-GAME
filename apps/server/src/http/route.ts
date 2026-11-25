/**
 * Rota yardımcısı: kimlik doğrulama, zod doğrulaması, CSRF başlığı, hız sınırı ve
 * istek düzeyinde idempotency tek yerde. Modüller yalnızca `route(...)` ile uç tanımlar.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client";
import { accounts, companies, idempotencyKeys } from "../db/schema";
import type { Deps } from "../deps";
import { AppError, fail } from "../errors";
import { UnitOfWork } from "../events/bus";
import { sessionFromRequest, type SessionInfo } from "../auth/session";
import { rateLimit } from "../security/rateLimit";
import { sha256 } from "../auth/crypto";

export type AuthLevel = "none" | "account" | "company" | "admin";

export interface Ctx<B> {
  deps: Deps;
  req: FastifyRequest;
  reply: FastifyReply;
  body: B;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  session: SessionInfo | null;
  account: typeof accounts.$inferSelect | null;
  company: typeof companies.$inferSelect | null;
  ip: string;
  now: Date;
}

export interface MutCtx<B> extends Ctx<B> {
  tx: Tx;
  uow: UnitOfWork;
}

interface RouteBase<S extends z.ZodTypeAny> {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  auth: AuthLevel;
  body?: S;
  /** dakikada en fazla istek (hesap/IP başına); varsayılan GET 240, diğerleri 90 */
  rateLimitPerMin?: number;
  rateKey?: string;
}

/** Okuma ucu: işlem açmaz */
export interface ReadRoute<S extends z.ZodTypeAny> extends RouteBase<S> {
  kind?: "read";
  handler: (ctx: Ctx<z.infer<S>>) => Promise<unknown>;
}
/** Değiştiren uç: tek veritabanı işlemi; gövdede idempotencyKey varsa yanıt saklanır */
export interface MutRoute<S extends z.ZodTypeAny> extends RouteBase<S> {
  kind: "mutation";
  handler: (ctx: MutCtx<z.infer<S>>) => Promise<unknown>;
}

function clientIp(req: FastifyRequest): string {
  return req.ip || "0.0.0.0";
}

async function resolveAuth(deps: Deps, req: FastifyRequest, level: AuthLevel) {
  const session = await sessionFromRequest(deps, req);
  if (level === "none") return { session, account: session?.account ?? null, company: session ? await companyOf(deps, session.account.id) : null };
  if (!session) fail("UNAUTHENTICATED");
  if (session.account.frozenAt && level !== "account") fail("ACCOUNT_FROZEN");
  const company = await companyOf(deps, session.account.id);
  if (level === "company" && !company) fail("NO_COMPANY");
  if (level === "admin") {
    if (session.account.role !== "admin") fail("FORBIDDEN");
    if (!session.account.totpEnabled || !session.adminVerified) fail("TOTP_REQUIRED");
  }
  return { session, account: session.account, company };
}

async function companyOf(deps: Deps, accountId: string) {
  const r = await deps.db
    .select()
    .from(companies)
    .where(and(eq(companies.accountId, accountId), isNull(companies.dissolvedAt)))
    .limit(1);
  return r[0] ?? null;
}

export function route<S extends z.ZodTypeAny>(app: FastifyInstance, deps: Deps, def: ReadRoute<S> | MutRoute<S>): void {
  app.route({
    method: def.method,
    url: def.url,
    handler: async (req, reply) => {
      const isMut = def.method !== "GET";
      if (isMut && req.headers["x-cf-intent"] !== "1") fail("FORBIDDEN");
      const ip = clientIp(req);
      const auth = await resolveAuth(deps, req, def.auth);
      const limit = def.rateLimitPerMin ?? (isMut ? 90 : 240);
      await rateLimit(deps, `${def.rateKey ?? (isMut ? "mut" : "get")}:${auth.account?.id ?? `ip:${ip}`}`, limit, 60);
      let body: unknown = undefined;
      if (def.body) {
        const parsed = def.body.safeParse(def.method === "GET" ? req.query : req.body ?? {});
        if (!parsed.success) {
          throw new AppError("BAD_REQUEST", { issue: parsed.error.issues[0]?.path.join(".") ?? "" });
        }
        body = parsed.data;
      }
      const base: Ctx<unknown> = {
        deps, req, reply, body, ip,
        params: (req.params ?? {}) as Record<string, string>,
        query: (req.query ?? {}) as Record<string, string | undefined>,
        session: auth.session, account: auth.account, company: auth.company,
        now: deps.clock.now(),
      };
      if (def.kind !== "mutation") return (def as ReadRoute<S>).handler(base as Ctx<z.infer<S>>);

      const idemKey = typeof (body as { idempotencyKey?: unknown })?.idempotencyKey === "string" ? (body as { idempotencyKey: string }).idempotencyKey : null;
      const uow = new UnitOfWork();
      const scope = `${def.method} ${def.url}`;
      // gerçek yol + gövde (anahtar hariç) karması: aynı anahtarın başka bir isteğe yeniden kullanımı reddedilir
      const { idempotencyKey: _ik, ...bodyRest } = (body ?? {}) as Record<string, unknown>;
      void _ik;
      const requestHash = sha256(JSON.stringify([req.url.split("?")[0], bodyRest]));
      const result = await deps.db.transaction(async (tx) => {
        if (idemKey && auth.account) {
          const ins = await tx
            .insert(idempotencyKeys)
            .values({ accountId: auth.account.id, key: idemKey, scope, requestHash, status: 0, response: {} })
            .onConflictDoNothing()
            .returning({ key: idempotencyKeys.key });
          if (!ins[0]) {
            const prev = await tx
              .select()
              .from(idempotencyKeys)
              .where(and(eq(idempotencyKeys.accountId, auth.account.id), eq(idempotencyKeys.key, idemKey)))
              .limit(1);
            const p0 = prev[0];
            if (p0 && (p0.scope !== scope || (p0.requestHash !== null && p0.requestHash !== requestHash))) fail("IDEMPOTENCY_MISMATCH");
            return { replay: true as const, value: p0?.response ?? {} };
          }
        }
        const value = await (def as MutRoute<S>).handler({ ...(base as Ctx<z.infer<S>>), tx, uow });
        if (idemKey && auth.account) {
          await tx
            .update(idempotencyKeys)
            .set({ status: 200, response: (value ?? {}) as object })
            .where(and(eq(idempotencyKeys.accountId, auth.account.id), eq(idempotencyKeys.key, idemKey)));
        }
        return { replay: false as const, value };
      });
      if (!result.replay) uow.flush(deps.events);
      else reply.header("x-cf-replay", "1");
      return result.value ?? { ok: true };
    },
  });
}
