/**
 * Güvenlik incelemesi düzeltmeleri: her bulgu için odaklı entegrasyon testi.
 * Kapsam: borç silme, XP/itibar enflasyonu, referans fiyat manipülasyonu, sistem sözleşme/mint sınırı, yönetici denetimi,
 * navlun ilanı değer aktarımı, WebSocket sızıntısı, defter değişmezliği ve küçük düzeltmeler.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { accruedInterest, applyBp } from "@capitalforge/economy";
import { SYSTEM_PROFILES } from "@capitalforge/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "../auth/crypto";
import { totpAt } from "../auth/totp";
import {
  accounts, adminSetupCodes, alerts, companies, connectionRecords, idempotencyKeys, priceHistory, priceRefs, starterGrants, trades,
} from "../db/schema";
import { AppError } from "../errors";
import { withTx } from "../deps";
import { scanPriceAnomalies, cleanupConnectionRecords } from "../fairplay/detect";
import { co, post } from "../ledger/post";
import { effectivePrice, type OrderRow } from "../market/spot";
import { referenceVwap, updatePriceRefs } from "../market/prices";
import { rateLimit } from "../security/rateLimit";
import { cleanupIdempotencyKeys } from "../security/idempotency";
import { runSystemCycle, topUp } from "../system/system";
import { DAY, found as kitFound, grantCash } from "../production/kit";
import { createHarness, Player, type Harness } from "./harness";
import { checkInvariants } from "./invariants";
import { bal, found, grantStock, HOUR, withKey } from "./trade-helpers";

let h: Harness;
const db = () => h.deps.db;
const nowMs = () => h.deps.clock.nowMs();
const iso = (ms: number) => new Date(nowMs() + ms).toISOString();
const rows = async <T,>(q: ReturnType<typeof sql>) => (await db().execute(q)) as unknown as T[];

/** Her grup kendi temiz dünyasıyla başlar (oynanabilir arsa sayısı sınırlıdır). */
function freshWorld(): void {
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h.close(); });
}

async function accountIdOf(p: Player): Promise<string> {
  return (await p.ok("GET", "/auth/me")).account.id;
}
async function companyRow(id: string) {
  return (await db().select().from(companies).where(eq(companies.id, id)))[0]!;
}

// ------------------------------------------------------------------ 1) borç silme

describe("1) kapanış/yeniden kuruluş ile borç silme", () => {
  freshWorld();
  it("açık kredi veya gecikmiş borç varken kapanmaz; bağış hesap başına bir kez; yeniden kuruluşta bekleme süresi", async () => {
    const p = await h.player();
    const id = await found(h, p, "livestock", "akyayla");
    const me = await p.ok("GET", "/company");
    const loan = await p.ok("POST", "/finance/loans", withKey(h, { amount: 2_000_000, termDays: 7 }));
    const blocked = await p.post("/account/dissolve", { confirmName: me.name });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("CONFLICT");
    expect(blocked.body.error.details.reason).toBe("OPEN_LOAN");
    await p.ok("POST", `/finance/loans/${loan.id}/repay`, withKey(h, { amount: 2_000_000 }));

    // gecikmiş borç (arrears) doğrudan deftere yazılır
    await withTx(h.deps, (tx) => post(tx, {
      kind: "test_arrears", idempotencyKey: `t-arrears:${h.key()}`, at: h.deps.clock.now(),
      lines: [{ account: co(id, "exp_penalties"), amount: 1000n }, { account: co(id, "arrears"), amount: -1000n }],
    }));
    const arrears = await p.post("/account/dissolve", { confirmName: me.name });
    expect(arrears.body.error.details.reason).toBe("ARREARS");
    await withTx(h.deps, (tx) => post(tx, {
      kind: "test_arrears_clear", idempotencyKey: `t-arrears-clear:${h.key()}`, at: h.deps.clock.now(),
      lines: [{ account: co(id, "arrears"), amount: 1000n }, { account: co(id, "cash"), amount: -1000n }],
    }));
    await p.ok("POST", "/account/dissolve", { confirmName: me.name });

    // yeniden kuruluş: bekleme süresi
    const ob = await p.ok("GET", "/world/onboarding?cityId=akyayla&sector=livestock");
    const plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
    const body = () => ({ name: `Yeni ${Math.random().toString(36).slice(2, 7)}`, cityId: "akyayla", sector: "livestock", plotId: plot.id, idempotencyKey: h.key() });
    const early = await p.post("/company", body());
    expect(early.body.error.code).toBe("COMPANY_COOLDOWN");
    const until = new Date(early.body.error.details.until).getTime();
    expect(until).toBeGreaterThan(nowMs() + 60 * HOUR);
    expect(until).toBeLessThanOrEqual(nowMs() + 72 * HOUR);
    await h.advance(72 * HOUR, 12 * HOUR);
    const again = await p.ok("POST", "/company", body());
    expect(again.companyId).not.toBe(id);
    // bağış verilmedi: bina, araç, girdi yok; başlangıç sermayesi var
    expect(again.facilityId).toBeNull();
    expect(again.vehicleId).toBeNull();
    const stock = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.holdings WHERE company_id = ${again.companyId}`);
    expect(stock[0]!.n).toBe(0);
    const fac = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.facilities WHERE company_id = ${again.companyId}`);
    expect(fac[0]!.n).toBe(0);
    const grants = await db().select({ c: starterGrants.companyId }).from(starterGrants).innerJoin(companies, eq(companies.id, starterGrants.companyId)).where(eq(companies.accountId, await accountIdOf(p)));
    expect(grants).toHaveLength(1);
    expect(await bal(h, again.companyId, "cash")).toBe(BigInt(h.deps.catalog.settings.startingCash) - BigInt(plot.price));
    expect(await checkInvariants(db())).toEqual([]);
  });
});

