import { randomUUID } from "node:crypto";
import { PARAMS } from "@capitalforge/economy";
import type { ActionResult, StartProduction } from "@capitalforge/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest } from "../auth/guest";
import { buyFacility } from "../company/buyFacility";
import { foundCompany } from "../company/found";
import type { Db } from "../db/client";
import { accounts, companies, facilities, inventories, productionJobs, transfers } from "../db/schema";
import { claimRelief } from "../relief/claim";
import { startProduction } from "../production/start";
import { transfer } from "../ledger/transfer";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";

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

async function invOf(playerId: string, productId: string): Promise<bigint> {
  const [i] = await db
    .select({ quantity: inventories.quantity })
    .from(inventories)
    .where(and(eq(inventories.playerId, playerId), eq(inventories.productId, productId)));
  return i?.quantity ?? 0n;
}

async function companyCount(playerId: string): Promise<number> {
  const rows = await db.select({ id: companies.id }).from(companies).where(eq(companies.playerId, playerId));
  return rows.length;
}

async function facilityCount(playerId: string): Promise<number> {
  const rows = await db
    .select({ id: facilities.id })
    .from(facilities)
    .innerJoin(companies, eq(companies.id, facilities.companyId))
    .where(eq(companies.playerId, playerId));
  return rows.length;
}

async function jobCount(playerId: string): Promise<number> {
  const rows = await db.select({ id: productionJobs.id }).from(productionJobs).where(eq(productionJobs.playerId, playerId));
  return rows.length;
}

async function transferCount(key: string): Promise<number> {
  const rows = await db.select({ id: transfers.id }).from(transfers).where(eq(transfers.idempotencyKey, key));
  return rows.length;
}

function refOf(r: ActionResult): string {
  if (!r.ok || !r.refId) throw new Error(`refId beklenen başarılı sonuç yok: ${JSON.stringify(r)}`);
  return r.refId;
}

describe("foundCompany idempotency", () => {
  it("aynı anahtar farklı ad → IDEMPOTENCY_MISMATCH, ilk sonuç ve bakiye korunur", async () => {
    const p = await newPlayer();
    const key = randomUUID();
    const first = await foundCompany(db, p, { name: "Alfa", idempotencyKey: key });
    expect(first.ok).toBe(true);

    const second = await foundCompany(db, p, { name: "Beta", idempotencyKey: key });
    expect(second).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });
    expect(await companyCount(p)).toBe(1);
    expect(await balanceOf(p)).toBe(PARAMS.startingBalance - PARAMS.companyFoundingFee);
  });

  it("aynı anahtar aynı payload → duplicate, aynı refId, ücret bir kez", async () => {
    const p = await newPlayer();
    const key = randomUUID();
    const first = await foundCompany(db, p, { name: "Gama", idempotencyKey: key });
    const again = await foundCompany(db, p, { name: "Gama", idempotencyKey: key });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.refId).toBe(first.refId);
    expect(await companyCount(p)).toBe(1);
    expect(await balanceOf(p)).toBe(PARAMS.startingBalance - PARAMS.companyFoundingFee);
  });
});

describe("buyFacility idempotency", () => {
  it("aynı anahtar farklı arsa → IDEMPOTENCY_MISMATCH, ikinci arsa satılmaz", async () => {
    const p = await newPlayer();
    await foundCompany(db, p, { name: "Delta", idempotencyKey: randomUUID() });
    const key = randomUUID();
    const first = await buyFacility(db, p, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: key });
    expect(first.ok).toBe(true);
    const balance = await balanceOf(p);

    const second = await buyFacility(db, p, { type: "farm", plotX: 1, plotY: 0, idempotencyKey: key });
    expect(second).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });
    expect(await facilityCount(p)).toBe(1);
    expect(await balanceOf(p)).toBe(balance);
  });

  it("aynı anahtar farklı tür → IDEMPOTENCY_MISMATCH", async () => {
    const p = await newPlayer();
    await foundCompany(db, p, { name: "Epsilon", idempotencyKey: randomUUID() });
    const key = randomUUID();
    expect((await buyFacility(db, p, { type: "mine", plotX: 2, plotY: 2, idempotencyKey: key })).ok).toBe(true);
    expect(await buyFacility(db, p, { type: "farm", plotX: 2, plotY: 2, idempotencyKey: key })).toMatchObject({
      ok: false,
      error: "IDEMPOTENCY_MISMATCH",
    });
    expect(await facilityCount(p)).toBe(1);
  });

  it("aynı anahtar aynı payload → duplicate, aynı tesis, bakiye bir kez düşer", async () => {
    const p = await newPlayer();
    await foundCompany(db, p, { name: "Zeta", idempotencyKey: randomUUID() });
    const key = randomUUID();
    const first = await buyFacility(db, p, { type: "farm", plotX: 4, plotY: 4, idempotencyKey: key });
    const before = await balanceOf(p);
    const again = await buyFacility(db, p, { type: "farm", plotX: 4, plotY: 4, idempotencyKey: key });

    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.refId).toBe(first.refId);
    expect(await facilityCount(p)).toBe(1);
    expect(await balanceOf(p)).toBe(before);
    expect(await transferCount(`facility:buy:${p}:${key}`)).toBe(1);
  });
});

