import { randomUUID } from "node:crypto";
import { RECIPES, RECIPE_IDS } from "@capitalforge/economy";
import { MSG, StartProductionSchema, type ActionResult, type OrderResult } from "@capitalforge/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, revokeSession, type Session } from "../auth/session";
import { createGuest } from "../auth/guest";
import { foundCompany } from "../company/found";
import { buyFacility } from "../company/buyFacility";
import type { Db } from "../db/client";
import { accounts, companies, facilities, productionJobs, trades } from "../db/schema";
import { bridgeTicks } from "../market/ticker";
import { startProduction } from "../production/start";
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
  handleAction(
    c: FakeClient,
    raw: unknown,
    schema: typeof StartProductionSchema,
    exec: typeof startProduction,
  ): Promise<void>;
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

describe("MarketRoom yetkisiz erişim (başkasının varlığı)", () => {
  /** Gerçek oyuncu (players + cüzdan) oluşturur; bakiye ve şirket sorguları için gerekir. */
  async function joinReal(tag: string) {
    const g = await createGuest(db, `${tag}_${randomUUID().slice(0, 6)}`);
    if (!g.ok) throw new Error("misafir oluşturulamadı");
    const token = await createSession(redis, { playerId: g.playerId, username: g.username });
    const client: FakeClient = { sessionId: randomUUID(), send: vi.fn(), leave: vi.fn() };
    client.auth = await internals().onAuth(client, { token });
    internals().clients.push(client);
    return { token, client };
  }
  const balanceOf = async (playerId: string) => {
    const [w] = await db.select({ b: accounts.balance }).from(accounts).where(eq(accounts.playerId, playerId));
    return w!.b;
  };
  const tradeCount = async (playerId: string) => {
    const [t] = await db.select({ c: sql<number>`count(*)::int` }).from(trades).where(eq(trades.playerId, playerId));
    return t!.c;
  };
  const lastResult = <T>(client: FakeClient, type: string): T | undefined =>
    client.send.mock.calls.filter((c) => c[0] === type).at(-1)?.[1] as T | undefined;

  it("emir mesajına başkasının playerId alanı eklenirse şema reddeder; hiçbir bakiye/işlem değişmez", async () => {
    const victim = await joinReal("kurbanEmir");
    const attacker = await joinReal("saldirganEmir");
    const victimId = victim.client.auth!.playerId;
    const attackerId = attacker.client.auth!.playerId;
    const victimBefore = await balanceOf(victimId);
    const attackerBefore = await balanceOf(attackerId);

    await internals().handleOrder(attacker.client, { ...order(), playerId: victimId, side: "buy" });

    expect(lastResult<OrderResult>(attacker.client, MSG.orderResult)).toMatchObject({ ok: false, error: "INVALID" });
    expect(await balanceOf(victimId)).toBe(victimBefore);
    expect(await balanceOf(attackerId)).toBe(attackerBefore);
    expect(await tradeCount(victimId)).toBe(0);
    expect(await tradeCount(attackerId)).toBe(0);
  });

  it("geçerli bir alım yalnızca gönderenin cüzdanını etkiler (kimlik oturumdan gelir)", async () => {
    const victim = await joinReal("kurbanAlim");
    const attacker = await joinReal("saldirganAlim");
    const victimId = victim.client.auth!.playerId;
    const attackerId = attacker.client.auth!.playerId;
    const victimBefore = await balanceOf(victimId);

    await internals().handleOrder(attacker.client, order());

    expect(lastResult<OrderResult>(attacker.client, MSG.orderResult)).toMatchObject({ ok: true });
    expect(await tradeCount(attackerId)).toBe(1);
    expect(await tradeCount(victimId)).toBe(0);
    expect(await balanceOf(victimId)).toBe(victimBefore);
  });

  it("başkasının tesisinde üretim başlatılamaz (UNAUTHORIZED), tesis ve iş değişmez", async () => {
    const owner = await joinReal("tesisSahibi");
    const attacker = await joinReal("tesisSaldirgan");
    const ownerId = owner.client.auth!.playerId;
    const recipeId = RECIPE_IDS[0]!;
    const facilityType = RECIPES[recipeId].facility;

    const found = await foundCompany(db, ownerId, { name: "Sahip Sanayi", idempotencyKey: randomUUID() });
    expect(found).toMatchObject({ ok: true });
    const bought = await buyFacility(db, ownerId, { type: facilityType, plotX: 1, plotY: 1, idempotencyKey: randomUUID() });
    expect(bought).toMatchObject({ ok: true });
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.playerId, ownerId));
    const [facility] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.companyId, company!.id));

    const req = { facilityId: facility!.id, recipeId, batches: 1, idempotencyKey: randomUUID() };
    await internals().handleAction(attacker.client, req, StartProductionSchema, startProduction);

    expect(lastResult<ActionResult>(attacker.client, MSG.actionResult)).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
    const jobs = await db.select({ id: productionJobs.id }).from(productionJobs).where(eq(productionJobs.facilityId, facility!.id));
    expect(jobs).toHaveLength(0);
  });

  it("var olmayan tesis kimliği de aynı UNAUTHORIZED yanıtını alır (varlık sızmaz)", async () => {
    const attacker = await joinReal("varYokTesis");
    const req = { facilityId: randomUUID(), recipeId: RECIPE_IDS[0]!, batches: 1, idempotencyKey: randomUUID() };
    await internals().handleAction(attacker.client, req, StartProductionSchema, startProduction);
    expect(lastResult<ActionResult>(attacker.client, MSG.actionResult)).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
  });
});