// ------------------------------------------------------------------ 2) XP ve itibar

describe("2) XP ve itibar enflasyonu", () => {
  freshWorld();
  async function runContract(seller: Player, sellerId: string, buyer: Player, buyerId: string, qty: number, price: number, splits: number[]) {
    await grantStock(h, sellerId, "akyayla", "fodder", 3, qty, 10n);
    const prop = await buyer.ok("POST", "/contracts", withKey(h, {
      role: "buyer", counterpartyCompanyId: sellerId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: qty, pricePerKg: price,
      deliveryCityId: "akyayla", freightPayer: "seller", installments: 1, firstDueAt: iso(3 * HOUR), intervalHours: 1, graceHours: 2, penaltyBp: 1000,
    }));
    await seller.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const det = await seller.ok("GET", `/contracts/${prop.id}`);
    const inst = det.schedule[0].id as string;
    const xps: number[] = [];
    for (const q of splits) {
      await seller.ok("POST", `/contracts/installments/${inst}/deliver`, withKey(h, { qtyKg: q, quality: 3 }));
      xps.push((await companyRow(sellerId)).xp);
    }
    return xps;
  }

  it("teslim başına XP yok; küçük taksit itibar/XP vermez; büyük taksit kapanınca verir", async () => {
    const s = await h.player(); const sId = await found(h, s, "livestock", "akyayla");
    const b = await h.player(); const bId = await found(h, b, "crop", "yesilova");
    const s0 = await companyRow(sId);

    // küçük: 5000 kuruş < 500000
    const xpsSmall = await runContract(s, sId, b, bId, 50, 100, [20, 30]);
    expect(xpsSmall).toEqual([s0.xp, s0.xp]);
    let sc = await companyRow(sId);
    expect(sc.onTimeDeliveries).toBe(0);
    expect(sc.xp).toBe(s0.xp);
    expect((await companyRow(bId)).xp).toBe(0);

    // büyük: 600000 kuruş; ilk teslimde XP yok, kapanışta her iki taraf taksit XP'si alır
    const b0 = await companyRow(bId);
    const xpsBig = await runContract(s, sId, b, bId, 1000, 600, [500, 500]);
    expect(xpsBig[0]).toBe(s0.xp);
    sc = await companyRow(sId);
    const xpGain = h.deps.catalog.settings.xp.contractInstallment;
    expect(sc.xp).toBe(s0.xp + xpGain);
    expect(sc.onTimeDeliveries).toBe(1);
    expect((await companyRow(bId)).xp).toBe(b0.xp + xpGain);
    expect(await checkInvariants(db())).toEqual([]);
  });

  it("aynı bağlantı grubundaki taraflar XP ve itibar kazanamaz", async () => {
    const s = await h.player(undefined, "10.55.5.5"); const sId = await found(h, s, "livestock", "akyayla");
    const b = await h.player(undefined, "10.55.5.5"); const bId = await found(h, b, "crop", "yesilova");
    await runContract(s, sId, b, bId, 1000, 600, [1000]);
    const sc = await companyRow(sId);
    expect(sc.xp).toBe(0);
    expect(sc.onTimeDeliveries).toBe(0);
    expect((await companyRow(bId)).xp).toBe(0);
    // sözleşme yine de tamamlandı
    const ct = await rows<{ status: string }>(sql`SELECT status FROM cf.contracts WHERE seller_company_id = ${sId} ORDER BY created_at DESC LIMIT 1`);
    expect(ct[0]!.status).toBe("completed");
  });
});

// ------------------------------------------------------------------ 3) referans fiyat

