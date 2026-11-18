import { randomUUID } from "node:crypto";
import { PARAMS, quoteTrade } from "@capitalforge/economy";
import type { OrderResult, PlaceOrder } from "@capitalforge/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest } from "../auth/guest";
import type { Db } from "../db/client";
import { accounts, inventories, products, trades, transfers } from "../db/schema";
import { transfer } from "../ledger/transfer";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";
import { executeTrade } from "./trade";
import { runTick } from "./ticker";

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

/** Oyuncu oluşturur. target verilirse bakiye, sistem:mint ile dengeli bir transferle o değere ayarlanır. */
async function createPlayer(target?: bigint): Promise<string> {
  const res = await createGuest(db, `trader_${randomUUID().slice(0, 8)}`);
  if (!res.ok) throw new Error("test oyuncusu oluşturulamadı");
  if (target !== undefined && target !== PARAMS.startingBalance) {
    const [wallet] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.playerId, res.playerId), eq(accounts.kind, "player")));
    const [mint] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, "system:mint"));
    await transfer(db, `test:fund:${res.playerId}`, "test:fund", [
      { accountId: wallet!.id, amount: target - PARAMS.startingBalance },
      { accountId: mint!.id, amount: PARAMS.startingBalance - target },
    ]);
  }
  return res.playerId;
}

const order = (over: Partial<PlaceOrder> = {}): PlaceOrder => ({
  side: "buy",
  productId: "wheat",
  quantity: 1,
  idempotencyKey: randomUUID(),
  ...over,
});

async function priceOf(productId: string): Promise<bigint> {
  const [p] = await db.select({ price: products.price }).from(products).where(eq(products.id, productId));
  return p!.price;
}

async function balanceOf(playerId: string): Promise<bigint> {
  const [w] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.playerId, playerId), eq(accounts.kind, "player")));
  return w!.balance;
}

async function inventoryOf(playerId: string, productId: string): Promise<bigint> {
  const [i] = await db
    .select({ quantity: inventories.quantity })
    .from(inventories)
    .where(and(eq(inventories.playerId, playerId), eq(inventories.productId, productId)));
  return i?.quantity ?? 0n;
}

async function tradeCount(playerId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(trades)
    .where(eq(trades.playerId, playerId));
  return r!.c;
}

async function transferCountForKey(key: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(transfers)
    .where(eq(transfers.idempotencyKey, key));
  return r!.c;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`zaman aşımı (${ms} ms): olası deadlock`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

describe("executeTrade: bakiye ve miktar sınırları", () => {
  it("10 alımlık bakiyeyle 50 paralel alımda tam 10 başarılı, bakiye negatife düşmez", async () => {
    const unitCost = -quoteTrade("buy", await priceOf("wheat"), 1n).playerDelta;
    const playerId = await createPlayer(unitCost * 10n);

    const results = await Promise.all(
      Array.from({ length: 50 }, () => executeTrade(db, playerId, order({ side: "buy", quantity: 1 }))),
    );

    expect(results.filter((r) => !r.ok && r.error !== "INSUFFICIENT_FUNDS")).toEqual([]);
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await balanceOf(playerId)).toBe(0n);
    expect(await inventoryOf(playerId, "wheat")).toBe(10n);
    expect(await tradeCount(playerId)).toBe(10);
  });

  it("bakiye tam maliyete eşitse başarılı, bir kuruş eksikse INSUFFICIENT_FUNDS", async () => {
    const price = await priceOf("wheat");
    const cost = -quoteTrade("buy", price, 1n).playerDelta;

    const exact = await createPlayer(cost);
    expect((await executeTrade(db, exact, order({ side: "buy", quantity: 1 }))).ok).toBe(true);
    expect(await balanceOf(exact)).toBe(0n);

    const short = await createPlayer(cost - 1n);
    const r = await executeTrade(db, short, order({ side: "buy", quantity: 1 }));
    expect(r).toMatchObject({ ok: false, error: "INSUFFICIENT_FUNDS" });
    expect(await balanceOf(short)).toBe(cost - 1n);
    expect(await inventoryOf(short, "wheat")).toBe(0n);
    expect(await tradeCount(short)).toBe(0);
  });

  it("çok büyük miktar bakiyeyi aşarsa INSUFFICIENT_FUNDS, bakiye ve envanter değişmez", async () => {
    const playerId = await createPlayer(1_000n);
    const r = await executeTrade(db, playerId, order({ side: "buy", quantity: 1_000_000 }));
    expect(r).toMatchObject({ ok: false, error: "INSUFFICIENT_FUNDS" });
    expect(await balanceOf(playerId)).toBe(1_000n);
    expect(await inventoryOf(playerId, "wheat")).toBe(0n);
  });

  it("envanter yokken satış INSUFFICIENT_INVENTORY, bilinmeyen ürün UNKNOWN_PRODUCT", async () => {
    const playerId = await createPlayer();
    expect(await executeTrade(db, playerId, order({ side: "sell" }))).toMatchObject({
      ok: false,
      error: "INSUFFICIENT_INVENTORY",
    });
    expect(await executeTrade(db, playerId, order({ side: "buy", productId: "yok" }))).toMatchObject({
      ok: false,
      error: "UNKNOWN_PRODUCT",
    });
    expect(await balanceOf(playerId)).toBe(PARAMS.startingBalance);
  });

  it("sabit fiyatta al-sat turu oyuncuya kâr yazdırmaz (spread + vergi)", async () => {
    const playerId = await createPlayer();
    const buy = await executeTrade(db, playerId, order({ side: "buy", quantity: 3 }));
    const sell = await executeTrade(db, playerId, order({ side: "sell", quantity: 3 }));
    expect(buy.ok && sell.ok).toBe(true);
    expect(await balanceOf(playerId)).toBeLessThan(PARAMS.startingBalance);
    expect(await inventoryOf(playerId, "wheat")).toBe(0n);
  });
});

