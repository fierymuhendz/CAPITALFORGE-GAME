import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDue } from "../scheduler/scheduler";
import { createHarness, type Harness } from "../test/harness";
import { checkInvariants } from "../test/invariants";
import { balance, found, grantCash, grantStock, HOUR, setLevel, type Founded } from "./kit";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const inv = async (f: Founded) => (await f.p.ok("GET", "/inventory")) as Array<{ productId: string; quality: number; qtyKg: number; costTotal: string }>;

/** Tarifle bir iş başlat, bitir, çıktıyı maliyetiyle doğrula */
async function runFirstJob(f: Founded, recipeId: string, batches: number) {
  const quote = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId, batches });
  expect(quote.blockers, JSON.stringify(quote.blockers)).toEqual([]);
  expect(quote.canStart).toBe(true);
  const cashBefore = BigInt((await f.p.ok("GET", "/company")).cash);
  const job = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId, batches, repeat: false, idempotencyKey: h.key() });
  expect(job.status).toBe("running");
  const cashAfter = BigInt((await f.p.ok("GET", "/company")).cash);
  // Nakit yalnızca enerji + su + ücret kadar düşer (girdiler stoktan)
  expect(cashBefore - cashAfter).toBe(BigInt(quote.cost.energy) + BigInt(quote.cost.water) + BigInt(quote.cost.labor));
  const fin1 = await f.p.ok("GET", "/finance");
  expect(BigInt(fin1.balances.wip)).toBe(BigInt(job.cost.total));
  await h.advance(5 * HOUR);
  const st = await f.p.ok("GET", `/facilities/${f.facilityId}`);
  expect(st.jobs.find((j: { id: string }) => j.id === job.id).status).toBe("completed");
  const stock = (await inv(f)).find((s) => s.productId === job.output.productId && s.quality === job.output.quality);
  expect(stock, "çıktı depoda").toBeTruthy();
  expect(stock!.qtyKg).toBe(job.output.qtyKg);
  expect(stock!.costTotal).toBe(job.cost.total);
  const fin2 = await f.p.ok("GET", "/finance");
  expect(fin2.balances.wip).toBe("0");
  const mv = await f.p.ok("GET", `/inventory/movements?productId=${job.output.productId}`);
  const out = mv.find((x: { kind: string }) => x.kind === "production_output");
  expect(out.breakdown.total).toBe(job.cost.total);
  expect(out.breakdown.inputs.length).toBe(quote.inputs.length);
  const me = await f.p.ok("GET", "/company");
  expect(me.xp).toBe(h.deps.catalog.settings.xp.productionJob);
  return { job, quote };
}

