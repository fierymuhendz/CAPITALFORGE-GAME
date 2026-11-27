/**
 * Şirket Muhasebesi kabul testleri: örnek satış (1.000 − 600 − 50 − 10 = 340), kredi (kasa +500, kâr değişmez),
 * şirketler arası yalıtım, dönem sınırı, ters kayıt, aynı işlemin bir kez sayılması ve nakit eşitliği.
 * Tutarlar kuruş: 1.000 ₺ = 100_000.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountingDto, AccountingTxPageDto } from "@capitalforge/shared";
import { withTx } from "../deps";
import { sales } from "../db/schema";
import { removeStock } from "../inventory/holdings";
import { co, post, reverse } from "../ledger/post";
import { found, grantStock, type Founded } from "../production/kit";
import { createHarness, type Harness, type Player } from "../test/harness";
import { checkInvariants } from "../test/invariants";
import { gameDayStart } from "./accounting";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const TL = 100n; // 1 ₺ = 100 kuruş
const acc = (p: Player, period = "today") => p.ok<AccountingDto>("GET", `/finance/accounting?period=${period}`);
async function allTx(p: Player, period = "today"): Promise<AccountingTxPageDto["items"]> {
  const out: AccountingTxPageDto["items"] = [];
  let url = `/finance/accounting/transactions?period=${period}&limit=5`;
  for (let i = 0; i < 50; i++) {
    const page = await p.ok<AccountingTxPageDto>("GET", url);
    out.push(...page.items);
    if (!page.next) break;
    url = `/finance/accounting/transactions?period=${period}&limit=5&before=${encodeURIComponent(page.next.before)}&beforeId=${page.next.beforeId}`;
  }
  return out;
}

/** Satıcı: 10 kg stok (maliyet 600 ₺) satılır; tahsilat 1.000, navlun 50, komisyon 10 → kasa +940, net kâr 340 */
async function sampleSale(seller: Founded, buyer: Founded, at: Date, key = `test-sale:${randomUUID()}`): Promise<{ saleId: string; txId: string; duplicate: boolean }> {
  await grantStock(h, seller.companyId, seller.cityId, "fodder", 2, 10, 600n * TL);
  return withTx(h.deps, async (tx) => {
    const cost = await removeStock(tx, { companyId: seller.companyId, cityId: seller.cityId, productId: "fodder", quality: 2 }, 10, { kind: "sale", at });
    expect(cost).toBe(600n * TL);
    const led = await post(tx, {
      kind: "spot_trade", idempotencyKey: key, at, memo: "Test satışı",
      lines: [
        { account: co(seller.companyId, "cogs"), amount: cost },
        { account: co(seller.companyId, "inventory"), amount: -cost },
        { account: co(seller.companyId, "cash"), amount: 940n * TL },
        { account: co(seller.companyId, "exp_fees"), amount: 10n * TL },
        { account: co(seller.companyId, "exp_freight"), amount: 50n * TL },
        { account: co(seller.companyId, "revenue_sales"), amount: -1000n * TL },
      ],
    });
    const [s] = await tx.insert(sales).values({
      sellerCompanyId: seller.companyId, buyerCompanyId: buyer.companyId, source: "spot", cityId: seller.cityId, productId: "fodder", quality: 2, qtyKg: 10,
      pricePerKg: 100n * TL, gross: 1000n * TL, cogs: cost, freight: 50n * TL, fees: 10n * TL, netProfit: 340n * TL, transactionIds: [led.id], createdAt: at,
    }).returning();
    return { saleId: s!.id, txId: led.id, duplicate: led.duplicate };
  });
}

function cashIdentity(a: AccountingDto) {
  const { opening, operating, investing, financing, net, closing } = a.cashflow;
  expect(BigInt(operating) + BigInt(investing) + BigInt(financing)).toBe(BigInt(net));
  expect(BigInt(opening) + BigInt(net)).toBe(BigInt(closing));
  expect(closing).toBe(a.cashNow); // gelecek tarihli kayıt yok: kapanış = şimdi
}

