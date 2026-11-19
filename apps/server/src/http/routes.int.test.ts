import { MeSchema } from "@capitalforge/shared";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis as IORedis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest } from "../auth/guest";
import { createSession } from "../auth/session";
import { config } from "../config";
import type { Db } from "../db/client";
import { players } from "../db/schema";
import type { Redis } from "../redis";
import { closeTestResources, resetTestDb, setupTestDb, setupTestRedis } from "../test/db";
import { registerRoutes } from "./routes";

let db: Db;
let redis: Redis;
let app: FastifyInstance;
const original = config.newAccountTradeDelaySeconds;

beforeAll(async () => {
  db = await setupTestDb();
  redis = setupTestRedis();
  app = Fastify();
  registerRoutes(app, { db, redis });
  await app.ready();
});
beforeEach(async () => {
  await redis.flushdb();
  await resetTestDb(db);
  config.newAccountTradeDelaySeconds = original;
});
afterAll(async () => {
  config.newAccountTradeDelaySeconds = original;
  await app.close();
  await closeTestResources();
});

const report = (payload: unknown, ip?: string) =>
  app.inject({ method: "POST", url: "/client-errors", payload: payload as object, ...(ip ? { remoteAddress: ip } : {}) });
const valid = { kind: "error", message: "boom", path: "/oyun" };

describe("GET /me tradeUnlockAt", () => {
  it("created_at + bekleme süresi olarak döner ve şemaya uyar", async () => {
    config.newAccountTradeDelaySeconds = 600;
    const g = await createGuest(db, "meOyuncu");
    if (!g.ok) throw new Error("kayıt");
    const token = await createSession(redis, { playerId: g.playerId, username: g.username });
    const [row] = await db.select({ c: players.createdAt }).from(players).where(eq(players.id, g.playerId));
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const me = MeSchema.parse(res.json());
    expect(new Date(me.tradeUnlockAt).getTime()).toBe(row!.c.getTime() + 600_000);
  });

  it("delay=0 iken tradeUnlockAt oluşturulma anıdır (geçmiş)", async () => {
    config.newAccountTradeDelaySeconds = 0;
    const g = await createGuest(db, "meOyuncu0");
    if (!g.ok) throw new Error("kayıt");
    const token = await createSession(redis, { playerId: g.playerId, username: g.username });
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(new Date(res.json().tradeUnlockAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("POST /client-errors", () => {
  it("geçerli bildirim 204", async () => {
    expect((await report(valid)).statusCode).toBe(204);
    expect((await report({ kind: "react", message: "x", stack: "s", release: "abc" })).statusCode).toBe(204);
  });

  it("geçersiz gövde 400: tür, boş mesaj, uzun mesaj, path / ile başlamıyor, fazladan alan", async () => {
    const bad = [
      { ...valid, kind: "other" },
      { ...valid, message: "" },
      { ...valid, message: "x".repeat(501) },
      { ...valid, path: "https://evil.example/" },
      { ...valid, extra: 1 },
      { ...valid, stack: "x".repeat(4001) },
    ];
    for (const b of bad) expect((await report(b, "192.0.2.1")).statusCode).toBe(400);
  });

  it("8 KB üstü gövde reddedilir (400)", async () => {
    const res = await report({ ...valid, stack: "x".repeat(9000) });
    expect(res.statusCode).toBe(400);
  });

  it("IP başına 10/dk: 11. istek 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await report(valid, "198.51.100.9")).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 204)).toBe(true);
    expect(codes[10]).toBe(429);
    expect((await report(valid, "198.51.100.10")).statusCode).toBe(204);
  });

  it("toplam 600/dk sınırı aşılınca 429", async () => {
    await redis.set("rl:clienterr:all", "600", "PX", 60_000);
    expect((await report(valid, "203.0.113.77")).statusCode).toBe(429);
  });

  it("Redis hatasında reddeder (fail closed), iç ayrıntı sızdırmaz", async () => {
    const down = new IORedis("redis://127.0.0.1:1", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0 });
    const a = Fastify();
    registerRoutes(a, { db, redis: down as unknown as Redis });
    await a.ready();
    try {
      const res = await a.inject({ method: "POST", url: "/client-errors", payload: valid });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "INTERNAL" });
    } finally {
      await a.close();
      down.disconnect();
    }
  });
});
