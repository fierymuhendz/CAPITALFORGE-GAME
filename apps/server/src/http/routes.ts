import { FACILITY_TYPES, PARAMS, RECIPES, RECIPE_IDS, facilityPrice, upkeep } from "@capitalforge/economy";
import {
  CITY,
  CityQuerySchema,
  GuestLoginSchema,
  HISTORY_LIMIT,
  HistoryQuerySchema,
  type ApiError,
  type Catalog,
  type CityResponse,
  type FacilityTypeId,
  type GuestLoginResponse,
  type HistoryResponse,
  type Me,
} from "@capitalforge/shared";
import { count, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createGuest } from "../auth/guest";
import { createSession, getSession, type Session } from "../auth/session";
import type { Db } from "../db/client";
import { companies, facilities, gameClock, priceHistory, products } from "../db/schema";
import { getCompanyView } from "../company/view";
import { getPortfolio } from "../market/portfolio";
import type { Redis } from "../redis";
import { allowGuestLogin } from "../security/rateLimit";

const send = (reply: FastifyReply, status: number, error: ApiError["error"]) => reply.code(status).send({ error } satisfies ApiError);

async function authenticate(redis: Redis, req: FastifyRequest): Promise<Session | null> {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
  return getSession(redis, token);
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
    const portfolio = await getPortfolio(db, session.playerId);
    return { playerId: session.playerId, username: session.username, ...portfolio } satisfies Me;
  });

  app.get("/market/history", async (req, reply) => {
    const parsed = HistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return send(reply, 400, "INVALID");
    const { productId } = parsed.data;
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
    if (!product) return send(reply, 404, "UNKNOWN_PRODUCT");

    const rows = await db
      .select({ tick: priceHistory.tick, price: priceHistory.price, at: priceHistory.at })
      .from(priceHistory)
      .where(eq(priceHistory.productId, productId))
      .orderBy(desc(priceHistory.tick))
      .limit(HISTORY_LIMIT);
    return {
      productId,
      points: rows.reverse().map((r) => ({ tick: Number(r.tick), price: r.price.toString(), at: r.at.toISOString() })),
    } satisfies HistoryResponse;
  });

  app.get("/catalog", async (req, reply) => {
    const session = await authenticate(redis, req);
    if (!session) return send(reply, 401, "UNAUTHORIZED");
    const [clock] = await db.select({ tick: gameClock.tick }).from(gameClock).where(eq(gameClock.id, 1));
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.playerId, session.playerId));
    let owned = 0n;
    if (company) {
      const [n] = await db.select({ n: count() }).from(facilities).where(eq(facilities.companyId, company.id));
      owned = BigInt(n?.n ?? 0);
    }
    return {
      clockTick: Number(clock?.tick ?? 0n),
      companyFoundingFee: PARAMS.companyFoundingFee.toString(),
      maxFacilitiesPerCompany: Number(PARAMS.maxFacilitiesPerCompany),
      upkeepPeriodTicks: Number(PARAMS.upkeepPeriodTicks),
      reliefAmount: PARAMS.reliefAmount.toString(),
      reliefCooldownTicks: Number(PARAMS.reliefCooldownTicks),
      facilityTypes: FACILITY_TYPES.map((type) => ({
        type,
        price: facilityPrice(type, owned).toString(),
        upkeep: upkeep(type, 1n).toString(),
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
    return getCompanyView(db, session.playerId);
  });

  // Herkese açık: arsa listesi yalnızca konum, tür, seviye ve şirket adını içerir.
  app.get("/city", async (req, reply) => {
    const parsed = CityQuerySchema.safeParse(req.query);
    if (!parsed.success) return send(reply, 400, "INVALID");
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
      .where(eq(facilities.cityId, parsed.data.cityId));
    return {
      cityId: parsed.data.cityId,
      width: CITY.width,
      height: CITY.height,
      plots: rows.map((r) => ({ ...r, type: r.type as FacilityTypeId })),
    } satisfies CityResponse;
  });
}