describe("executeTrade: eşzamanlılık", () => {
  it("aynı anahtarla 20 paralel istek → 1 trade, 1 transfer, envanter bir kez", async () => {
    const playerId = await createPlayer();
    const o = order({ side: "buy", quantity: 2 });
    const cost = -quoteTrade("buy", await priceOf("wheat"), 2n).playerDelta;

    const results = await Promise.all(Array.from({ length: 20 }, () => executeTrade(db, playerId, o)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
    const tradeIds = new Set(results.map((r) => (r.ok ? r.tradeId : null)));
    expect(tradeIds.size).toBe(1);
    expect(await tradeCount(playerId)).toBe(1);
    expect(await transferCountForKey(`trade:${playerId}:${o.idempotencyKey}`)).toBe(1);
    expect(await inventoryOf(playerId, "wheat")).toBe(2n);
    expect(await balanceOf(playerId)).toBe(PARAMS.startingBalance - cost);
  });

  it("duplicate yanıtı orijinal sonucu (aynı tutarlar ve tradeId) döndürür", async () => {
    const playerId = await createPlayer();
    const o = order({ side: "buy", quantity: 1 });
    const first = await executeTrade(db, playerId, o);
    const again = await executeTrade(db, playerId, o);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.tradeId).toBe(first.tradeId);
    expect(again.gross).toBe(first.gross);
    expect(again.tax).toBe(first.tax);
    expect(again.unitPrice).toBe(first.unitPrice);
  });

  it("aynı anahtar farklı payload → IDEMPOTENCY_MISMATCH, durum değişmez", async () => {
    const playerId = await createPlayer();
    const key = randomUUID();
    const first = await executeTrade(db, playerId, order({ side: "buy", quantity: 1, idempotencyKey: key }));
    expect(first.ok).toBe(true);
    const balanceAfterFirst = await balanceOf(playerId);

    const qtyMismatch = await executeTrade(db, playerId, order({ side: "buy", quantity: 2, idempotencyKey: key }));
    expect(qtyMismatch).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });

    const sideMismatch = await executeTrade(db, playerId, order({ side: "sell", quantity: 1, idempotencyKey: key }));
    expect(sideMismatch).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });

    const productMismatch = await executeTrade(
      db,
      playerId,
      order({ side: "buy", productId: "iron", quantity: 1, idempotencyKey: key }),
    );
    expect(productMismatch).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });

    expect(await balanceOf(playerId)).toBe(balanceAfterFirst);
    expect(await inventoryOf(playerId, "wheat")).toBe(1n);
    expect(await inventoryOf(playerId, "iron")).toBe(0n);
    expect(await tradeCount(playerId)).toBe(1);
  });

  it("aynı anahtar farklı oyuncularda ayrı işlem sayılır (anahtar oyuncuya kapsamlı)", async () => {
    const a = await createPlayer();
    const b = await createPlayer();
    const key = randomUUID();
    const ra = await executeTrade(db, a, order({ side: "buy", quantity: 1, idempotencyKey: key }));
    const rb = await executeTrade(db, b, order({ side: "buy", quantity: 1, idempotencyKey: key }));
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(rb.duplicate).toBe(false);
    expect(ra.tradeId).not.toBe(rb.tradeId);
    expect(await inventoryOf(b, "wheat")).toBe(1n);
  });

  it("paralel satışta envanter negatife düşmez, pending_supply yalnızca başarılı satışları sayar", async () => {
    const playerId = await createPlayer();
    const buy = await executeTrade(db, playerId, order({ side: "buy", quantity: 5 }));
    expect(buy.ok).toBe(true);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => executeTrade(db, playerId, order({ side: "sell", quantity: 1 }))),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.error === "INSUFFICIENT_INVENTORY")).toHaveLength(15);
    expect(await inventoryOf(playerId, "wheat")).toBe(0n);
    const [p] = await db.select({ pendingSupply: products.pendingSupply }).from(products).where(eq(products.id, "wheat"));
    expect(p!.pendingSupply).toBe(5n);
  });

  it("paralel alım + runTick: deadlock yok, hata yok, bakiye ve envanter tutarlı", async () => {
    const playerId = await createPlayer();

    const trading = Promise.all(
      Array.from({ length: 40 }, () => executeTrade(db, playerId, order({ side: "buy", quantity: 1 }))),
    );
    const ticking = Promise.all(Array.from({ length: 5 }, () => runTick(db)));
    const [results, ticks] = await withTimeout(Promise.all([trading, ticking]), 20_000);

    expect(results.filter((r) => !r.ok && r.error !== "INSUFFICIENT_FUNDS")).toEqual([]);
    for (const t of ticks) expect(t).toHaveLength(3);

    const okResults = results.filter((r): r is Extract<OrderResult, { ok: true }> => r.ok);
    const spent = okResults.reduce((s, r) => s + BigInt(r.gross) + BigInt(r.tax), 0n);
    expect(await inventoryOf(playerId, "wheat")).toBe(BigInt(okResults.length));
    expect(await balanceOf(playerId)).toBe(PARAMS.startingBalance - spent);
  });
});
