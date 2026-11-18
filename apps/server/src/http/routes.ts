import {
  GuestLoginSchema,
  HISTORY_LIMIT,
  HistoryQuerySchema,
  type ApiError,
  type GuestLoginResponse,
  type HistoryResponse,
  type Me,
} from "@capitalforge/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createGuest } from "../auth/guest";
import { createSession, getSession, type Session } from "../auth/session";
import type { Db } from "../db/client";
import { priceHistory, products } from "../db/schema";
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
  app.setErrorHandler((err, req, reply) => {
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
}
