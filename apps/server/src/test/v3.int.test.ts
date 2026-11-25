/**
 * v3 oynanabilirlik: teklif karşılaştırma, al + teslim ettir, tahmin ↔ gerçekleşen, sözleşme karşılaştırması,
 * taşıma panosu ekleri, üretim tahmini ve migration'dan sağ çıkma.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { applyBp, estimateOwnTrip, systemCarrierQuote, travelMinutes } from "@capitalforge/economy";
import { roadDistanceKm } from "@capitalforge/shared";
import { contracts, dealOutcomes, freightJobs, marketOrders } from "../db/schema";
import { createHarness, type Harness, type Player } from "./harness";
import { checkInvariants } from "./invariants";
import { bal, grantStock, holding, HOUR, withKey } from "./trade-helpers";
import { drainCash, grantCash } from "../production/kit";
import { found as foundWithFacility } from "../production/kit";
import { runMigrations } from "../db/migrate";
import { paceTrip, pickupMinutes } from "../catalog/pace";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const CITY_ORDER = ["yesilova", "kavsak", "korfezkent", "akyayla", "demirdag"];
/** şirket kur; istenen şehirde uygun arsa kalmadıysa diğer şehirlere bak */
async function found(hh: Harness, p: Player, sector: string, cityId: string): Promise<string> {
  for (const c of [cityId, ...CITY_ORDER.filter((x) => x !== cityId)]) {
    const ob = await p.ok("GET", `/world/onboarding?cityId=${c}&sector=${sector}`);
    const plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
    if (!plot) continue;
    const r = await p.ok("POST", "/company", { name: `Firma ${Math.random().toString(36).slice(2, 8)}`, cityId: c, sector, plotId: plot.id, idempotencyKey: hh.key() });
    return r.companyId as string;
  }
  throw new Error(`uygun arsa yok ${sector}/${cityId}`);
}

/** sistem taşımacısı: her kamyon dolusu parça ayrı tarifeyle (gerçek ayarlardan) */
const truck = () => h.deps.catalog.vehicleModel("truck");
const fq = (km: number, kg: number): bigint => {
  const f = h.deps.catalog.settings.freight;
  let total = 0n;
  for (let left = kg; left > 0; left -= truck().capacityKg) total += systemCarrierQuote(km, Math.min(left, truck().capacityKg), f.systemBaseFee, f.systemPerKm, truck().capacityKg);
  return total;
};
const etaFor = (km: number): number => {
  const f = h.deps.catalog.settings.freight;
  return pickupMinutes(h.deps.catalog) + paceTrip(h.deps.catalog, travelMinutes(km, truck().speedKmh) + (f.handlingMinutes ?? 0));
};
const cashOf = async (id: string) => bal(h, id, "cash");
const iso = (ms: number) => new Date(h.deps.clock.nowMs() + ms).toISOString();

async function listing(p: Player, cityId: string, qty: number, price: number, quality = 3): Promise<string> {
  return (await p.ok("POST", "/market/listings", withKey(h, { cityId, productId: "fodder", quality, qtyKg: qty, pricePerKg: price }))).id as string;
}
const offersUrl = (q: Record<string, string | number>) => `/market/offers?${Object.entries(q).map(([k, v]) => `${k}=${v}`).join("&")}`;

