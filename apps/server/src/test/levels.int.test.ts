/** Bina seviyesi bonusları: çıktı, girdi tasarrufu, kalite; /world seviye alanları; v3-2026-11b revizyonu. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { facilities } from "../db/schema";
import { createHarness, type Harness } from "./harness";
import { checkInvariants } from "./invariants";
import { found, grantCash, grantStock } from "../production/kit";
import { holding } from "./trade-helpers";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const setFacilityLevel = (id: string, level: number) => h.deps.db.update(facilities).set({ level }).where(eq(facilities.id, id));

describe("bina seviyesi bonusları", () => {
  it("seviye 2 tarla: aynı girdiyle parti başına daha çok çıktı, daha az tohum; başlatma tasarruflu girdiyi düşer", async () => {
    const f = await found(h, "crop", "yesilova");
    await grantCash(h, f.companyId, 50_000_000n);
    const body = { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 };
    const q1 = await f.p.ok("POST", "/production/quote", body);
    await setFacilityLevel(f.facilityId, 2);
    const q2 = await f.p.ok("POST", "/production/quote", body);
    expect(q2.output.qtyKg).toBeGreaterThan(q1.output.qtyKg);
    expect(q1.inputs[0].requiredKg).toBe(200);
    expect(q2.inputs[0].requiredKg).toBe(150);
    expect(q2.minutes).toBeLessThanOrEqual(60);

    const before = Number((await holding(h, f.companyId, f.cityId, "seed", 2))?.qty ?? 0);
    await grantStock(h, f.companyId, f.cityId, "seed", 2, 200, 20_000n);
    const job = await f.p.ok("POST", "/production/start", { ...body, repeat: false, idempotencyKey: h.key() });
    expect(job.id).toBeTruthy();
    const left = await holding(h, f.companyId, f.cityId, "seed", 2);
    expect(Number(left?.qty ?? 0)).toBe(before + 200 - 150);
    await checkInvariants(h.deps.db);
  });

  it("seviye 2 gıda tesisi: daha az girdi (tahıl) ve /world seviye alanları", async () => {
    const f = await found(h, "manufacturing", "kavsak", "food_plant");
    const body = { facilityId: f.facilityId, recipeId: "mill_flour", batches: 1 };
    const q1 = await f.p.ok("POST", "/production/quote", body);
    await setFacilityLevel(f.facilityId, 2);
    const q2 = await f.p.ok("POST", "/production/quote", body);
    expect(q1.inputs[0].requiredKg).toBe(2000);
    expect(q2.inputs[0].requiredKg).toBe(1800);
    expect(q2.output.qtyKg).toBeGreaterThan(q1.output.qtyKg);

    const world = await f.p.ok("GET", "/world");
    const fp = world.buildingTypes.find((b: { id: string }) => b.id === "food_plant");
    expect(fp.levels[0].yieldBp).toBeUndefined();
    expect(fp.levels[1]).toMatchObject({ yieldBp: 300, efficiencyBp: 700, inputSavingBp: 1000 });
    await checkInvariants(h.deps.db);
  });
});
