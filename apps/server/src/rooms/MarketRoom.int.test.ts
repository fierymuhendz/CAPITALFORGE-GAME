import { randomUUID } from "node:crypto";
import { MSG, type OrderResult } from "@capitalforge/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, revokeSession, type Session } from "../auth/session";
import type { Db } from "../db/client";
import { bridgeTicks } from "../market/ticker";
import type { Redis } from "../redis";
import { closeTestResources, resetTestDb, setupTestDb, setupTestRedis } from "../test/db";
import { MarketRoom } from "./MarketRoom";

let db: Db;
let redis: Redis;
let stopBridge: () => Promise<void>;
let room: MarketRoom;

/** Colyseus Client'ın sınanan yüzü. */
interface FakeClient {
  sessionId: string;
  auth?: Session;
  send: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
}

/** Odanın özel üyelerine test erişimi (any kullanmadan). */
interface RoomInternals {
  onAuth(c: FakeClient, options: unknown): Promise<Session>;
  handleOrder(c: FakeClient, raw: unknown): Promise<void>;
  clients: FakeClient[];
}
const internals = () => room as unknown as RoomInternals;

beforeAll(async () => {
  db = await setupTestDb();
  redis = setupTestRedis();
  MarketRoom.deps = { db, redis };
  stopBridge = await bridgeTicks(redis.duplicate());
});
beforeEach(async () => {
  await redis.flushdb();
  await resetTestDb(db);
  room = new MarketRoom();
  await room.onCreate();
});
afterEach(() => room.onDispose());
afterAll(async () => {
  await stopBridge();
  MarketRoom.deps = null;
  await closeTestResources();
});

async function join(username: string, playerId = randomUUID()) {
  const token = await createSession(redis, { playerId, username });
  const client: FakeClient = { sessionId: randomUUID(), send: vi.fn(), leave: vi.fn() };
  client.auth = await internals().onAuth(client, { token });
  internals().clients.push(client);
  return { token, client };
}

const order = () => ({ side: "buy", productId: "wheat", quantity: 1, idempotencyKey: randomUUID() });
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe("MarketRoom oturum iptali", () => {
  it("iptal yayınında eşleşen istemci 4002 ile atılır, diğeri kalır", async () => {
    const a = await join("odaA");
    const b = await join("odaB");
    await revokeSession(redis, a.token, false);
    await waitFor(() => a.client.leave.mock.calls.length > 0);
    expect(a.client.leave).toHaveBeenCalledWith(MarketRoom.CLOSE_SESSION_EXPIRED);
    expect(MarketRoom.CLOSE_SESSION_EXPIRED).toBe(4002);
    expect(b.client.leave).not.toHaveBeenCalled();
  });

  it("all=true aynı oyuncunun iki bağlantısını da atar", async () => {
    const playerId = randomUUID();
    const a = await join("odaC", playerId);
    const b = await join("odaC", playerId);
    await revokeSession(redis, a.token, true);
    await waitFor(() => a.client.leave.mock.calls.length > 0 && b.client.leave.mock.calls.length > 0);
    expect(a.client.leave).toHaveBeenCalledWith(4002);
    expect(b.client.leave).toHaveBeenCalledWith(4002);
  });

  it("yayın kaçsa bile iptal edilmiş oturumun sonraki emri UNAUTHORIZED olur", async () => {
    const a = await join("odaD");
    // Yayını atlamak için Redis'ten doğrudan sil (pub/sub yok).
    const keys = await redis.keys("sess:*");
    await redis.del(...keys.filter((k) => k !== "sess:revoked"));
    await internals().handleOrder(a.client, order());
    const call = a.client.send.mock.calls.find((c) => c[0] === MSG.orderResult);
    const result = call?.[1] as OrderResult;
    expect(result).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
    expect(a.client.leave).toHaveBeenCalledWith(4002);
  });
});
