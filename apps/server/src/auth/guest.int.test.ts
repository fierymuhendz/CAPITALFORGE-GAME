import { randomUUID } from "node:crypto";
import { PARAMS } from "@capitalforge/economy";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import { accounts, players, transfers } from "../db/schema";
import { applyTransfer } from "../ledger/transfer";
import type { Redis } from "../redis";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb, setupTestRedis } from "../test/db";
import { registerRoutes } from "../http/routes";
import { createGuest } from "./guest";
import { createSession, getSession } from "./session";

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
afterEach(async () => {
  await assertLedgerBalanced(db);
});
afterAll(async () => {
  await app.close();
  await closeTestResources();
});

async function walletOf(playerId: string): Promise<bigint> {
  const [w] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  return w!.balance;
}

async function grantCount(playerId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(transfers)
    .where(eq(transfers.idempotencyKey, `grant:start:${playerId}`));
  return r!.c;
}

describe("başlangıç parası", () => {
  it("yeni misafir başlangıç parasını tam bir kez alır", async () => {
    const res = await createGuest(db, "ilkOyuncu");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await walletOf(res.playerId)).toBe(PARAMS.startingBalance);
    expect(await grantCount(res.playerId)).toBe(1);
  });

  it("grant iki kez çağrılınca ikinci çağrı duplicate döner, bakiye iki kat olmaz", async () => {
    const res = await createGuest(db, "ikiKezOyuncu");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [wallet] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.playerId, res.playerId), eq(accounts.kind, "player")));
    const [mint] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, "system:mint"));
    const legs = [
      { accountId: mint!.id, amount: -PARAMS.startingBalance },
      { accountId: wallet!.id, amount: PARAMS.startingBalance },
    ];
    const second = await db.transaction((tx) =>
      applyTransfer(tx, `grant:start:${res.playerId}`, "grant:start", legs),
    );

    expect(second.status).toBe("duplicate");
    expect(await walletOf(res.playerId)).toBe(PARAMS.startingBalance);
    expect(await grantCount(res.playerId)).toBe(1);
  });

  it("aynı ad için paralel 5 kayıtta yalnızca biri başarılı, başlangıç parası bir kez yazılır", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createGuest(db, "yarisOyuncu")));
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "USERNAME_TAKEN")).toHaveLength(4);
    const winner = winners[0]!;
    if (!winner.ok) return;
    expect(await walletOf(winner.playerId)).toBe(PARAMS.startingBalance);
    expect(await grantCount(winner.playerId)).toBe(1);
  });
});

describe("ad çakışması", () => {
  it("büyük/küçük harf farkı dahil aynı ad reddedilir ve yeni oyuncu oluşmaz", async () => {
    expect((await createGuest(db, "Kaan_01")).ok).toBe(true);
    expect(await createGuest(db, "kaan_01")).toEqual({ ok: false, error: "USERNAME_TAKEN" });
    expect(await createGuest(db, "KAAN_01")).toEqual({ ok: false, error: "USERNAME_TAKEN" });
    const [c] = await db.select({ c: sql<number>`count(*)::int` }).from(players);
    expect(c!.c).toBe(1);
  });

  it("HTTP: çakışan ad 409 USERNAME_TAKEN döner, geçersiz ad 400 INVALID", async () => {
    const first = await app.inject({ method: "POST", url: "/auth/guest", payload: { username: "httpOyuncu" } });
    expect(first.statusCode).toBe(200);

    const dup = await app.inject({ method: "POST", url: "/auth/guest", payload: { username: "HTTPOYUNCU" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toEqual({ error: "USERNAME_TAKEN" });

    const bad = await app.inject({ method: "POST", url: "/auth/guest", payload: { username: "a b" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: "INVALID" });
  });
});

describe("oturum token doğrulaması", () => {
  it("geçerli token oturumu döndürür", async () => {
    const token = await createSession(redis, { playerId: randomUUID(), username: "tokenOyuncu" });
    const s = await getSession(redis, token);
    expect(s?.username).toBe("tokenOyuncu");
  });

  it("boş, kısa, uzun, hiç verilmemiş veya tahrif edilmiş token reddedilir", async () => {
    const token = await createSession(redis, { playerId: randomUUID(), username: "tahrifOyuncu" });
    const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(await getSession(redis, undefined)).toBeNull();
    expect(await getSession(redis, null)).toBeNull();
    expect(await getSession(redis, "")).toBeNull();
    expect(await getSession(redis, "kisa")).toBeNull();
    expect(await getSession(redis, "x".repeat(129))).toBeNull();
    expect(await getSession(redis, "x".repeat(43))).toBeNull();
    expect(await getSession(redis, tampered)).toBeNull();
  });

  it("HTTP /me: token yoksa veya uydurulmuşsa 401, geçerliyse bakiye ile 200", async () => {
    const login = await app.inject({ method: "POST", url: "/auth/guest", payload: { username: "meOyuncu" } });
    const { token, playerId } = login.json() as { token: string; playerId: string };

    const none = await app.inject({ method: "GET", url: "/me" });
    expect(none.statusCode).toBe(401);

    const forged = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${randomUUID()}${randomUUID()}` },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toEqual({ error: "UNAUTHORIZED" });

    const ok = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ playerId, username: "meOyuncu", balance: PARAMS.startingBalance.toString() });
  });
});
