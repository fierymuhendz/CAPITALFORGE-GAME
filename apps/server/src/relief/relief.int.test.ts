import { randomUUID } from "node:crypto";
import { PARAMS, inventoryValue } from "@capitalforge/economy";
import type { ActionResult } from "@capitalforge/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest } from "../auth/guest";
import { buyFacility } from "../company/buyFacility";
import { foundCompany } from "../company/found";
import type { Db } from "../db/client";
import { accounts, facilities, inventories, reliefClaims, transfers } from "../db/schema";
import { transfer } from "../ledger/transfer";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";
import { claimRelief, reliefAvailable } from "./claim";

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});
beforeEach(async () => {
  await resetTestDb(db);
});
afterEach(async () => {
  await assertLedgerBalanced(db);
});
afterAll(async () => {
  await closeTestResources();
});

const uniq = () => randomUUID().replace(/-/g, "").slice(0, 12);
const R = PARAMS.reliefAmount;
const THRESHOLD = PARAMS.reliefThreshold;

async function walletId(playerId: string): Promise<string> {
  const [w] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  return w!.id;
}

async function balanceOf(playerId: string): Promise<bigint> {
  const [w] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  return w!.balance;
}

async function setBalance(playerId: string, target: bigint): Promise<void> {
  const diff = target - (await balanceOf(playerId));
  if (diff === 0n) return;
  const [mint] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, "system:mint"));
  await transfer(db, `test:set:${playerId}:${randomUUID()}`, "test:set", [
    { accountId: await walletId(playerId), amount: diff },
    { accountId: mint!.id, amount: -diff },
  ]);
}

async function newPlayer(balance: bigint = PARAMS.startingBalance): Promise<string> {
  const res = await createGuest(db, `p_${uniq()}`);
  if (!res.ok) throw new Error("test oyuncusu oluşturulamadı");
  await setBalance(res.playerId, balance);
  return res.playerId;
}

async function grant(playerId: string, productId: string, qty: bigint): Promise<void> {
  await db
    .insert(inventories)
    .values({ playerId, productId, quantity: qty })
    .onConflictDoUpdate({
      target: [inventories.playerId, inventories.productId],
      set: { quantity: sql`${inventories.quantity} + ${qty}` },
    });
}

async function setTick(tick: bigint): Promise<void> {
  await db.execute(sql`UPDATE game_clock SET tick = ${tick} WHERE id = 1`);
}

function claim(playerId: string, key: string = randomUUID()): Promise<ActionResult> {
  return claimRelief(db, playerId, { idempotencyKey: key });
}

async function claimCount(playerId: string): Promise<number> {
  const rows = await db.select({ p: reliefClaims.period }).from(reliefClaims).where(eq(reliefClaims.playerId, playerId));
  return rows.length;
}

async function reliefTransferCount(playerId: string, period: bigint): Promise<number> {
  const rows = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(eq(transfers.idempotencyKey, `relief:${playerId}:${period}`));
  return rows.length;
}

describe("asgari ödenek: dönem başına tek ödeme", () => {
  it("aynı dönemde 10 paralel istek (farklı anahtar) → 1 ödeme, 9 NOT_ELIGIBLE", async () => {
    const p = await newPlayer(0n);
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(p)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.flatMap((r) => (r.ok ? [] : [r.error]))).toEqual(Array(9).fill("NOT_ELIGIBLE"));
    expect(await balanceOf(p)).toBe(R);
    expect(await claimCount(p)).toBe(1);
    expect(await reliefTransferCount(p, 0n)).toBe(1);
  });

  it("aynı anahtarla 10 paralel istek → tek etki, geri kalanı duplicate", async () => {
    const p = await newPlayer(0n);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => claim(p, key)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.duplicate)).toHaveLength(9);
    expect(await balanceOf(p)).toBe(R);
    expect(await claimCount(p)).toBe(1);
    expect(await reliefTransferCount(p, 0n)).toBe(1);
  });

  it("dönem sınırı: tick 86399 hâlâ aynı dönem (NOT_ELIGIBLE), tick 86400 yeni dönem (ödenir)", async () => {
    const p = await newPlayer(0n);
    expect((await claim(p)).ok).toBe(true);

    await setTick(PARAMS.reliefCooldownTicks - 1n);
    expect(await claim(p)).toMatchObject({ ok: false, error: "NOT_ELIGIBLE" });
    expect(await balanceOf(p)).toBe(R);

    await setTick(PARAMS.reliefCooldownTicks);
    expect((await claim(p)).ok).toBe(true);
    expect(await balanceOf(p)).toBe(2n * R);
    expect(await reliefTransferCount(p, 1n)).toBe(1);
  });
});