describe("her sektörün ilk işi", () => {
  it("tarım: yem bitkisi", async () => {
    const f = await found(h, "crop", "yesilova");
    await runFirstJob(f, "grow_fodder", 2);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("hayvancılık: süt", async () => {
    const f = await found(h, "livestock", "akyayla");
    const { job } = await runFirstJob(f, "milk_cows", 2);
    expect(job.output.productId).toBe("raw_milk");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("madencilik: arsadaki yatağa göre cevher/kömür", async () => {
    const f = await found(h, "mining", "demirdag");
    const recipe = f.plot.deposit?.kind === "coal" ? "mine_coal" : "mine_iron";
    const { job } = await runFirstJob(f, recipe, 1);
    expect(job.output.productId).toBe(recipe === "mine_coal" ? "coal" : "iron_ore");
    // yanlış yatak tarifi reddedilir
    const wrong = recipe === "mine_coal" ? "mine_iron" : "mine_coal";
    const r = await f.p.post("/production/start", { facilityId: f.facilityId, recipeId: wrong, batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(r.body.error.code).toBe("DEPOSIT_MISMATCH");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("imalat: gıda fabrikası (un)", async () => {
    const f = await found(h, "manufacturing", "korfezkent", "food_plant");
    const { job } = await runFirstJob(f, "mill_flour", 1);
    expect(job.output.productId).toBe("flour");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("imalat: çelikhane (çelik)", async () => {
    const f = await found(h, "manufacturing", "korfezkent", "steel_mill");
    const { job } = await runFirstJob(f, "smelt_steel", 1);
    expect(job.output.productId).toBe("steel");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("kapasite, hat ve engeller", () => {
  it("parti kapasitesi, hat sınırı, tarif ve garaj", async () => {
    const f = await found(h, "crop", "yesilova");
    const start = (batches: number, recipeId = "grow_fodder") =>
      f.p.post("/production/start", { facilityId: f.facilityId, recipeId, batches, repeat: false, idempotencyKey: h.key() });
    expect((await start(3)).body.error.code).toBe("BATCHES_EXCEED_CAPACITY");
    expect((await start(1, "milk_cows")).body.error.code).toBe("RECIPE_NOT_ALLOWED");
    expect((await start(1)).status).toBe(200);
    // seviye 1: tek hat
    expect((await start(1)).body.error.code).toBe("NO_FREE_LINE");
    const q = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 });
    expect(q.canStart).toBe(false);
    expect(q.blockers.map((b: { code: string }) => b.code)).toContain("NO_FREE_LINE");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("girdi yoksa INSUFFICIENT_STOCK, garaj üretim yapmaz", async () => {
    const f = await found(h, "crop", "yesilova");
    const r = await f.p.post("/production/start", { facilityId: f.facilityId, recipeId: "grow_grain", batches: 2, repeat: false, idempotencyKey: h.key() });
    expect(r.body.error.code).toBe("INSUFFICIENT_STOCK"); // 600 kg tohum gerekir, 400 var
    const g = await found(h, "freight", "kavsak");
    const r2 = await g.p.post("/production/start", { facilityId: g.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(r2.body.error.code).toBe("RECIPE_NOT_ALLOWED");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("aynı idempotencyKey ikinci kez iş açmaz", async () => {
    const f = await found(h, "crop", "yesilova");
    const body = { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() };
    const a = await f.p.ok("POST", "/production/start", body);
    const b = await f.p.ok("POST", "/production/start", body);
    expect(b.id).toBe(a.id);
    const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
    expect(fac.jobs.filter((j: { status: string }) => j.status === "running").length).toBe(1);
  });
});

describe("tekrar modu", () => {
  it("girdi bitince hat durur, durma nedeni ve bildirim yazılır", async () => {
    const f = await found(h, "crop", "yesilova");
    await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: true, idempotencyKey: h.key() });
    await h.advance(6 * HOUR);
    const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
    // 400 kg tohum: iki iş (200 + 200), üçüncü başlayamaz
    expect(fac.jobs.filter((j: { status: string }) => j.status === "completed").length).toBe(2);
    expect(fac.jobs.filter((j: { status: string }) => j.status === "running").length).toBe(0);
    expect(fac.status).toBe("stalled");
    expect(fac.stalledReason).toEqual({ code: "MISSING_INPUT", productId: "seed" });
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.some((n: { kind: string }) => n.kind === "line_stalled")).toBe(true);
    expect(notes.filter((n: { kind: string }) => n.kind === "production_done").length).toBe(2);
    const me = await f.p.ok("GET", "/company");
    expect(me.nextSteps.some((s: { key: string }) => s.key === "fix_stalled")).toBe(true);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("stop-repeat zinciri durdurur", async () => {
    const f = await found(h, "crop", "yesilova");
    const job = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: true, idempotencyKey: h.key() });
    await f.p.ok("POST", `/production/${job.id}/stop-repeat`, { idempotencyKey: h.key() });
    await h.advance(4 * HOUR);
    const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
    expect(fac.jobs.filter((j: { status: string }) => j.status === "completed").length).toBe(1);
    expect(fac.status).toBe("idle");
    expect(fac.stalledReason).toBeNull();
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("tekrar işi katalogdaki güncel tarifle başlar, çalışan iş kendi anlık görüntüsüyle biter", async () => {
    const f = await found(h, "crop", "yesilova");
    const first = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: true, idempotencyKey: h.key() });
    // yönetici tarifi değiştirir: çıktı 2400 → 4800 (katalog belleği)
    const r = h.deps.catalog.recipes.get("grow_fodder")!;
    const old = { ...r, output: { ...r.output } };
    h.deps.catalog.recipes.set("grow_fodder", { ...r, output: { productId: "fodder", kg: 4800 }, version: r.version + 1 });
    try {
      await h.advance(4 * HOUR);
      const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
      const jobs = fac.jobs as Array<{ id: string; output: { qtyKg: number } }>;
      const a = jobs.find((j) => j.id === first.id)!;
      const b = jobs.find((j) => j.id !== first.id)!;
      expect(a.output.qtyKg).toBe(first.output.qtyKg);
      expect(Math.abs(b.output.qtyKg - first.output.qtyKg * 2)).toBeLessThanOrEqual(1);
    } finally {
      h.deps.catalog.recipes.set("grow_fodder", old);
    }
  });
});

describe("çevrimdışı yerleşme ve tek seferlik", () => {
  it("oturum olmadan zamanlayıcı işi bitirir; aynı anda iki runDue işi iki kez yerleştirmez", async () => {
    const f = await found(h, "crop", "yesilova");
    const job = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 2, repeat: false, idempotencyKey: h.key() });
    // zamanı ilerlet ama görev çalıştırma (çevrimdışı oyuncu): saat ofseti
    await h.deps.clock.advance(h.deps.db, 3 * HOUR);
    const now = h.deps.clock.now();
    const res = await Promise.all([runDue(h.deps, now, true), runDue(h.deps, now, true), runDue(h.deps, now, true)]);
    expect(res.reduce((a, r) => a + (r["production.settle"] ?? 0), 0)).toBe(1);
    const stock = (await inv(f)).filter((s) => s.productId === job.output.productId);
    expect(stock.reduce((a, s) => a + s.qtyKg, 0)).toBe(job.output.qtyKg);
    const rows = (await h.deps.db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("drizzle-orm")).sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE idempotency_key = ${`prod-settle:${job.id}`}`,
    )) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(1);
    const me = await f.p.ok("GET", "/company");
    expect(me.xp).toBe(h.deps.catalog.settings.xp.productionJob);
    expect(await balance(h, f.companyId, "wip")).toBe(0n);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("kalite, araştırma", () => {
  it("kalite iyileştirmesi çıktı kalitesini artırır", async () => {
    const f = await found(h, "crop", "yesilova");
    const q1 = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 });
    await grantCash(h, f.companyId, 10_000_000n);
    const up = await f.p.ok("POST", `/facilities/${f.facilityId}/quality`, { idempotencyKey: h.key() });
    expect(up.upgrade.kind).toBe("quality");
    const busy = await f.p.post(`/facilities/${f.facilityId}/quality`, { idempotencyKey: h.key() });
    expect(busy.body.error.code).toBe("BUILDING_BUSY");
    await h.advance(5 * HOUR);
    const fac = await f.p.ok("GET", `/facilities/${f.facilityId}`);
    expect(fac.qualityLevel).toBe(2);
    expect(fac.upgrade).toBeNull();
    const q2 = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 });
    expect(q2.output.quality).toBe(q1.output.quality + 1);
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.some((n: { kind: string }) => n.kind === "quality_upgrade_done")).toBe(true);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
  it("araştırma verimi artırır; seviye ve meşgul denetimi", async () => {
    const f = await found(h, "crop", "yesilova");
    const q1 = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 2 });
    await grantCash(h, f.companyId, 20_000_000n);
    const r = await f.p.ok("POST", "/research/agronomy/start", { idempotencyKey: h.key() });
    expect(r.items.find((i: { researchId: string }) => i.researchId === "agronomy").inProgress).toBeTruthy();
    expect((await f.p.post("/research/drilling/start", { idempotencyKey: h.key() })).body.error.code).toBe("RESEARCH_BUSY");
    await h.advance(4 * HOUR);
    const q2 = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 2 });
    expect(q2.output.qtyKg).toBeGreaterThan(q1.output.qtyKg);
    // %8 artış (taban 2400 × 2 parti, aşağı yuvarlı)
    expect(q2.output.qtyKg).toBe(Math.floor((q1.output.qtyKg * 10800) / 10000));
    // seviye 2 için şirket seviyesi 2 gerekir
    expect((await f.p.post("/research/agronomy/start", { idempotencyKey: h.key() })).body.error.code).toBe("LEVEL_TOO_LOW");
    await setLevel(h, f.companyId, 2);
    await grantCash(h, f.companyId, 30_000_000n);
    await f.p.ok("POST", "/research/agronomy/start", { idempotencyKey: h.key() });
    await h.advance(7 * HOUR);
    await setLevel(h, f.companyId, 3);
    await f.p.ok("POST", "/research/agronomy/start", { idempotencyKey: h.key() });
    await h.advance(10 * HOUR);
    expect((await f.p.post("/research/agronomy/start", { idempotencyKey: h.key() })).body.error.code).toBe("RESEARCH_MAXED");
    const view = await f.p.ok("GET", "/research");
    expect(view.items.find((i: { researchId: string }) => i.researchId === "agronomy").level).toBe(3);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("stok ve maliyet", () => {
  it("lot maliyeti ağırlıklı ortalamayla düşer, kalite girdi ortalamasından gelir", async () => {
    const f = await found(h, "livestock", "akyayla");
    const before = (await inv(f)).find((s) => s.productId === "fodder")!.qtyKg;
    // ek yem: kalite 4, pahalı → girdi ortalaması yukarı çeker
    await grantStock(h, f.companyId, f.cityId, "fodder", 4, 1500, 3_000_000n);
    const q = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "milk_cows", batches: 2 });
    // en yüksek kaliteden başlar: 1500 kg q4 + 1500 kg q2 → ağırlıklı ortalama 3
    expect(q.output.quality).toBe(3);
    const job = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "milk_cows", batches: 2, repeat: false, idempotencyKey: h.key() });
    expect(job.cost.inputs.map((i: { quality: number }) => i.quality).sort()).toEqual([2, 4]);
    const lot4 = job.cost.inputs.find((i: { quality: number }) => i.quality === 4);
    expect(lot4.cost).toBe("3000000");
    await h.advance(3 * HOUR);
    const stock = await inv(f);
    const usedKg = (job.cost.inputs as Array<{ qtyKg: number }>).reduce((a, i) => a + i.qtyKg, 0);
    expect(stock.filter((s) => s.productId === "fodder").map((s) => [s.quality, s.qtyKg])).toEqual([[2, before - (usedKg - 1500)]]);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});
