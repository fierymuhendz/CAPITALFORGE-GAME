import { randomUUID } from "node:crypto";
import { PARAMS } from "@capitalforge/economy";
import type { PlaceOrder } from "@capitalforge/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest } from "../auth/guest";
import { config } from "../config";
import type { Db } from "../db/client";
import { accounts, inventories, players, products, trades } from "../db/schema";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";
import { executeTrade } from "./trade";

let db: Db;
const original = config.newAccountTradeDelaySeconds;

beforeAll(async () => {
  db = await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
  config.newAccountTradeDelaySeconds = 600;
});
afterEach(async () => {
  config.newAccountTradeDelaySeconds = original;
  await assertLedgerBalanced(db);
});
afterAll(async () => {
  await closeTestResources();
});

async function newPlayer(): Promise<string> {
  const res = await createGuest(db, `cd_${randomUUID().slice(0, 8)}`);
  if (!res.ok) throw new Error("oyuncu oluşturulamadı");
  return res.playerId;
}
const ageAccount = (id: string, seconds: number) =>
  db.update(players).set({ createdAt: sql`now() - make_interval(secs => ${seconds})` }).where(eq(players.id, id));
const buy = (over: Partial<PlaceOrder> = {}): PlaceOrder => ({
  side: "buy",
  productId: "wheat",
  quantity: 1,
  idempotencyKey: randomUUID(),
  ...over,
});

async function snapshot(playerId: string) {
  const [w] = await db.select({ b: accounts.balance }).from(accounts).where(eq(accounts.playerId, playerId));
  const [p] = await db.select().from(products).where(eq(products.id, "wheat"));
  const [t] = await db.select({ c: sql<number>`count(*)::int` }).from(trades);
  const [e] = await db.execute<{ c: number }>(sql`select count(*)::int as c from ledger_entries`);
  return { balance: w!.b, price: p!.price, pool: [p!.poolUnits, p!.poolValue], trades: t!.c, entries: e!.c };
}

describe("yeni hesap bekleme süresi", () => {
  it("yeni oyuncunun alışı NEW_ACCOUNT_COOLDOWN ile reddedilir; defter, trades ve fiyat değişmez", async () => {
    const id = await newPlayer();
    const before = await snapshot(id);
    const r = await executeTrade(db, id, buy());
    expect(r).toMatchObject({ ok: false, error: "NEW_ACCOUNT_COOLDOWN" });
    expect(await snapshot(id)).toEqual(before);
  });

  it("satış da engellenir (envanter olsa bile)", async () => {
    const id = await newPlayer();
    await db.insert(inventories).values({ playerId: id, productId: "wheat", quantity: 5n });
    const before = await snapshot(id);
    const r = await executeTrade(db, id, buy({ side: "sell" }));
    expect(r).toMatchObject({ ok: false, error: "NEW_ACCOUNT_COOLDOWN" });
    expect(await snapshot(id)).toEqual(before);
    const [inv] = await db.select().from(inventories).where(eq(inventories.playerId, id));
    expect(inv!.quantity).toBe(5n);
  });

  it("süre geçince aynı idempotencyKey normal işlenir (reddedilen istek iz bırakmamıştı)", async () => {
    const id = await newPlayer();
    const o = buy();
    expect(await executeTrade(db, id, o)).toMatchObject({ ok: false, error: "NEW_ACCOUNT_COOLDOWN" });
    await ageAccount(id, 601);
    const r = await executeTrade(db, id, o);
    expect(r).toMatchObject({ ok: true, duplicate: false });
    const s = await snapshot(id);
    expect(s.trades).toBe(1);
    expect(s.balance < PARAMS.startingBalance).toBe(true);
  });

  it("süre dolmadan hemen önce hâlâ kilitli", async () => {
    const id = await newPlayer();
    await ageAccount(id, 590);
    expect(await executeTrade(db, id, buy())).toMatchObject({ ok: false, error: "NEW_ACCOUNT_COOLDOWN" });
  });

  it("delay=0 bekleme süresini kapatır", async () => {
    config.newAccountTradeDelaySeconds = 0;
    const id = await newPlayer();
    expect(await executeTrade(db, id, buy())).toMatchObject({ ok: true });
  });

  it("eşzamanlı alışlar: süre dolmuş oyuncuda defter dengeli, kilitli oyuncuda hiçbiri işlenmez", async () => {
    const old = await newPlayer();
    const fresh = await newPlayer();
    await ageAccount(old, 1000);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => executeTrade(db, old, buy())),
      ...Array.from({ length: 5 }, () => executeTrade(db, fresh, buy())),
    ]);
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results.slice(5).every((r) => !r.ok && r.error === "NEW_ACCOUNT_COOLDOWN")).toBe(true);
    const [t] = await db.select({ c: sql<number>`count(*)::int` }).from(trades).where(eq(trades.playerId, fresh));
    expect(t!.c).toBe(0);
  });
});
