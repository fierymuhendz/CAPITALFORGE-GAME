/**
 * v4 katalog entegrasyon testleri (gerçek PostgreSQL, harness).
 *  1) eski dünya yükseltmesi (seedWorld + applyCatalogRevisions iki kez)
 *  2) araştırma önkoşulu ve reçete araştırma kilidi
 *  3) bina türüne özgü araştırma etkileri (kapasite, enerji, süre)
 *  4) yatak kuralı ve minCompanyLevel
 *  5) eşzamanlılık ve idempotency
 *  6) ara mal zinciri: üret, ilan, satın al, işle, sevk et, sisteme sat; muhasebe
 * Para ve stok doğrulamaları tam sayıdır. Her senaryo sonunda checkInvariants.
 */
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BUILDING_TYPES, CITIES, LEGACY_BUILDING_TYPES, LEGACY_PRODUCTS, LEGACY_RECIPES, LEGACY_RESEARCH, PLOTS, PRODUCTS, RECIPES, RESEARCH,
  type AccountingDto, type FacilityDto,
} from "@capitalforge/shared";
import { applyCatalogRevisions } from "../db/catalogRevision";
import { seedWorld } from "../db/seed";
import { catalogItems, meta, plots, priceRefs, sales, settings, trades } from "../db/schema";
import { found, grantCash, grantStock, balance, setLevel, HOUR, type Founded } from "../production/kit";
import { createHarness, type Harness } from "./harness";
import { checkInvariants } from "./invariants";

const T = 280_000;
const withKey = <T extends object>(h: Harness, body: T) => ({ ...body, idempotencyKey: h.key() });
const errCode = (r: { body: { error?: { code?: string } } }) => r.body.error?.code;

/** tablo içeriğinin sıralı JSON dökümü (değişmezlik karşılaştırması için) */
async function dump(h: Harness, table: string, where = sql`true`): Promise<string> {
  const rows = (await h.deps.db.execute(sql`SELECT t::text AS r FROM ${sql.raw(`cf.${table}`)} t WHERE ${where} ORDER BY t::text`)) as unknown as Array<{ r: string }>;
  return rows.map((r) => r.r).join("\n");
}

/** boş, seviye 1'den açık ve (isteğe bağlı) belirli yataklı arsa */
async function freePlot(h: Harness, cityId: string, deposit: string | null): Promise<string> {
  const rows = await h.deps.db
    .select({ id: plots.id })
    .from(plots)
    .where(and(eq(plots.cityId, cityId), isNull(plots.ownerCompanyId), eq(plots.minLevel, 1), deposit ? eq(plots.depositKind, deposit as never) : isNull(plots.depositKind)))
    .orderBy(plots.id)
    .limit(1);
  if (!rows[0]) throw new Error(`boş arsa yok: ${cityId}/${deposit}`);
  return rows[0].id;
}

/** arsa al + bina kur + inşaat bitene dek ilerlet; tesis kimliğini döndürür */
async function build(h: Harness, f: Founded, buildingType: string, cityId: string, deposit: string | null = null): Promise<{ facilityId: string; plotId: string }> {
  const bt = h.deps.catalog.buildingType(buildingType);
  const plotId = await freePlot(h, cityId, deposit);
  await grantCash(h, f.companyId, 300_000_000n);
  await grantStock(h, f.companyId, cityId, "steel", 2, bt.buildSteelKg, 100n);
  const fac = await f.p.ok<FacilityDto>("POST", `/plots/${plotId}/buy`, withKey(h, { buildingType }));
  expect(fac.type).toBe(buildingType);
  await h.advance(6 * HOUR, HOUR);
  const now = await f.p.ok<FacilityDto>("GET", `/facilities/${fac.id}`);
  expect(now.status).not.toBe("constructing");
  return { facilityId: fac.id, plotId };
}

async function runResearch(h: Harness, f: Founded, id: string): Promise<void> {
  await grantCash(h, f.companyId, 50_000_000n);
  await f.p.ok("POST", `/research/${id}/start`, withKey(h, {}));
  await h.advance(12 * HOUR, HOUR);
}

const acc = (p: Founded["p"]) => p.ok<AccountingDto>("GET", "/finance/accounting?period=today");