describe("Şirket Muhasebesi", () => {
  it("örnek satış 340 ₺ net kâr; 500 ₺ kredi kasayı artırır, kârı değiştirmez; işlem ikinci kez sayılmaz", async () => {
    const a = await found(h, "crop", "yesilova");
    const b = await found(h, "crop", "kavsak");
    const fresh = await acc(a.p);
    // yeni şirket: başlangıç sermayesi gelir değildir
    expect(fresh.summary.revenue).toBe("0");
    expect(fresh.summary.revenueByAccount).toEqual({});
    expect(fresh.hasActivity).toBe(false); // arayüz: "Henüz işlem yok"
    cashIdentity(fresh);

    const now = h.deps.clock.now();
    const sale = await sampleSale(a, b, now, "test-sale:fixed-1");
    const s1 = await acc(a.p);
    expect(BigInt(s1.summary.revenue)).toBe(1000n * TL);
    expect(s1.hasActivity).toBe(true);
    expect(s1.summary.revenueByAccount).toEqual({ revenue_sales: String(1000n * TL) });
    expect(s1.summary.expenseByAccount).toMatchObject({ cogs: String(600n * TL), exp_freight: String(50n * TL), exp_fees: String(10n * TL) });
    const saleExpense = 660n * TL;
    expect(BigInt(s1.summary.expense) - BigInt(fresh.summary.expense)).toBe(saleExpense);
    expect(BigInt(s1.summary.net) - BigInt(fresh.summary.net)).toBe(340n * TL);
    expect(BigInt(s1.cashNow) - BigInt(fresh.cashNow)).toBe(940n * TL);
    cashIdentity(s1);
    // günlük grafik dönem özetine eşit
    const dRev = s1.daily.reduce((x, d) => x + BigInt(d.revenue), 0n);
    const dExp = s1.daily.reduce((x, d) => x + BigInt(d.expense), 0n);
    expect(dRev).toBe(BigInt(s1.summary.revenue));
    expect(dExp).toBe(BigInt(s1.summary.expense));

    // satış ayrıntısı: tahsilat, maliyet, navlun, komisyon, kalan kâr ayrı
    const trace = await a.p.ok("GET", `/finance/sales/${sale.saleId}`);
    expect(trace.sale).toMatchObject({ gross: "100000", cogs: "60000", freight: "5000", fees: "1000", netProfit: "34000", viewerRole: "seller" });
    // işlem listesi satışa bağlanır
    const txs = await allTx(a.p);
    const saleTx = txs.find((t) => t.id === sale.txId)!;
    expect(saleTx).toMatchObject({ saleId: sale.saleId, cash: "94000", revenue: "100000", expense: "66000" });

    // aynı idempotency anahtarı: ikinci kayıt yazılmaz, toplamlar değişmez
    const dup = await withTx(h.deps, (tx) => post(tx, {
      kind: "spot_trade", idempotencyKey: "test-sale:fixed-1", at: now, memo: "tekrar",
      lines: [{ account: co(a.companyId, "cash"), amount: 940n * TL }, { account: co(a.companyId, "revenue_sales"), amount: -940n * TL }],
    }));
    expect(dup).toEqual({ id: sale.txId, duplicate: true });
    expect((await acc(a.p)).summary).toEqual(s1.summary);

    // 500 ₺ kredi (aynı istek iki kez): kasa +500, kâr 340 kalır, nakit akışı finansmanda
    const key = h.key();
    await a.p.ok("POST", "/finance/loans", { amount: Number(500n * TL), termDays: 7, idempotencyKey: key });
    await a.p.ok("POST", "/finance/loans", { amount: Number(500n * TL), termDays: 7, idempotencyKey: key });
    const s2 = await acc(a.p);
    expect(BigInt(s2.cashNow) - BigInt(s1.cashNow)).toBe(500n * TL);
    expect(s2.summary).toEqual(s1.summary);
    expect(BigInt(s2.cashflow.financing) - BigInt(s1.cashflow.financing)).toBe(500n * TL);
    cashIdentity(s2);
    expect((await allTx(a.p)).filter((t) => t.kind === "loan_disburse")).toHaveLength(1);

    // dönem filtreleri: satış bugünse üç dönemde de aynı
    for (const p of ["7d", "30d"]) {
      const x = await acc(a.p, p);
      expect(x.summary.revenue).toBe(s2.summary.revenue);
      expect(x.daily).toHaveLength(p === "7d" ? 7 : 30);
      cashIdentity(x);
    }
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("veri yalıtımı: diğer şirketin özeti, işlemleri ve satış maliyeti görünmez", async () => {
    const a = await found(h, "crop", "yesilova");
    const buyer = await found(h, "crop", "kavsak");
    const other = await found(h, "crop", "korfezkent");
    const otherBefore = await acc(other.p);
    const sale = await sampleSale(a, buyer, h.deps.clock.now());
    // üçüncü şirket: hiçbir şey değişmez
    expect(await acc(other.p)).toMatchObject({ summary: otherBefore.summary, cashNow: otherBefore.cashNow });
    expect((await allTx(other.p)).some((t) => t.id === sale.txId)).toBe(false);
    expect((await other.p.get(`/finance/sales/${sale.saleId}`)).status).toBe(404);
    // alıcı: satışı görür ama satıcının maliyeti, navlunu, komisyonu, kârı ve defter satırları gizli
    const bt = await buyer.p.ok("GET", `/finance/sales/${sale.saleId}`);
    expect(bt.sale).toMatchObject({ viewerRole: "buyer", cogs: "0", freight: "0", fees: "0", netProfit: "0", ledgerTransactionIds: [] });
    expect(bt.transactions).toEqual([]); // satıcının işlem kaydı ve notu da gizli
    expect((await buyer.p.get(`/finance/accounting/transactions?before=${encodeURIComponent(new Date().toISOString())}`)).status).toBe(400);
    // sorguda başka şirket kimliği verilemez; yanıtlar paylaşılan önbelleğe girmez
    const r = await h.app.inject({ method: "GET", url: `/finance/accounting?period=today&companyId=${a.companyId}`, headers: { cookie: other.p.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().summary).toEqual(otherBefore.summary);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect((await h.app.inject({ method: "GET", url: "/finance/accounting" })).statusCode).toBe(401);
    expect((await other.p.get("/finance/accounting?period=year")).status).toBe(400);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("dönem sınırı ve ters kayıt: kayıt kendi oyun gününe, ters kayıt yapıldığı güne düşer", async () => {
    const a = await found(h, "crop", "yesilova");
    const now = h.deps.clock.now();
    const today = gameDayStart(now);
    const fee = 77n * TL;
    // dün 23:59:59.999 (İstanbul): bugün dışında, 7 günde içinde
    const lastMs = new Date(today.getTime() - 1);
    const t1 = await withTx(h.deps, (tx) => post(tx, {
      kind: "test_income", idempotencyKey: `t:${randomUUID()}`, at: lastMs, memo: "dün",
      lines: [{ account: co(a.companyId, "cash"), amount: fee }, { account: co(a.companyId, "revenue_other"), amount: -fee }],
    }));
    // bugün 00:00:00.000: bugün içinde
    await withTx(h.deps, (tx) => post(tx, {
      kind: "test_income", idempotencyKey: `t:${randomUUID()}`, at: today, memo: "bugün",
      lines: [{ account: co(a.companyId, "cash"), amount: 2n * fee }, { account: co(a.companyId, "revenue_other"), amount: -2n * fee }],
    }));
    const d = await acc(a.p, "today");
    const w = await acc(a.p, "7d");
    expect(d.from).toBe(today.toISOString());
    expect(d.summary.revenueByAccount.revenue_other).toBe(String(2n * fee));
    expect(w.summary.revenueByAccount.revenue_other).toBe(String(3n * fee));
    expect(w.daily.at(-2)!.revenue).toBe(String(fee));
    expect(w.daily.at(-1)!.revenue).toBe(String(2n * fee));
    cashIdentity(d);
    cashIdentity(w);
    // dünkü kayıt bugünün açılış nakdinde
    expect(BigInt(d.cashflow.opening) - BigInt(w.cashflow.opening)).toBe(BigInt(w.cashflow.net) - BigInt(d.cashflow.net));

    // dünkü kaydı bugün ters çevir: dün değişmez, bugün −fee
    const rev = await withTx(h.deps, (tx) => reverse(tx, t1.id, h.deps.clock.now(), "düzeltme"));
    const rev2 = await withTx(h.deps, (tx) => reverse(tx, t1.id, h.deps.clock.now(), "düzeltme"));
    expect(rev2).toEqual({ id: rev.id, duplicate: true });
    const d2 = await acc(a.p, "today");
    const w2 = await acc(a.p, "7d");
    expect(d2.summary.revenueByAccount.revenue_other).toBe(String(fee));
    expect(w2.summary.revenueByAccount.revenue_other).toBe(String(2n * fee));
    expect(w2.daily.at(-2)!.revenue).toBe(String(fee));
    expect(BigInt(d2.cashNow)).toBe(BigInt(d.cashNow) - fee);
    cashIdentity(d2);
    cashIdentity(w2);
    const revTx = (await allTx(a.p)).find((t) => t.id === rev.id)!;
    expect(revTx).toMatchObject({ kind: "reversal", reversesId: t1.id, cash: String(-fee), revenue: String(-fee) });

    // 8 gün öncesi: 7 günde yok, 30 günde var
    const old = new Date(today.getTime() - 7 * 86_400_000 + 1000);
    await withTx(h.deps, (tx) => post(tx, {
      kind: "test_income", idempotencyKey: `t:${randomUUID()}`, at: old, memo: "eski",
      lines: [{ account: co(a.companyId, "cash"), amount: 5n * fee }, { account: co(a.companyId, "revenue_other"), amount: -5n * fee }],
    }));
    expect((await acc(a.p, "7d")).summary.revenueByAccount.revenue_other).toBe(String(2n * fee));
    const m30 = await acc(a.p, "30d");
    expect(m30.summary.revenueByAccount.revenue_other).toBe(String(7n * fee));
    cashIdentity(m30);
    cashIdentity(await acc(a.p, "7d"));
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("işlem geçmişi sayfaları çakışmaz ve dönem dışını içermez", async () => {
    const a = await found(h, "crop", "yesilova");
    const at = h.deps.clock.now();
    for (let n = 0; n < 12; n++) {
      // aynı anda birden çok işlem: imleç (zaman, kimlik) ile bölünmeden sayfalanır
      await withTx(h.deps, (tx) => post(tx, {
        kind: "test_income", idempotencyKey: `t:${randomUUID()}`, at, memo: `#${n}`,
        lines: [{ account: co(a.companyId, "cash"), amount: 100n }, { account: co(a.companyId, "revenue_other"), amount: -100n }],
      }));
    }
    const items = await allTx(a.p);
    expect(new Set(items.map((t) => t.id)).size).toBe(items.length);
    expect(items.filter((t) => t.kind === "test_income")).toHaveLength(12);
    expect(items.length).toBe((await acc(a.p)).txCount);
    const from = gameDayStart(at).getTime();
    expect(items.every((t) => new Date(t.at).getTime() >= from)).toBe(true);
    // her işlemin şirket içi satırları dengeli
    for (const t of items) expect(t.lines.reduce((x, l) => x + BigInt(l.amount), 0n)).toBe(0n);
  });
});
