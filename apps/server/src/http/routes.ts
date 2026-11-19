import { FACILITY_TYPES, PARAMS, RECIPES, RECIPE_IDS, facilityPrice, poolMaxOrder, upkeep } from "@capitalforge/economy";
import {
  CITY,
  CityQuerySchema,
  ClientErrorReportSchema,
  GuestLoginSchema,
  HISTORY_LIMIT,
  HistoryQuerySchema,
  LogoutRequestSchema,
  type ApiError,
  type Catalog,
  type CityResponse,
  type FacilityTypeId,
  type GuestLoginResponse,
  type HistoryResponse,
  type Me,
} from "@capitalforge/shared";
import { asc, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createGuest } from "../auth/guest";
import { createSession, getSession, revokeSession, type Session } from "../auth/session";
import { config } from "../config";
import type { Db } from "../db/client";
import { companies, facilities, gameClock, priceHistory, products } from "../db/schema";
import { getCompanyView } from "../company/view";
import { getPortfolio } from "../market/portfolio";
import type { Redis } from "../redis";
import { tradeUnlockAt } from "../market/cooldown";
import { allow, allowClientError, allowGuestLogin, allowRead, ipBucket } from "../security/rateLimit";

const send = (reply: FastifyReply, status: number, error: ApiError["error"]) => reply.code(status).send({ error } satisfies ApiError);

function bearerToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
}

async function authenticate(redis: Redis, req: FastifyRequest): Promise<Session | null> {
  return getSession(redis, bearerToken(req));
}