describe("GET /market/offers (alış): teslim maliyeti sırası", () => {
  it("uzaktaki ucuz ilan ile yakındaki pahalı ilan; miktar, hedef şehir ve tarife değişince sıra döner", async () => {
    const sup = await h.player(); const supId = await found(h, sup, "livestock", "akyayla");
    const buyer = await h.player(); const buyerId = await found(h, buyer, "crop", "yesilova");
    await grantStock(h, supId, "demirdag", "fodder", 3, 20_000, 1n);
    await grantStock(h, supId, "akyayla", "fodder", 3, 20_000, 1n);
    // fiyat farkı: 12.000 kg'da uzak ilan kazansın, 13.000 kg'da (iki kamyon) yakın ilan kazansın
    const lowA = Number(fq(210, 12_000) - fq(70, 12_000)) / 12_000;
    const highB = Number(fq(210, 13_000) - fq(70, 13_000)) / 13_000;
    const delta = Math.round((lowA + highB) / 2);
    expect(delta, "fiyat penceresi").toBeGreaterThan(lowA + 1);
    expect(delta).toBeLessThan(highB - 1);
    const far = await listing(sup, "demirdag", 15_000, 100);
    const near = await listing(sup, "akyayla", 15_000, 100 + delta);
    const rowsOf = (o: { rows: Array<{ orderId: string }> }) => o.rows.map((r) => r.orderId).filter((id) => id === far || id === near);

    // 12.000 kg = tek kamyon: uzak ilan navlunla bile ucuz
    const a = await buyer.ok("GET", offersUrl({ side: "buy", productId: "fodder", cityId: "yesilova", qtyKg: 12_000 }));
    expect(rowsOf(a)).toEqual([far, near]);
    const ra = a.rows.find((r: { orderId: string }) => r.orderId === far);
    const frFar = fq(roadDistanceKm("demirdag", "yesilova"), 12_000);
    expect(ra.freight).toBe(frFar.toString());
    expect(ra.goods).toBe("1200000");
    expect(ra.total).toBe((1_200_000n + frFar).toString());
    expect(ra.perKg).toBe(((1_200_000n + frFar + 11_999n) / 12_000n).toString());
    expect(ra.loads).toBe(1);
    expect(ra.etaMinutes).toBe(etaFor(210));
    expect(ra.notes).toEqual([]);
    // satırlar teslim birim maliyetine göre artan
    const pk = a.rows.map((r: { perKg: string }) => BigInt(r.perKg));
    expect(pk).toEqual([...pk].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    expect(a.bestOrderId).toBe(a.rows[0].orderId);

    // 13.000 kg: iki kamyon (SPLIT_LOADS) → navlun ikiye katlanır, yakın ilan öne geçer
    const b = await buyer.ok("GET", offersUrl({ side: "buy", productId: "fodder", cityId: "yesilova", qtyKg: 13_000 }));
    expect(rowsOf(b)).toEqual([near, far]);
    const rb = b.rows.find((r: { orderId: string }) => r.orderId === far);
    expect(rb.loads).toBe(2);
    expect(rb.notes).toContain("SPLIT_LOADS");
    expect(rb.freight).toBe(fq(210, 13_000).toString());

    // teslim şehri akyayla: yakın ilan aynı şehirde (navlun 0, süre 0)
    const c = await buyer.ok("GET", offersUrl({ side: "buy", productId: "fodder", cityId: "akyayla", qtyKg: 12_000 }));
    expect(rowsOf(c)).toEqual([near, far]);
    const rc = c.rows.find((r: { orderId: string }) => r.orderId === near);
    expect(rc.freight).toBe("0");
    expect(rc.etaMinutes).toBe(0);
    expect(rc.notes).toContain("SAME_CITY");
    expect(c.fastestOrderId).toBe(near);

    // kalandan fazlası istenirse PARTIAL (fillKg = kalan)
    const d = await buyer.ok("GET", offersUrl({ side: "buy", productId: "fodder", cityId: "yesilova", qtyKg: 16_000 }));
    const rd = d.rows.find((r: { orderId: string }) => r.orderId === near);
    expect(rd.fillKg).toBe(15_000);
    expect(rd.notes).toContain("PARTIAL");

    // sistem taşımacısı tarifesi değişirse (km başı ücret) sıra yeniden hesaplanır
    const prev = h.deps.catalog.settings;
    h.deps.catalog.settings = { ...prev, freight: { ...prev.freight, systemPerKm: h.deps.catalog.settings.freight.systemPerKm * 4 as never } };
    try {
      const e = await buyer.ok("GET", offersUrl({ side: "buy", productId: "fodder", cityId: "yesilova", qtyKg: 12_000 }));
      expect(rowsOf(e)).toEqual([near, far]);
    } finally { h.deps.catalog.settings = prev; }

    // kendi ilanım listede yok
    const mine = await sup.ok("GET", offersUrl({ side: "buy", productId: "fodder", cityId: "yesilova", qtyKg: 100 }));
    expect(mine.rows.some((r: { orderId: string }) => r.orderId === far || r.orderId === near)).toBe(false);
    void buyerId;
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("GET /market/offers (satış)", () => {
  it("net kg başı, komisyon, navlun, kâr ve notlar; stok yoksa NO_STOCK", async () => {
    const seller = await h.player(); const sellerId = await found(h, seller, "crop", "yesilova");
    const orderer = await h.player(); const ordererId = await found(h, orderer, "crop", "akyayla");
    await grantCash(h, ordererId, 5_000_000n);
    await grantStock(h, sellerId, "yesilova", "fodder", 3, 3000, 100n);
    const farOrder = (await orderer.ok("POST", "/market/orders", withKey(h, { cityId: "akyayla", productId: "fodder", minQuality: 2, qtyKg: 2000, maxPricePerKg: 400 }))).id as string;
    const sameOrder = (await orderer.ok("POST", "/market/orders", withKey(h, { cityId: "yesilova", productId: "fodder", minQuality: 2, qtyKg: 1000, maxPricePerKg: 280 }))).id as string;
    const highQ = (await orderer.ok("POST", "/market/orders", withKey(h, { cityId: "yesilova", productId: "fodder", minQuality: 5, qtyKg: 1000, maxPricePerKg: 900 }))).id as string;

    const o = await seller.ok("GET", offersUrl({ side: "sell", productId: "fodder", cityId: "yesilova", qtyKg: 1500 }));
    expect(o.fromCityId).toBe("yesilova");
    expect(o.stockKg).toBe(3000);
    expect(o.avgCostPerKg).toBe("100");
    const far = o.rows.find((r: { orderId: string }) => r.orderId === farOrder);
    const fr = fq(70, 1500);
    const goods = 1500n * 400n;
    const fee = applyBp(goods, 100);
    expect(far.fillKg).toBe(1500);
    expect(far.goods).toBe(goods.toString());
    expect(far.fee).toBe(fee.toString());
    expect(far.freight).toBe(fr.toString());
    expect(far.total).toBe((goods - fee - fr).toString());
    expect(far.perKg).toBe(((goods - fee - fr) / 1500n).toString());
    expect(far.profit).toBe((goods - fee - fr - 150_000n).toString());
    expect(far.etaMinutes).toBe(etaFor(70));
    expect(far.quality).toBe(3);

    const same = o.rows.find((r: { orderId: string }) => r.orderId === sameOrder);
    expect(same.fillKg).toBe(1000);
    expect(same.notes).toEqual(expect.arrayContaining(["PARTIAL", "SAME_CITY"]));
    expect(same.freight).toBe("0");
    expect(same.etaMinutes).toBe(0);

    const hq = o.rows.find((r: { orderId: string }) => r.orderId === highQ);
    expect(hq.notes).toContain("NO_STOCK");
    expect(hq.profit).toBeNull();
    // stoksuz satırlar sonda; en iyi satır stoklu satırların en yüksek net değeri
    const idxHq = o.rows.findIndex((r: { orderId: string }) => r.orderId === highQ);
    expect(o.rows.slice(idxHq).every((r: { notes: string[] }) => r.notes.includes("NO_STOCK"))).toBe(true);
    const sellable = o.rows.filter((r: { notes: string[] }) => !r.notes.includes("NO_STOCK"));
    const pks = sellable.map((r: { perKg: string }) => BigInt(r.perKg));
    expect(pks).toEqual([...pks].sort((x, y) => (x > y ? -1 : x < y ? 1 : 0)));
    expect(o.bestOrderId).toBe(sellable[0].orderId);
    expect(o.fastestOrderId).toBe(sellable.reduce((a: { etaMinutes: number; orderId: string }, r: { etaMinutes: number; orderId: string }) => (r.etaMinutes < a.etaMinutes ? r : a)).orderId);

    // fiyat = sellToOrder ile aynı: önerilen fiyatla satış reddedilmez
    const ok = await seller.ok("POST", `/market/orders/${sameOrder}/sell`, withKey(h, { qtyKg: 1000, quality: 3, expectedPricePerKg: Number(same.pricePerKg) }));
    expect(BigInt(ok.gross)).toBe(BigInt(same.goods));
    expect(BigInt(ok.fee)).toBe(BigInt(same.fee));

    // satış tahmin kaydı: beklenen = kararın anındaki rakamlar, gerçekleşen = satış satırı
    const outs = await seller.ok("GET", "/finance/outcomes");
    const sale = outs.find((x: { kind: string; refType: string }) => x.kind === "sale");
    expect(sale.status).toBe("settled");
    expect(sale.expected.revenue).toBe(same.goods);
    expect(sale.actual.revenue).toBe(same.goods);
    expect(sale.actual.cost).toBe("100000");
    expect(sale.actual.profit).toBe((BigInt(same.goods) - BigInt(same.fee) - 100_000n).toString());
    expect(sale.saleIds).toEqual([ok.saleId]);
    expect(sale.ledgerTransactionIds.length).toBeGreaterThan(0);

    // stok olmayan oyuncu: NO_STOCK, fromCityId sorgudaki şehir sayılmaz (null)
    const nobody = await h.player(); await found(h, nobody, "crop", "kavsak");
    const n = await nobody.ok("GET", offersUrl({ side: "sell", productId: "fodder", cityId: "kavsak", qtyKg: 500 }));
    expect(n.fromCityId).toBeNull();
    expect(n.rows.length).toBeGreaterThan(0);
    expect(n.rows.every((r: { notes: string[] }) => r.notes.includes("NO_STOCK"))).toBe(true);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("POST /market/listings/:id/buy + deliverToCityId", () => {
  it("alım + taşıma işi tek işlemde; nakit = mal + navlun emaneti; varışta maliyet = mal + navlun; tahmin ↔ gerçekleşen defterle uyumlu", async () => {
    const sup = await h.player(); const supId = await found(h, sup, "livestock", "akyayla");
    const buyer = await h.player(); const buyerId = await found(h, buyer, "crop", "yesilova");
    await grantCash(h, buyerId, 10_000_000n);
    await grantStock(h, supId, "demirdag", "fodder", 3, 20_000, 1n);
    const lid = await listing(sup, "demirdag", 20_000, 100);
    const cash0 = await cashOf(buyerId);
    const km = roadDistanceKm("demirdag", "yesilova");
    const freight = fq(km, 5000);
    const key = h.key();
    const res = await buyer.ok("POST", `/market/listings/${lid}/buy`, { qtyKg: 5000, expectedPricePerKg: 100, deliverToCityId: "yesilova", idempotencyKey: key });
    expect(res.gross).toBe("500000");
    expect(res.fee).toBe("5000");
    expect(res.freightPay).toBe(freight.toString());
    expect(res.freightJobId).toBeTruthy();
    expect(res.outcomeId).toBeTruthy();
    expect(await cashOf(buyerId)).toBe(cash0 - 500_000n - freight);
    expect(await bal(h, buyerId, "escrow")).toBe(freight);
    const [job] = await h.deps.db.select().from(freightJobs).where(eq(freightJobs.id, res.freightJobId));
    expect(job!.status).toBe("open");
    expect(job!.allowSystemCarrier).toBe(true);
    expect(job!.payAmount).toBe(freight);
    expect(job!.originCityId).toBe("demirdag");
    expect(job!.destCityId).toBe("yesilova");
    expect(job!.deadlineAt.getTime() - job!.createdAt.getTime()).toBe(24 * HOUR);
    expect((await holding(h, buyerId, "demirdag", "fodder", 3)).reserved).toBe(5000);

    // tekrar (aynı anahtar): aynı yanıt, ikinci alım yok
    const rep = await buyer.post(`/market/listings/${lid}/buy`, { qtyKg: 5000, expectedPricePerKg: 100, deliverToCityId: "yesilova", idempotencyKey: key });
    expect(rep.status).toBe(200);
    expect(rep.body).toEqual(res);
    expect(await cashOf(buyerId)).toBe(cash0 - 500_000n - freight);

    // varış: sistem taşımacısı 2 saat sonra üstlenir, yol ~3,2 saat
    const pending = (await buyer.ok("GET", "/finance/outcomes")).find((x: { id: string }) => x.id === res.outcomeId);
    expect(pending.status).toBe("pending");
    expect(pending.actual).toBeNull();
    expect(pending.expected.goods).toBe("500000");
    expect(pending.expected.freight).toBe(freight.toString());
    await h.advance(8 * HOUR);

    const hd = await holding(h, buyerId, "yesilova", "fodder", 3);
    expect(hd.qty).toBe(5000);
    expect(hd.cost).toBe(500_000n + freight);
    expect(await bal(h, buyerId, "escrow")).toBe(0n);
    expect((await holding(h, buyerId, "demirdag", "fodder", 3)).qty).toBe(0);

    const outs = await buyer.ok("GET", "/finance/outcomes");
    const o = outs.find((x: { id: string }) => x.id === res.outcomeId);
    expect(o.kind).toBe("purchase");
    expect(o.status).toBe("settled");
    expect(o.actual.goods).toBe("500000");
    expect(o.actual.freight).toBe(freight.toString());
    expect(o.actual.cost).toBe((500_000n + freight).toString());
    expect(o.actual.minutes).toBeGreaterThanOrEqual(pickupMinutes(h.deps.catalog));
    expect(o.expected.cost).toBe(o.actual.cost);
    expect(o.saleIds).toEqual([res.saleId]);
    // gerçekleşen maliyet = ilgili defter işlemlerinin envanter hesabına net etkisi
    const ids = o.ledgerTransactionIds as string[];
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const r = (await h.deps.db.execute(sql`
      SELECT coalesce(sum(e.amount),0)::text s FROM cf.ledger_entries e JOIN cf.ledger_accounts a ON a.id = e.account_id
      WHERE a.company_id = ${buyerId} AND a.code = 'inventory' AND e.transaction_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as Array<{ s: string }>;
    expect(r[0]!.s).toBe(o.actual.cost);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("nakit mal + navluna yetmiyorsa hiçbir şey yazılmaz; aynı şehir teslimi iş açmaz; büyük alım kamyon dolusu işlere bölünür", async () => {
    const sup = await h.player(); const supId = await found(h, sup, "livestock", "akyayla");
    const poor = await h.player(); const poorId = await found(h, poor, "crop", "yesilova");
    await grantStock(h, supId, "demirdag", "fodder", 3, 30_000, 1n);
    const lid = await listing(sup, "demirdag", 30_000, 100);
    const freight = fq(210, 5000);
    await drainCash(h, poorId);
    await grantCash(h, poorId, 500_000n + freight - 1n); // 1 kuruş eksik
    const before = { cash: await cashOf(poorId), jobs: (await h.deps.db.select().from(freightJobs).where(eq(freightJobs.shipperCompanyId, poorId))).length };
    const r = await poor.post(`/market/listings/${lid}/buy`, withKey(h, { qtyKg: 5000, expectedPricePerKg: 100, deliverToCityId: "yesilova" }));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(await cashOf(poorId)).toBe(before.cash);
    expect((await holding(h, poorId, "demirdag", "fodder", 3)).qty).toBe(0);
    const [ord] = await h.deps.db.select().from(marketOrders).where(eq(marketOrders.id, lid));
    expect(ord!.remainingKg).toBe(30_000);
    expect((await h.deps.db.select().from(dealOutcomes).where(eq(dealOutcomes.companyId, poorId))).length).toBe(0);

    // aynı şehir: iş yok, yalnızca alım
    await grantCash(h, poorId, 10_000_000n);
    const same = await poor.ok("POST", `/market/listings/${lid}/buy`, withKey(h, { qtyKg: 1000, expectedPricePerKg: 100, deliverToCityId: "demirdag" }));
    expect(same.freightJobId).toBeNull();
    expect(same.freightPay).toBeNull();
    expect(same.arrivesBy).toBeNull();
    expect((await holding(h, poorId, "demirdag", "fodder", 3)).qty).toBe(1000);

    // 20.000 kg → kamyon başına bir iş (12.000 + 8.000), toplam ücret = sistem tarifesi
    const big = await poor.ok("POST", `/market/listings/${lid}/buy`, withKey(h, { qtyKg: 20_000, expectedPricePerKg: 100, deliverToCityId: "yesilova" }));
    expect(big.freightPay).toBe(fq(210, 20_000).toString());
    const jobs = await h.deps.db.select().from(freightJobs).where(and(eq(freightJobs.shipperCompanyId, poorId), eq(freightJobs.status, "open")));
    expect(jobs.map((j) => j.totalKg).sort((a, b) => a - b)).toEqual([8000, 12_000]);
    expect(jobs.reduce((a, j) => a + j.payAmount, 0n)).toBe(fq(210, 20_000));
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("GET /contracts/:id/compare ve kabulde tahmin kaydı", () => {
  it("satıcı: sözleşme ↔ bugün spot; alıcı: maliyet; herkese açık teklif karşı taraf rolünde", async () => {
    const seller = await h.player(); const sellerId = await found(h, seller, "crop", "yesilova");
    const buyer = await h.player(); const buyerId = await found(h, buyer, "crop", "yesilova");
    const orderer = await h.player(); const ordererId = await found(h, orderer, "crop", "yesilova");
    const stranger = await h.player(); await found(h, stranger, "crop", "korfezkent");
    await grantCash(h, buyerId, 5_000_000n);
    await grantCash(h, sellerId, 1_000_000n);
    await grantCash(h, ordererId, 5_000_000n);
    await grantStock(h, sellerId, "kavsak", "fodder", 3, 6000, 100n);
    await orderer.ok("POST", "/market/orders", withKey(h, { cityId: "yesilova", productId: "fodder", minQuality: 2, qtyKg: 6000, maxPricePerKg: 350 }));

    const prop = await seller.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: buyerId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 2000, pricePerKg: 300,
      deliveryCityId: "yesilova", freightPayer: "seller", installments: 3, firstDueAt: iso(10 * HOUR), intervalHours: 6, graceHours: 2, penaltyBp: 1000,
    }));
    const frPer = fq(roadDistanceKm("kavsak", "yesilova"), 2000);
    const c = await seller.ok("GET", `/contracts/${prop.id}/compare`);
    expect(c.myRole).toBe("seller");
    expect(c.perInstallment).toEqual({ qtyKg: 2000, goods: "600000", freight: frPer.toString(), fees: "0", net: (600_000n - frPer).toString(), perKg: ((600_000n - frPer) / 2000n).toString() });
    expect(c.total.qtyKg).toBe(6000);
    expect(c.total.goods).toBe("1800000");
    expect(c.total.freight).toBe((frPer * 3n).toString());
    expect(c.total.net).toBe((1_800_000n - frPer * 3n).toString());
    expect(c.schedule.installments).toBe(3);
    expect(new Date(c.schedule.lastDueAt).getTime() - new Date(c.schedule.firstDueAt).getTime()).toBe(12 * HOUR);
    expect(c.commitment).toEqual({ sellerDeposit: "180000", buyerEscrow: "1800000", penaltyPerMissed: "60000" });
    expect(c.myStockKg).toBe(6000);
    expect(c.avgCostPerKg).toBe("100");
    // spot: teslim şehrindeki emir 350, 6000 kg; navlun kavsak → yesilova (6000 kg = 1 kamyon)
    const spotGoods = 6000n * 350n;
    const spotNet = spotGoods - applyBp(spotGoods, 100) - fq(90, 6000);
    expect(c.spotNow.cityId).toBe("yesilova");
    expect(c.spotNow.fillKg).toBe(6000);
    expect(c.spotNow.net).toBe(spotNet.toString());
    expect(c.spotNow.perKg).toBe((spotNet / 6000n).toString());

    const cb = await buyer.ok("GET", `/contracts/${prop.id}/compare`);
    expect(cb.myRole).toBe("buyer");
    expect(cb.perInstallment.net).toBe("600000");
    expect(cb.spotNow === null || cb.spotNow.fillKg > 0).toBe(true); // alıcı için: en ucuz ilan (qa eklemesi)
    expect(cb.myStockKg).toBe(0);

    // taraf olmayan kapalı teklifi göremez; açık teklifte karşı taraf rolü
    expect((await stranger.get(`/contracts/${prop.id}/compare`)).body.error.code).toBe("NOT_PARTY");
    const pub = await seller.ok("POST", "/contracts", withKey(h, {
      role: "seller", productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 1000, pricePerKg: 280,
      deliveryCityId: "kavsak", freightPayer: "seller", installments: 2, firstDueAt: iso(10 * HOUR), intervalHours: 6, graceHours: 2, penaltyBp: 1000,
    }));
    const cp = await stranger.ok("GET", `/contracts/${pub.id}/compare`);
    expect(cp.myRole).toBe("buyer");
    expect(cp.total.goods).toBe("560000");

    // kabul: iki tarafa beklenen rakamlar
    await buyer.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const so = (await seller.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(so.status).toBe("pending");
    expect(so.expected.qtyKg).toBe(6000);
    expect(so.expected.revenue).toBe("1800000");
    expect(so.expected.freight).toBe((frPer * 3n).toString());
    expect(so.expected.cost).toBe("600000");
    expect(so.expected.profit).toBe((1_800_000n - frPer * 3n - 600_000n).toString());
    const bo = (await buyer.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(bo.expected.goods).toBe("1800000");
    // kabulden sonra karşılaştırma dondurulmuş teminatla aynı
    const after = await seller.ok("GET", `/contracts/${prop.id}/compare`);
    expect(after.commitment.sellerDeposit).toBe("180000");

    // teslim: üç taksit teslim şehrindeki stoktan elle; gerçekleşen = satış satırları
    await grantStock(h, sellerId, "yesilova", "fodder", 3, 6000, 100n);
    await h.advance(9 * HOUR);
    for (let k = 0; k < 3; k++) {
      const det = await seller.ok("GET", `/contracts/${prop.id}`);
      await seller.ok("POST", `/contracts/installments/${det.schedule[k].id}/deliver`, withKey(h, { qtyKg: 2000, quality: 3 }));
      if (k < 2) await h.advance(6 * HOUR);
    }
    const so2 = (await seller.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(so2.status).toBe("settled");
    expect(so2.actual.qtyKg).toBe(6000);
    expect(so2.actual.revenue).toBe("1800000");
    expect(so2.actual.cost).toBe("600000");
    expect(so2.actual.freight).toBe("0");
    expect(so2.actual.profit).toBe("1200000");
    expect(so2.saleIds.length).toBe(3);
    const bo2 = (await buyer.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(bo2.status).toBe("settled");
    expect(bo2.actual.goods).toBe("1800000");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("FreightJobDto: bağlı kalma süresi ve saat başı net", () => {
  it("boş araç konumundan kalkış şehrine boş gidiş + yükleme + yol; en iyi araç seçilir", async () => {
    const shipper = await h.player(); const shipperId = await found(h, shipper, "crop", "kavsak");
    const carrier = await h.player(); const carrierId = await found(h, carrier, "freight", "akyayla");
    await grantStock(h, shipperId, "kavsak", "fodder", 3, 2000, 1000n);
    await grantStock(h, shipperId, "akyayla", "fodder", 3, 2000, 1000n);
    const far = await shipper.ok("POST", "/freight-jobs", withKey(h, {
      originCityId: "kavsak", destCityId: "yesilova", cargo: [{ productId: "fodder", quality: 3, qtyKg: 1000 }], payAmount: 400_000, deadlineHours: 24, allowSystemCarrier: false,
    }));
    const local = await shipper.ok("POST", "/freight-jobs", withKey(h, {
      originCityId: "akyayla", destCityId: "yesilova", cargo: [{ productId: "fodder", quality: 3, qtyKg: 1000 }], payAmount: 400_000, deadlineHours: 24, allowSystemCarrier: false,
    }));
    const fleet = await carrier.ok("GET", "/fleet");
    expect(fleet[0].cityId).toBe("akyayla");
    const board = await carrier.ok("GET", "/freight-jobs?scope=board");
    const cat = h.deps.catalog;
    const van = cat.vehicleModel(fleet[0].modelId);
    const veh = { capacityKg: van.capacityKg, speedKmh: van.speedKmh, fuelPerKm: BigInt(van.fuelPerKm) };
    const fr = cat.settings.freight;
    const expectFor = (origin: string, dest: string) => {
      const repo = estimateOwnTrip(roadDistanceKm("akyayla", origin), veh, BigInt(cat.city("akyayla").wage), { loadingHours: 0 });
      const trip = estimateOwnTrip(roadDistanceKm(origin, dest), veh, BigInt(cat.city(origin).wage), { loadingHours: fr.driverHoursPerTrip, handlingMinutes: fr.handlingMinutes });
      const minutes = paceTrip(cat, repo.minutes + trip.minutes);
      return { minutes, nph: ((400_000n - repo.total - trip.total) * 60n) / BigInt(minutes) };
    };
    const jf = board.find((j: { id: string }) => j.id === far.id);
    const jl = board.find((j: { id: string }) => j.id === local.id);
    const ef = expectFor("kavsak", "yesilova"), el = expectFor("akyayla", "yesilova");
    expect(jf.bestVehicleIdForMe).toBe(fleet[0].id);
    expect(jf.estMinutesForMe).toBe(ef.minutes);
    expect(jf.netPerHourForMe).toBe(ef.nph.toString());
    expect(jl.estMinutesForMe).toBe(el.minutes);
    expect(jl.netPerHourForMe).toBe(el.nph.toString());
    // araç zaten kalkış şehrindeyse boş gidiş yok → daha kısa ve saat başı daha iyi
    expect(jl.estMinutesForMe).toBeLessThan(jf.estMinutesForMe);
    expect(BigInt(jl.netPerHourForMe)).toBeGreaterThan(BigInt(jf.netPerHourForMe));
    // kendi ilanımda ve taşıyıcı olmayan görünümde alan yok
    const mine = await shipper.ok("GET", "/freight-jobs?scope=mine");
    expect(mine.every((j: { estMinutesForMe: number | null; bestVehicleIdForMe: string | null }) => j.estMinutesForMe === null && j.bestVehicleIdForMe === null)).toBe(true);

    // kabul: taşıyıcı beklenen rakamları, varışta gerçekleşen ile eşleşir
    await carrier.ok("POST", `/freight-jobs/${local.id}/accept`, withKey(h, { vehicleId: fleet[0].id }));
    const pend = (await carrier.ok("GET", "/finance/outcomes")).find((x: { kind: string }) => x.kind === "freight_job");
    expect(pend.status).toBe("pending");
    expect(pend.expected.revenue).toBe("400000");
    await h.advance(6 * HOUR);
    const done = (await carrier.ok("GET", "/finance/outcomes")).find((x: { kind: string }) => x.kind === "freight_job");
    expect(done.status).toBe("settled");
    expect(done.actual.revenue).toBe("400000");
    expect(done.actual.fees).toBe(applyBp(400_000n, 100).toString());
    expect(done.actual.cost).toBe(done.expected.cost);
    expect(done.actual.profit).toBe(done.expected.profit);
    expect(done.actual.minutes).toBe(done.expected.minutes);
    void carrierId;
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("üretim tahmini ve tahmin ↔ gerçekleşen", () => {
  it("quote.estimate: aynı şehirdeki en iyi alım emri; başlatınca beklenen kayıt, bitince gerçekleşen maliyet", async () => {
    const f = await foundWithFacility(h, "crop", "yesilova");
    const orderer = await h.player(); const ordererId = await found(h, orderer, "crop", "yesilova");
    const q0 = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 });
    expect(q0.estimate).not.toBeNull();
    const fee0 = applyBp(BigInt(q0.estimate.revenue), 100);
    expect(q0.estimate.fee).toBe(fee0.toString());
    expect(BigInt(q0.estimate.profit)).toBe(BigInt(q0.estimate.revenue) - fee0 - BigInt(q0.cost.total));
    expect(q0.estimate.profitPerHour).toBe(((BigInt(q0.estimate.profit) * 60n) / BigInt(q0.minutes)).toString());

    // yüksek fiyatlı yerel alım emri öne geçer
    await grantCash(h, ordererId, 5_000_000n);
    await orderer.ok("POST", "/market/orders", withKey(h, { cityId: f.cityId, productId: "fodder", minQuality: 1, qtyKg: 100, maxPricePerKg: 9999 }));
    const q = await f.p.ok("POST", "/production/quote", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1 });
    expect(q.estimate.pricePerKg).toBe("9999");
    expect(q.estimate.cityId).toBe(f.cityId);
    expect(q.estimate.revenue).toBe((BigInt(q.output.qtyKg) * 9999n).toString());

    const job = await f.p.ok("POST", "/production/start", { facilityId: f.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: h.key() });
    const p1 = (await f.p.ok("GET", "/finance/outcomes")).find((x: { refId: string }) => x.refId === job.id);
    expect(p1.kind).toBe("production");
    expect(p1.status).toBe("pending");
    expect(p1.recipeId).toBe("grow_fodder");
    expect(p1.expected.qtyKg).toBe(q.output.qtyKg);
    expect(p1.expected.cost).toBe(q.cost.total);
    expect(p1.expected.minutes).toBe(q.minutes);
    expect(p1.expected.revenue).toBe(q.estimate.revenue);
    expect(p1.expected.profit).toBe(q.estimate.profit);
    await h.advance(q.minutes * 60_000 + HOUR);
    const p2 = (await f.p.ok("GET", "/finance/outcomes")).find((x: { refId: string }) => x.refId === job.id);
    expect(p2.status).toBe("settled");
    expect(p2.actual.qtyKg).toBe(job.output.qtyKg);
    expect(p2.actual.cost).toBe(job.cost.total);
    expect(p2.actual.minutes).toBe(q.minutes);
    expect(p2.ledgerTransactionIds.length).toBe(2);
    // tahmin kaydı tek: aynı işin tekrar yazılması engellenir
    expect((await h.deps.db.select().from(dealOutcomes).where(and(eq(dealOutcomes.refId, job.id), eq(dealOutcomes.kind, "production")))).length).toBe(1);
    // sayfalama: imleç ile bir sonraki sayfa boş/eski kayıtlar
    const page = await f.p.ok("GET", `/finance/outcomes?before=${encodeURIComponent(p2.createdAt)}`);
    expect(page.some((x: { id: string }) => x.id === p2.id)).toBe(false);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("tempo kuralı (settings.pace.maxMinutes = 60)", () => {
  it("üretim, inşaat, araştırma ve sevkiyat süreleri 60 dk'yı aşmaz; /world tempolu değer ve ölçek verir", async () => {
    const w = await (await h.player()).ok("GET", "/world");
    expect(w.pace.maxMinutes).toBe(60);
    expect(w.pace.travelScaleBp).toBeGreaterThan(0);
    expect(w.pace.travelScaleBp).toBeLessThan(10000);
    expect(Math.max(...w.recipes.map((r: { minutes: number }) => r.minutes))).toBeLessThanOrEqual(60);
    expect(Math.max(...w.buildingTypes.map((b: { buildMinutes: number }) => b.buildMinutes))).toBeLessThanOrEqual(60);
    expect(Math.max(...w.research.map((r: { baseMinutes: number }) => r.baseMinutes))).toBeLessThanOrEqual(60);
    // en uzun yol, en yavaş araç: tempolu sefer ≤ 60
    const cat = h.deps.catalog;
    const slowest = Math.min(...[...cat.vehicleModels.values()].map((v) => v.speedKmh));
    expect(paceTrip(cat, travelMinutes(250, slowest) + (cat.settings.freight.handlingMinutes ?? 0))).toBeLessThanOrEqual(60);
    // kısa ve uzun yol hâlâ farklı
    expect(paceTrip(cat, travelMinutes(70, 65) + 40)).toBeLessThan(paceTrip(cat, travelMinutes(250, 65) + 40));
    // kayıtlı işler
    const rows = (await h.deps.db.execute(sql`
      SELECT (SELECT coalesce(max(extract(epoch from ends_at - started_at)/60),0) FROM cf.production_jobs) prod,
             (SELECT coalesce(max(extract(epoch from arrives_at - departed_at)/60),0) FROM cf.shipments) ship,
             (SELECT coalesce(max(extract(epoch from construction_ends_at - created_at)/60),0) FROM cf.facilities WHERE construction_ends_at IS NOT NULL) build`)) as unknown as Array<{ prod: string; ship: string; build: string }>;
    expect(Number(rows[0]!.prod)).toBeLessThanOrEqual(60);
    expect(Number(rows[0]!.ship)).toBeLessThanOrEqual(60);
    expect(Number(rows[0]!.build)).toBeLessThanOrEqual(60);
  });
});

describe("migration 0003: canlı veriden sağ çıkma", () => {
  it("geri alma + iki kez yeniden migration: şirket, defter ve yoldaki sözleşme korunur", async () => {
    const url = process.env.DATABASE_URL ?? "postgres://capitalforge:capitalforge@localhost:5432/capitalforge_test";
    const count = async (t: string) => ((await h.deps.db.execute(sql.raw(`SELECT count(*)::int c FROM cf.${t}`))) as unknown as Array<{ c: number }>)[0]!.c;
    const cs = await h.player(); const csId = await found(h, cs, "crop", "yesilova");
    const cb = await h.player(); const cbId = await found(h, cb, "crop", "yesilova");
    await grantCash(h, cbId, 2_000_000n);
    await grantCash(h, csId, 500_000n);
    await grantStock(h, csId, "yesilova", "fodder", 3, 1000, 100_000n);
    const prop = await cs.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: cbId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 500, pricePerKg: 300,
      deliveryCityId: "yesilova", freightPayer: "seller", installments: 2, firstDueAt: iso(48 * HOUR), intervalHours: 24, graceHours: 2, penaltyBp: 1000,
    }));
    await cb.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const [active] = await h.deps.db.select().from(contracts).where(eq(contracts.id, prop.id));
    expect(active!.status).toBe("active");
    const outBefore = await count("deal_outcomes");
    expect(outBefore).toBeGreaterThan(0);
    const before2 = { companies: await count("companies"), entries: await count("ledger_entries"), contracts: await count("contracts"), inst: await count("contract_installments") };

    // geri alma betiği (yalnızca tahmin tablosu gider)
    const down = readFileSync(new URL("../../drizzle/down/0003_v3_deal_outcomes.sql", import.meta.url), "utf8");
    for (const stmt of down.replace(/^--.*$/gm, "").split(";").map((x) => x.trim()).filter(Boolean)) await h.deps.db.execute(sql.raw(stmt));
    const gone = (await h.deps.db.execute(sql`SELECT to_regclass('cf.deal_outcomes')::text t`)) as unknown as Array<{ t: string | null }>;
    expect(gone[0]!.t).toBeNull();

    await runMigrations(url);
    await runMigrations(url); // ikinci çalıştırma: idempotent
    const back = (await h.deps.db.execute(sql`SELECT to_regclass('cf.deal_outcomes')::text t`)) as unknown as Array<{ t: string | null }>;
    expect(back[0]!.t).toBe("cf.deal_outcomes");
    expect({ companies: await count("companies"), entries: await count("ledger_entries"), contracts: await count("contracts"), inst: await count("contract_installments") }).toEqual(before2);
    const [still] = await h.deps.db.select().from(contracts).where(eq(contracts.id, active!.id));
    expect(still!.status).toBe("active");
    expect(still!.terms).toEqual(active!.terms);
    expect(await checkInvariants(h.deps.db)).toEqual([]);

    // tahmin kayıtları geri almada silinir, yoldaki sözleşme yine okunur
    expect(await count("deal_outcomes")).toBe(0);
    const det = await cs.ok("GET", `/contracts/${prop.id}`);
    expect(det.contract.status).toBe("active");
    expect((await cs.ok("GET", `/contracts/${prop.id}/compare`)).myRole).toBe("seller");
    // tablo yeniden yazılabilir
    await cb.ok("POST", "/market/orders", withKey(h, { cityId: "yesilova", productId: "fodder", minQuality: 1, qtyKg: 10, maxPricePerKg: 100 }));
  });
});
