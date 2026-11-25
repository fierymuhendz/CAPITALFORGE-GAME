/** Modül C: yönetim ve adil oyun entegrasyon testleri */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hmacHex } from "../auth/crypto";
import { totpAt } from "../auth/totp";
import {
  accounts, adminAuditLog, alerts, catalogHistory, companySnapshots, connectionRecords, contractInstallments, contracts,
  facilities, freightJobs, holdings, ledgerEntries, ledgerTransactions, marketOrders, priceHistory, productionJobs, trades,
} from "../db/schema";
import type { Tx } from "../db/client";
import { addStock, removeStock, reserveStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { cleanupConnectionRecords, registerFairplayTasks, scanMarketWatch, scanPriceAnomalies } from "../fairplay/detect";
import { createHarness, Player, type Harness } from "./harness";
import { checkInvariants } from "./invariants";

let h: Harness;
const rnd = () => Math.random().toString(36).slice(2, 7);
const db = () => h.deps.db;
const nowMs = () => h.deps.clock.nowMs();

beforeAll(async () => {
  h = await createHarness({ schedulerTasks: false });
  registerFairplayTasks();
});
afterAll(async () => { await h.close(); });

async function found(p: Player, sector = "crop", cityId = "yesilova"): Promise<{ companyId: string; accountId: string }> {
  const ob = await p.ok("GET", `/world/onboarding?cityId=${cityId}&sector=${sector}`);
  const plot = ob.plots.find((x: any) => x.eligible);
  const r = await p.ok("POST", "/company", { name: `Firma ${rnd()}${rnd()}`, cityId, sector, plotId: plot.id, idempotencyKey: h.key() });
  const me = await p.ok("GET", "/auth/me");
  return { companyId: r.companyId, accountId: me.account.id };
}

async function mkAdmin(ip: string, canReview = true): Promise<Player> {
  const p = await h.player(undefined, ip);
  const me = await p.ok("GET", "/auth/me");
  await db().update(accounts).set({ role: "admin", canReviewConnections: canReview }).where(eq(accounts.id, me.account.id));
  const { secret } = await p.ok("POST", "/auth/totp/setup");
  await p.ok("POST", "/auth/totp/enable", { code: totpAt(secret, Math.floor(nowMs() / 30000)) });
  return p;
}

async function addTrade(sellerId: string, buyerId: string, productId: string, cityId: string, price: number, ageMin: number, qty = 100, quality = 2) {
  const [t] = await db().insert(trades).values({
    orderId: randomUUID(), buyerCompanyId: buyerId, sellerCompanyId: sellerId, buyerIsSystem: false, sellerIsSystem: false, cityId, productId, quality,
    qtyKg: qty, pricePerKg: BigInt(price), gross: BigInt(price) * BigInt(qty), fee: 0n, transactionId: randomUUID(), createdAt: new Date(nowMs() - ageMin * 60_000),
  }).returning();
  return t!;
}

let admin: Player;
let A: { companyId: string; accountId: string }, B: typeof A, C: typeof A, D: typeof A;
let pA: Player, pB: Player, pC: Player, pD: Player;
const SAME_IP = "10.77.7.7";

describe("erişim", () => {
  it("oyuncu hesabı /admin/* uçlarına giremez (403 FORBIDDEN), oturumsuz 401, TOTP'siz yönetici TOTP_REQUIRED", async () => {
    const p = await h.player();
    for (const url of ["/admin/overview", "/admin/alerts", "/admin/connections", "/admin/cases", "/admin/audit", "/admin/catalog", "/admin/search?q=ab"]) {
      const r = await p.get(url);
      expect(r.status, url).toBe(403);
      expect(r.body.error.code, url).toBe("FORBIDDEN");
    }
    const w = await p.patch("/admin/settings", { key: "marketFeeBp", value: 50, reasoning: "deneme" });
    expect(w.status).toBe(403);
    expect((await p.post("/admin/time/advance", { minutes: 5 })).body.error.code).toBe("FORBIDDEN");
    expect((await p.post("/admin/cases", { subjectType: "account", subjectId: "x", title: "abc", reasoning: "abc" })).body.error.code).toBe("FORBIDDEN");

    const anon = new Player(h, "anon", "10.1.1.1");
    expect((await anon.get("/admin/overview")).status).toBe(401);

    // yönetici ama TOTP etkin değil
    const q = await h.player();
    const me = await q.ok("GET", "/auth/me");
    await db().update(accounts).set({ role: "admin", canReviewConnections: true }).where(eq(accounts.id, me.account.id));
    expect((await q.get("/admin/overview")).body.error.code).toBe("TOTP_REQUIRED");

    // TOTP etkin ama yeni oturum doğrulanmamış
    const adm = await mkAdmin("10.1.2.3");
    expect((await adm.get("/admin/overview")).status).toBe(200);
    const fresh = new Player(h, adm.username, "10.1.2.3");
    await fresh.ok("POST", "/auth/login", { username: adm.username, password: "parola-123456" });
    const r2 = await fresh.get("/admin/overview");
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe("TOTP_REQUIRED");
  });
});

describe("fiyat sapması ve bağlantı grupları", () => {
  it("aynı IP'li iki hesap: normal işlem uyarısız, uç fiyatlar uyarılı, az veride yetersiz veri", async () => {
    admin = await mkAdmin("10.88.0.1");
    pA = await h.player("hesapA" + rnd(), SAME_IP); A = await found(pA);
    pB = await h.player("hesapB" + rnd(), SAME_IP); B = await found(pB);
    pC = await h.player(undefined, "10.88.0.3"); C = await found(pC);
    pD = await h.player(undefined, "10.88.0.4"); D = await found(pD);

    // bağımsız karşılaştırmalar: tahıl (6 işlem), un (2 işlem)
    for (let i = 0; i < 6; i++) await addTrade(C.companyId, D.companyId, "grain", "yesilova", 1000, 120 + i);
    for (let i = 0; i < 2; i++) await addTrade(C.companyId, D.companyId, "flour", "yesilova", 1000, 120 + i);
    const normal = await addTrade(A.companyId, B.companyId, "grain", "yesilova", 1050, 30);
    const low = await addTrade(A.companyId, B.companyId, "grain", "yesilova", 300, 20);
    const high = await addTrade(B.companyId, A.companyId, "grain", "yesilova", 2500, 15);
    const few = await addTrade(A.companyId, B.companyId, "flour", "yesilova", 4000, 10);

    const raised = await scanPriceAnomalies(h.deps, h.deps.clock.now());
    expect(raised).toBe(3);
    const rows = await db().select().from(alerts).where(eq(alerts.kind, "price_anomaly"));
    const by = (id: string) => rows.find((r) => (r.details as any).tradeId === id);
    expect(by(normal.id)).toBeUndefined();

    const lo = by(low.id)!.details as any;
    expect(by(low.id)!.severity).toBe("high");
    expect(lo).toMatchObject({ refPricePerKg: "1000", deviationBp: -7000, comparables: 6, insufficientData: false, sameConnectionGroup: true, sellerCompanyId: A.companyId, buyerCompanyId: B.companyId });
    const hi = by(high.id)!.details as any;
    expect(hi).toMatchObject({ refPricePerKg: "1000", deviationBp: 15000, comparables: 6, insufficientData: false, sameConnectionGroup: true });
    const fw = by(few.id)!;
    expect(fw.severity).toBe("info");
    expect(fw.details).toMatchObject({ insufficientData: true, comparables: 2, deviationBp: 30000 });

    // tekrar tarama aynı uyarıları yeniden yazmaz
    expect(await scanPriceAnomalies(h.deps, h.deps.clock.now())).toBe(0);
    expect(await db().select().from(alerts).where(eq(alerts.kind, "price_anomaly"))).toHaveLength(3);

    // API: uyarı listesi şirket adlarıyla
    const list = await admin.ok("GET", "/admin/alerts?kind=price_anomaly");
    expect(list).toHaveLength(3);
    expect(list.find((a: any) => a.details.tradeId === low.id).companyNames).toHaveLength(2);
    // onaylama
    const aid = list[0].id;
    await admin.ok("POST", `/admin/alerts/${aid}/ack`, { idempotencyKey: h.key() });
    expect((await admin.ok("GET", "/admin/alerts?status=acknowledged")).map((a: any) => a.id)).toEqual([aid]);
  });

  it("inceleme ekranı işlemleri ve değer transferini gösterir; IP/karma sızmaz; erişim denetim kaydına yazılır", async () => {
    const groups = await admin.ok("GET", "/admin/connections");
    const g = groups.find((x: any) => x.accounts.some((a: any) => a.companyId === A.companyId));
    expect(g).toBeTruthy();
    expect(g.groupId).toMatch(/^[0-9a-f]{12}$/);
    expect(g.label).toMatch(/^Bağlantı grubu #\d+$/);
    expect(g.accountCount).toBe(2);
    expect(g.interactions).toBe(4);
    expect(g.flaggedTrades).toBe(2);

    const rev = await admin.ok("GET", `/admin/connections/${g.groupId}`);
    expect(rev.trades).toHaveLength(4);
    const lowRow = rev.trades.find((t: any) => t.pricePerKg === "300");
    expect(lowRow.anomaly).toMatchObject({ refPricePerKg: "1000", deviationBp: -7000, comparables: 6, insufficientData: false, flagged: true });
    const fewRow = rev.trades.find((t: any) => t.pricePerKg === "4000");
    expect(fewRow.anomaly.insufficientData).toBe(true);
    const normalRow = rev.trades.find((t: any) => t.pricePerKg === "1050");
    expect(normalRow.anomaly.flagged).toBe(false);
    // toplam = 1050+300+2500+4000 kuruş/kg × 100 kg
    expect(rev.totals.valueTransferred).toBe(String((1050 + 300 + 2500 + 4000) * 100));
    expect(rev.totals.byDirection).toHaveLength(2);

    // gizlilik: ham IP ve karma yanıtta yok
    const hash = hmacHex(h.deps.config.ipHashKey, SAME_IP);
    const text = JSON.stringify([groups, rev]);
    expect(text).not.toContain(hash);
    expect(text).not.toContain(SAME_IP);
    expect(g.groupId).not.toBe(hash.slice(0, 12));

    const log = await admin.ok("GET", "/admin/audit?action=connections.view");
    expect(log.rows.length).toBeGreaterThanOrEqual(2);
    expect(log.rows.some((r: any) => r.target === `connection_group:${g.groupId}`)).toBe(true);
    expect(log.rows[0].adminUsername).toBe(admin.username);

    // yetkisiz yönetici (can_review_connections=false) bağlantıları göremez
    const lim = await mkAdmin("10.88.0.9", false);
    expect((await lim.get("/admin/connections")).body.error.code).toBe("FORBIDDEN");
    expect((await lim.get(`/admin/connections/${g.groupId}`)).body.error.code).toBe("FORBIDDEN");
    expect((await lim.get("/admin/overview")).status).toBe(200);
    // geçersiz / bilinmeyen grup
    expect((await admin.get("/admin/connections/zzz")).status).toBe(400);
    expect((await admin.get("/admin/connections/000000000000")).status).toBe(404);

    // aynı IP'liler ticarete engelsiz devam eder: hiçbir hesap dondurulmadı
    const accs = await db().select().from(accounts).where(eq(accounts.id, A.accountId));
    expect(accs[0]!.frozenAt).toBeNull();
  });

  it("genel bakış, ürün kırılımı, arama ve şirket ayrıntısı", async () => {
    const ov = await admin.ok("GET", "/admin/overview?productId=grain&cityId=yesilova");
    expect(ov.rows).toHaveLength(1);
    const row = ov.rows[0];
    expect(row).toMatchObject({ productId: "grain", cityId: "yesilova", volume24hKg: 900, volume7dKg: 900, systemShareBp: 0 });
    expect(BigInt(row.vwap24h)).toBeGreaterThan(0n);
    const all = await admin.ok("GET", "/admin/overview?productId=grain&byCity=0");
    expect(all.rows[0].cityId).toBeNull();
    expect(all.rows[0].volume24hKg).toBe(900);

    const pd = await admin.ok("GET", "/admin/products/grain?cityId=yesilova");
    expect(pd.recentTrades.length).toBeGreaterThan(0);
    expect((await admin.get("/admin/products/yok")).status).toBe(404);

    const s = await admin.ok("GET", `/admin/search?q=${encodeURIComponent(pA.username.slice(0, 6))}`);
    expect(s.accounts.some((a: any) => a.id === A.accountId && a.companyId === A.companyId)).toBe(true);
    const sc = await admin.ok("GET", `/admin/search?q=${A.companyId}`);
    expect(sc.companies.map((c: any) => c.id)).toContain(A.companyId);
    expect(JSON.stringify(s)).not.toContain(hmacHex(h.deps.config.ipHashKey, SAME_IP));

    const det = await admin.ok("GET", `/admin/companies/${A.companyId}`);
    expect(det.company.id).toBe(A.companyId);
    expect(det.account.username).toBe(pA.username);
    expect(BigInt(det.balances.cash)).toBeGreaterThan(0n);
    expect(det.facilities.length).toBeGreaterThan(0);
    expect((await admin.get("/admin/companies/not-a-uuid")).status).toBe(400);
  });
});

describe("diğer uyarılar", () => {
  it("kıtlık, stok fazlası, servet/fiyat sıçraması, taşımacısız iş, duran hat", async () => {
    const now = h.deps.clock.now();
    const ago = (hrs: number) => new Date(now.getTime() - hrs * 3600_000);
    // kıtlık: 7 saattir açık alım emri, hiç ilan yok
    await db().insert(marketOrders).values({ side: "buy", companyId: C.companyId, cityId: "yesilova", productId: "seed", quality: 2, qtyKg: 500, remainingKg: 500, pricePerKg: 900n, escrowRemaining: 0n, createdAt: ago(7) });
    // taşımacısız iş: 3 saattir açık
    await db().insert(freightJobs).values({
      shipperCompanyId: C.companyId, consigneeCompanyId: D.companyId, originCityId: "yesilova", destCityId: "korfezkent", distanceKm: 100,
      cargo: [{ productId: "grain", quality: 2, qtyKg: 100 }], totalKg: 100, payAmount: 100000n, deadlineAt: ago(-20), createdAt: ago(3),
    });
    // duran hat
    await db().update(facilities).set({ stalledReason: { code: "MISSING_INPUT", productId: "seed", at: ago(1).toISOString() } }).where(eq(facilities.companyId, C.companyId));
    // servet sıçraması: 1 milyon → 30 milyon (kuruş)
    await db().insert(companySnapshots).values([
      { companyId: D.companyId, at: ago(25), cash: 100_000n, netWorth: 10_000_000n },
      { companyId: D.companyId, at: ago(0.1), cash: 100_000n, netWorth: 90_000_000n },
    ]);
    // fiyat sıçraması: ref 1000 → 1600 (+%60)
    await db().insert(priceHistory).values({ productId: "coal", cityId: "demirdag", at: ago(24.5), refPricePerKg: 1000n });
    await db().execute(sqlRaw(`UPDATE cf.price_refs SET ref_price_per_kg = 1600 WHERE product_id = 'coal' AND city_id = 'demirdag'`));
    // stok fazlası: 50 ton tahıl, haftalık hacim 900 kg
    await addStock(await asTx(), { companyId: C.companyId, cityId: "yesilova", productId: "fodder", quality: 2 }, 50_000, 0n, { kind: "test", at: now });

    const n = await scanMarketWatch(h.deps, now);
    expect(n).toBeGreaterThanOrEqual(6);
    const kinds = (await db().select().from(alerts)).map((a) => a.kind);
    for (const k of ["shortage", "unfilled_freight", "stalled_production", "wealth_spike", "price_spike", "excess_inventory"]) expect(kinds, k).toContain(k);
    expect(await scanMarketWatch(h.deps, now)).toBe(0); // dedupe

    // görev kayıt defterinden de çalışır
    const r = await h.tick();
    expect(Object.keys(r)).toEqual(expect.arrayContaining(["fairplay.price_scan", "fairplay.market_watch", "fairplay.ip_cleanup"]));
  });
});

describe("katalog ve ayar düzenleme", () => {
  it("tarif düzenleme denetim kaydı üretir, çalışan işin anlık görüntüsü değişmez", async () => {
    const recipe = [...h.deps.catalog.recipes.values()].find((r) => r.buildingType === "field")!;
    const fac = (await db().select().from(facilities).where(eq(facilities.companyId, A.companyId)))[0]!;
    const snapshot = JSON.parse(JSON.stringify(recipe));
    await db().insert(productionJobs).values({
      facilityId: fac.id, companyId: A.companyId, cityId: fac.cityId, recipeId: recipe.id, recipeVersion: recipe.version, recipeSnapshot: snapshot,
      batches: 1, repeat: true, startedAt: new Date(nowMs()), endsAt: new Date(nowMs() + 3600_000), outputProductId: recipe.output.productId,
      outputKg: recipe.output.kg, outputQuality: 2, costBreakdown: {}, costTotal: 0n,
    });
    const key = h.key();
    const body = { minutes: recipe.minutes + 17, energyKwh: recipe.energyKwh + 1, reasoning: "denge ayarı", idempotencyKey: key };
    const r = await admin.ok("PATCH", `/admin/catalog/recipes/${recipe.id}`, body);
    expect(r).toMatchObject({ id: recipe.id, version: recipe.version + 1, affected: { runningJobs: 1, repeatingJobs: 1 } });
    expect(h.deps.catalog.recipe(recipe.id).minutes).toBe(recipe.minutes + 17);
    expect(h.deps.catalog.recipe(recipe.id).version).toBe(recipe.version + 1);

    const job = (await db().select().from(productionJobs).where(eq(productionJobs.companyId, A.companyId)))[0]!;
    expect(job.recipeSnapshot).toEqual(snapshot);
    expect(job.recipeVersion).toBe(recipe.version);

    const hist = await db().select().from(catalogHistory).where(eq(catalogHistory.itemId, recipe.id));
    expect(hist).toHaveLength(1);
    expect((hist[0]!.before as any).minutes).toBe(recipe.minutes);
    expect((hist[0]!.after as any).minutes).toBe(recipe.minutes + 17);
    const log = await admin.ok("GET", "/admin/audit?action=catalog.recipe.update");
    expect(log.rows[0]).toMatchObject({ target: `recipe:${recipe.id}`, reasoning: "denge ayarı" });
    expect(log.rows[0].before.data.minutes).toBe(recipe.minutes);
    expect(log.rows[0].after.affected.runningJobs).toBe(1);

    // aynı anahtar: tekrar işlenmez
    const again = await admin.patch(`/admin/catalog/recipes/${recipe.id}`, body);
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(recipe.version + 1);
    expect((await db().select().from(catalogHistory).where(eq(catalogHistory.itemId, recipe.id)))).toHaveLength(1);

    // geçersiz: bilinmeyen girdi ürünü, değişiklik yok, olmayan tarif
    expect((await admin.patch(`/admin/catalog/recipes/${recipe.id}`, { inputs: [{ productId: "yok", kg: 5 }], reasoning: "deneme" })).status).toBe(400);
    expect((await admin.patch(`/admin/catalog/recipes/${recipe.id}`, { reasoning: "deneme" })).status).toBe(400);
    expect((await admin.patch(`/admin/catalog/recipes/yok`, { minutes: 5, reasoning: "deneme" })).status).toBe(404);
  });

  it("ürün taban fiyatı ve ayar anahtarı", async () => {
    const base = h.deps.catalog.product("grain").basePricePerKg;
    const r = await admin.ok("PATCH", "/admin/catalog/products/grain", { basePricePerKg: base + 50, reasoning: "enflasyon" });
    expect(r.version).toBe(2);
    expect(h.deps.catalog.product("grain").basePricePerKg).toBe(base + 50);

    const s = await admin.ok("PATCH", "/admin/settings", { key: "anomaly.thresholdBp", value: 4200, reasoning: "eşik" });
    expect(s.id).toBe("anomaly.thresholdBp");
    expect(h.deps.catalog.settings.anomaly.thresholdBp).toBe(4200);
    expect(h.deps.catalog.settings.anomaly.minComparables).toBe(5);
    await admin.ok("PATCH", "/admin/settings", { key: "marketFeeBp", value: 150, reasoning: "komisyon" });
    expect(h.deps.catalog.settings.marketFeeBp).toBe(150);
    const logs = await admin.ok("GET", "/admin/audit?action=settings.update");
    expect(logs.rows).toHaveLength(2);
    expect(logs.rows.find((x: any) => x.target === "setting:anomaly.thresholdBp")).toMatchObject({ before: 3500, after: 4200 });

    for (const bad of [{ key: "yok", value: 1 }, { key: "marketFeeBp", value: "abc" }, { key: "marketFeeBp", value: -1 }, { key: "marketFeeBp", value: 1.5 },
      { key: "marketFeeBp", value: 99999 }, { key: "anomaly", value: { thresholdBp: 1 } }, { key: "ipRetentionDays", value: 0 }, { key: "anomaly.yok", value: 1 }]) {
      const res = await admin.patch("/admin/settings", { ...bad, reasoning: "deneme" });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const cat = await admin.ok("GET", "/admin/catalog");
    expect(cat.settings.marketFeeBp.value).toBe(150);
    expect(cat.recipes.length).toBeGreaterThan(0);
    // eski değerlere dön
    await admin.ok("PATCH", "/admin/settings", { key: "anomaly.thresholdBp", value: 3500, reasoning: "geri al" });
    await admin.ok("PATCH", "/admin/settings", { key: "marketFeeBp", value: 100, reasoning: "geri al" });
  });
});

// ---- yaptırım ----
const sqlRaw = (s: string) => sql.raw(s);
async function asTx(): Promise<Tx> { return db() as unknown as Tx; }

async function openCase(subjectType: string, subjectId: string): Promise<string> {
  const c = await admin.ok("POST", "/admin/cases", { subjectType, subjectId, title: "Şüpheli işlem", reasoning: "inceleme gerekçesi", idempotencyKey: h.key() });
  return c.id;
}
const enforce = (caseId: string, action: string, targetId: string) =>
  admin.post(`/admin/cases/${caseId}/enforce`, { action, targetId, reasoning: "yaptırım gerekçesi", idempotencyKey: h.key() });

describe("yaptırım", () => {
  it("hesap dondurma ve çözme", async () => {
    const caseId = await openCase("account", A.accountId);
    const r = await enforce(caseId, "freeze_account", A.accountId);
    expect(r.status).toBe(200);
    const blocked = await pA.post("/research/x/start", { idempotencyKey: h.key() });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("ACCOUNT_FROZEN");
    expect((await pA.get("/auth/me")).body.account.frozen).toBe(true);
    expect((await enforce(caseId, "freeze_account", A.accountId)).status).toBe(409); // zaten dondurulmuş
    // yönetici hesabı dondurulamaz
    const me = await admin.ok("GET", "/auth/me");
    expect((await enforce(caseId, "freeze_account", me.account.id)).status).toBe(403);

    expect((await enforce(caseId, "unfreeze_account", A.accountId)).status).toBe(200);
    const after = await pA.post("/research/x/start", { idempotencyKey: h.key() });
    expect(after.body.error?.code).not.toBe("ACCOUNT_FROZEN");

    const cs = await admin.ok("GET", `/admin/cases/${caseId}`);
    expect(cs.events.map((e: any) => e.kind)).toEqual(["opened", "enforcement", "enforcement"]);
    await admin.ok("POST", `/admin/cases/${caseId}/notes`, { text: "not düştüm" });
    const closed = await admin.ok("POST", `/admin/cases/${caseId}/close`, { resolution: "enforced", reasoning: "kapandı" });
    expect(closed.status).toBe("closed");
    expect((await admin.post(`/admin/cases/${caseId}/notes`, { text: "x" })).status).toBe(409);
    expect((await enforce(caseId, "freeze_account", A.accountId)).status).toBe(409); // kapalı dosyada yaptırım yok
    const audit = await admin.ok("GET", "/admin/audit?limit=200");
    const actions = audit.rows.map((x: any) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["case.open", "enforce.freeze_account", "enforce.unfreeze_account", "case.note", "case.close"]));
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("ters kayıt orijinal satırları değiştirmez, yeni işlem ekler; stok ve defter tutarlı kalır", async () => {
    // satıcı A'ya 100 kg stok, ardından A → B satışı (defter + depo + trade)
    await db().transaction(async (tx) => {
      const p = await post(tx, { kind: "test_stock", idempotencyKey: `t-stock:${A.companyId}`, at: h.deps.clock.now(), lines: [{ account: co(A.companyId, "inventory"), amount: 50_000n }, { account: co(A.companyId, "equity"), amount: -50_000n }] });
      await addStock(tx, { companyId: A.companyId, cityId: "yesilova", productId: "steel", quality: 3 }, 100, 50_000n, { kind: "test", at: h.deps.clock.now(), transactionId: p.id });
    });
    const before = await snapshot(A.companyId, B.companyId);
    let txId = "";
    await db().transaction(async (tx) => {
      const at = h.deps.clock.now();
      const p = await post(tx, {
        kind: "test_trade", idempotencyKey: `t-trade:${A.companyId}`, at, refType: "test", refId: "t1",
        lines: [
          { account: co(B.companyId, "inventory"), amount: 80_000n }, { account: co(B.companyId, "cash"), amount: -80_000n },
          { account: co(A.companyId, "cash"), amount: 80_000n }, { account: co(A.companyId, "inventory"), amount: -50_000n },
          { account: co(A.companyId, "cogs"), amount: 50_000n }, { account: co(A.companyId, "revenue_sales"), amount: -80_000n },
        ],
      });
      txId = p.id;
      await removeStock(tx, { companyId: A.companyId, cityId: "yesilova", productId: "steel", quality: 3 }, 100, { kind: "test", at, transactionId: p.id });
      await addStock(tx, { companyId: B.companyId, cityId: "yesilova", productId: "steel", quality: 3 }, 100, 80_000n, { kind: "test", at, transactionId: p.id });
    });
    const trade = await addTradeRow(A.companyId, B.companyId, txId);
    const origEntries = await entriesOf(txId);
    expect(origEntries).toHaveLength(6);
    expect(await checkInvariants(h.deps.db)).toEqual([]);

    // stok rezerve edilmişse (B'nin elinde kilitli) ters kayıt reddedilir, hiçbir şey değişmez
    await db().transaction((tx) => reserveStock(tx, { companyId: B.companyId, cityId: "yesilova", productId: "steel", quality: 3 }, 100));
    const caseId = await openCase("transaction", trade);
    const blocked = await enforce(caseId, "reverse_transaction", trade);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.reason).toBe("STOCK_ALREADY_USED");
    await db().update(holdings).set({ reservedKg: 0 }).where(and(eq(holdings.companyId, B.companyId), eq(holdings.productId, "steel")));

    const ok = await enforce(caseId, "reverse_transaction", trade);
    expect(ok.status).toBe(200);
    // orijinal satırlar aynen duruyor
    expect(await entriesOf(txId)).toEqual(origEntries);
    const revs = await db().select().from(ledgerTransactions).where(eq(ledgerTransactions.reversesId, txId));
    expect(revs).toHaveLength(1);
    expect(revs[0]!.kind).toBe("reversal");
    expect((await entriesOf(revs[0]!.id)).map((e) => e.amount).sort()).toEqual(origEntries.map((e) => (-BigInt(e.amount)).toString()).sort());
    // bakiyeler ve stok işlem öncesine döndü
    expect(await snapshot(A.companyId, B.companyId)).toEqual(before);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
    // ikinci kez ters kayıt yok
    expect((await enforce(caseId, "reverse_transaction", txId)).status).toBe(409);
    expect((await db().select().from(ledgerTransactions).where(eq(ledgerTransactions.reversesId, txId)))).toHaveLength(1);
    const audit = await admin.ok("GET", "/admin/audit?action=enforce.reverse_transaction");
    expect(audit.rows).toHaveLength(1);
  });

  it("ilan/emir ve sözleşme iptali emanet ve rezervi iade eder", async () => {
    const caseId = await openCase("company", F_ID());
    // satış ilanı: rezerv serbest kalır
    await db().transaction(async (tx) => {
      await addStock(tx, { companyId: C.companyId, cityId: "yesilova", productId: "seed", quality: 2 }, 40, 0n, { kind: "test", at: h.deps.clock.now() });
      await reserveStock(tx, { companyId: C.companyId, cityId: "yesilova", productId: "seed", quality: 2 }, 40);
    });
    const [sell] = await db().insert(marketOrders).values({ side: "sell", companyId: C.companyId, cityId: "yesilova", productId: "seed", quality: 2, qtyKg: 40, remainingKg: 40, pricePerKg: 900n, createdAt: h.deps.clock.now() }).returning();
    expect((await enforce(caseId, "cancel_listing", sell!.id)).status).toBe(200);
    expect((await db().select().from(marketOrders).where(eq(marketOrders.id, sell!.id)))[0]!.status).toBe("cancelled");
    expect((await db().select().from(holdings).where(and(eq(holdings.companyId, C.companyId), eq(holdings.productId, "seed"), eq(holdings.cityId, "yesilova"))))[0]!.reservedKg).toBe(0);
    expect((await enforce(caseId, "cancel_listing", sell!.id)).body.error.code).toBe("ORDER_CLOSED");

    // alım emri: emanet nakde döner
    const cashBefore = await cashOf(C.companyId);
    await db().transaction((tx) => post(tx, { kind: "test_escrow", idempotencyKey: `t-esc:${C.companyId}`, at: h.deps.clock.now(), lines: [{ account: co(C.companyId, "escrow"), amount: 9000n }, { account: co(C.companyId, "cash"), amount: -9000n }] }));
    const [buy] = await db().insert(marketOrders).values({ side: "buy", companyId: C.companyId, cityId: "yesilova", productId: "seed", quality: 2, qtyKg: 10, remainingKg: 10, pricePerKg: 900n, escrowRemaining: 9000n, createdAt: h.deps.clock.now() }).returning();
    expect((await enforce(caseId, "cancel_listing", buy!.id)).status).toBe(200);
    expect(await cashOf(C.companyId)).toBe(cashBefore);

    // sözleşme: alıcı D emanet 10000, satıcı C teminat 2000
    const cashD = await cashOf(D.companyId), cashC = await cashOf(C.companyId);
    await db().transaction((tx) => post(tx, {
      kind: "test_contract", idempotencyKey: `t-ct:${C.companyId}`, at: h.deps.clock.now(),
      lines: [{ account: co(D.companyId, "escrow"), amount: 10_000n }, { account: co(D.companyId, "cash"), amount: -10_000n }, { account: co(C.companyId, "escrow"), amount: 2000n }, { account: co(C.companyId, "cash"), amount: -2000n }],
    }));
    const now = h.deps.clock.now();
    const [k] = await db().insert(contracts).values({
      status: "active", proposerCompanyId: C.companyId, proposerRole: "seller", sellerCompanyId: C.companyId, buyerCompanyId: D.companyId, productId: "grain",
      minQuality: 2, qtyPerInstallmentKg: 10, pricePerKg: 500n, deliveryCityId: "yesilova", freightPayer: "seller", installments: 2, firstDueAt: now, intervalHours: 24,
      graceHours: 2, penaltyBp: 1000, lateFeeBp: 1000, expiresAt: now, createdAt: now, acceptedAt: now, buyerEscrow: 10_000n, sellerDeposit: 2000n,
    }).returning();
    for (const seq of [1, 2]) {
      await db().insert(contractInstallments).values({ contractId: k!.id, seq, dueAt: now, windowOpensAt: now, graceEndsAt: now, qtyDueKg: 10, escrowRemaining: 5000n, depositShare: 1000n });
    }
    expect((await enforce(caseId, "cancel_contract", k!.id)).status).toBe(200);
    expect(await cashOf(D.companyId)).toBe(cashD);
    expect(await cashOf(C.companyId)).toBe(cashC);
    expect((await db().select().from(contracts).where(eq(contracts.id, k!.id)))[0]!.status).toBe("cancelled");
    const insts = await db().select().from(contractInstallments).where(eq(contractInstallments.contractId, k!.id));
    expect(insts.every((i) => i.status === "cancelled" && i.escrowRemaining === 0n && i.settledAt)).toBe(true);
    expect((await enforce(caseId, "cancel_contract", k!.id)).body.error.code).toBe("CONTRACT_NOT_ACTIVE");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

const F_ID = () => C.companyId;
async function cashOf(companyId: string): Promise<bigint> {
  const r = (await db().execute(sql`SELECT balance::text AS b FROM cf.ledger_accounts WHERE company_id = ${companyId} AND code = 'cash'`)) as unknown as Array<{ b: string }>;
  return BigInt(r[0]!.b);
}
async function snapshot(...ids: string[]) {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const bal = (await db().execute(sql`SELECT code, balance::text AS b FROM cf.ledger_accounts WHERE company_id = ${id} ORDER BY code`)) as unknown as Array<{ code: string; b: string }>;
    const h_ = await db().select().from(holdings).where(eq(holdings.companyId, id));
    out[id] = { bal: bal.map((x) => `${x.code}:${x.b}`), stock: h_.filter((x) => x.qtyKg > 0 || x.costTotal > 0n).map((x) => `${x.productId}/${x.cityId}/${x.quality}:${x.qtyKg}:${x.costTotal}:${x.reservedKg}`).sort() };
  }
  return out;
}
async function entriesOf(txId: string) {
  const rows = await db().select({ id: ledgerEntries.id, accountId: ledgerEntries.accountId, amount: ledgerEntries.amount }).from(ledgerEntries).where(eq(ledgerEntries.transactionId, txId)).orderBy(ledgerEntries.id);
  return rows.map((r) => ({ id: r.id, accountId: r.accountId, amount: r.amount.toString() }));
}
async function addTradeRow(sellerId: string, buyerId: string, transactionId: string): Promise<string> {
  const [t] = await db().insert(trades).values({
    orderId: randomUUID(), buyerCompanyId: buyerId, sellerCompanyId: sellerId, buyerIsSystem: false, sellerIsSystem: false, cityId: "yesilova", productId: "steel", quality: 3,
    qtyKg: 100, pricePerKg: 800n, gross: 80_000n, fee: 0n, transactionId, createdAt: h.deps.clock.now(),
  }).returning();
  return t!.id;
}

describe("hesap, zaman ve IP temizliği", () => {
  it("şifre sıfırlama oturumları sonlandırır, yönetici hesabı hedeflenemez", async () => {
    const victim = await h.player(undefined, "10.55.5.5");
    const me = await victim.ok("GET", "/auth/me");
    const r = await admin.post(`/admin/accounts/${me.account.id}/reset-password`, { accountId: me.account.id, newPassword: "yeni-parola-99", reasoning: "kullanıcı talebi", idempotencyKey: h.key() });
    expect(r.status).toBe(200);
    expect((await victim.get("/auth/me")).body.account).toBeNull(); // oturum düştü
    const fresh = new Player(h, victim.username, "10.55.5.5");
    expect((await fresh.post("/auth/login", { username: victim.username, password: "parola-123456" })).body.error.code).toBe("INVALID_CREDENTIALS");
    expect((await fresh.post("/auth/login", { username: victim.username, password: "yeni-parola-99" })).status).toBe(200);
    const log = await db().select().from(adminAuditLog).where(eq(adminAuditLog.action, "account.reset_password"));
    expect(JSON.stringify(log)).not.toContain("yeni-parola-99");
    const adm = await admin.ok("GET", "/auth/me");
    expect((await admin.post(`/admin/accounts/${adm.account.id}/reset-password`, { accountId: adm.account.id, newPassword: "yeni-parola-99", reasoning: "deneme" })).status).toBe(403);
    expect((await admin.post(`/admin/accounts/${me.account.id}/reset-password`, { accountId: randomUUID(), newPassword: "yeni-parola-99", reasoning: "deneme" })).status).toBe(400);
  });

  it("zaman ilerletme (test ortamı) görevleri çalıştırır", async () => {
    const t0 = h.deps.clock.nowMs();
    const r = await admin.ok("POST", "/admin/time/advance", { minutes: 20 });
    expect(h.deps.clock.nowMs() - t0).toBeGreaterThanOrEqual(20 * 60_000);
    expect(r.ran).toHaveProperty("fairplay.price_scan");
    expect((await admin.post("/admin/time/advance", { minutes: 0 })).status).toBe(400);
  });

  it("IP kaydı temizliği eski kayıtları siler, yenileri korur", async () => {
    const p = await h.player(undefined, "10.66.6.6");
    const me = await p.ok("GET", "/auth/me");
    const now = h.deps.clock.now();
    const old = new Date(now.getTime() - 40 * 86400_000);
    await db().insert(connectionRecords).values({ accountId: me.account.id, ipHash: "eski-karma-1", firstSeenAt: old, lastSeenAt: old });
    await db().insert(connectionRecords).values({ accountId: me.account.id, ipHash: "yeni-karma-2", firstSeenAt: new Date(now.getTime() - 5 * 86400_000), lastSeenAt: new Date(now.getTime() - 5 * 86400_000) });
    const n = await cleanupConnectionRecords(h.deps, now);
    expect(n).toBeGreaterThanOrEqual(1);
    const left = (await db().select().from(connectionRecords).where(eq(connectionRecords.accountId, me.account.id))).map((r) => r.ipHash);
    expect(left).not.toContain("eski-karma-1");
    expect(left).toContain("yeni-karma-2");
    // ayara saygı: 3 güne indirilirse 5 günlük kayıt da silinir
    await admin.ok("PATCH", "/admin/settings", { key: "ipRetentionDays", value: 3, reasoning: "kısalt" });
    await cleanupConnectionRecords(h.deps, now);
    expect((await db().select().from(connectionRecords).where(eq(connectionRecords.accountId, me.account.id))).map((r) => r.ipHash)).not.toContain("yeni-karma-2");
    await admin.ok("PATCH", "/admin/settings", { key: "ipRetentionDays", value: 30, reasoning: "geri al" });
  });
});