export function registerRoutes(app: FastifyInstance, deps: { db: Db; redis: Redis }): void {
  const { db, redis } = deps;

  // Beklenmeyen hatalar: iç ayrıntı (SQL, stack) istemciye gitmez, sadece sunucu günlüğüne.
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    // İstemci hataları (bozuk JSON, büyük gövde): 400, günlüğü şişirmez.
    if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      return send(reply, 400, "INVALID");
    }
    req.log.error(err);
    return send(reply, 500, "INTERNAL");
  });

  // Okuma uçları: IP başına hız sınırı (oturum çözülmeden önce, Redis'i oturum aramalarından korur).
  // Redis hatasında istek reddedilir (fail closed). Oyuncu başına sınır, kimlik doğrulanınca ayrıca uygulanır.
  const READ_PATHS = new Set(["/me", "/market/history", "/catalog", "/company", "/city"]);
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" || !READ_PATHS.has(req.url.split("?")[0] ?? "")) return;
    if (!(await allowRead(redis, `ip:${ipBucket(req.ip)}`))) return send(reply, 429, "RATE_LIMITED");
  });

  // Herkese açık, oyuncuya özel olmayan yanıtlar için 1 sn'lik bellek içi önbellek.
  const memo = new Map<string, { at: number; value: unknown }>();
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && now - hit.at < 1000) return hit.value as T;
    const value = await load();
    if (memo.size >= 500) for (const [k, v] of memo) if (now - v.at >= 1000) memo.delete(k);
    if (memo.size >= 500) memo.clear();
    memo.set(key, { at: now, value });
    return value;
  }

  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/guest", async (req, reply) => {
    if (!(await allowGuestLogin(redis, req.ip))) return send(reply, 429, "RATE_LIMITED");
    const parsed = GuestLoginSchema.safeParse(req.body);
    if (!parsed.success) return send(reply, 400, "INVALID");

    const result = await createGuest(db, parsed.data.username);
    if (!result.ok) return send(reply, 409, "USERNAME_TAKEN");

    const token = await createSession(redis, { playerId: result.playerId, username: result.username });
    return { token, playerId: result.playerId, username: result.username } satisfies GuestLoginResponse;
  });

  app.get("/me", async (req, reply) => {
    const session = await authenticate(redis, req);
    if (!session) return send(reply, 401, "UNAUTHORIZED");
    if (!(await allowRead(redis, `p:${session.playerId}`))) return send(reply, 429, "RATE_LIMITED");
    const portfolio = await getPortfolio(db, session.playerId);
    const unlock = await tradeUnlockAt(db, session.playerId, config.newAccountTradeDelaySeconds);
    return { playerId: session.playerId, username: session.username, ...portfolio, tradeUnlockAt: unlock.toISOString() } satisfies Me;
  });

  // Çıkış: geçersiz token için de 204 (idempotent, bilgi sızdırmaz). all=true tüm cihazlardaki oturumları kapatır.
  app.post("/auth/logout", async (req, reply) => {
    if (!(await allow(redis, `logout:${ipBucket(req.ip)}`, 20, 60_000))) return send(reply, 429, "RATE_LIMITED");
    const parsed = LogoutRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return send(reply, 400, "INVALID");
    await revokeSession(redis, bearerToken(req), parsed.data.all === true);
    return reply.code(204).send();
  });

  // İstemci hata bildirimi: kimliksiz, küçük gövde, IP başına ve toplam sınır. Redis hatasında reddeder.
  app.post("/client-errors", { bodyLimit: 8 * 1024 }, async (req, reply) => {
    try {
      if (!(await allowClientError(redis, req.ip))) return send(reply, 429, "RATE_LIMITED");
    } catch {
      return send(reply, 503, "INTERNAL");
    }
    const parsed = ClientErrorReportSchema.safeParse(req.body);
    if (!parsed.success) return send(reply, 400, "INVALID");
    req.log.warn({ src: "web", clientError: parsed.data }, "istemci hatası");
    return reply.code(204).send();
  });

  app.get("/market/history", async (req, reply) => {
    const parsed = HistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return send(reply, 400, "INVALID");
    const { productId } = parsed.data;
    const body = await cached(`history:${productId}`, async (): Promise<HistoryResponse | null> => {
      const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
      if (!product) return null;
      const rows = await db
        .select({ tick: priceHistory.tick, price: priceHistory.price, at: priceHistory.at })
        .from(priceHistory)
        .where(eq(priceHistory.productId, productId))
        .orderBy(desc(priceHistory.tick))
        .limit(HISTORY_LIMIT);
      return {
        productId,
        points: rows.reverse().map((r) => ({ tick: Number(r.tick), price: r.price.toString(), at: r.at.toISOString() })),
      };
    });
    if (!body) return send(reply, 404, "UNKNOWN_PRODUCT");
    return body;
  });

  app.get("/catalog", async (req, reply) => {
    const session = await authenticate(redis, req);
    if (!session) return send(reply, 401, "UNAUTHORIZED");
    if (!(await allowRead(redis, `p:${session.playerId}`))) return send(reply, 429, "RATE_LIMITED");
    const [clock] = await db.select({ tick: gameClock.tick }).from(gameClock).where(eq(gameClock.id, 1));
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.playerId, session.playerId));
    let owned = 0n;
    if (company) {
      const [n] = await db.select({ n: count() }).from(facilities).where(eq(facilities.companyId, company.id));
      owned = BigInt(n?.n ?? 0);
    }
    const productRows = await db.select().from(products).orderBy(asc(products.id));
    return {
      clockTick: Number(clock?.tick ?? 0n),
      products: productRows.map((r) => ({
        productId: r.id,
        price: r.price.toString(),
        maxOrder: poolMaxOrder({ units: r.poolUnits, value: r.poolValue }).toString(),
      })),
      companyFoundingFee: PARAMS.companyFoundingFee.toString(),
      maxFacilitiesPerCompany: Number(PARAMS.maxFacilitiesPerCompany),
      upkeepPeriodTicks: Number(PARAMS.upkeepPeriodTicks),
      reliefAmount: PARAMS.reliefAmount.toString(),
      reliefCooldownTicks: Number(PARAMS.reliefCooldownTicks),
      facilityTypes: FACILITY_TYPES.map((type) => ({
        type,
        price: facilityPrice(type, owned).toString(),
        upkeep: upkeep(type, 1n, owned + 1n).toString(),
      })),
      recipes: RECIPE_IDS.map((id) => {
        const r = RECIPES[id];
        return {
          id,
          facilityType: r.facility,
          inputs: r.inputs.map((l) => ({ productId: l.productId, qty: l.qty.toString() })),
          output: { productId: r.output.productId, qty: r.output.qty.toString() },
          durationTicks: Number(r.durationTicks),
        };
      }),
    } satisfies Catalog;
  });

  app.get("/company", async (req, reply) => {
    const session = await authenticate(redis, req);
    if (!session) return send(reply, 401, "UNAUTHORIZED");
    if (!(await allowRead(redis, `p:${session.playerId}`))) return send(reply, 429, "RATE_LIMITED");
    return getCompanyView(db, session.playerId);
  });

  // Herkese açık: arsa listesi yalnızca konum, tür, seviye ve şirket adını içerir.
  app.get("/city", async (req, reply) => {
    const parsed = CityQuerySchema.safeParse(req.query);
    if (!parsed.success) return send(reply, 400, "INVALID");
    const { cityId } = parsed.data;
    return cached(`city:${cityId}`, async (): Promise<CityResponse> => {
      const rows = await db
        .select({
          plotX: facilities.plotX,
          plotY: facilities.plotY,
          type: facilities.type,
          level: facilities.level,
          companyName: companies.name,
        })
        .from(facilities)
        .innerJoin(companies, eq(companies.id, facilities.companyId))
        .where(eq(facilities.cityId, cityId));
      return {
        cityId,
        width: CITY.width,
        height: CITY.height,
        plots: rows.map((r) => ({ ...r, type: r.type as FacilityTypeId })),
      };
    });
  });
}