describe("3) referans fiyat manipülasyonu", () => {
  freshWorld();
  const T = (price: number, qty: number, buyer: string, seller: string, quality = 2) => ({ price: BigInt(price), qty, quality, buyer, seller });

  it("kırpılmış VWAP ve en az 3 farklı çift (saf fonksiyon)", () => {
    expect(referenceVwap([T(100, 100, "a", "b"), T(100, 100, "a", "c")]).vwap).toBeNull(); // 2 çift
    expect(referenceVwap([T(100, 100, "a", "b"), T(100, 100, "a", "b"), T(100, 100, "b", "a")]).vwap).toBeNull(); // 2 çift
    const rowsIn = [T(100, 100, "a", "b"), T(100, 100, "c", "b"), T(100, 100, "d", "b"), T(100, 800, "e", "b"), T(10_000, 100, "f", "b"), T(1, 100, "g", "b")];
    // hacim 1300 → alt 130 ve üst 130 kg atılır; aşırı fiyatlar elenir
    const r = referenceVwap(rowsIn);
    expect(r.vwap).toBe(100n);
    expect(r.vol).toBe(1300 - 260);
  });

  it("yıkama ticareti (aynı grup) ve uyarılı işlemler referansı oynatamaz", async () => {
    // aynı IP'li iki şirket + dört bağımsız şirket
    const w1 = await h.player(undefined, "10.66.6.6"); const w1Id = await found(h, w1, "crop", "yesilova");
    const w2 = await h.player(undefined, "10.66.6.6"); const w2Id = await found(h, w2, "crop", "korfezkent");
    const ind: string[] = [];
    for (let i = 0; i < 4; i++) ind.push(await found(h, await h.player(), "crop", i % 2 ? "yesilova" : "korfezkent"));
    const refs = await db().select().from(priceRefs);
    const g = refs.find((r) => r.productId === "grain" && r.cityId === "yesilova")!;
    const f = refs.find((r) => r.productId === "fodder" && r.cityId === "akyayla")!;
    const ref = (productId: string, cityId: string) => refs.find((r) => r.productId === productId && r.cityId === cityId)!;
    const base = (r: typeof g) => Number(r.refPricePerKg);
    const at = new Date(nowMs() - 10 * 60_000);
    const ins = async (productId: string, cityId: string, price: number, qty: number, buyer: string, seller: string) => {
      const [t] = await db().insert(trades).values({
        orderId: randomUUID(), buyerCompanyId: buyer, sellerCompanyId: seller, buyerIsSystem: false, sellerIsSystem: false, cityId, productId, quality: 2,
        qtyKg: qty, pricePerKg: BigInt(price), gross: BigInt(price) * BigInt(qty), fee: 0n, transactionId: randomUUID(), createdAt: at,
      }).returning();
      return t!;
    };
    // grain@yesilova: üç bağımsız çift normal fiyat + devasa yıkama işlemi (5×)
    await ins("grain", "yesilova", base(g), 500, ind[0]!, ind[1]!);
    await ins("grain", "yesilova", base(g), 500, ind[1]!, ind[2]!);
    await ins("grain", "yesilova", base(g), 500, ind[2]!, ind[3]!);
    await ins("grain", "yesilova", base(g) * 5, 50_000, w1Id, w2Id);
    // fodder@akyayla: üç bağımsız çift ama biri için fiyat uyarısı var → yalnızca 2 çift kalır
    await ins("fodder", "akyayla", base(f) * 2, 500, ind[0]!, ind[1]!);
    await ins("fodder", "akyayla", base(f) * 2, 500, ind[1]!, ind[2]!);
    const flagged = await ins("fodder", "akyayla", base(f) * 2, 500, ind[2]!, ind[3]!);
    await db().insert(alerts).values({ kind: "price_anomaly", severity: "warn", companyIds: [], details: { tradeId: flagged.id }, dedupeKey: `t:${flagged.id}` });
    void ref;

    await h.deps.clock.advance(db(), HOUR);
    const now = h.deps.clock.now();
    await updatePriceRefs(h.deps, now);
    const bucket = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
    const hist = await db().select().from(priceHistory).where(eq(priceHistory.at, bucket));
    const hg = hist.find((x) => x.productId === "grain" && x.cityId === "yesilova")!;
    expect(hg.vwapPerKg).not.toBeNull();
    expect(Number(hg.vwapPerKg)).toBeLessThanOrEqual(base(g) * 1.01);
    expect(Number(hg.vwapPerKg)).toBeGreaterThanOrEqual(base(g) * 0.99);
    expect(hg.volumeKg).toBe(1200); // yıkama hacmi dışlandı; 1500 kg'ın alt/üst %10'u kırpıldı
    const hf = hist.find((x) => x.productId === "fodder" && x.cityId === "akyayla")!;
    expect(hf.vwapPerKg).toBeNull(); // yetersiz bağımsız çift: kayma korunur
    const after = (await db().select().from(priceRefs).where(and(eq(priceRefs.productId, "grain"), eq(priceRefs.cityId, "yesilova"))))[0]!;
    expect(after.driftBp).toBeLessThanOrEqual(10_500);
  });
});

// ------------------------------------------------------------------ 4) sistem sözleşmeleri ve mint

