import { randomUUID } from "node:crypto";
import { PARAMS, facilityPrice, type FacilityType } from "@capitalforge/economy";
import type { ActionResult, BuyFacility } from "@capitalforge/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuest } from "../auth/guest";
import type { Db } from "../db/client";
import { accounts, companies, facilities } from "../db/schema";
import { transfer } from "../ledger/transfer";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";
import { buyFacility } from "./buyFacility";
import { foundCompany } from "./found";

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

function found(playerId: string, name: string): Promise<ActionResult> {
  return foundCompany(db, playerId, { name, idempotencyKey: randomUUID() });
}

async function newCompany(playerId: string): Promise<void> {
  const r = await found(playerId, `Firma${uniq()}`);
  if (!r.ok) throw new Error(`şirket kurulamadı: ${r.error}`);
}

function buy(playerId: string, type: BuyFacility["type"], plotX: number, plotY: number): Promise<ActionResult> {
  return buyFacility(db, playerId, { type, plotX, plotY, idempotencyKey: randomUUID() });
}

async function facilityCountAt(plotX: number, plotY: number): Promise<number> {
  const rows = await db
    .select({ id: facilities.id })
    .from(facilities)
    .where(and(eq(facilities.plotX, plotX), eq(facilities.plotY, plotY)));
  return rows.length;
}

async function companyIdOf(playerId: string): Promise<string | undefined> {
  const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.playerId, playerId));
  return c?.id;
}

describe("arsa yarışı", () => {
  it("aynı arsaya 10 paralel alım (farklı oyuncular) → 1 başarı, diğerleri PLOT_TAKEN", async () => {
    const players: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = await newPlayer();
      await newCompany(p);
      players.push(p);
    }

    const results = await Promise.all(players.map((p) => buy(p, "farm", 3, 3)));

    const winners = results.flatMap((r, i) => (r.ok ? [players[i]!] : []));
    expect(winners).toHaveLength(1);
    const losersErrors = results.flatMap((r) => (r.ok ? [] : [r.error]));
    expect(losersErrors).toEqual(Array(9).fill("PLOT_TAKEN"));

    expect(await facilityCountAt(3, 3)).toBe(1);
    const price = facilityPrice("farm", 0n);
    const afterFee = PARAMS.startingBalance - PARAMS.companyFoundingFee;
    expect(await balanceOf(winners[0]!)).toBe(afterFee - price);
    for (const p of players.filter((x) => x !== winners[0])) {
      expect(await balanceOf(p)).toBe(afterFee);
    }
  });
});

describe("tesis limiti ve fiyat", () => {
  it("şirket en fazla maxFacilitiesPerCompany tesis alabilir; 21. FACILITY_LIMIT", async () => {
    const p = await newPlayer(10n ** 13n);
    await newCompany(p);
    const type: FacilityType = "steelworks";
    const max = Number(PARAMS.maxFacilitiesPerCompany);

    let spent = 0n;
    for (let k = 0; k < max; k++) {
      const before = await balanceOf(p);
      const r = await buy(p, type, k % 16, Math.floor(k / 16));
      expect(r.ok).toBe(true);
      const cost = before - (await balanceOf(p));
      expect(cost).toBe(facilityPrice(type, BigInt(k)));
      spent += cost;
    }
    const beforeLimit = await balanceOf(p);
    const r = await buy(p, type, max % 16, Math.floor(max / 16));
    expect(r).toMatchObject({ ok: false, error: "FACILITY_LIMIT" });
    expect(await balanceOf(p)).toBe(beforeLimit);

    const [cnt] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(facilities)
      .innerJoin(companies, eq(companies.id, facilities.companyId))
      .where(eq(companies.playerId, p));
    expect(cnt!.c).toBe(max);
    expect(spent).toBeGreaterThan(0n);
  });

  it("tesis fiyatı her yeni tesiste artar (aynı tür için)", async () => {
    const p = await newPlayer(10n ** 9n);
    await newCompany(p);
    const first = facilityPrice("mine", 0n);
    const second = facilityPrice("mine", 1n);
    expect(second).toBeGreaterThan(first);

    const b0 = await balanceOf(p);
    expect((await buy(p, "mine", 0, 0)).ok).toBe(true);
    const b1 = await balanceOf(p);
    expect((await buy(p, "mine", 1, 0)).ok).toBe(true);
    const b2 = await balanceOf(p);
    expect(b0 - b1).toBe(first);
    expect(b1 - b2).toBe(second);
  });
});

describe("tesis alımı: bakiye ve şirket", () => {
  it("tam bakiyeyle alım başarılı; bir kuruş eksikse INSUFFICIENT_FUNDS ve arsa boş kalır", async () => {
    const price = facilityPrice("farm", 0n);
    const short = await newPlayer(PARAMS.companyFoundingFee + price - 1n);
    await newCompany(short);
    expect(await buy(short, "farm", 5, 5)).toMatchObject({ ok: false, error: "INSUFFICIENT_FUNDS" });
    expect(await facilityCountAt(5, 5)).toBe(0);
    expect(await balanceOf(short)).toBe(price - 1n);

    // Başarısız işlem arsayı serbest bırakmalı: bakiye tamamlanınca aynı arsa alınabilir.
    await setBalance(short, price);
    expect((await buy(short, "farm", 5, 5)).ok).toBe(true);
    expect(await balanceOf(short)).toBe(0n);
    expect(await facilityCountAt(5, 5)).toBe(1);
  });

  it("şirketi olmayan oyuncu alım yapamaz: NO_COMPANY", async () => {
    const p = await newPlayer();
    expect(await buy(p, "farm", 1, 1)).toMatchObject({ ok: false, error: "NO_COMPANY" });
    expect(await facilityCountAt(1, 1)).toBe(0);
    expect(await balanceOf(p)).toBe(PARAMS.startingBalance);
  });

  it("aynı ad büyük/küçük harf farkıyla alınamaz: NAME_TAKEN, ikinci oyuncu ücret ödemez", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    expect((await found(a, "Acme")).ok).toBe(true);
    expect(await found(b, "ACME")).toMatchObject({ ok: false, error: "NAME_TAKEN" });
    expect(await companyIdOf(b)).toBeUndefined();
    expect(await balanceOf(b)).toBe(PARAMS.startingBalance);
  });

  it("ikinci şirket COMPANY_EXISTS; ücret yalnızca bir kez alınır", async () => {
    const p = await newPlayer();
    expect((await found(p, "Alfa")).ok).toBe(true);
    expect(await found(p, "Beta")).toMatchObject({ ok: false, error: "COMPANY_EXISTS" });
    expect(await balanceOf(p)).toBe(PARAMS.startingBalance - PARAMS.companyFoundingFee);
    const [c] = await db.select({ name: companies.name }).from(companies).where(eq(companies.playerId, p));
    expect(c!.name).toBe("Alfa");
  });
});
