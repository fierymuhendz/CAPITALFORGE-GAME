import { randomUUID } from "node:crypto";
import { PARAMS, RECIPES, type RecipeId } from "@capitalforge/economy";
import type { ActionResult, BuyFacility, StartProduction } from "@capitalforge/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buyFacility } from "../company/buyFacility";
import { foundCompany } from "../company/found";
import { createGuest } from "../auth/guest";
import type { Db } from "../db/client";
import { accounts, facilities, inventories, productionJobs } from "../db/schema";
import { transfer } from "../ledger/transfer";
import { assertLedgerBalanced, closeTestResources, resetTestDb, setupTestDb } from "../test/db";
import { runCompletionPhase } from "./complete";
import { startProduction } from "./start";

/** Tarif süresi sabit yazılmaz; ekonomi parametreleriyle birlikte değişir. */
const GROW_TICKS = RECIPES.grow_wheat.durationTicks;

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

function refOf(r: ActionResult): string {
  if (!r.ok) throw new Error(`başarı beklendi, gelen hata: ${r.error}`);
  if (!r.refId) throw new Error("refId beklendi");
  return r.refId;
}

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

/** Test kurulumu: bakiyeyi sistem:mint ile dengeli bir transferle hedef değere ayarlar. */
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

async function newCompany(playerId: string): Promise<void> {
  refOf(await foundCompany(db, playerId, { name: `Firma${uniq()}`, idempotencyKey: randomUUID() }));
}

async function buy(playerId: string, type: BuyFacility["type"], plotX: number, plotY: number): Promise<ActionResult> {
  return buyFacility(db, playerId, { type, plotX, plotY, idempotencyKey: randomUUID() });
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

function start(
  playerId: string,
  facilityId: string,
  recipeId: RecipeId,
  batches = 1,
): Promise<ActionResult> {
  const input: StartProduction = {
    facilityId,
    recipeId,
    batches,
    idempotencyKey: randomUUID(),
  };
  return startProduction(db, playerId, input);
}

async function jobsOf(facilityId: string) {
  return db.select().from(productionJobs).where(eq(productionJobs.facilityId, facilityId));
}

async function runningCount(facilityId: string): Promise<number> {
  return (await jobsOf(facilityId)).filter((j) => j.status === "running").length;
}

describe("üretim başlatma: eşzamanlılık", () => {
  it("aynı tesise 20 paralel başlatma → tam 1 iş, diğerleri FACILITY_BUSY, girdi yalnızca bir kez düşer", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 100n);

    const results = await Promise.all(Array.from({ length: 20 }, () => start(p, farm, "grow_wheat", 1)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const errors = results.flatMap((r) => (r.ok ? [] : [r.error]));
    expect(errors).toEqual(Array(19).fill("FACILITY_BUSY"));
    expect(await runningCount(farm)).toBe(1);
    expect(await invOf(p, "energy")).toBe(99n);
  });

  it("tek işlik girdiyle iki tesise 10 paralel başlatma → 1 başarı, envanter negatife düşmez", async () => {
    const p = await newPlayer(10n ** 9n);
    await newCompany(p);
    const f1 = refOf(await buy(p, "farm", 0, 0));
    const f2 = refOf(await buy(p, "farm", 1, 0));
    await grant(p, "energy", 1n);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => start(p, i % 2 === 0 ? f1 : f2, "grow_wheat", 1)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const allowed = new Set(["FACILITY_BUSY", "INSUFFICIENT_INVENTORY"]);
    for (const r of results) {
      if (!r.ok) expect(allowed.has(r.error)).toBe(true);
    }
    const inv = await invOf(p, "energy");
    expect(inv).toBe(0n);
    expect(inv >= 0n).toBe(true);
    const total = (await runningCount(f1)) + (await runningCount(f2));
    expect(total).toBe(1);
  });

  it("iki paralel runCompletionPhase + tekrar çağrı → çıktı yalnızca bir kez envantere yazılır", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 2n);
    expect((await start(p, farm, "grow_wheat", 2)).ok).toBe(true);

    // Süre tarifin durationTicks değeri: bir önceki tick'te henüz tamamlanmamalı.
    expect(await runCompletionPhase(db, GROW_TICKS - 1n)).toEqual([]);

    const [a, b] = await Promise.all([runCompletionPhase(db, GROW_TICKS), runCompletionPhase(db, GROW_TICKS)]);
    const again = await runCompletionPhase(db, GROW_TICKS);

    expect(a.length + b.length + again.length).toBe(1);
    expect(await invOf(p, "wheat")).toBe(RECIPES.grow_wheat.output.qty * 2n);
    const [job] = await jobsOf(farm);
    expect(job!.status).toBe("done");
    expect(job!.completedTick).toBe(GROW_TICKS);
  });

  it("tamamlanan tesis yeniden başlatılabilir (kısmi UNIQUE yalnızca running için)", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 2n);
    expect((await start(p, farm, "grow_wheat", 1)).ok).toBe(true);
    await runCompletionPhase(db, GROW_TICKS);
    expect((await start(p, farm, "grow_wheat", 1)).ok).toBe(true);
    expect(await runningCount(farm)).toBe(1);
  });
});