describe("startProduction idempotency", () => {
  it("aynı anahtar farklı batch → IDEMPOTENCY_MISMATCH, girdi yalnızca ilk batch kadar düşer", async () => {
    const p = await newPlayer();
    await foundCompany(db, p, { name: "Eta", idempotencyKey: randomUUID() });
    const farm = refOf(await buyFacility(db, p, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: randomUUID() }));
    await grant(p, "energy", 10n);
    const key = randomUUID();
    const base: StartProduction = { facilityId: farm, recipeId: "grow_wheat", batches: 1, idempotencyKey: key };

    expect((await startProduction(db, p, base)).ok).toBe(true);
    const r = await startProduction(db, p, { ...base, batches: 2 });
    expect(r).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });
    expect(await invOf(p, "energy")).toBe(9n);
    expect(await jobCount(p)).toBe(1);
  });

  it("aynı anahtar farklı tesis → IDEMPOTENCY_MISMATCH", async () => {
    const p = await newPlayer(10n ** 9n);
    await foundCompany(db, p, { name: "Theta", idempotencyKey: randomUUID() });
    const f1 = refOf(await buyFacility(db, p, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: randomUUID() }));
    const f2 = refOf(await buyFacility(db, p, { type: "farm", plotX: 1, plotY: 0, idempotencyKey: randomUUID() }));
    await grant(p, "energy", 10n);
    const key = randomUUID();

    expect((await startProduction(db, p, { facilityId: f1, recipeId: "grow_wheat", batches: 1, idempotencyKey: key })).ok).toBe(true);
    expect(
      await startProduction(db, p, { facilityId: f2, recipeId: "grow_wheat", batches: 1, idempotencyKey: key }),
    ).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });
    expect(await invOf(p, "energy")).toBe(9n);
    expect(await jobCount(p)).toBe(1);
  });

  it("aynı anahtar aynı payload → duplicate, tek iş, tek girdi düşümü", async () => {
    const p = await newPlayer();
    await foundCompany(db, p, { name: "Iota", idempotencyKey: randomUUID() });
    const farm = refOf(await buyFacility(db, p, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: randomUUID() }));
    await grant(p, "energy", 10n);
    const input: StartProduction = {
      facilityId: farm,
      recipeId: "grow_wheat",
      batches: 3,
      idempotencyKey: randomUUID(),
    };

    const first = await startProduction(db, p, input);
    const again = await startProduction(db, p, input);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.refId).toBe(first.refId);
    expect(await jobCount(p)).toBe(1);
    expect(await invOf(p, "energy")).toBe(7n);
  });
});

describe("claimRelief idempotency", () => {
  it("aynı anahtar başka eylem türüyle → IDEMPOTENCY_MISMATCH, şirket oluşmaz", async () => {
    const p = await newPlayer(0n);
    const key = randomUUID();
    const first = await claimRelief(db, p, { idempotencyKey: key });
    expect(first.ok).toBe(true);
    const balance = await balanceOf(p);

    const other = await foundCompany(db, p, { name: "Kappa", idempotencyKey: key });
    expect(other).toMatchObject({ ok: false, error: "IDEMPOTENCY_MISMATCH" });
    expect(await companyCount(p)).toBe(0);
    expect(await balanceOf(p)).toBe(balance);
  });

  it("aynı anahtar aynı payload → duplicate, ödenek bir kez", async () => {
    const p = await newPlayer(0n);
    const key = randomUUID();
    const first = await claimRelief(db, p, { idempotencyKey: key });
    const again = await claimRelief(db, p, { idempotencyKey: key });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.duplicate).toBe(true);
    expect(again.amount).toBe(PARAMS.reliefAmount.toString());
    expect(await balanceOf(p)).toBe(PARAMS.reliefAmount);
    expect(await transferCount(`relief:${p}:0`)).toBe(1);
  });
});
