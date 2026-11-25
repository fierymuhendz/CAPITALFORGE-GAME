import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test/harness";
import { checkInvariants } from "../test/invariants";
import { balance, drainCash, found, grantCash, grantStock, HOUR, setLevel } from "../production/kit";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

type PlotRow = { id: string; minLevel: number; price: string; owner: unknown; deposit: unknown };
const freePlots = async (f: { p: { ok: Function } }, cityId: string, pred: (p: PlotRow) => boolean = () => true) =>
  ((await f.p.ok("GET", `/world/plots?cityId=${cityId}`)).plots as PlotRow[]).filter((p) => !p.owner && pred(p));

describe("arsa alımı ve inşaat", () => {
  it("seviye ve nakit ayrı ayrı denetlenir; çelik gerekir; inşaat süre sonunda biter", async () => {
    const f = await found(h, "crop", "yesilova");
    const city = f.cityId;
    const lvl1 = (await freePlots(f, city, (p) => p.minLevel === 1))[0]!;
    const lvl3 = (await freePlots(f, city, (p) => p.minLevel >= 2))[0]!;
    const buy = (plotId: string, buildingType: string) => f.p.post(`/plots/${plotId}/buy`, { buildingType, idempotencyKey: h.key() });

    // yalnızca seviye yetersiz: bol nakit + çelik
    await grantCash(h, f.companyId, 100_000_000n);
    await grantStock(h, f.companyId, city, "steel", 2, 20_000, 20_000_000n);
    expect((await buy(lvl3.id, "field")).body.error.code).toBe("LEVEL_TOO_LOW");

    // yalnızca nakit yetersiz: seviye uygun, çelik var, nakit yok
    await drainCash(h, f.companyId);
    expect((await buy(lvl1.id, "field")).body.error.code).toBe("INSUFFICIENT_FUNDS");
    await grantCash(h, f.companyId, 100_000_000n);

    // çelik yok
    const g = await found(h, "crop", "kavsak");
    await grantCash(h, g.companyId, 100_000_000n);
    const gp = (await freePlots(g, g.cityId, (p) => p.minLevel === 1))[0]!;
    const r = await g.p.post(`/plots/${gp.id}/buy`, { buildingType: "field", idempotencyKey: h.key() });
    expect(r.body.error.code).toBe("INSUFFICIENT_STEEL");

    // maden: yataksız arsa uygun değil
    const nodep = (await freePlots(f, city, (p) => p.minLevel === 1 && !p.deposit))[0]!;
    expect((await buy(nodep.id, "mine")).body.error.code).toBe("PLOT_NOT_ELIGIBLE");

    // başarı
    const cashBefore = await balance(h, f.companyId, "cash");
    const steelBefore = (await f.p.ok("GET", "/inventory")).find((s: { productId: string }) => s.productId === "steel").qtyKg as number;
    const ok = await buy(lvl1.id, "field");
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("constructing");
    const bt = h.deps.catalog.buildingType("field");
    const cashAfter = await balance(h, f.companyId, "cash");
    expect(cashBefore - cashAfter).toBe(BigInt(lvl1.price) + BigInt(bt.buildCost));
    const steelAfter = (await f.p.ok("GET", "/inventory")).find((s: { productId: string }) => s.productId === "steel").qtyKg as number;
    expect(steelBefore - steelAfter).toBe(bt.buildSteelKg);
    // inşaat sürerken üretim yapılamaz
    const early = await f.p.post("/production/start", { facilityId: ok.body.id, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(early.body.error.code).toBe("BUILDING_NOT_READY");
    // aynı arsa ikinci kez alınamaz
    const other = await found(h, "crop", "yesilova");
    await grantCash(h, other.companyId, 50_000_000n);
    expect((await other.p.post(`/plots/${lvl1.id}/buy`, { buildingType: "field", idempotencyKey: h.key() })).body.error.code).toBe("PLOT_TAKEN");

    await h.advance(bt.buildMinutes * 60_000 + HOUR);
    const fac = await f.p.ok("GET", `/facilities/${ok.body.id}`);
    expect(fac.status).toBe("idle");
    expect(fac.constructionEndsAt).toBeNull();
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.some((n: { kind: string }) => n.kind === "construction_done")).toBe(true);
    // artık üretim yapılabilir (tohum al)
    await grantStock(h, f.companyId, city, "seed", 2, 400, 40_000n);
    const job = await f.p.post("/production/start", { facilityId: ok.body.id, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(job.status).toBe(200);
    // arsa + inşaat + çelik maliyeti sabit kıymette
    const fa = await balance(h, f.companyId, "fixed_assets");
    expect(fa).toBeGreaterThan(BigInt(lvl1.price) + BigInt(bt.buildCost));
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("her sektör için en az iki şehirde seviye 1 arsa vardır", async () => {
    const f = await found(h, "crop", "yesilova");
    for (const sector of ["crop", "livestock", "mining", "manufacturing"]) {
      let cities = 0;
      for (const c of ["korfezkent", "yesilova", "akyayla", "demirdag", "kavsak"]) {
        const ob = await f.p.ok("GET", `/world/onboarding?cityId=${c}&sector=${sector}`);
        if (ob.plots.some((p: { minLevel: number; deposit: unknown }) => p.minLevel === 1 && (sector !== "mining" || p.deposit))) cities++;
      }
      expect(cities, sector).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("yükseltme", () => {
  it("seviye, çelik ve nakit gerekir; süre sonunda hat sayısı artar", async () => {
    const f = await found(h, "crop", "yesilova");
    const up = () => f.p.post(`/facilities/${f.facilityId}/upgrade`, { idempotencyKey: h.key() });
    // şirket seviyesi 1: hedef seviye 2 açık değil
    expect((await up()).body.error.code).toBe("LEVEL_TOO_LOW");
    await setLevel(h, f.companyId, 2);
    await grantCash(h, f.companyId, 50_000_000n);
    // çelik yok
    expect((await up()).body.error.code).toBe("INSUFFICIENT_STEEL");
    const ld = h.deps.catalog.levelDef("field", 1);
    await grantStock(h, f.companyId, f.cityId, "steel", 2, ld.upgradeSteelKg, 6_000_000n);
    const cashBefore = await balance(h, f.companyId, "cash");
    const faBefore = await balance(h, f.companyId, "fixed_assets");
    const r = await up();
    expect(r.status).toBe(200);
    expect(r.body.upgrade).toMatchObject({ kind: "level", target: 2 });
    expect(cashBefore - (await balance(h, f.companyId, "cash"))).toBe(BigInt(ld.upgradeCost));
    // sabit kıymet: nakit + çelik maliyeti
    expect((await balance(h, f.companyId, "fixed_assets")) - faBefore).toBe(BigInt(ld.upgradeCost) + 6_000_000n);
    expect((await up()).body.error.code).toBe("BUILDING_BUSY");
    expect((await f.p.ok("GET", "/inventory")).find((s: { productId: string }) => s.productId === "steel")).toBeUndefined();
    await h.advance(ld.upgradeMinutes * 60_000 + HOUR);
    const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
    expect(fac.level).toBe(2);
    expect(fac.lines).toBe(2);
    expect(fac.maxBatches).toBe(h.deps.catalog.levelDef("field", 2).maxBatches);
    expect(fac.upgrade).toBeNull();
    // iki hat artık çalışır (tohum yeterli: starter 400 kg)
    for (let i = 0; i < 2; i++) {
      const s = await f.p.post("/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
      expect(s.status).toBe(200);
    }
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.some((n: { kind: string }) => n.kind === "upgrade_done")).toBe(true);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("garaj üretim yapmaz ama yükseltilebilir; kalite iyileştirme garajda yok", async () => {
    const f = await found(h, "freight", "kavsak");
    const q = await f.p.post(`/facilities/${f.facilityId}/quality`, { idempotencyKey: h.key() });
    expect(q.body.error.code).toBe("MAX_LEVEL");
    const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
    expect(fac.lines).toBe(0);
  });
});
