import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import type { Redis as RedisClient } from "../redis";
import { closeTestResources, setupTestRedis } from "../test/db";
import { allow, allowGuestLogin, allowOrder, ipBucket48, LIMITS, recordGuestSignup } from "./rateLimit";

let redis: RedisClient;

beforeAll(() => {
  redis = setupTestRedis();
});
beforeEach(async () => {
  await redis.flushdb();
});
afterAll(async () => {
  await closeTestResources();
});

describe("emir hız sınırı (5/sn/oyuncu)", () => {
  it("6. istek reddedilir, ilk 5 kabul edilir", async () => {
    const playerId = randomUUID();
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(await allowOrder(redis, playerId));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("bir oyuncunun sınırı diğerini etkilemez", async () => {
    const a = randomUUID();
    const b = randomUUID();
    for (let i = 0; i < LIMITS.order.limit; i++) await allowOrder(redis, a);
    expect(await allowOrder(redis, a)).toBe(false);
    expect(await allowOrder(redis, b)).toBe(true);
  });

  it("pencere dolunca yeniden izin verilir", async () => {
    const key = `window-${randomUUID()}`;
    expect(await allow(redis, key, 2, 200)).toBe(true);
    expect(await allow(redis, key, 2, 200)).toBe(true);
    expect(await allow(redis, key, 2, 200)).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
    expect(await allow(redis, key, 2, 200)).toBe(true);
  });
});

describe("misafir giriş hız sınırı (5/dk/IP)", () => {
  it("6. giriş denemesi aynı IP için reddedilir", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(await allowGuestLogin(redis, ip));
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(await allowGuestLogin(redis, "198.51.100.7")).toBe(true);
  });
});

describe("misafir günlük tavanı (20/24 sa/IP /64, 100/24 sa /48)", () => {
  it("aynı /64 ağından 21. kayıt reddedilir, başka ağ etkilenmez", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 21; i++) {
      // Dakikalık sayaçları sıfırla; yalnızca günlük tavan sınanır. Her istek aynı /64 içinde farklı adrestendir.
      await redis.del("rl:guest:2001:db8:1:2::/64", "rl:guest:all");
      const ip = `2001:db8:1:2::${(i + 1).toString(16)}`;
      const ok = await allowGuestLogin(redis, ip);
      results.push(ok);
      if (ok) await recordGuestSignup(redis, ip);
    }
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
    expect(LIMITS.guestLoginDaily.limit).toBe(20);
    expect(await redis.pttl("rl:guestday:2001:db8:1:2::/64")).toBeGreaterThan(80_000_000);
    expect(await allowGuestLogin(redis, "2001:db8:1:3::1")).toBe(true);
  });

  it("günlük sayaç yalnızca recordGuestSignup ile artar (başarısız kayıt sayılmaz)", async () => {
    for (let i = 0; i < 3; i++) {
      await redis.del("rl:guest:2001:db8:9:9::/64", "rl:guest:all");
      expect(await allowGuestLogin(redis, "2001:db8:9:9::1")).toBe(true);
    }
    expect(await redis.get("rl:guestday:2001:db8:9:9::/64")).toBeNull();
    await recordGuestSignup(redis, "2001:db8:9:9::1");
    expect(await redis.get("rl:guestday:2001:db8:9:9::/64")).toBe("1");
  });

  it("/48 tavanı: farklı /64'lerden 100 kayıttan sonra aynı /48 reddedilir", async () => {
    expect(ipBucket48("2001:db8:7:5::1")).toBe("2001:db8:7::/48");
    expect(ipBucket48("203.0.113.5")).toBeNull();
    await redis.set("rl:guestday48:2001:db8:7::/48", "100", "PX", 60_000);
    await redis.del("rl:guest:all");
    expect(await allowGuestLogin(redis, "2001:db8:7:ffff::1")).toBe(false);
    expect(await allowGuestLogin(redis, "2001:db8:8::1")).toBe(true);
  });
});

describe("Redis hatasında fail closed", () => {
  it("Redis erişilemezse allow istisna fırlatır (çağıran isteği reddeder)", async () => {
    const down = new Redis("redis://127.0.0.1:1", {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    try {
      await expect(allowOrder(down, randomUUID())).rejects.toThrow();
    } finally {
      down.disconnect();
    }
  });
});