// ---------------------------------------------------------------------------------------------------------------------
describe("1) eski dünya yükseltmesi: seedWorld + applyCatalogRevisions iki kez", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });

  it("yeni satırlar eklenir, eski satırlar alan kazanır, düzenleme ve ayar korunur, oyuncu verisi değişmez, ikinci çalıştırma etkisiz", async () => {
    const db = h.deps.db;
    // --- oyuncu durumu: bakiye, stok, çalışan üretim işi, açık ilan ve alım emri
    const crop = await found(h, "crop", "yesilova");
    const herd = await found(h, "livestock", "akyayla");
    await grantCash(h, crop.companyId, 40_000_000n);
    await grantStock(h, herd.companyId, "akyayla", "fodder", 2, 5000, 25n);
    await grantStock(h, crop.companyId, "yesilova", "grain", 3, 777, 11n);
    const job = await crop.p.ok("POST", "/production/start", withKey(h, { facilityId: crop.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false }));
    expect(job.status).toBe("running");
    const listing = await herd.p.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 2, qtyKg: 3000, pricePerKg: 300 }));
    const order = await crop.p.ok("POST", "/market/orders", withKey(h, { cityId: "yesilova", productId: "fodder", minQuality: 2, qtyKg: 500, maxPricePerKg: 1 }));
    const cashCrop = await balance(h, crop.companyId, "cash");
    const cashHerd = await balance(h, herd.companyId, "cash");

    // --- v4 öncesi dünyaya geri götür: yalnızca LEGACY_* kataloğu, halka arsaları yok, yeni fiyat referansı yok
    const origCatalog = await db.select().from(catalogItems);
    const legacy = {
      product: LEGACY_PRODUCTS.map((d) => ({ id: d.id, data: d as object })),
      building_type: LEGACY_BUILDING_TYPES.map((d) => ({ id: d.id, data: d as object })),
      recipe: LEGACY_RECIPES.map((d) => ({ id: d.id, data: d as object })),
      research: LEGACY_RESEARCH.map((d) => ({ id: d.id, data: d as object })),
    } as const;
    for (const kind of ["product", "building_type", "recipe", "research"] as const) {
      await db.delete(catalogItems).where(and(eq(catalogItems.kind, kind), notInArray(catalogItems.id, legacy[kind].map((x) => x.id))));
      for (const x of legacy[kind]) await db.update(catalogItems).set({ data: x.data, version: 1 }).where(and(eq(catalogItems.kind, kind), eq(catalogItems.id, x.id)));
    }
    // yönetici düzenlemeleri: ürün "flour" (sürüm 2, fiyat değişti), bina "field" (sürüm 3, inşaat maliyeti değişti)
    const flourBase = LEGACY_PRODUCTS.find((p) => p.id === "flour")!;
    const fieldBase = LEGACY_BUILDING_TYPES.find((b) => b.id === "field")!;
    const flourEdited = { ...flourBase, basePricePerKg: flourBase.basePricePerKg + 77 };
    const fieldEdited = { ...fieldBase, buildCost: fieldBase.buildCost + 1_234_000 };
    await db.update(catalogItems).set({ data: flourEdited as object, version: 2 }).where(and(eq(catalogItems.kind, "product"), eq(catalogItems.id, "flour")));
    await db.update(catalogItems).set({ data: fieldEdited as object, version: 3 }).where(and(eq(catalogItems.kind, "building_type"), eq(catalogItems.id, "field")));
    // ayar düzenlemesi
    await db.update(settings).set({ value: 150 as never }).where(eq(settings.key, "marketFeeBp"));
    // yeni halka arsaları ve yeni ürünlerin fiyat referansları yok; v4 revizyon işareti yok
    const legacyPlotIds = PLOTS.filter((p) => !p.id.includes("-o")).map((p) => p.id);
    await db.delete(plots).where(notInArray(plots.id, legacyPlotIds));
    await db.delete(priceRefs).where(notInArray(priceRefs.productId, LEGACY_PRODUCTS.map((p) => p.id)));
    await db.delete(meta).where(eq(meta.key, "catalog.rev.v4-2026-11-katalog"));
    // ön koşul: gerçekten eski dünya
    expect((await db.select().from(catalogItems).where(eq(catalogItems.kind, "product"))).length).toBe(LEGACY_PRODUCTS.length);
    expect((await db.select().from(plots)).length).toBe(80);
    expect((await db.select().from(catalogItems).where(and(eq(catalogItems.kind, "research"), eq(catalogItems.id, "agronomy"))))[0]!.data).not.toHaveProperty("branch");

    const before = {
      holdings: await dump(h, "holdings"), jobs: await dump(h, "production_jobs"), orders: await dump(h, "market_orders"),
      accounts: await dump(h, "ledger_accounts"), entries: await dump(h, "ledger_entries"), facilities: await dump(h, "facilities"),
      companies: await dump(h, "companies"),
    };

    // --- yükseltme, iki kez
    const r1 = await (async () => { await seedWorld(db); return applyCatalogRevisions(db); })();
    expect(r1).toHaveLength(1);
    expect(r1[0]!.revisionId).toBe("v4-2026-11-katalog");
    const afterFirst = {
      catalog: await dump(h, "catalog_items"), plots: await dump(h, "plots"), refs: await dump(h, "price_refs"),
      settings: await dump(h, "settings"), meta: await dump(h, "meta", sql`key LIKE 'catalog.rev.%'`), history: await dump(h, "catalog_history"),
    };
    await seedWorld(db);
    expect(await applyCatalogRevisions(db)).toEqual([]);
    expect(await dump(h, "catalog_items")).toBe(afterFirst.catalog);
    expect(await dump(h, "plots")).toBe(afterFirst.plots);
    expect(await dump(h, "price_refs")).toBe(afterFirst.refs);
    expect(await dump(h, "settings")).toBe(afterFirst.settings);
    expect(await dump(h, "meta", sql`key LIKE 'catalog.rev.%'`)).toBe(afterFirst.meta);
    expect(await dump(h, "catalog_history")).toBe(afterFirst.history);

    // --- yeni satırlar eklendi
    const rows = await db.select().from(catalogItems);
    const count = (k: string) => rows.filter((r) => r.kind === k).length;
    expect(count("product")).toBe(PRODUCTS.length);
    expect(count("building_type")).toBe(BUILDING_TYPES.length);
    expect(count("recipe")).toBe(RECIPES.length);
    expect(count("research")).toBe(RESEARCH.length);
    expect(await db.select().from(plots)).toHaveLength(PLOTS.length);
    expect((await db.select().from(plots).where(eq(plots.id, "yesilova-o51")))[0]!.depositKind).toBe("limestone");
    const refs = await db.select().from(priceRefs);
    expect(refs).toHaveLength(PRODUCTS.length * CITIES.length);
    // her şehirde yeni bir ürün için referans var ve taban fiyatla tutarlı
    for (const c of CITIES) expect(refs.some((x) => x.cityId === c.id && x.productId === "compound_feed")).toBe(true);

    // --- eski satırlar yeni alan kazandı (düzenlenmemişler), değerleri değişmedi
    const byKey = new Map(rows.map((r) => [`${r.kind}:${r.id}`, r]));
    const origByKey = new Map(origCatalog.map((r) => [`${r.kind}:${r.id}`, r]));
    for (const p of LEGACY_PRODUCTS.filter((x) => x.id !== "flour")) {
      expect(byKey.get(`product:${p.id}`)!.data, p.id).toEqual(origByKey.get(`product:${p.id}`)!.data);
      expect(byKey.get(`product:${p.id}`)!.version).toBe(2);
    }
    for (const b of LEGACY_BUILDING_TYPES.filter((x) => x.id !== "field")) {
      expect(byKey.get(`building_type:${b.id}`)!.data, b.id).toEqual(origByKey.get(`building_type:${b.id}`)!.data);
    }
    for (const r of LEGACY_RESEARCH) expect(byKey.get(`research:${r.id}`)!.data, r.id).toEqual(origByKey.get(`research:${r.id}`)!.data);
    expect(byKey.get("building_type:mine")!.data).toMatchObject({ deposits: ["iron", "coal", "copper"], industry: "mining_metal" });
    expect(byKey.get("research:agronomy")!.data).toMatchObject({ branch: expect.any(String), prerequisites: [] });
    // yeni satırlar tohumlamayla aynı
    for (const r of rows.filter((x) => !["city", "vehicle_model"].includes(x.kind) && !legacyKey(x.kind, x.id))) {
      expect(r.data, `${r.kind}:${r.id}`).toEqual(origByKey.get(`${r.kind}:${r.id}`)!.data);
      expect(r.version).toBe(1);
    }
    // --- yönetici düzenlemesi korunur: değer ve sürüm aynı; revizyon "düzenlenmiş" diye atladı
    expect(byKey.get("product:flour")!.data).toEqual(flourEdited);
    expect(byKey.get("product:flour")!.version).toBe(2);
    expect(byKey.get("building_type:field")!.data).toEqual(fieldEdited);
    expect(byKey.get("building_type:field")!.version).toBe(3);
    const skipped = r1[0]!.skipped.filter((s) => s.reason === "edited").map((s) => `${s.kind}:${s.id}`).sort();
    expect(skipped).toEqual(["building_type:field", "product:flour"]);
    // --- ayar korunur
    expect((await db.select().from(settings).where(eq(settings.key, "marketFeeBp")))[0]!.value).toBe(150);

    // --- oyuncu verisi: bakiye, stok, iş, emirler, defter aynen
    expect(await dump(h, "holdings")).toBe(before.holdings);
    expect(await dump(h, "production_jobs")).toBe(before.jobs);
    expect(await dump(h, "market_orders")).toBe(before.orders);
    expect(await dump(h, "ledger_accounts")).toBe(before.accounts);
    expect(await dump(h, "ledger_entries")).toBe(before.entries);
    expect(await dump(h, "facilities")).toBe(before.facilities);
    expect(await dump(h, "companies")).toBe(before.companies);
    expect(await balance(h, crop.companyId, "cash")).toBe(cashCrop);
    expect(await balance(h, herd.companyId, "cash")).toBe(cashHerd);
    expect(await checkInvariants(db)).toEqual([]);

    // --- yeni varsayılan mevcut şirkette etkili: katalog yeniden yüklenir, çalışan iş biter, yeni bina kurulur
    await h.deps.catalog.reload(db);
    expect(h.deps.catalog.buildingType("quarry").deposits).toContain("limestone");
    expect(h.deps.catalog.product("flour").basePricePerKg).toBe(flourEdited.basePricePerKg);
    await h.advance(5 * HOUR, HOUR);
    const fac = await crop.p.ok<FacilityDto>("GET", `/facilities/${crop.facilityId}`);
    expect(fac.jobs.find((j) => j.id === job.id)!.status).toBe("completed");
    const stock = (await crop.p.ok("GET", "/inventory")) as Array<{ productId: string; qtyKg: number }>;
    expect(stock.find((s) => s.productId === "fodder")!.qtyKg).toBe(job.output.qtyKg);
    // açık ilan ve emir hâlâ işlem görür
    const buyer = await found(h, "crop", "kavsak");
    const buy = await buyer.p.post(`/market/listings/${listing.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: 300 }));
    expect(buy.status).toBe(200);
    await grantStock(h, herd.companyId, "yesilova", "fodder", 2, 200, 25n);
    const sell = await herd.p.post(`/market/orders/${order.id}/sell`, withKey(h, { qtyKg: 100, quality: 2, expectedPricePerKg: 1 }));
    expect(sell.status).toBe(200);
    // eski şirket yeni bir binayı (taş ocağı) yeni halka arsasında kurabilir
    await build(h, crop, "quarry", "yesilova", "limestone");
    const fl = await crop.p.ok<FacilityDto[]>("GET", "/facilities");
    expect(fl.some((x) => x.type === "quarry")).toBe(true);
    expect(await checkInvariants(db)).toEqual([]);
  }, T);
});

function legacyKey(kind: string, id: string): boolean {
  const ids = kind === "product" ? LEGACY_PRODUCTS : kind === "building_type" ? LEGACY_BUILDING_TYPES : kind === "recipe" ? LEGACY_RECIPES : kind === "research" ? LEGACY_RESEARCH : [];
  return ids.some((x) => x.id === id);
}

// ---------------------------------------------------------------------------------------------------------------------
describe("2-5) araştırma, bina etkileri, yatak kuralı, eşzamanlılık", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });

  it("2) önkoşul: soil_science agronomy olmadan PREREQUISITE_MISSING; agronomy 1 sonrası başlar; kilitli reçete araştırmasız RESEARCH_REQUIRED", async () => {
    const f = await found(h, "crop", "yesilova");
    await grantCash(h, f.companyId, 50_000_000n);
    await grantStock(h, f.companyId, "yesilova", "fertilizer", 2, 400, 10n);
    const startRes = (id: string) => f.p.post(`/research/${id}/start`, withKey(h, {}));

    const none = await startRes("soil_science");
    expect(none.status).toBeGreaterThanOrEqual(400);
    expect(errCode(none)).toBe("PREREQUISITE_MISSING");
    const view = await f.p.ok("GET", "/research");
    const item = view.items.find((i: { researchId: string }) => i.researchId === "soil_science");
    expect(item.blocked).toBe("PREREQUISITE_MISSING");
    expect(item.missingPrerequisites).toEqual([{ researchId: "agronomy", level: 1, have: 0 }]);

    // kilitli reçete: araştırma yok
    const body = { facilityId: f.facilityId, recipeId: "grow_grain_fert", batches: 1 };
    const q0 = await f.p.ok("POST", "/production/quote", body);
    expect(q0.canStart).toBe(false);
    expect(q0.blockers).toEqual([{ code: "RESEARCH_REQUIRED", missing: "soil_science" }]);
    const s0 = await f.p.post("/production/start", withKey(h, { ...body, repeat: false }));
    expect(errCode(s0)).toBe("RESEARCH_REQUIRED");

    // agronomy 1 → soil_science başlar
    await f.p.ok("POST", "/research/agronomy/start", withKey(h, {}));
    expect(errCode(await startRes("soil_science"))).toBe("RESEARCH_BUSY"); // önkoşul seviyesi henüz yok değil, araştırma sürüyor
    await h.advance(6 * HOUR, HOUR);
    const view2 = await f.p.ok("GET", "/research");
    expect(view2.items.find((i: { researchId: string }) => i.researchId === "agronomy").level).toBe(1);
    expect(view2.items.find((i: { researchId: string }) => i.researchId === "soil_science").blocked).toBeNull();
    await f.p.ok("POST", "/research/soil_science/start", withKey(h, {}));
    // araştırma sürerken reçete hâlâ kilitli
    expect((await f.p.ok("POST", "/production/quote", body)).blockers.map((b: { code: string }) => b.code)).toEqual(["RESEARCH_REQUIRED"]);
    await h.advance(6 * HOUR, HOUR);
    const q1 = await f.p.ok("POST", "/production/quote", body);
    expect(q1.blockers).toEqual([]);
    const job = await f.p.ok("POST", "/production/start", withKey(h, { ...body, repeat: false }));
    expect(job.status).toBe("running");
    expect(job.output.productId).toBe("grain");
    await h.advance(5 * HOUR, HOUR);
    const inv = (await f.p.ok("GET", "/inventory")) as Array<{ productId: string; qtyKg: number }>;
    expect(inv.find((s) => s.productId === "grain")!.qtyKg).toBe(job.output.qtyKg);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  it("3a) capacity araştırması maxBatches'i artırır ve fazla parti başlatılabilir", async () => {
    const f = await found(h, "crop", "yesilova");
    const { facilityId } = await build(h, f, "feed_mill", "yesilova");
    await grantStock(h, f.companyId, "yesilova", "barley", 2, 1200, 10n);
    await grantStock(h, f.companyId, "yesilova", "corn", 2, 1200, 10n);
    const start = (batches: number) => f.p.post("/production/start", withKey(h, { facilityId, recipeId: "mix_compound_feed", batches, repeat: false }));
    const fac0 = await f.p.ok<FacilityDto>("GET", `/facilities/${facilityId}`);
    expect(fac0.maxBatches).toBe(h.deps.catalog.levelDef("feed_mill", 1).maxBatches);
    const base = fac0.maxBatches;
    expect(errCode(await start(base + 1))).toBe("BATCHES_EXCEED_CAPACITY");

    await runResearch(h, f, "feed_formulation");
    expect(errCode(await start(base + 1))).toBe("BATCHES_EXCEED_CAPACITY"); // verim araştırması kapasite vermez
    await runResearch(h, f, "pellet_press");
    const fac1 = await f.p.ok<FacilityDto>("GET", `/facilities/${facilityId}`);
    expect(fac1.maxBatches).toBe(base + 1);
    // başka bina türünün kapasitesi etkilenmez
    const q = await f.p.ok("POST", "/production/quote", { facilityId, recipeId: "mix_compound_feed", batches: base + 1 });
    expect(q.blockers).toEqual([]);
    const job = await start(base + 1);
    expect(job.status).toBe(200);
    expect(job.body.batches).toBe(base + 1);
    expect(errCode(await start(base + 2))).toBeDefined();
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  it("3b) energy etkisi quote'ta enerjiyi tam sayı olarak azaltır (silage_tech −%12)", async () => {
    const f = await found(h, "crop", "yesilova");
    const { facilityId } = await build(h, f, "feed_mill", "yesilova");
    const recipe = h.deps.catalog.recipe("mix_compound_feed");
    const quote = (batches = 1) => f.p.ok("POST", "/production/quote", { facilityId, recipeId: "mix_compound_feed", batches });
    const q0 = await quote(1);
    expect(q0.energyKwh).toBe(recipe.energyKwh);
    await runResearch(h, f, "feed_formulation");
    expect((await quote(1)).energyKwh).toBe(recipe.energyKwh); // verim araştırması enerjiyi değiştirmez
    await runResearch(h, f, "silage_tech");
    const q1 = await quote(1);
    expect(q1.energyKwh).toBe(Number((BigInt(recipe.energyKwh) * 8800n) / 10000n));
    expect(q1.energyKwh).toBeLessThan(q0.energyKwh);
    expect(BigInt(q1.cost.energy)).toBeLessThan(BigInt(q0.cost.energy));
    // işçilik değişmez (yalnızca enerji etkisi)
    expect(q1.laborHours).toBe(q0.laborHours);
    // başka bina türünde (tarla) enerji aynı kalır
    const fieldQ = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 });
    expect(fieldQ.energyKwh).toBe(h.deps.catalog.recipe("grow_fodder").energyKwh);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  it("3c) duration etkisi quote'ta süreyi azaltır (irrigation, tarla −%10)", async () => {
    const f = await found(h, "crop", "yesilova");
    const prev = h.deps.catalog.settings;
    // tempo tavanı süreyi 60 dakikaya eşitler; etkiyi görmek için tavan kapalı (yalnızca bu test)
    h.deps.catalog.settings = { ...prev, pace: { ...prev.pace, maxMinutes: 0 } } as unknown as typeof prev;
    try {
      const recipe = h.deps.catalog.recipe("grow_barley");
      const durBp = 10000 + Math.round((10000 - h.deps.catalog.city("yesilova").labor.availability) / 2);
      const minutesWith = (speedBp: number) => Math.max(1, Math.ceil((recipe.minutes * durBp * speedBp) / 100_000_000));
      const quote = () => f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_barley", batches: 1 });
      expect((await quote()).minutes).toBe(minutesWith(10000));
      await runResearch(h, f, "agronomy");
      expect((await quote()).minutes).toBe(minutesWith(10000)); // agronomy süreyi değiştirmez
      await runResearch(h, f, "irrigation");
      const q1 = await quote();
      expect(q1.minutes).toBe(minutesWith(9000));
      expect(q1.minutes).toBeLessThan(minutesWith(10000));
      // başlayan işin süresi quote ile aynı
      const job = await f.p.ok("POST", "/production/start", withKey(h, { facilityId: f.facilityId, recipeId: "grow_barley", batches: 1, repeat: false }));
      expect(new Date(job.endsAt).getTime() - new Date(job.startedAt).getTime()).toBe(q1.minutes * 60_000);
    } finally {
      h.deps.catalog.settings = prev;
    }
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  it("4) yatak kuralı: quarry demir yatağına kurulamaz, kireçtaşına kurulur; mine kireçtaşına kurulamaz; minCompanyLevel", async () => {
    const f = await found(h, "crop", "yesilova");
    await grantCash(h, f.companyId, 300_000_000n);
    await grantStock(h, f.companyId, "yesilova", "steel", 2, 20_000, 100n);
    await grantStock(h, f.companyId, "demirdag", "steel", 2, 20_000, 100n);
    const ironPlot = await freePlot(h, "demirdag", "iron");
    const limePlot = await freePlot(h, "yesilova", "limestone");
    const noDeposit = await freePlot(h, "yesilova", null);
    const buy = (plotId: string, buildingType: string) => f.p.post(`/plots/${plotId}/buy`, withKey(h, { buildingType }));

    const cashBefore = await balance(h, f.companyId, "cash");
    const bad = await buy(ironPlot, "quarry");
    expect(errCode(bad)).toBe("PLOT_NOT_ELIGIBLE");
    expect(errCode(await buy(noDeposit, "quarry"))).toBe("PLOT_NOT_ELIGIBLE"); // yatak şart
    expect(errCode(await buy(limePlot, "mine"))).toBe("PLOT_NOT_ELIGIBLE"); // mine kireçtaşı kabul etmez
    // başarısız denemeler hiçbir şey yazmadı
    expect(await balance(h, f.companyId, "cash")).toBe(cashBefore);
    expect((await h.deps.db.select().from(plots).where(eq(plots.id, ironPlot)))[0]!.ownerCompanyId).toBeNull();
    expect((await h.deps.db.select().from(plots).where(eq(plots.id, limePlot)))[0]!.ownerCompanyId).toBeNull();

    const ok = await buy(limePlot, "quarry");
    expect(ok.status).toBe(200);
    expect(ok.body.type).toBe("quarry");
    const plotRow = (await h.deps.db.select().from(plots).where(eq(plots.id, limePlot)))[0]!;
    expect(plotRow.ownerCompanyId).toBe(f.companyId);
    const price = plotRow.price;
    expect(cashBefore - (await balance(h, f.companyId, "cash"))).toBe(price + BigInt(h.deps.catalog.buildingType("quarry").buildCost));
    // yatağa uygun reçete çalışır, yanlış yatak reçetesi DEPOSIT_MISMATCH
    await h.advance(6 * HOUR, HOUR);
    const wrong = await f.p.post("/production/start", withKey(h, { facilityId: ok.body.id, recipeId: "dig_clay", batches: 1, repeat: false }));
    expect(errCode(wrong)).toBe("DEPOSIT_MISMATCH");
    const job = await f.p.ok("POST", "/production/start", withKey(h, { facilityId: ok.body.id, recipeId: "quarry_limestone", batches: 1, repeat: false }));
    expect(job.output.productId).toBe("limestone");

    // minCompanyLevel: assembly_plant seviye 5 ister
    const hi = await found(h, "crop", "yesilova");
    await grantCash(h, hi.companyId, 500_000_000n);
    await grantStock(h, hi.companyId, "yesilova", "steel", 2, 20_000, 100n);
    const plotA = await freePlot(h, "yesilova", null);
    const lvl = h.deps.catalog.buildingType("assembly_plant").minCompanyLevel!;
    expect(lvl).toBeGreaterThan(1);
    const low = await hi.p.post(`/plots/${plotA}/buy`, withKey(h, { buildingType: "assembly_plant" }));
    expect(errCode(low)).toBe("LEVEL_TOO_LOW");
    expect(low.body.error).toMatchObject({ code: "LEVEL_TOO_LOW" });
    expect((await h.deps.db.select().from(plots).where(eq(plots.id, plotA)))[0]!.ownerCompanyId).toBeNull();
    // aradaki seviye de yetmez
    await setLevel(h, hi.companyId, lvl - 1);
    expect(errCode(await hi.p.post(`/plots/${plotA}/buy`, withKey(h, { buildingType: "assembly_plant" })))).toBe("LEVEL_TOO_LOW");
    await setLevel(h, hi.companyId, lvl);
    const pass = await hi.p.post(`/plots/${plotA}/buy`, withKey(h, { buildingType: "assembly_plant" }));
    expect(pass.status).toBe(200);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  it("5a) eşzamanlılık: son 100 kg için iki alıcı aynı anda → tek başarı, stok ve defter tutarlı", async () => {
    const sup = await found(h, "livestock", "akyayla");
    const a = await found(h, "crop", "yesilova");
    const b = await found(h, "crop", "yesilova");
    await grantStock(h, sup.companyId, "akyayla", "fodder", 4, 100, 5n);
    const l = await sup.p.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 4, qtyKg: 100, pricePerKg: 7 }));
    const cash = async () => ({ sup: await balance(h, sup.companyId, "cash"), a: await balance(h, a.companyId, "cash"), b: await balance(h, b.companyId, "cash") });
    const c0 = await cash();
    const [ra, rb] = await Promise.all([
      a.p.post(`/market/listings/${l.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: 7, deliverToCityId: "akyayla" })),
      b.p.post(`/market/listings/${l.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: 7, deliverToCityId: "akyayla" })),
    ]);
    const wins = [ra, rb].filter((r) => r.status === 200);
    const lose = [ra, rb].filter((r) => r.status !== 200);
    expect(wins).toHaveLength(1);
    expect(["ORDER_CLOSED", "INSUFFICIENT_STOCK"]).toContain(errCode(lose[0]!));
    const winner = ra.status === 200 ? a : b;
    const loser = ra.status === 200 ? b : a;
    const c1 = await cash();
    // 100 kg × 7 = 700; komisyon %1 = 7
    expect(c1.sup - c0.sup).toBe(693n);
    const key = winner === a ? "a" : "b";
    const lk = loser === a ? "a" : "b";
    expect(c1[key] - c0[key]).toBe(-700n);
    expect(c1[lk] - c0[lk]).toBe(0n);
    const tr = await h.deps.db.select().from(trades).where(eq(trades.orderId, l.id));
    expect(tr).toHaveLength(1);
    expect(tr[0]!.qtyKg).toBe(100);
    expect(tr[0]!.gross).toBe(700n);
    expect(tr[0]!.fee).toBe(7n);
    const hold = async (id: string) => (await h.deps.db.execute(sql`SELECT coalesce(sum(qty_kg),0)::text q, coalesce(sum(cost_total),0)::text c FROM cf.holdings WHERE company_id = ${id} AND product_id = 'fodder' AND quality = 4 AND city_id = 'akyayla'`)) as unknown as Array<{ q: string; c: string }>;
    expect((await hold(sup.companyId))[0]!.q).toBe("0");
    expect((await hold(winner.companyId))[0]).toEqual({ q: "100", c: "700" });
    expect((await hold(loser.companyId))[0]!.q).toBe("0");
    expect((await h.deps.db.execute(sql`SELECT remaining_kg::text r, status s FROM cf.market_orders WHERE id = ${l.id}`)) as unknown as Array<{ r: string; s: string }>).toEqual([{ r: "0", s: "filled" }]);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  it("5b) aynı idempotencyKey ile tekrar gönderilen alım aynı yanıtı döner, para/stok ikinci kez hareket etmez (art arda ve eşzamanlı)", async () => {
    const sup = await found(h, "livestock", "akyayla");
    const buyer = await found(h, "crop", "yesilova");
    await grantStock(h, sup.companyId, "akyayla", "fodder", 4, 300, 5n);
    const l = await sup.p.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 4, qtyKg: 300, pricePerKg: 7 }));
    const body = withKey(h, { qtyKg: 100, expectedPricePerKg: 7 });
    const c0 = await balance(h, buyer.companyId, "cash");
    const r1 = await buyer.p.post(`/market/listings/${l.id}/buy`, body);
    const c1 = await balance(h, buyer.companyId, "cash");
    const r2 = await buyer.p.post(`/market/listings/${l.id}/buy`, body);
    const c2 = await balance(h, buyer.companyId, "cash");
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
    expect(c0 - c1).toBe(700n);
    expect(c2).toBe(c1);
    // eşzamanlı aynı anahtar
    const body2 = withKey(h, { qtyKg: 100, expectedPricePerKg: 7 });
    const [p1, p2] = await Promise.all([buyer.p.post(`/market/listings/${l.id}/buy`, body2), buyer.p.post(`/market/listings/${l.id}/buy`, body2)]);
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(p2.body).toEqual(p1.body);
    expect(c1 - (await balance(h, buyer.companyId, "cash"))).toBe(700n);
    const tr = await h.deps.db.select().from(trades).where(eq(trades.orderId, l.id));
    expect(tr).toHaveLength(2);
    const q = (await h.deps.db.execute(sql`SELECT qty_kg::text q, cost_total::text c FROM cf.holdings WHERE company_id = ${buyer.companyId} AND product_id = 'fodder' AND quality = 4`)) as unknown as Array<{ q: string; c: string }>;
    expect(q).toEqual([{ q: "200", c: "1400" }]);
    const rem = (await h.deps.db.execute(sql`SELECT remaining_kg::text r FROM cf.market_orders WHERE id = ${l.id}`)) as unknown as Array<{ r: string }>;
    expect(rem[0]!.r).toBe("100");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);
});

// ---------------------------------------------------------------------------------------------------------------------
describe("6) ara mal zinciri: yem fabrikası → ilan → süt ahırı → sevk → sistem alıcısı", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });

  it("A karma yem üretip satar; B satın alır, çiğ süte işler, korfezkent'e sevk edip sisteme satar; iki şirketin muhasebesi tutar", async () => {
    // --- A: yem fabrikası (yesilova)
    const A = await found(h, "crop", "yesilova");
    const { facilityId: mill } = await build(h, A, "feed_mill", "yesilova");
    await grantStock(h, A.companyId, "yesilova", "barley", 2, 600, 40n);
    await grantStock(h, A.companyId, "yesilova", "corn", 2, 600, 60n);
    const aJob = await A.p.ok("POST", "/production/start", withKey(h, { facilityId: mill, recipeId: "mix_compound_feed", batches: 1, repeat: false }));
    expect(aJob.output.productId).toBe("compound_feed");
    await h.advance(3 * HOUR, HOUR);
    const aInv = (await A.p.ok("GET", "/inventory")) as Array<{ productId: string; quality: number; qtyKg: number; costTotal: string }>;
    const feed = aInv.find((s) => s.productId === "compound_feed")!;
    expect(feed.qtyKg).toBe(aJob.output.qtyKg);
    expect(feed.costTotal).toBe(aJob.cost.total);
    expect(await checkInvariants(h.deps.db)).toEqual([]);

    // --- ilan: tam 600 kg (iş çıktısı en az bu kadar olmalı)
    expect(feed.qtyKg).toBeGreaterThanOrEqual(600);
    const price = h.deps.catalog.product("compound_feed").basePricePerKg;
    const listing = await A.p.ok("POST", "/market/listings", withKey(h, { cityId: "yesilova", productId: "compound_feed", quality: feed.quality, qtyKg: 600, pricePerKg: price }));

    // --- B: süt ahırı (akyayla), satın alır ve kendi şehrine teslim ettirir
    const B = await found(h, "livestock", "akyayla");
    const bCash0 = await balance(h, B.companyId, "cash");
    const buy = await B.p.ok("POST", `/market/listings/${listing.id}/buy`, withKey(h, { qtyKg: 600, expectedPricePerKg: price, deliverToCityId: "akyayla" }));
    const gross = BigInt(price) * 600n;
    expect(BigInt(buy.gross)).toBe(gross);
    expect(BigInt(buy.fee)).toBe(gross / 100n);
    expect(buy.freightJobId).toBeTruthy();
    const freightIn = BigInt(buy.freightPay);
    // yükün varışını bekle
    let arrived = 0;
    for (let i = 0; i < 48 && !arrived; i++) {
      await h.advance(HOUR, HOUR);
      const inv = (await B.p.ok("GET", "/inventory")) as Array<{ cityId: string; productId: string; qtyKg: number }>;
      arrived = inv.find((s) => s.cityId === "akyayla" && s.productId === "compound_feed")?.qtyKg ?? 0;
    }
    expect(arrived).toBe(600);
    const bFeed = ((await B.p.ok("GET", "/inventory")) as Array<{ cityId: string; productId: string; costTotal: string }>).find((s) => s.cityId === "akyayla" && s.productId === "compound_feed")!;
    // stok maliyeti = mal bedeli + navlun
    expect(BigInt(bFeed.costTotal)).toBe(gross + freightIn);
    expect(await checkInvariants(h.deps.db)).toEqual([]);

    // --- B kendi tesisinde işler
    const bJob = await B.p.ok("POST", "/production/start", withKey(h, { facilityId: B.facilityId, recipeId: "milk_cows_compound", batches: 1, repeat: false }));
    expect(bJob.output.productId).toBe("raw_milk");
    expect(bJob.cost.inputs).toEqual([expect.objectContaining({ productId: "compound_feed", qtyKg: 600 })]);
    expect(BigInt(bJob.cost.inputs[0].cost)).toBe(gross + freightIn);
    await h.advance(3 * HOUR, HOUR);
    const milk = ((await B.p.ok("GET", "/inventory")) as Array<{ cityId: string; productId: string; quality: number; qtyKg: number; costTotal: string }>).find((s) => s.productId === "raw_milk" && s.cityId === "akyayla")!;
    expect(milk.qtyKg).toBe(bJob.output.qtyKg);
    expect(milk.costTotal).toBe(bJob.cost.total);

    // --- sevk: sistem taşımacısıyla korfezkent'e
    const haul = await B.p.ok("POST", "/market/haul", withKey(h, { originCityId: "akyayla", destCityId: "korfezkent", productId: "raw_milk", quality: milk.quality, qtyKg: milk.qtyKg }));
    expect(haul.jobIds.length).toBeGreaterThan(0);
    const haulFreight = BigInt(haul.freight);
    let there = 0;
    for (let i = 0; i < 48 && !there; i++) {
      await h.advance(HOUR, HOUR);
      const inv = (await B.p.ok("GET", "/inventory")) as Array<{ cityId: string; productId: string; qtyKg: number }>;
      there = inv.find((s) => s.cityId === "korfezkent" && s.productId === "raw_milk")?.qtyKg ?? 0;
    }
    expect(there).toBe(milk.qtyKg);
    const milkThere = ((await B.p.ok("GET", "/inventory")) as Array<{ cityId: string; productId: string; costTotal: string }>).find((s) => s.cityId === "korfezkent" && s.productId === "raw_milk")!;
    expect(BigInt(milkThere.costTotal)).toBe(BigInt(bJob.cost.total) + haulFreight);

    // --- sistem alıcısına sat
    await h.tick();
    const mk = await B.p.ok("GET", "/market?cityId=korfezkent&productId=raw_milk");
    const bid = mk.orders.find((o: { isSystem: boolean }) => o.isSystem);
    expect(bid, "korfezkent'te sistem çiğ süt alım emri").toBeTruthy();
    expect(bid.remainingKg).toBeGreaterThanOrEqual(milk.qtyKg);
    const sold = await B.p.ok("POST", `/market/orders/${bid.id}/sell`, withKey(h, { qtyKg: milk.qtyKg, quality: milk.quality, expectedPricePerKg: 1 }));
    const bSale = (await h.deps.db.select().from(sales).where(eq(sales.id, sold.saleId)))[0]!;
    expect(bSale.sellerCompanyId).toBe(B.companyId);
    expect(bSale.qtyKg).toBe(milk.qtyKg);
    expect(bSale.gross).toBe(bSale.pricePerKg * BigInt(milk.qtyKg));
    // satılan stokun maliyeti = üretim + navlun (tamamı satıldı)
    expect(bSale.cogs).toBe(BigInt(bJob.cost.total) + haulFreight);
    expect(bSale.netProfit).toBe(bSale.gross - bSale.cogs - bSale.fees);

    // --- B muhasebesi
    const bAcc = await acc(B.p);
    expect(bAcc.summary.revenueByAccount.revenue_sales).toBe(bSale.gross.toString());
    expect(bAcc.summary.expenseByAccount.cogs).toBe(bSale.cogs.toString());
    expect(bAcc.summary.expenseByAccount.exp_fees).toBe(bSale.fees.toString());
    // karma yem satın alma gider değil, stoktur: B'nin cogs'u yalnızca çiğ süt satışından gelir
    const bBalances = (await B.p.ok("GET", "/finance")).balances;
    expect(bBalances.inventory).toBe((await sumInventory(B)).toString());
    expect(bBalances.wip).toBe("0");
    // nakit: başlangıç − mal − navlun(giriş) − işletme (enerji+su+ücret) − sevk navlunu + satış − komisyon
    const bCash1 = await balance(h, B.companyId, "cash");
    const operating = BigInt(bJob.cost.energy) + BigInt(bJob.cost.water) + BigInt(bJob.cost.labor);
    expect(bCash1 - bCash0).toBe(-gross - freightIn - operating - haulFreight + bSale.gross - bSale.fees);

    // --- A muhasebesi: satış, maliyet, kalan stok değeri
    const aSale = (await h.deps.db.select().from(sales).where(eq(sales.id, buy.saleId)))[0]!;
    expect(aSale.sellerCompanyId).toBe(A.companyId);
    expect(aSale.buyerCompanyId).toBe(B.companyId);
    expect(aSale.gross).toBe(gross);
    expect(aSale.fees).toBe(gross / 100n);
    expect(aSale.netProfit).toBe(aSale.gross - aSale.cogs - aSale.fees);
    const aAcc = await acc(A.p);
    expect(aAcc.summary.revenueByAccount.revenue_sales).toBe(gross.toString());
    expect(aAcc.summary.expenseByAccount.cogs).toBe(aSale.cogs.toString());
    expect(aAcc.summary.expenseByAccount.exp_fees).toBe(aSale.fees.toString());
    // satılan 600 kg'ın maliyeti, üretim maliyetinin (toplam kg üzerinden) orantılı payı
    const total = BigInt(aJob.cost.total);
    const kg = BigInt(aJob.output.qtyKg);
    expect(aSale.cogs).toBe((total * 600n) / kg);
    const aFeedLeft = ((await A.p.ok("GET", "/inventory")) as Array<{ productId: string; qtyKg: number; costTotal: string }>).find((s) => s.productId === "compound_feed");
    const leftKg = aJob.output.qtyKg - 600;
    if (leftKg > 0) {
      expect(aFeedLeft!.qtyKg).toBe(leftKg);
      expect(BigInt(aFeedLeft!.costTotal)).toBe(total - aSale.cogs);
    } else {
      expect(aFeedLeft).toBeUndefined();
    }
    expect(((await A.p.ok("GET", "/finance")).balances.inventory)).toBe((await sumInventory(A)).toString());
    // A'nın üretim maliyeti gider değil: stoğa girdi (cogs yalnızca satılan kısım)
    expect(aAcc.summary.expenseByAccount.cogs).toBe(aSale.cogs.toString());

    // işlem listeleri: her iki şirkette satış satırı görünür
    const aTx = await A.p.ok("GET", "/finance/accounting/transactions?period=today&limit=50");
    expect(aTx.items.some((t: { saleId: string | null }) => t.saleId === aSale.id)).toBe(true);
    const bTx = await B.p.ok("GET", "/finance/accounting/transactions?period=today&limit=50");
    expect(bTx.items.some((t: { saleId: string | null }) => t.saleId === bSale.id)).toBe(true);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, T);

  async function sumInventory(f: Founded): Promise<bigint> {
    const r = (await h.deps.db.execute(sql`SELECT coalesce(sum(cost_total),0)::text c FROM cf.holdings WHERE company_id = ${f.companyId}`)) as unknown as Array<{ c: string }>;
    return BigInt(r[0]!.c);
  }
});