describe("asgari ödenek: uygunluk", () => {
  it("eşik üstü (varsayılan 10M) oyuncu NOT_ELIGIBLE, bakiye değişmez", async () => {
    const p = await newPlayer();
    expect(await claim(p)).toMatchObject({ ok: false, error: "NOT_ELIGIBLE" });
    expect(await balanceOf(p)).toBe(PARAMS.startingBalance);
    expect(await reliefAvailable(db, p)).toBe(false);
  });

  it("nakit eşiğin bir kuruş altındaysa alır; tam eşikteyse NOT_ELIGIBLE (sınır değer)", async () => {
    const below = await newPlayer(THRESHOLD - 1n);
    expect(await reliefAvailable(db, below)).toBe(true);
    expect((await claim(below)).ok).toBe(true);
    expect(await balanceOf(below)).toBe(THRESHOLD - 1n + R);

    const at = await newPlayer(THRESHOLD);
    expect(await reliefAvailable(db, at)).toBe(false);
    expect(await claim(at)).toMatchObject({ ok: false, error: "NOT_ELIGIBLE" });
    expect(await balanceOf(at)).toBe(THRESHOLD);
  });

  it("nakit + envanter değeri eşiği aşarsa NOT_ELIGIBLE; altındaysa uygun (sınır)", async () => {
    // Fiyat sunucuda 500 (seed). Birim değer sistem lehine ölçülür.
    const unit = inventoryValue([{ price: 500n, qty: 1n }]);
    const need = (THRESHOLD + unit - 1n) / unit;

    const under = await newPlayer(0n);
    await grant(under, "wheat", need - 1n);
    expect(inventoryValue([{ price: 500n, qty: need - 1n }])).toBeLessThan(THRESHOLD);
    expect((await claim(under)).ok).toBe(true);

    const over = await newPlayer(0n);
    await grant(over, "wheat", need);
    expect(inventoryValue([{ price: 500n, qty: need }])).toBeGreaterThanOrEqual(THRESHOLD);
    expect(await claim(over)).toMatchObject({ ok: false, error: "NOT_ELIGIBLE" });
    expect(await balanceOf(over)).toBe(0n);
  });

  it("aktif tesisi olan oyuncu nakitsiz olsa bile NOT_ELIGIBLE", async () => {
    const p = await newPlayer();
    expect((await foundCompany(db, p, { name: `Firma${uniq()}`, idempotencyKey: randomUUID() })).ok).toBe(true);
    const f = await buyFacility(db, p, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: randomUUID() });
    expect(f.ok).toBe(true);
    await setBalance(p, 0n);

    expect(await reliefAvailable(db, p)).toBe(false);
    expect(await claim(p)).toMatchObject({ ok: false, error: "NOT_ELIGIBLE" });
    expect(await balanceOf(p)).toBe(0n);
  });

  it("askıdaki tesisi olan ve nakitsiz oyuncu ödenek alabilir", async () => {
    const p = await newPlayer();
    expect((await foundCompany(db, p, { name: `Firma${uniq()}`, idempotencyKey: randomUUID() })).ok).toBe(true);
    const f = await buyFacility(db, p, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: randomUUID() });
    if (!f.ok || !f.refId) throw new Error("tesis alınamadı");
    await db.update(facilities).set({ status: "suspended" }).where(eq(facilities.id, f.refId));
    await setBalance(p, 0n);

    expect(await reliefAvailable(db, p)).toBe(true);
    const r = await claim(p);
    expect(r.ok).toBe(true);
    expect(await balanceOf(p)).toBe(R);
  });

  it("şirketi olan ama tesisi olmayan nakitsiz oyuncu ödenek alabilir", async () => {
    const p = await newPlayer();
    expect((await foundCompany(db, p, { name: `Firma${uniq()}`, idempotencyKey: randomUUID() })).ok).toBe(true);
    await setBalance(p, 0n);
    expect((await claim(p)).ok).toBe(true);
  });
});