describe("üretim tamamlama: askıdaki tesis", () => {
  it("askıdaki tesisin işi tamamlanmaz; tesis yeniden aktif olunca tamamlanır", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 1n);
    expect((await start(p, farm, "grow_wheat", 1)).ok).toBe(true);
    await db.update(facilities).set({ status: "suspended" }).where(eq(facilities.id, farm));

    expect(await runCompletionPhase(db, GROW_TICKS + 5n)).toEqual([]);
    expect(await invOf(p, "wheat")).toBe(0n);
    expect((await jobsOf(farm))[0]!.status).toBe("running");

    await db.update(facilities).set({ status: "active" }).where(eq(facilities.id, farm));
    expect(await runCompletionPhase(db, GROW_TICKS + 6n)).toHaveLength(1);
    expect(await invOf(p, "wheat")).toBe(RECIPES.grow_wheat.output.qty);
  });
});

describe("üretim başlatma: yetki ve durum", () => {
  it("başkasının tesisinde üretim UNAUTHORIZED; kimse envanter kaybetmez", async () => {
    const owner = await newPlayer();
    await newCompany(owner);
    const farm = refOf(await buy(owner, "farm", 0, 0));
    await grant(owner, "energy", 5n);

    const intruder = await newPlayer();
    await newCompany(intruder);
    await grant(intruder, "energy", 5n);

    const r = await start(intruder, farm, "grow_wheat", 1);
    expect(r).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
    expect(await jobsOf(farm)).toHaveLength(0);
    expect(await invOf(intruder, "energy")).toBe(5n);
    expect(await invOf(owner, "energy")).toBe(5n);
  });

  it("olmayan tesis kimliği UNAUTHORIZED döner", async () => {
    const p = await newPlayer();
    await newCompany(p);
    await grant(p, "energy", 5n);
    expect(await start(p, randomUUID(), "grow_wheat", 1)).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
  });

  it("askıdaki tesiste FACILITY_SUSPENDED, girdi düşmez, iş oluşmaz", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await db.update(facilities).set({ status: "suspended" }).where(eq(facilities.id, farm));
    await grant(p, "energy", 5n);

    expect(await start(p, farm, "grow_wheat", 1)).toMatchObject({ ok: false, error: "FACILITY_SUSPENDED" });
    expect(await jobsOf(farm)).toHaveLength(0);
    expect(await invOf(p, "energy")).toBe(5n);
  });

  it("tarif-tesis uyuşmazlığı → RECIPE_FACILITY_MISMATCH, hiçbir şey değişmez", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 10n);
    await grant(p, "iron", 10n);

    expect(await start(p, farm, "mine_iron", 1)).toMatchObject({ ok: false, error: "RECIPE_FACILITY_MISMATCH" });
    expect(await start(p, farm, "smelt_steel", 1)).toMatchObject({ ok: false, error: "RECIPE_FACILITY_MISMATCH" });
    expect(await jobsOf(farm)).toHaveLength(0);
    expect(await invOf(p, "energy")).toBe(10n);
    expect(await invOf(p, "iron")).toBe(10n);
  });

  it("bilinmeyen tarif → UNKNOWN_RECIPE", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    const r = await startProduction(db, p, {
      facilityId: farm,
      recipeId: "yok" as unknown as StartProduction["recipeId"],
      batches: 1,
      idempotencyKey: randomUUID(),
    });
    expect(r).toMatchObject({ ok: false, error: "UNKNOWN_RECIPE" });
    expect(await jobsOf(farm)).toHaveLength(0);
  });
});

describe("üretim başlatma: girdi yeterliliği", () => {
  it("girdi yetersizse INSUFFICIENT_INVENTORY; batch büyükse kısmi düşüm olmaz", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 5n);

    // 10 batch = 10 enerji gerekir, 5 var.
    expect(await start(p, farm, "grow_wheat", 10)).toMatchObject({ ok: false, error: "INSUFFICIENT_INVENTORY" });
    expect(await invOf(p, "energy")).toBe(5n);
    expect(await jobsOf(farm)).toHaveLength(0);
  });

  it("çok girdili tarifte bir girdi eksikse hiçbiri düşmez", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const mill = refOf(await buy(p, "mill", 0, 0));
    await grant(p, "wheat", 10n);
    // Değirmen: 10 buğday + 1 enerji. Enerji yok.
    expect(await start(p, mill, "mill_flour", 1)).toMatchObject({ ok: false, error: "INSUFFICIENT_INVENTORY" });
    expect(await invOf(p, "wheat")).toBe(10n);
    expect(await invOf(p, "energy")).toBe(0n);
  });
});

describe("üretim tamamlama: süre ve çıktı", () => {
  it("batch çıktısı doğrusaldır ve yalnızca süre dolunca envantere yazılır", async () => {
    const p = await newPlayer();
    await newCompany(p);
    const farm = refOf(await buy(p, "farm", 0, 0));
    await grant(p, "energy", 3n);
    expect((await start(p, farm, "grow_wheat", 3)).ok).toBe(true);
    expect(await invOf(p, "wheat")).toBe(0n);
    expect(await invOf(p, "energy")).toBe(0n);

    const done = await runCompletionPhase(db, GROW_TICKS);
    expect(done).toHaveLength(1);
    const expected = RECIPES.grow_wheat.output.qty * 3n;
    expect(done[0]!.outputQty).toBe(expected.toString());
    expect(await invOf(p, "wheat")).toBe(expected);
  });
});