describe("4) sistem sözleşme toplamı ve hazine basımı sınırlı", () => {
  freshWorld();
  it("açık sistem sözleşmeleri 2 × günlük bütçeyi aşmaz; günlük basım bütçeyi aşmaz ve kayıtlıdır", async () => {
    const prof = SYSTEM_PROFILES.find((p) => p.companyKey === "wholesale_yesilova")!;
    const sysCo = (await db().select().from(companies).where(eq(companies.systemKey, prof.companyKey)))[0]!;
    // 14 itibarlı oyuncu, her birinde bol stok
    for (let i = 0; i < 14; i++) {
      const id = (await kitFound(h, "crop", "yesilova")).companyId;
      await grantStock(h, id, "yesilova", "fodder", 2, 20_000, 10n);
      await db().update(companies).set({ onTimeDeliveries: 20 }).where(eq(companies.id, id));
    }
    for (let i = 0; i < 3; i++) await runSystemCycle(h.deps, h.deps.clock.now());
    const open = await rows<{ v: string; n: number }>(sql`
      SELECT coalesce(sum(qty_per_installment_kg::numeric * price_per_kg * installments), 0)::text v, count(*)::int n
      FROM cf.contracts WHERE is_system AND buyer_company_id = ${sysCo.id}::uuid AND status IN ('proposed','active')`);
    expect(open[0]!.n).toBeGreaterThan(0);
    expect(BigInt(open[0]!.v)).toBeLessThanOrEqual(BigInt(prof.dailyBudget) * 2n);
    expect(open[0]!.n).toBeLessThan(14); // tavan bazı oyuncuları dışarıda bıraktı

    // günlük sermaye basımı: sınırsız istek bile günde en çok günlük bütçe kadar basar; toplam meta kaydında görünür
    const cash = async () => bal(h, sysCo.id, "cash");
    await withTx(h.deps, async (tx) => {
      const c = await cash();
      if (c > 0n) await post(tx, { kind: "test_drain", idempotencyKey: `drain:${h.key()}`, at: h.deps.clock.now(), lines: [{ account: co(sysCo.id, "exp_other"), amount: c }, { account: co(sysCo.id, "cash"), amount: -c }] });
    });
    const budget = BigInt(prof.dailyBudget);
    const mintMany = () => withTx(h.deps, async (tx) => {
      for (let i = 0; i < 5; i++) await topUp(tx, sysCo.id, budget * 100n, h.deps.clock.now());
    });
    await mintMany();
    expect(await cash()).toBe(budget); // 5 istek, tek günlük pay
    await mintMany();
    expect(await cash()).toBe(budget);
    const day = h.deps.clock.now().toISOString().slice(0, 10);
    const meta = await rows<{ v: { minted: string } }>(sql`SELECT value v FROM cf.meta WHERE key = ${`system.mint:${sysCo.id}:${day}`}`);
    expect(BigInt(meta[0]!.v.minted)).toBe(budget);
    await h.deps.clock.advance(db(), DAY);
    await mintMany();
    expect(await cash()).toBe(budget * 2n); // ertesi gün yeni pay
    expect(await checkInvariants(db())).toEqual([]);
  });
});

// ------------------------------------------------------------------ 5) yönetici denetimi

describe("5) yönetici denetim kaydı ve bağlantı inceleme yetkisi", () => {
  freshWorld();
  async function claim(p: Player): Promise<string> {
    const code = `kurulum-${randomUUID()}`;
    await db().insert(adminSetupCodes).values({ codeHash: sha256(code) });
    await p.ok("POST", "/auth/admin/claim", { setupCode: code });
    return accountIdOf(p);
  }
  async function totp(p: Player): Promise<string> {
    const { secret } = await p.ok("POST", "/auth/totp/setup");
    await p.ok("POST", "/auth/totp/enable", { code: totpAt(secret, Math.floor(nowMs() / 30000)) });
    return secret;
  }
  const actions = async (adminId: string) => (await rows<{ action: string }>(sql`SELECT action FROM cf.admin_audit_log WHERE admin_account_id = ${adminId}::uuid`)).map((r) => r.action);

  it("yalnızca ilk yönetici inceleme yetkisini alır; talep, 2FA, arama ve şirket görüntüleme denetlenir; yetki ucu denetimli", async () => {
    // önceki testlerden yönetici kalmadığını doğrula (bu dosyada ilk talep)
    const a1 = await h.player(); const a1Id = await claim(a1);
    const a2 = await h.player(); const a2Id = await claim(a2);
    const flag = async (id: string) => (await db().select().from(accounts).where(eq(accounts.id, id)))[0]!.canReviewConnections;
    expect(await flag(a1Id)).toBe(true);
    expect(await flag(a2Id)).toBe(false);

    const secret1 = await totp(a1);
    await totp(a2);
    expect(await actions(a1Id)).toEqual(expect.arrayContaining(["admin.claim", "admin.totp_enable"]));

    // yeni oturum + doğrulama
    await a1.ok("POST", "/auth/login", { username: a1.username, password: "parola-123456" });
    await a1.ok("POST", "/auth/totp/verify", { code: totpAt(secret1, Math.floor(nowMs() / 30000) + 1) });
    expect(await actions(a1Id)).toContain("admin.totp_verify");

    const target = await found(h, await h.player(), "crop", "yesilova");
    await a1.ok("GET", `/admin/companies/${target}`);
    await a1.ok("GET", "/admin/search?q=firma");
    expect(await actions(a1Id)).toEqual(expect.arrayContaining(["company.view", "admin.search"]));

    // yetkisiz yönetici yetki veremez
    const denied = await a2.post(`/admin/accounts/${a2Id}/connections-access`, { enabled: true, reason: "kendime vereyim" });
    expect(denied.status).toBe(403);
    // yetkili yönetici verir; denetlenir
    const ok = await a1.ok("POST", `/admin/accounts/${a2Id}/connections-access`, { enabled: true, reason: "ikinci inceleyici" });
    expect(ok.enabled).toBe(true);
    expect(await flag(a2Id)).toBe(true);
    const audit = await rows<{ reasoning: string; after: { canReviewConnections: boolean } }>(sql`
      SELECT reasoning, after FROM cf.admin_audit_log WHERE admin_account_id = ${a1Id}::uuid AND action = 'account.connections_access'`);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reasoning).toBe("ikinci inceleyici");
    expect(audit[0]!.after.canReviewConnections).toBe(true);
    // oyuncu hesabına verilemez; son yetkili alınamaz değil: iki yetkili var, biri çekilebilir
    const player = await h.player();
    const bad = await a1.post(`/admin/accounts/${await accountIdOf(player)}/connections-access`, { enabled: true, reason: "oyuncu" });
    expect(bad.status).toBe(400);
    await a2.ok("POST", `/admin/accounts/${a1Id}/connections-access`, { enabled: false, reason: "devir" });
    const last = await a2.post(`/admin/accounts/${a2Id}/connections-access`, { enabled: false, reason: "son yetkili" });
    expect(last.status).toBe(409);
    (globalThis as { __admin?: Player }).__admin = a2;
  });

  it("tüm ayarlar aralık sınırlıdır", async () => {
    const admin = (globalThis as { __admin?: Player }).__admin!;
    const bad: Array<[string, unknown]> = [
      ["system.bidBp", 20_000], ["system.askBp", 5_000], ["system.shareDampBp", 20_000], ["loan.lateFeeBp", 9_000],
      ["contracts.windowHoursBeforeDue", 0], ["contracts.defaultGraceHours", 9_999], ["freight.systemPerKm", 999_999_999_999],
      ["xp.productionJob", 5_000], ["refoundCooldownHours", 100_000], ["xp.minInstallmentValue", 99_999_999_999], ["loan.limitPerLevel", 99_999_999_999],
    ];
    for (const [key, value] of bad) {
      const r = await admin.patch("/admin/settings", { key, value, reasoning: "aralık denemesi" });
      expect(r.status, key).toBe(400);
    }
    const good = await admin.patch("/admin/settings", { key: "refoundCooldownHours", value: 48, reasoning: "geçerli değer" });
    expect(good.status).toBe(200);
    await admin.ok("PATCH", "/admin/settings", { key: "refoundCooldownHours", value: 72, reasoning: "geri al" });
    expect(h.deps.catalog.settings.refoundCooldownHours).toBe(72);
  });
});

