import { randomUUID } from "node:crypto";
import { PARAMS, upkeep } from "@capitalforge/economy";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buyFacility } from "../company/buyFacility";
import { foundCompany } from "../company/found";
import { createGuest } from "../auth/guest";
import type { Db } from "../db/client";
import { accounts, companies, facilities, ledgerEntries, transfers } from "../db/schema";
import { transfer } from "../ledger/transfer";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";
import { chargeUpkeep, runUpkeepPhase } from "./upkeep";

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

/** Tick 3600 → dönem 1; tesis tick 0'da alındığı için dönem 0'da ödenmiştir, dönem 1 vadelidir. */
const PERIOD_1_TICK = PARAMS.upkeepPeriodTicks;
const PERIOD_2_TICK = PARAMS.upkeepPeriodTicks * 2n;
const FARM_UPKEEP = upkeep("farm", 1n);

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

/** Oyuncu + şirket + tek çiftlik (tick 0'da alındı). */
async function setupFarm(): Promise<{ playerId: string; companyId: string; facilityId: string }> {
  const res = await createGuest(db, `p_${uniq()}`);
  if (!res.ok) throw new Error("test oyuncusu oluşturulamadı");
  const playerId = res.playerId;
  const c = await foundCompany(db, playerId, { name: `Firma${uniq()}`, idempotencyKey: randomUUID() });
  if (!c.ok) throw new Error("şirket kurulamadı");
  const f = await buyFacility(db, playerId, { type: "farm", plotX: 0, plotY: 0, idempotencyKey: randomUUID() });
  if (!f.ok || !f.refId) throw new Error("tesis alınamadı");
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.playerId, playerId));
  return { playerId, companyId: company!.id, facilityId: f.refId };
}

async function facilityRow(facilityId: string) {
  const [f] = await db.select().from(facilities).where(eq(facilities.id, facilityId));
  return f!;
}

async function upkeepTransferCount(facilityId: string, period: bigint): Promise<number> {
  const rows = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(eq(transfers.idempotencyKey, `upkeep:${facilityId}:${period}`));
  return rows.length;
}

describe("bakım: tek kesinti", () => {
  it("aynı dönem paralel çalıştırma (faz + doğrudan) → tek kesinti", async () => {
    const { playerId, companyId, facilityId } = await setupFarm();
    const before = await balanceOf(playerId);

    await Promise.all([
      ...Array.from({ length: 5 }, () => runUpkeepPhase(db, PERIOD_1_TICK)),
      ...Array.from({ length: 5 }, () => chargeUpkeep(db, facilityId, companyId, 1n)),
    ]);

    expect(await upkeepTransferCount(facilityId, 1n)).toBe(1);
    expect(await balanceOf(playerId)).toBe(before - FARM_UPKEEP);
    const f = await facilityRow(facilityId);
    expect(f.status).toBe("active");
    expect(f.upkeepPaidPeriod).toBe(1n);

    // Aynı dönem tekrar: işlem yok.
    expect(await runUpkeepPhase(db, PERIOD_1_TICK)).toBe(0);
    expect(await balanceOf(playerId)).toBe(before - FARM_UPKEEP);
  });

  it("bakım kesintisi defterde tek bacak çiftiyle yazılır (oyuncu → system:fees)", async () => {
    const { playerId, facilityId } = await setupFarm();
    await runUpkeepPhase(db, PERIOD_1_TICK);
    const [t] = await db
      .select({ id: transfers.id, reason: transfers.reason })
      .from(transfers)
      .where(eq(transfers.idempotencyKey, `upkeep:${facilityId}:1`));
    expect(t!.reason).toBe("upkeep");
    const legs = await db.select().from(ledgerEntries).where(eq(ledgerEntries.transferId, t!.id));
    expect(legs).toHaveLength(2);
    expect(legs.reduce((s, l) => s + l.amount, 0n)).toBe(0n);
    const w = await walletId(playerId);
    expect(legs.find((l) => l.accountId === w)?.amount).toBe(-FARM_UPKEEP);
  });
});

describe("bakım: yetersiz bakiye", () => {
  it("bakiye bakımdan azsa tesis suspended, bakiye değişmez ve negatif olmaz", async () => {
    const { playerId, facilityId } = await setupFarm();
    await setBalance(playerId, FARM_UPKEEP - 1n);

    expect(await runUpkeepPhase(db, PERIOD_1_TICK)).toBe(1);
    const f = await facilityRow(facilityId);
    expect(f.status).toBe("suspended");
    expect(f.upkeepPaidPeriod).toBe(1n);
    expect(await balanceOf(playerId)).toBe(FARM_UPKEEP - 1n);
    expect(await upkeepTransferCount(facilityId, 1n)).toBe(0);
  });

  it("sıfır bakiyede de suspended; paralel çalıştırmada bakiye ≥ 0 kalır", async () => {
    const { playerId, companyId, facilityId } = await setupFarm();
    await setBalance(playerId, 0n);

    await Promise.all([
      ...Array.from({ length: 4 }, () => runUpkeepPhase(db, PERIOD_1_TICK)),
      ...Array.from({ length: 4 }, () => chargeUpkeep(db, facilityId, companyId, 1n)),
    ]);

    expect((await facilityRow(facilityId)).status).toBe("suspended");
    expect(await balanceOf(playerId)).toBe(0n);
    expect(await balanceOf(playerId)).toBeGreaterThanOrEqual(0n);
  });

  it("askıdaki tesis için geriye dönük borç oluşmaz: dönem atlanır", async () => {
    const { playerId, companyId, facilityId } = await setupFarm();
    await setBalance(playerId, 0n);
    await runUpkeepPhase(db, PERIOD_1_TICK);
    expect((await facilityRow(facilityId)).status).toBe("suspended");

    await setBalance(playerId, 10_000n);
    expect(await chargeUpkeep(db, facilityId, companyId, 1n)).toBe("skipped");
    expect(await balanceOf(playerId)).toBe(10_000n);
  });
});

describe("bakım: sonraki dönemde ödeme", () => {
  it("dönem 1'de askıya alınan tesis, dönem 2'de ödenince active olur", async () => {
    const { playerId, facilityId } = await setupFarm();
    await setBalance(playerId, 0n);
    await runUpkeepPhase(db, PERIOD_1_TICK);
    expect((await facilityRow(facilityId)).status).toBe("suspended");

    await setBalance(playerId, 10_000n);
    expect(await runUpkeepPhase(db, PERIOD_2_TICK)).toBe(1);

    const f = await facilityRow(facilityId);
    expect(f.status).toBe("active");
    expect(f.upkeepPaidPeriod).toBe(2n);
    expect(await upkeepTransferCount(facilityId, 2n)).toBe(1);
    // Yalnızca dönem 2 bakımı düşer; dönem 1 geriye dönük ücretlendirilmez.
    expect(await balanceOf(playerId)).toBe(10_000n - FARM_UPKEEP);
  });
});
