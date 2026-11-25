import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { SYSTEM_PROFILES } from "@capitalforge/shared";
import { systemAsk } from "@capitalforge/economy";
import { companies, contractDeliveries, contractInstallments, marketOrders, priceRefs, sales, shipments, systemDaily, trades } from "../db/schema";
import { createHarness, type Harness } from "./harness";
import { checkInvariants } from "./invariants";
import { bal, found, grantStock, holding, HOUR, withKey } from "./trade-helpers";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const iso = (ms: number) => new Date(h.deps.clock.nowMs() + ms).toISOString();

describe("kabul senaryosu: ortalama maliyet, navlun, net kâr", () => {
  it("100@10 + 200@13 → ort. 12; 50@16 sözleşme teslimi, navlun 50 → net kâr 150, 250 kalır", async () => {
    const sup = await h.player(); const supId = await found(h, sup, "livestock", "akyayla");
    const seller = await h.player(); const sellerId = await found(h, seller, "livestock", "akyayla");
    const buyer = await h.player(); const buyerId = await found(h, buyer, "crop", "yesilova");
    const carrier = await h.player(); const carrierId = await found(h, carrier, "freight", "akyayla");
    await grantStock(h, supId, "akyayla", "fodder", 3, 300, 1n);
    const l1 = await sup.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 3, qtyKg: 100, pricePerKg: 10 }));
    const l2 = await sup.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 3, qtyKg: 200, pricePerKg: 13 }));
    await seller.ok("POST", `/market/listings/${l1.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: 10 }));
    await seller.ok("POST", `/market/listings/${l2.id}/buy`, withKey(h, { qtyKg: 200, expectedPricePerKg: 13 }));
    const hd = await holding(h, sellerId, "akyayla", "fodder", 3);
    expect(hd.qty).toBe(300);
    expect(hd.cost).toBe(3600n); // ortalama 12

    const prop = await seller.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: buyerId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 50, pricePerKg: 16,
      deliveryCityId: "kavsak", freightPayer: "seller", installments: 1, firstDueAt: iso(6 * HOUR), graceHours: 2, penaltyBp: 1000,
    }));
    await buyer.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const det = await seller.ok("GET", `/contracts/${prop.id}`);
    expect(det.contract.status).toBe("active");
    const instId = det.schedule[0].id;
    const job = await seller.ok("POST", "/freight-jobs", withKey(h, {
      originCityId: "akyayla", destCityId: "kavsak", cargo: [{ productId: "fodder", quality: 3, qtyKg: 50 }], contractInstallmentId: instId,
      payAmount: 50, deadlineHours: 24, allowSystemCarrier: false,
    }));
    const fleet = await carrier.ok("GET", "/fleet");
    expect(fleet[0].cityId).toBe("akyayla");
    await carrier.ok("POST", `/freight-jobs/${job.id}/accept`, withKey(h, { vehicleId: fleet[0].id }));
    await h.advance(3 * HOUR);

    const sale = (await h.deps.db.select().from(sales).where(eq(sales.contractId, prop.id)))[0]!;
    expect(sale.gross).toBe(800n);
    expect(sale.cogs).toBe(600n);
    expect(sale.freight).toBe(50n);
    expect(sale.netProfit).toBe(150n);
    expect((await holding(h, sellerId, "akyayla", "fodder", 3)).qty).toBe(250);
    expect((await holding(h, buyerId, "kavsak", "fodder", 3)).qty).toBe(50);
    const sh = (await h.deps.db.select().from(shipments).where(eq(shipments.carrierCompanyId, carrierId)))[0]!;
    expect(sh.status).toBe("delivered");
    expect((sh.proof as { hash: string }).hash).toHaveLength(64);
    const c2 = await seller.ok("GET", `/contracts/${prop.id}`);
    expect(c2.contract.status).toBe("completed");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("üç taraflı sözleşme: üretici, alıcı, taşımacı", () => {
  it("çoklu teslim, gecikmeli teslim, kısmi teslim; mutabakat", async () => {
    const prod = await h.player(); const prodId = await found(h, prod, "livestock", "akyayla");
    const buyer = await h.player(); const buyerId = await found(h, buyer, "crop", "yesilova");
    const carrier = await h.player(); const carrierId = await found(h, carrier, "freight", "akyayla");
    await grantStock(h, prodId, "akyayla", "fodder", 3, 40, 10n);
    await grantStock(h, prodId, "kavsak", "fodder", 3, 190, 10n);
    const before = { p: await bal(h, prodId, "cash"), b: await bal(h, buyerId, "cash"), c: await bal(h, carrierId, "cash") };

    const prop = await buyer.ok("POST", "/contracts", withKey(h, {
      role: "buyer", counterpartyCompanyId: prodId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 100, pricePerKg: 20,
      deliveryCityId: "kavsak", freightPayer: "seller", installments: 3, firstDueAt: iso(4 * HOUR), intervalHours: 1, graceHours: 2, penaltyBp: 1000,
    }));
    await prod.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    expect(await bal(h, buyerId, "escrow")).toBe(6000n);
    expect(await bal(h, prodId, "escrow")).toBe(600n);
    let det = await prod.ok("GET", `/contracts/${prop.id}`);
    const [i1, i2, i3] = det.schedule.map((s: { id: string }) => s.id);

    // taksit 1: 60 elle + 40 taşımacı ile → zamanında
    await prod.ok("POST", `/contracts/installments/${i1}/deliver`, withKey(h, { qtyKg: 60, quality: 3 }));
    const job = await prod.ok("POST", "/freight-jobs", withKey(h, {
      originCityId: "akyayla", destCityId: "kavsak", cargo: [{ productId: "fodder", quality: 3, qtyKg: 40 }], contractInstallmentId: i1,
      payAmount: 40, deadlineHours: 24, allowSystemCarrier: false,
    }));
    const veh = (await carrier.ok("GET", "/fleet"))[0];
    await carrier.ok("POST", `/freight-jobs/${job.id}/accept`, withKey(h, { vehicleId: veh.id }));
    await h.advance(2 * HOUR); // varış (~1.7 sa)
    det = await prod.ok("GET", `/contracts/${prop.id}`);
    expect(det.schedule[0].status).toBe("fulfilled");
    expect(det.schedule[0].deliveries).toHaveLength(2);
    expect(det.schedule[0].qtyLateKg).toBe(0);

    // taksit 2: vadeden sonra (tolerans içinde) tam teslim → gecikme cezası
    await h.advance(3.5 * HOUR); // T+5.5sa: vade T+5 geçti, tolerans T+7
    await prod.ok("POST", `/contracts/installments/${i2}/deliver`, withKey(h, { qtyKg: 100, quality: 3 }));
    // taksit 3: kısmi teslim, sonra kapanış
    await h.advance(1 * HOUR); // T+6.5
    await prod.ok("POST", `/contracts/installments/${i3}/deliver`, withKey(h, { qtyKg: 30, quality: 3 }));
    const over = await prod.post(`/contracts/installments/${i3}/deliver`, withKey(h, { qtyKg: 80, quality: 3 }));
    expect(over.status).toBe(400); // eksik miktarı aşan teslim reddedilir
    await h.advance(2 * HOUR); // T+8.5 > tolerans sonu T+8

    det = await prod.ok("GET", `/contracts/${prop.id}`);
    expect(det.contract.status).toBe("completed");
    const s = det.schedule;
    expect(s[0].status).toBe("fulfilled");
    expect(s[1].status).toBe("fulfilled"); expect(s[1].qtyLateKg).toBe(100); expect(s[1].lateFees).toBe("200");
    expect(s[2].status).toBe("partial"); expect(s[2].refundedToBuyer).toBe("1400"); expect(s[2].penalty).toBe("140");
    // itibar sayaçları
    const co = (await h.deps.db.select().from(companies).where(eq(companies.id, prodId)))[0]!;
    expect(co.onTimeDeliveries).toBe(1);
    expect(co.lateOrMissed).toBe(2);
    // stok
    expect((await holding(h, buyerId, "kavsak", "fodder", 3)).qty).toBe(230);
    expect((await holding(h, prodId, "kavsak", "fodder", 3)).qty).toBe(190 - 60 - 100 - 30);
    // nakit mutabakatı (emanetler boşaldı)
    const after = { p: await bal(h, prodId, "cash"), b: await bal(h, buyerId, "cash"), c: await bal(h, carrierId, "cash") };
    expect(await bal(h, buyerId, "escrow")).toBe(0n);
    expect(await bal(h, prodId, "escrow")).toBe(0n);
    expect(after.b - before.b).toBe(-4200n);
    expect(after.p - before.p).toBe(4160n); // teslim net 4340 - teminat 600 + iade 460 - navlun işi 40
    const sh = (await h.deps.db.select().from(shipments).where(eq(shipments.carrierCompanyId, carrierId)))[0]!;
    expect(after.c - before.c).toBe(40n - sh.fuelCost - sh.driverCost);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("eşzamanlılık ve tekrar", () => {
  it("iki alıcı aynı anda son birimleri alır → tek başarı", async () => {
    const sup = await h.player(); const supId = await found(h, sup, "livestock", "akyayla");
    const a = await h.player(); await found(h, a, "crop", "yesilova");
    const b = await h.player(); await found(h, b, "crop", "yesilova");
    await grantStock(h, supId, "akyayla", "fodder", 4, 100, 5n);
    const l = await sup.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 4, qtyKg: 100, pricePerKg: 7 }));
    const [ra, rb] = await Promise.all([
      a.post(`/market/listings/${l.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: 7 })),
      b.post(`/market/listings/${l.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: 7 })),
    ]);
    const ok = [ra, rb].filter((r) => r.status === 200);
    const bad = [ra, rb].filter((r) => r.status !== 200);
    expect(ok).toHaveLength(1);
    expect(["ORDER_CLOSED", "INSUFFICIENT_STOCK"]).toContain(bad[0]!.body.error.code);
    const tr = await h.deps.db.select().from(trades).where(eq(trades.orderId, l.id));
    expect(tr).toHaveLength(1);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("aynı istek tekrarı tek hareket yazar (alım, teslim)", async () => {
    const sup = await h.player(); const supId = await found(h, sup, "livestock", "akyayla");
    const buyer = await h.player(); const buyerId = await found(h, buyer, "crop", "yesilova");
    await grantStock(h, supId, "akyayla", "fodder", 4, 100, 5n);
    await grantStock(h, supId, "kavsak", "fodder", 4, 100, 5n);
    const l = await sup.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 4, qtyKg: 100, pricePerKg: 7 }));
    const body = withKey(h, { qtyKg: 40, expectedPricePerKg: 7 });
    const r1 = await buyer.post(`/market/listings/${l.id}/buy`, body);
    const r2 = await buyer.post(`/market/listings/${l.id}/buy`, body);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    expect(r2.body.tradeId).toBe(r1.body.tradeId);
    expect(await h.deps.db.select().from(trades).where(eq(trades.orderId, l.id))).toHaveLength(1);

    const prop = await sup.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: buyerId, productId: "fodder", minQuality: 3, qtyPerInstallmentKg: 100, pricePerKg: 9,
      deliveryCityId: "kavsak", freightPayer: "seller", installments: 1, firstDueAt: iso(3 * HOUR),
    }));
    await buyer.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const det = await sup.ok("GET", `/contracts/${prop.id}`);
    const dk = withKey(h, { qtyKg: 50, quality: 4 });
    const d1 = await sup.post(`/contracts/installments/${det.schedule[0].id}/deliver`, dk);
    const d2 = await sup.post(`/contracts/installments/${det.schedule[0].id}/deliver`, dk);
    expect(d1.status).toBe(200);
    expect(d2.body.deliveryId).toBe(d1.body.deliveryId);
    expect(await h.deps.db.select().from(contractDeliveries).where(eq(contractDeliveries.contractId, prop.id))).toHaveLength(1);
    const inst = (await h.deps.db.select().from(contractInstallments).where(eq(contractInstallments.contractId, prop.id)))[0]!;
    expect(inst.qtyDeliveredKg).toBe(50);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("kendi aracı sevkiyatı", () => {
  it("oyuncu çevrimdışıyken varır; navlun yükün maliyetine eklenir; boş yük konum değiştirir", async () => {
    const p = await h.player(); const id = await found(h, p, "freight", "kavsak");
    await grantStock(h, id, "kavsak", "grain", 2, 1000, 10n);
    const veh = (await p.ok("GET", "/fleet"))[0];
    const s = await p.ok("POST", "/shipments", withKey(h, { vehicleId: veh.id, destCityId: "korfezkent", cargo: [{ productId: "grain", quality: 2, qtyKg: 1000 }] }));
    expect(s.status).toBe("in_transit");
    expect(await p.post("/shipments", withKey(h, { vehicleId: veh.id, destCityId: "yesilova", cargo: [] }))).toMatchObject({ status: 422 });
    await h.advance(4 * HOUR);
    const hd = await holding(h, id, "korfezkent", "grain", 2);
    expect(hd.qty).toBe(1000);
    expect(hd.cost).toBe(10_000n + BigInt(s.cost.total));
    const f = await p.ok("GET", "/fleet");
    expect(f[0].cityId).toBe("korfezkent");
    expect(f[0].status).toBe("idle");
    // boş konum değiştirme
    const r = await p.ok("POST", "/shipments", withKey(h, { vehicleId: veh.id, destCityId: "kavsak", cargo: [] }));
    expect(r.purpose).toBe("reposition");
    await h.advance(4 * HOUR);
    expect((await p.ok("GET", "/fleet"))[0].cityId).toBe("kavsak");
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

describe("sistem şirketleri", () => {
  it("sistemden al → sisteme sat zarardır; sistem alış fiyatı cap altında", async () => {
    await h.tick();
    const ov = await h.deps.db.select().from(priceRefs);
    // her ürün için en düşük taban sistem satış fiyatı
    const minAsk = new Map<string, bigint>();
    for (const r of ov) {
      const a = systemAsk(r.refPricePerKg, h.deps.catalog.settings.system.askBp, 0, 1);
      const cur = minAsk.get(r.productId);
      if (cur === undefined || a < cur) minAsk.set(r.productId, a);
    }
    const bids = await h.deps.db.select().from(marketOrders).where(and(eq(marketOrders.isSystem, true), eq(marketOrders.side, "buy"), eq(marketOrders.status, "open")));
    expect(bids.length).toBeGreaterThan(5);
    for (const b of bids) expect(b.pricePerKg * 100n).toBeLessThanOrEqual(minAsk.get(b.productId)! * 80n);

    const p = await h.player(); const id = await found(h, p, "crop", "korfezkent");
    const mk = await p.ok("GET", "/market?cityId=korfezkent&productId=grain");
    const ask = mk.listings.find((l: { isSystem: boolean }) => l.isSystem);
    const bid = mk.orders.find((o: { isSystem: boolean }) => o.isSystem);
    expect(ask && bid).toBeTruthy();
    const cash0 = await bal(h, id, "cash");
    await p.ok("POST", `/market/listings/${ask.id}/buy`, withKey(h, { qtyKg: 100, expectedPricePerKg: Number(ask.pricePerKg) }));
    await p.ok("POST", `/market/orders/${bid.id}/sell`, withKey(h, { qtyKg: 100, quality: 2, expectedPricePerKg: Number(bid.pricePerKg) }));
    const cash1 = await bal(h, id, "cash");
    expect(cash1).toBeLessThan(cash0);
    expect(Number(bid.pricePerKg) * 100).toBeLessThanOrEqual(Number(ask.pricePerKg) * 80);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("birkaç gün sonunda günlük bütçe ve miktar sınırları aşılmaz; sahipsiz ilan üstlenilir", async () => {
    const p = await h.player(); const id = await found(h, p, "livestock", "akyayla");
    await grantStock(h, id, "akyayla", "fodder", 2, 60_000, 50n);
    await grantStock(h, id, "yesilova", "fodder", 2, 6000, 50n);
    const ref = (await h.deps.db.select().from(priceRefs).where(and(eq(priceRefs.productId, "fodder"), eq(priceRefs.cityId, "yesilova"))))[0]!;
    const orphan = await p.ok("POST", "/market/listings", withKey(h, { cityId: "yesilova", productId: "fodder", quality: 2, qtyKg: 3000, pricePerKg: Number(ref.refPricePerKg / 2n) }));
    for (let day = 0; day < 3; day++) {
      for (let step = 0; step < 6; step++) {
        const mk = await p.ok("GET", "/market?cityId=akyayla&productId=fodder");
        const bid = mk.orders.find((o: { isSystem: boolean }) => o.isSystem);
        if (bid) await p.post(`/market/orders/${bid.id}/sell`, withKey(h, { qtyKg: Math.min(3000, bid.remainingKg), quality: 2, expectedPricePerKg: Number(bid.pricePerKg) }));
        await h.advance(4 * HOUR, HOUR);
      }
    }
    const rows = await h.deps.db.select({ r: systemDaily, key: companies.systemKey }).from(systemDaily).innerJoin(companies, eq(companies.id, systemDaily.companyId));
    expect(rows.length).toBeGreaterThan(0);
    const spentBy = new Map<string, bigint>();
    for (const { r, key } of rows) {
      const prof = SYSTEM_PROFILES.find((x) => x.companyKey === key)!;
      expect(r.boughtKg).toBeLessThanOrEqual(prof.buys[r.productId] ?? 0);
      expect(r.soldKg).toBeLessThanOrEqual(prof.sells[r.productId] ?? 0);
      const k = `${key}|${r.day}`;
      spentBy.set(k, (spentBy.get(k) ?? 0n) + r.spent);
    }
    for (const [k, v] of spentBy) {
      const prof = SYSTEM_PROFILES.find((x) => x.companyKey === k.split("|")[0])!;
      expect(v).toBeLessThanOrEqual(BigInt(prof.dailyBudget));
    }
    const ad = (await h.deps.db.select().from(marketOrders).where(eq(marketOrders.id, orphan.id)))[0]!;
    expect(ad.firstFillAt).not.toBeNull(); // sistem üstlendi
    // sistem taşıma işleri ve filo
    const jobs = await h.deps.db.execute(sql`select count(*)::int n from cf.freight_jobs where is_system`);
    expect(Number((jobs as unknown as Array<{ n: number }>)[0]!.n)).toBeGreaterThan(0);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, 180_000);
});