// ------------------------------------------------------------------ 6) navlun ilanı

describe("6) navlun ilanı ücreti", () => {
  freshWorld();
  it("ücret sistem tarifesinin 3 katını aşamaz; komisyon kesilir; aynı gruptaki ilan uyarı üretir", async () => {
    const shipper = await h.player(); const shipperId = await found(h, shipper, "livestock", "akyayla");
    const carrier = await h.player(); const carrierId = await found(h, carrier, "freight", "akyayla");
    await grantStock(h, shipperId, "akyayla", "fodder", 3, 100, 10n);
    const q = await shipper.ok("GET", "/freight/quote?originCityId=akyayla&destCityId=kavsak&kg=100");
    const cap = BigInt(q.systemQuote) * 3n;
    const job = (pay: bigint) => withKey(h, {
      originCityId: "akyayla", destCityId: "kavsak", cargo: [{ productId: "fodder", quality: 3, qtyKg: 50 }], payAmount: Number(pay), deadlineHours: 24, allowSystemCarrier: false,
    });
    const tooMuch = await shipper.post("/freight-jobs", job(cap + 1n));
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe("BAD_REQUEST");
    const pay = cap;
    const created = await shipper.ok("POST", "/freight-jobs", job(pay));
    const veh = (await carrier.ok("GET", "/fleet"))[0];
    const cash0 = await bal(h, carrierId, "cash");
    await carrier.ok("POST", `/freight-jobs/${created.id}/accept`, withKey(h, { vehicleId: veh.id }));
    const costs = await rows<{ fuel: string; driver: string }>(sql`SELECT fuel_cost::text fuel, driver_cost::text driver FROM cf.shipments WHERE freight_job_id = ${created.id}::uuid`);
    await h.advance(12 * HOUR, HOUR);
    const fee = applyBp(pay, h.deps.catalog.settings.marketFeeBp);
    expect(fee).toBeGreaterThan(0n);
    expect(await bal(h, carrierId, "cash") - cash0).toBe(pay - fee - BigInt(costs[0]!.fuel) - BigInt(costs[0]!.driver));
    expect(await bal(h, carrierId, "exp_fees")).toBe(fee);
    expect(await bal(h, carrierId, "revenue_freight")).toBe(-pay);

    // aynı bağlantı grubu: kabul edilen ilan uyarı üretir
    const s2 = await h.player(undefined, "10.88.8.8"); const s2Id = await found(h, s2, "livestock", "akyayla");
    const c2 = await h.player(undefined, "10.88.8.8"); await found(h, c2, "freight", "akyayla");
    await grantStock(h, s2Id, "akyayla", "fodder", 3, 100, 10n);
    const j2 = await s2.ok("POST", "/freight-jobs", job(1000n));
    await c2.ok("POST", `/freight-jobs/${j2.id}/accept`, withKey(h, { vehicleId: (await c2.ok("GET", "/fleet"))[0].id }));
    await scanPriceAnomalies(h.deps, h.deps.clock.now());
    const al = await rows<{ severity: string; details: { freightJobId: string; explanation: string; sameConnectionGroup: boolean } }>(sql`
      SELECT severity, details FROM cf.alerts WHERE kind = 'price_anomaly' AND details->>'freightJobId' = ${j2.id}`);
    expect(al).toHaveLength(1);
    expect(al[0]!.severity).toBe("high");
    expect(al[0]!.details.sameConnectionGroup).toBe(true);
    expect(al[0]!.details.explanation.length).toBeGreaterThan(10);
    // bağımsız taraflar için uyarı yok
    const none = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.alerts WHERE details->>'freightJobId' = ${created.id}`);
    expect(none[0]!.n).toBe(0);
    expect(await checkInvariants(db())).toEqual([]);
  });
});

// ------------------------------------------------------------------ 7) WebSocket

describe("7) WebSocket sızıntısı", () => {
  freshWorld();
  it("IP başına 5, hesap başına 3 soket; kapanınca yer açılır", async () => {
    const p = await h.player(undefined, "10.99.9.9");
    await found(h, p, "crop", "yesilova");
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (h.app.server.address() as { port: number }).port;
    const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
    interface Conn { ws: WebSocket; closed: Promise<number> }
    const connect = async (cookie?: string): Promise<Conn> => {
      const Ctor = WebSocket as unknown as new (url: string, opts?: unknown) => WebSocket;
      const ws = new Ctor(`ws://127.0.0.1:${port}/events`, cookie ? { headers: { cookie } } : undefined);
      const closed = new Promise<number>((res) => ws.addEventListener("close", (e) => res((e as CloseEvent).code)));
      await new Promise<void>((res) => { ws.addEventListener("open", () => res()); ws.addEventListener("close", () => res()); });
      await settle(150); // sunucu tarafı oturum çözümü bitsin (sayaçlar sıralı artsın)
      return { ws, closed };
    };
    const isOpen = (c: Conn) => c.ws.readyState === 1;
    const mine: Conn[] = [];
    for (let i = 0; i < 3; i++) mine.push(await connect(p.cookie));
    const fourth = await connect(p.cookie);
    expect(await Promise.race([fourth.closed, settle(1000).then(() => -1)])).toBe(1008);
    for (const c of mine) expect(isOpen(c)).toBe(true);
    // IP sayacı: 3 açık; iki anonim daha sığar, altıncı reddedilir
    const anon = [await connect(), await connect()];
    for (const c of anon) expect(isOpen(c)).toBe(true);
    const sixth = await connect();
    expect(await Promise.race([sixth.closed, settle(1000).then(() => -1)])).toBe(1008);
    // kapanış sayacı düşürür
    mine[0]!.ws.close();
    await mine[0]!.closed;
    await settle();
    const again = await connect();
    expect(isOpen(again)).toBe(true);
    for (const c of [...mine.slice(1), ...anon, again]) c.ws.close();
    await settle();
  });

  it("oturum 5 dakikada bir yeniden doğrulanır; geçersizse soket kapanır", async () => {
    const p = await h.player(undefined, "10.99.9.10");
    await found(h, p, "crop", "korfezkent");
    const accId = await accountIdOf(p);
    const port = (h.app.server.address() as { port: number }).port;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const Ctor = WebSocket as unknown as new (url: string, opts?: unknown) => WebSocket;
      const ws = new Ctor(`ws://127.0.0.1:${port}/events`, { headers: { cookie: p.cookie } });
      const closed = new Promise<number>((res) => ws.addEventListener("close", (e) => res((e as CloseEvent).code)));
      await new Promise<void>((res) => ws.addEventListener("open", () => res()));
      await new Promise((r) => setTimeout(r, 300));
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000); // oturum hâlâ geçerli: açık kalır
      await new Promise((r) => setTimeout(r, 200));
      expect(ws.readyState).toBe(1);
      await db().execute(sql`DELETE FROM cf.sessions WHERE account_id = ${accId}::uuid`);
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
      expect(await Promise.race([closed, new Promise<number>((r) => setTimeout(() => r(-1), 3000))])).toBe(1008);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ------------------------------------------------------------------ 8) defter değişmezliği

describe("8) defter değişmezliği (veritabanı düzeyi)", () => {
  freshWorld();
  it("UPDATE/DELETE/TRUNCATE yasak; dengesiz işlem kesinleşmez; sözleşme koşulları donar", async () => {
    const p = await h.player();
    const id = await found(h, p, "crop", "yesilova");
    void id;
    await expect(db().execute(sql`UPDATE cf.ledger_entries SET amount = amount WHERE id = (SELECT min(id) FROM cf.ledger_entries)`)).rejects.toThrow();
    await expect(db().execute(sql`DELETE FROM cf.ledger_entries WHERE id = (SELECT min(id) FROM cf.ledger_entries)`)).rejects.toThrow();
    await expect(db().execute(sql`UPDATE cf.ledger_transactions SET memo = 'x' WHERE id = (SELECT id FROM cf.ledger_transactions LIMIT 1)`)).rejects.toThrow();
    await expect(db().execute(sql`DELETE FROM cf.ledger_transactions WHERE id = (SELECT id FROM cf.ledger_transactions LIMIT 1)`)).rejects.toThrow();
    await expect(db().execute(sql`TRUNCATE cf.ledger_entries`)).rejects.toThrow();

    // dengesiz işlem: işlem sonunda reddedilir
    const txId = randomUUID();
    const acc = await rows<{ id: string }>(sql`SELECT id::text FROM cf.ledger_accounts WHERE company_id = ${id}::uuid AND code = 'equity'`);
    await expect(db().transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO cf.ledger_transactions (id, kind, idempotency_key, created_at) VALUES (${txId}::uuid, 'test_unbalanced', ${`u:${txId}`}, now())`);
      await tx.execute(sql`INSERT INTO cf.ledger_entries (transaction_id, account_id, amount, created_at) VALUES (${txId}::uuid, ${acc[0]!.id}::uuid, 5, now())`);
    })).rejects.toThrow();
    const gone = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE id = ${txId}::uuid`);
    expect(gone[0]!.n).toBe(0);

    // sözleşme koşulları: ilk atama serbest, sonraki değişiklik yasak
    const s = await h.player(); const sId = await found(h, s, "livestock", "akyayla");
    const b = await h.player(); const bId = await found(h, b, "crop", "yesilova");
    await grantStock(h, sId, "akyayla", "fodder", 3, 10, 10n);
    const prop = await b.ok("POST", "/contracts", withKey(h, {
      role: "buyer", counterpartyCompanyId: sId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 10, pricePerKg: 100,
      deliveryCityId: "akyayla", freightPayer: "seller", installments: 1, firstDueAt: iso(3 * HOUR), intervalHours: 1, graceHours: 2, penaltyBp: 1000,
    }));
    await s.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    await expect(db().execute(sql`UPDATE cf.contracts SET terms = '{}'::jsonb WHERE id = ${prop.id}::uuid`)).rejects.toThrow();
    await db().execute(sql`UPDATE cf.contracts SET note = 'serbest' WHERE id = ${prop.id}::uuid`); // diğer sütunlar etkilenmez
    void bId;
    expect(await checkInvariants(db())).toEqual([]);
  });
});

// ------------------------------------------------------------------ 9) küçük düzeltmeler

describe("9a) küçük düzeltmeler", () => {
  freshWorld();
  it("parola değişince diğer oturumlar düşer, mevcut oturum kalır", async () => {
    const p = await h.player();
    const other = new Player(h, p.username, "10.12.12.12");
    await other.ok("POST", "/auth/login", { username: p.username, password: "parola-123456" });
    expect((await other.ok("GET", "/auth/me")).account).not.toBeNull();
    await p.ok("POST", "/account/password", { oldPassword: "parola-123456", newPassword: "yeni-parola-98765" });
    expect((await other.ok("GET", "/auth/me")).account).toBeNull();
    expect((await p.ok("GET", "/auth/me")).account).not.toBeNull();
  });

  it("üretimde DISABLE_RATE_LIMIT yok sayılır", async () => {
    const prevNode = process.env.NODE_ENV;
    try {
      process.env.DISABLE_RATE_LIMIT = "1";
      process.env.NODE_ENV = "test";
      await rateLimit(h.deps, `t-test:${h.key()}`, 1, 60);
      await rateLimit(h.deps, `t-test2:${h.key()}`, 1, 60); // farklı anahtar; sınırsız geçerli
      const key = `t-prod:${h.key()}`;
      process.env.NODE_ENV = "production";
      await rateLimit(h.deps, key, 1, 60);
      await expect(rateLimit(h.deps, key, 1, 60)).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(AppError).toBeDefined();
    } finally {
      process.env.NODE_ENV = prevNode;
    }
  });

  it("IP karması saklama süresi ilk görülme tarihine göre işler", async () => {
    const p = await h.player();
    const accId = await accountIdOf(p);
    const now = h.deps.clock.now();
    const old = new Date(now.getTime() - 40 * DAY);
    await db().insert(connectionRecords).values({ accountId: accId, ipHash: `eski-${h.key()}`, firstSeenAt: old, lastSeenAt: now });
    await db().insert(connectionRecords).values({ accountId: accId, ipHash: `yeni-${h.key()}`, firstSeenAt: new Date(now.getTime() - 5 * DAY), lastSeenAt: now });
    const n = await cleanupConnectionRecords(h.deps, now);
    expect(n).toBeGreaterThanOrEqual(1);
    const left = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.connection_records WHERE account_id = ${accId}::uuid AND ip_hash LIKE 'eski-%'`);
    expect(left[0]!.n).toBe(0);
    const kept = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.connection_records WHERE account_id = ${accId}::uuid AND ip_hash LIKE 'yeni-%'`);
    expect(kept[0]!.n).toBe(1);
  });

  it("sistem alış üst sınırı kalite çarpanından sonra uygulanır", () => {
    const o = { isSystem: true, side: "buy", pricePerKg: 1000n } as unknown as OrderRow;
    expect(effectivePrice(o, 5, null)).toBeGreaterThan(1000n);
    expect(effectivePrice(o, 5, 1000n)).toBe(1000n);
    expect(effectivePrice(o, 2, 1000n)).toBe(1000n);
    expect(effectivePrice({ ...o, isSystem: false } as OrderRow, 5, 1n)).toBe(1000n);
  });

  it("idempotency: aynı anahtar başka istekte 409; aynı istekte tekrar; 7 günden eski anahtarlar temizlenir", async () => {
    const p = await h.player();
    await found(h, p, "livestock", "akyayla");
    const key = h.key();
    const a = await p.post("/finance/loans", { amount: 1_000_000, termDays: 7, idempotencyKey: key });
    expect(a.status).toBe(200);
    const same = await p.post("/finance/loans", { amount: 1_000_000, termDays: 7, idempotencyKey: key });
    expect(same.status).toBe(200);
    expect(same.body.id).toBe(a.body.id);
    const diffBody = await p.post("/finance/loans", { amount: 2_000_000, termDays: 7, idempotencyKey: key });
    expect(diffBody.status).toBe(409);
    expect(diffBody.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    const diffScope = await p.post(`/finance/loans/${a.body.id}/repay`, { amount: 1_000_000, idempotencyKey: key });
    expect(diffScope.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    const loans = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.loans WHERE company_id = (SELECT id FROM cf.companies WHERE account_id = ${await accountIdOf(p)}::uuid AND dissolved_at IS NULL)`);
    expect(loans[0]!.n).toBe(1);

    const acc = await accountIdOf(p);
    const now = h.deps.clock.now();
    await db().insert(idempotencyKeys).values({ accountId: acc, key: "eski-anahtar-1", scope: "x", status: 200, response: {}, createdAt: new Date(now.getTime() - 8 * DAY) });
    await db().insert(idempotencyKeys).values({ accountId: acc, key: "yeni-anahtar-1", scope: "x", status: 200, response: {}, createdAt: new Date(now.getTime() - 2 * DAY) });
    expect(await cleanupIdempotencyKeys(h.deps, now)).toBeGreaterThanOrEqual(1);
    const left = await db().select().from(idempotencyKeys).where(eq(idempotencyKeys.accountId, acc));
    expect(left.some((k) => k.key === "eski-anahtar-1")).toBe(false);
    expect(left.some((k) => k.key === "yeni-anahtar-1")).toBe(true);
  });

  it("sözleşme kabulünde teklif sahibinin eksik tutarı sızmaz; kabul edenin kendi eksiği görünür", async () => {
    const s = await h.player(); const sId = await found(h, s, "livestock", "akyayla");
    const b = await h.player(); const bId = await found(h, b, "crop", "yesilova");
    await grantStock(h, sId, "akyayla", "fodder", 3, 20_000, 10n);
    await grantCash(h, bId, 50_000_000n);
    const base = { productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 10_000, pricePerKg: 2000, deliveryCityId: "akyayla", freightPayer: "seller", installments: 1, firstDueAt: iso(3 * HOUR), intervalHours: 1, graceHours: 2, penaltyBp: 1000 };
    // alıcı teklif sahibi: emaneti (20M) sonradan boşalttı
    const prop = await b.ok("POST", "/contracts", withKey(h, { ...base, role: "buyer", counterpartyCompanyId: sId }));
    await withTx(h.deps, async (tx) => {
      const cash = await bal(h, bId, "cash");
      await post(tx, { kind: "test_drain", idempotencyKey: `drain:${h.key()}`, at: h.deps.clock.now(), lines: [{ account: co(bId, "exp_other"), amount: cash }, { account: co(bId, "cash"), amount: -cash }] });
    });
    const r = await s.post(`/contracts/${prop.id}/accept`, withKey(h, {}));
    expect(r.body.error.code).toBe("CONTRACT_NOT_OPEN");
    expect(r.body.error.details?.missing).toBeUndefined();
    // kabul eden yetersizse kendi eksiğini görür
    await grantCash(h, bId, 30_000_000n);
    const prop2 = await s.ok("POST", "/contracts", withKey(h, { ...base, role: "seller", counterpartyCompanyId: bId }));
    const cashB = await bal(h, bId, "cash");
    await withTx(h.deps, (tx) => post(tx, { kind: "test_drain", idempotencyKey: `drain:${h.key()}`, at: h.deps.clock.now(), lines: [{ account: co(bId, "exp_other"), amount: cashB - 1_000_000n }, { account: co(bId, "cash"), amount: -(cashB - 1_000_000n) }] }));
    const r2 = await b.post(`/contracts/${prop2.id}/accept`, withKey(h, {}));
    expect(r2.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(r2.body.error.details.missing).toBe("19000000");
  });

});

describe("9b) küçük düzeltmeler: sayaç kilidi ve kredi", () => {
  freshWorld();
  it("garajsız filo sayacı eşzamanlı alımlarda aşılmaz", async () => {
    const p = await h.player(); const id = await found(h, p, "crop", "yesilova");
    await grantCash(h, id, 100_000_000n);
    const res = await Promise.all(Array.from({ length: 5 }, () => p.post("/fleet/buy", withKey(h, { modelId: "van", cityId: "yesilova" }))));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    const v = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.vehicles WHERE company_id = ${id}::uuid AND status <> 'sold'`);
    expect(v[0]!.n).toBe(1);
  });

  it("kısmi kredi ödemesi tahakkuk eden faizi de alır", async () => {
    const p = await h.player(); const id = await found(h, p, "livestock", "akyayla");
    const loan = await p.ok("POST", "/finance/loans", withKey(h, { amount: 4_000_000, termDays: 14 }));
    await h.advance(5 * HOUR, HOUR);
    const expected = accruedInterest(4_000_000n, h.deps.catalog.settings.loan.dailyInterestBp, 5);
    expect(expected).toBeGreaterThan(0n);
    const r = await p.ok("POST", `/finance/loans/${loan.id}/repay`, withKey(h, { amount: 1_000_000 }));
    expect(r.outstanding).toBe((4_000_000n - (1_000_000n - expected)).toString());
    expect(r.interestPaid).toBe(expected.toString());
    expect(await bal(h, id, "exp_interest")).toBe(expected);
    expect(await checkInvariants(db())).toEqual([]);
  });

});
