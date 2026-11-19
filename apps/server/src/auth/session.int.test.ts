import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import type { Db } from "../db/client";
import { registerRoutes } from "../http/routes";
import type { Redis } from "../redis";
import { closeTestResources, resetTestDb, setupTestDb, setupTestRedis } from "../test/db";
import { REVOKE_CHANNEL, createSession, getSession, hashToken, revokeSession } from "./session";

let db: Db;
let redis: Redis;
let app: FastifyInstance;

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
});
afterAll(async () => {
  await app.close();
  await closeTestResources();
});

const logout = (token: string | undefined, payload?: unknown) =>
  app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as object | undefined,
  });

describe("POST /auth/logout", () => {
  it("çıkıştan sonra getSession null, 204 döner", async () => {
    const token = await createSession(redis, { playerId: randomUUID(), username: "cikisA" });
    expect(await getSession(redis, token)).not.toBeNull();
    const res = await logout(token, {});
    expect(res.statusCode).toBe(204);
    expect(await getSession(redis, token)).toBeNull();
  });

  it("gövdesiz çağrı da kabul edilir", async () => {
    const token = await createSession(redis, { playerId: randomUUID(), username: "cikisB" });
    expect((await logout(token)).statusCode).toBe(204);
    expect(await getSession(redis, token)).toBeNull();
  });

  it("all=false yalnızca o oturumu kapatır, aynı oyuncunun diğer oturumu kalır", async () => {
    const playerId = randomUUID();
    const t1 = await createSession(redis, { playerId, username: "cokCihaz" });
    const t2 = await createSession(redis, { playerId, username: "cokCihaz" });
    await logout(t1, { all: false });
    expect(await getSession(redis, t1)).toBeNull();
    expect(await getSession(redis, t2)).not.toBeNull();
    expect(await redis.sismember(`psess:${playerId}`, hashToken(t2))).toBe(1);
    expect(await redis.sismember(`psess:${playerId}`, hashToken(t1))).toBe(0);
  });

  it("all=true oyuncunun tüm oturumlarını siler, başkasınınkini silmez", async () => {
    const playerId = randomUUID();
    const t1 = await createSession(redis, { playerId, username: "tumCihaz" });
    const t2 = await createSession(redis, { playerId, username: "tumCihaz" });
    const other = await createSession(redis, { playerId: randomUUID(), username: "baskasi" });
    expect((await logout(t1, { all: true })).statusCode).toBe(204);
    expect(await getSession(redis, t1)).toBeNull();
    expect(await getSession(redis, t2)).toBeNull();
    expect(await getSession(redis, other)).not.toBeNull();
    expect(await redis.exists(`psess:${playerId}`)).toBe(0);
  });

  it("geçersiz, eksik veya tahrif edilmiş token için de 204 (bilgi sızdırmaz)", async () => {
    expect((await logout(undefined, {})).statusCode).toBe(204);
    expect((await logout("x".repeat(43), {})).statusCode).toBe(204);
    expect((await logout("kisa", { all: true })).statusCode).toBe(204);
  });

  it("geçersiz gövde 400 INVALID", async () => {
    const token = await createSession(redis, { playerId: randomUUID(), username: "bozukGovde" });
    const res = await logout(token, { all: "evet" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "INVALID" });
    const extra = await logout(token, { all: true, x: 1 });
    expect(extra.statusCode).toBe(400);
    expect(await getSession(redis, token)).not.toBeNull();
  });

  it("iptal edilen özetler sess:revoked kanalına yayınlanır", async () => {
    const sub = redis.duplicate();
    const got = new Promise<string>((resolve) => sub.on("message", (_c, m) => resolve(m)));
    await sub.subscribe(REVOKE_CHANNEL);
    const token = await createSession(redis, { playerId: randomUUID(), username: "yayinli" });
    await revokeSession(redis, token, false);
    expect(JSON.parse(await got)).toEqual({ hashes: [hashToken(token)] });
    sub.disconnect();
  });
});

describe("psess", () => {
  it("her yeni oturumda TTL sessionTtlSeconds olarak yenilenir", async () => {
    const playerId = randomUUID();
    await createSession(redis, { playerId, username: "ttlOyuncu" });
    await redis.expire(`psess:${playerId}`, 10);
    expect(await redis.ttl(`psess:${playerId}`)).toBeLessThanOrEqual(10);
    await createSession(redis, { playerId, username: "ttlOyuncu" });
    const ttl = await redis.ttl(`psess:${playerId}`);
    expect(ttl).toBeGreaterThan(10);
    expect(ttl).toBeLessThanOrEqual(config.sessionTtlSeconds);
    expect(await redis.scard(`psess:${playerId}`)).toBe(2);
  });
});
