import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loanInstallment } from "@capitalforge/economy";
import { withTx } from "../deps";
import { sales } from "../db/schema";
import { balance, DAY, drainCash, found, grantCash, grantStock, HOUR } from "../production/kit";
import { createHarness, type Harness } from "../test/harness";
import { checkInvariants } from "../test/invariants";
import { settleArrears } from "./arrears";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const q = async <T>(s: ReturnType<typeof sql>) => (await h.deps.db.execute(s)) as unknown as T[];

describe("finans raporu", () => {
  it("bakiyeler, kâr-zarar ve nakit akışı ayrı; net değer formülü; defter dengeli", async () => {
    const f = await found(h, "crop", "yesilova");
    await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    await h.advance(2 * HOUR);
    const fin = await f.p.ok("GET", "/finance");
    const b = fin.balances as Record<string, string>;
    // nakit akışı: tüm hareketler pencerede; net = nakit bakiyesi
    expect(fin.cashflow.net).toBe(b.cash);
    expect(BigInt(fin.cashflow.financing)).toBe(BigInt(h.deps.catalog.settings.startingCash));
    expect(BigInt(fin.cashflow.investing)).toBeLessThan(0n); // arsa
    expect(BigInt(fin.cashflow.operating)).toBeLessThan(0n); // enerji, su, ücret
    // gelir yok: kâr-zarar sıfır (üretim maliyeti satışta gider olur)
    expect(fin.pnl).toMatchObject({ revenue: "0", cogs: "0", netProfit: "0", days: 7 });
    const B = (k: string) => BigInt(b[k] ?? "0");
    const nw = B("cash") + B("inventory") + B("wip") + B("escrow") + B("prepaid_freight") + B("fixed_assets") - B("loans") - B("arrears");
    expect(fin.netWorth).toBe(nw.toString());
    // defter satırları: sayfalar birleşince toplam 0 (şirket içinde dengeli)
    let before: string | undefined;
    let sum = 0n;
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const page = await f.p.ok("GET", `/finance/ledger${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      if (page.length === 0) break;
      for (const l of page) sum += BigInt(l.amount);
      n += page.length;
      before = page[page.length - 1].at;
    }
    expect(n).toBeGreaterThan(8);
    expect(sum).toBe(0n);
    // saatlik snapshot
    await h.tick();
    const snap = await q<{ net_worth: string }>(sql`SELECT net_worth::text FROM cf.company_snapshots WHERE company_id = ${f.companyId} ORDER BY at DESC LIMIT 1`);
    expect(BigInt(snap[0]!.net_worth)).toBe(nw);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("satış listesi ve satış izi (yalnızca kendi satırları)", async () => {
    const a = await found(h, "crop", "yesilova");
    const b = await found(h, "crop", "kavsak");
    const job = await a.p.ok("POST", "/production/start", { facilityId: a.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    const t = await q<{ id: string }>(sql`SELECT start_transaction_id id FROM cf.production_jobs WHERE id = ${job.id}`);
    const [sale] = await h.deps.db.insert(sales).values({
      sellerCompanyId: a.companyId, buyerCompanyId: b.companyId, source: "spot", cityId: "yesilova", productId: "fodder", quality: 2, qtyKg: 10,
      pricePerKg: 100n, gross: 1000n, cogs: 600n, fees: 10n, netProfit: 390n, transactionIds: [t[0]!.id], createdAt: h.deps.clock.now(),
    }).returning();
    const list = await a.p.ok("GET", "/finance/sales");
    expect(list.map((s: { id: string }) => s.id)).toEqual([sale!.id]);
    expect(list[0].buyerName).toBeTruthy();
    const trace = await a.p.ok("GET", `/finance/sales/${sale!.id}`);
    expect(trace.transactions.length).toBe(1);
    expect(trace.transactions[0].lines.length).toBeGreaterThan(0);
    const bTrace = await b.p.ok("GET", `/finance/sales/${sale!.id}`);
    expect(bTrace.transactions[0].lines).toEqual([]); // alıcı satıcının defter satırlarını görmez
    const c = await found(h, "crop", "korfezkent");
    expect((await c.p.get(`/finance/sales/${sale!.id}`)).status).toBe(404);
    expect((await b.p.ok("GET", "/finance/sales")).length).toBe(0);
  });
});

describe("krediler", () => {
  it("kullanım, günlük taksitler ve kapanış; limit aşımı reddedilir", async () => {
    const f = await found(h, "crop", "yesilova");
    const fin0 = await f.p.ok("GET", "/finance");
    expect(fin0.loanOffer.maxAmount).toBe(String(h.deps.catalog.settings.loan.limitPerLevel)); // seviye 1
    expect((await f.p.post("/finance/loans", { amount: 10_000_001, termDays: 3, idempotencyKey: h.key() })).body.error.code).toBe("LOAN_LIMIT");
    expect((await f.p.post("/finance/loans", { amount: 1_000_000, termDays: 4, idempotencyKey: h.key() })).body.error.code).toBe("BAD_REQUEST");
    const cash0 = await balance(h, f.companyId, "cash");
    const key = h.key();
    const loan = await f.p.ok("POST", "/finance/loans", { amount: 3_000_000, termDays: 3, idempotencyKey: key });
    const again = await f.p.ok("POST", "/finance/loans", { amount: 3_000_000, termDays: 3, idempotencyKey: key });
    expect(again.id).toBe(loan.id);
    expect(await balance(h, f.companyId, "cash")).toBe(cash0 + 3_000_000n);
    expect(await balance(h, f.companyId, "loans")).toBe(-3_000_000n);
    // limit: kullanılan kısım düşer
    expect((await f.p.post("/finance/loans", { amount: 7_000_001, termDays: 3, idempotencyKey: h.key() })).body.error.code).toBe("LOAN_LIMIT");
    await h.advance(3 * DAY + HOUR, 6 * HOUR);
    const fin = await f.p.ok("GET", "/finance");
    const l = fin.loans.find((x: { id: string }) => x.id === loan.id);
    expect(l.status).toBe("repaid");
    expect(l.outstanding).toBe("0");
    // beklenen faiz: 3 taksit, kalan anapara üzerinden
    let out = 3_000_000n;
    let interest = 0n;
    for (let i = 0; i < 3; i++) {
      const r = loanInstallment(3_000_000n, 3, i, out, 40);
      interest += r.interest;
      out -= r.principalPart;
    }
    expect(BigInt(l.interestPaid)).toBe(interest);
    expect(BigInt(fin.balances.exp_interest)).toBe(interest);
    expect(fin.balances.loans).toBe("0");
    expect(fin.balances.arrears).toBe("0");
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.filter((n: { kind: string }) => n.kind === "loan_installment_paid").length).toBe(3);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("erken ödeme: kısmi anapara ve tam kapama (tahakkuk faizi ile)", async () => {
    const f = await found(h, "crop", "yesilova");
    const loan = await f.p.ok("POST", "/finance/loans", { amount: 4_000_000, termDays: 7, idempotencyKey: h.key() });
    const partial = await f.p.ok("POST", `/finance/loans/${loan.id}/repay`, { amount: 1_000_000, idempotencyKey: h.key() });
    expect(partial.outstanding).toBe("3000000");
    expect(partial.status).toBe("active");
    await h.advance(DAY + HOUR, 6 * HOUR); // bir taksit
    const mid = (await f.p.ok("GET", "/finance")).loans[0];
    expect(mid.paidInstallments).toBe(1);
    const cashBefore = await balance(h, f.companyId, "cash");
    const closed = await f.p.ok("POST", `/finance/loans/${loan.id}/repay`, { amount: Number(mid.outstanding), idempotencyKey: h.key() });
    expect(closed.status).toBe("repaid");
    expect(closed.outstanding).toBe("0");
    const paid = cashBefore - (await balance(h, f.companyId, "cash"));
    expect(paid).toBeGreaterThanOrEqual(BigInt(mid.outstanding)); // anapara + tahakkuk faizi
    expect(paid - BigInt(mid.outstanding)).toBeLessThanOrEqual(BigInt(Math.floor(Number(mid.outstanding) * 40 / 10000)));
    expect(await balance(h, f.companyId, "loans")).toBe(0n);
    expect((await f.p.post(`/finance/loans/${loan.id}/repay`, { amount: 1000, idempotencyKey: h.key() })).body.error.code).toBe("LOAN_NOT_ACTIVE");
    // başkasının kredisi görünmez
    const other = await found(h, "crop", "kavsak");
    expect((await other.p.post(`/finance/loans/${loan.id}/repay`, { amount: 1000, idempotencyKey: h.key() })).body.error.code).toBe("NOT_FOUND");
    await h.advance(3 * DAY, 12 * HOUR); // kapanmış kredi taksit üretmez
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("ödenemeyen taksit arrears olur, yeni işi engeller, nakit gelince kapanır", async () => {
    const f = await found(h, "crop", "yesilova");
    await f.p.ok("POST", "/finance/loans", { amount: 3_000_000, termDays: 3, idempotencyKey: h.key() });
    await drainCash(h, f.companyId);
    await h.advance(DAY + HOUR, 6 * HOUR);
    const fin = await f.p.ok("GET", "/finance");
    const expected = loanInstallment(3_000_000n, 3, 0, 3_000_000n, 40);
    const fee = (expected.total * BigInt(h.deps.catalog.settings.loan.lateFeeBp)) / 10000n;
    expect(BigInt(fin.balances.arrears)).toBe(expected.total + fee);
    expect(BigInt(fin.balances.exp_penalties)).toBe(fee);
    expect(fin.loans[0].paidInstallments).toBe(1);
    expect(fin.loans[0].outstanding).toBe((3_000_000n - expected.principalPart).toString());
    const me = await f.p.ok("GET", "/company");
    expect(me.arrears).toBe(fin.balances.arrears);
    expect(me.nextSteps.some((s: { key: string }) => s.key === "pay_arrears")).toBe(true);
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.some((n: { kind: string }) => n.kind === "loan_installment_missed")).toBe(true);
    // yeni iş engellenir
    const blocked = await f.p.post("/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(blocked.body.error.code).toBe("ARREARS_OUTSTANDING");
    // nakit girişi + settleArrears (Modül B bunu satış sonrası çağırır): kısmi ödeme
    await grantCash(h, f.companyId, 100_000n);
    const paid = await withTx(h.deps, (tx, uow) => settleArrears(tx, uow, f.companyId, h.deps.clock.now()));
    expect(paid).toBe(100_000n);
    expect(await balance(h, f.companyId, "cash")).toBe(0n);
    expect(await balance(h, f.companyId, "arrears")).toBe(-(expected.total + fee - 100_000n));
    // kalan: elle ödeme yetersiz nakitle reddedilir, sonra tamamı kapanır
    expect((await f.p.post("/finance/arrears/pay", { idempotencyKey: h.key() })).body.error.code).toBe("INSUFFICIENT_FUNDS");
    await grantCash(h, f.companyId, 20_000_000n);
    const r = await f.p.ok("POST", "/finance/arrears/pay", { idempotencyKey: h.key() });
    expect(r.paid).toBe((expected.total + fee - 100_000n).toString());
    expect(await balance(h, f.companyId, "arrears")).toBe(0n);
    const ok = await f.p.post("/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect(ok.status).toBe(200);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("günlük bakım", () => {
  it("bina ve araç bakımı günde bir kez alınır; yetmezse arrears; çift işlenmez", async () => {
    const f = await found(h, "freight", "kavsak"); // garaj + kamyon
    const before = await balance(h, f.companyId, "cash");
    const co = await q<{ next: Date }>(sql`SELECT next_upkeep_at next FROM cf.companies WHERE id = ${f.companyId}`);
    const first = new Date(co[0]!.next).getTime();
    const garage = BigInt(h.deps.catalog.levelDef("garage", 1).upkeepPerDay);
    const truck = BigInt(h.deps.catalog.vehicleModel("truck").upkeepPerDay);
    const perDay = garage + truck;
    // ilk bakım vadesine kadar ilerle; iki zamanlayıcı aynı anda çalışsın
    const target = first + HOUR - h.deps.clock.nowMs();
    await h.deps.clock.advance(h.deps.db, target);
    const now = h.deps.clock.now();
    const { runDue } = await import("../scheduler/scheduler");
    await Promise.all([runDue(h.deps, now, true), runDue(h.deps, now, true)]);
    expect(before - (await balance(h, f.companyId, "cash"))).toBe(perDay);
    expect(await balance(h, f.companyId, "exp_upkeep")).toBe(perDay);
    const after = await q<{ next: Date }>(sql`SELECT next_upkeep_at next FROM cf.companies WHERE id = ${f.companyId}`);
    expect(new Date(after[0]!.next).getTime()).toBe(first + DAY);
    // ertesi gün: nakit yok → arrears + bildirim
    await drainCash(h, f.companyId);
    await h.advance(DAY, 6 * HOUR);
    expect(await balance(h, f.companyId, "arrears")).toBe(-perDay);
    expect(await balance(h, f.companyId, "exp_upkeep")).toBe(perDay * 2n);
    const notes = await f.p.ok("GET", "/notifications");
    expect(notes.some((n: { kind: string }) => n.kind === "upkeep_missed")).toBe(true);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("şirket profili ve kapanış", () => {
  it("herkese açık profil ve arama; bakiye sızmaz", async () => {
    const a = await found(h, "crop", "yesilova");
    const b = await found(h, "crop", "kavsak");
    const me = await a.p.ok("GET", "/company");
    const prof = await b.p.ok("GET", `/companies/${a.companyId}`);
    expect(prof).toMatchObject({ id: a.companyId, name: me.name, sector: "crop", level: 1, isSystem: false });
    expect(prof.cash).toBeUndefined();
    const res = await b.p.ok("GET", `/companies/search?q=${encodeURIComponent(me.name.slice(0, 8).toLowerCase())}`);
    expect(res.some((c: { id: string }) => c.id === a.companyId)).toBe(true);
    expect((await b.p.get("/companies/not-a-uuid")).status).toBe(404);
    expect((await b.p.get("/companies/search?q=%25")).status).toBe(200);
  });

  it("şirketi kapat: işler iptal, stok ve bakiye kapanır, arsa serbest, yeniden kurulabilir", async () => {
    const f = await found(h, "livestock", "akyayla");
    await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "milk_cows", batches: 1, repeat: true, idempotencyKey: h.key() });
    await f.p.ok("POST", "/finance/loans", { amount: 2_000_000, termDays: 7, idempotencyKey: h.key() });
    await grantStock(h, f.companyId, f.cityId, "steel", 2, 100, 50_000n);
    const me = await f.p.ok("GET", "/company");
    expect((await f.p.post("/account/dissolve", { confirmName: "yanlış ad" })).status).toBe(400);
    const r = await f.p.ok("POST", "/account/dissolve", { confirmName: me.name });
    expect(r.ok).toBe(true);
    expect((await f.p.get("/company")).body.error.code).toBe("NO_COMPANY");
    for (const code of ["cash", "inventory", "wip", "escrow", "fixed_assets", "loans", "arrears"]) {
      expect(await balance(h, f.companyId, code), code).toBe(0n);
    }
    const rows = await q<{ n: number }>(sql`SELECT count(*)::int n FROM cf.production_jobs WHERE company_id = ${f.companyId} AND status = 'running'`);
    expect(rows[0]!.n).toBe(0);
    const plots = await q<{ n: number }>(sql`SELECT count(*)::int n FROM cf.plots WHERE owner_company_id = ${f.companyId}`);
    expect(plots[0]!.n).toBe(0);
    await h.advance(2 * DAY, 12 * HOUR); // kapanmış şirket için görev işlemez
    expect(await balance(h, f.companyId, "cash")).toBe(0n);
    // aynı hesapla yeniden kur
    const ob = await f.p.ok("GET", "/world/onboarding?cityId=akyayla&sector=livestock");
    const plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
    const again = await f.p.ok("POST", "/company", { name: me.name, cityId: "akyayla", sector: "livestock", plotId: plot.id, idempotencyKey: h.key() });
    expect(again.companyId).not.toBe(f.companyId);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});
