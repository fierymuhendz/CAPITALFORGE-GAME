import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MarketCompareDto, MarketStatsDto } from "@capitalforge/shared";
import { createHarness, type Harness } from "../test/harness";
import { checkInvariants } from "../test/invariants";
import { found, grantStock, withKey } from "../test/trade-helpers";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const Q = "productId=fodder&cityId=akyayla";

describe("pazar istatistikleri", () => {
  it("p2p pay, vwap, son işlem, kendi emri, iptal, sistem işlemi, az veri", async () => {
    await h.tick(); // sistem emirleri
    const a = await h.player(); const aId = await found(h, a, "livestock", "akyayla");
    const b = await h.player(); const bId = await found(h, b, "livestock", "akyayla");
    const c = await h.player(); const cId = await found(h, c, "livestock", "akyayla");
    await grantStock(h, aId, "akyayla", "fodder", 3, 1000, 1n);
    await grantStock(h, bId, "akyayla", "fodder", 3, 1000, 1n);
    const list = (p: typeof a, qtyKg: number, pricePerKg: number) =>
      p.ok("POST", "/market/listings", withKey(h, { cityId: "akyayla", productId: "fodder", quality: 3, qtyKg, pricePerKg }));
    const buy = (p: typeof a, id: string, qtyKg: number, price: number) =>
      p.ok("POST", `/market/listings/${id}/buy`, withKey(h, { qtyKg, expectedPricePerKg: price }));

    // veri yok
    const s0: MarketStatsDto = await c.ok("GET", `/market/stats?${Q}`);
    expect(s0.tradeCount).toBe(0);
    expect(s0.lastPlayerTrade).toBeNull();
    expect(s0.p2pShareBp).toBe(0);
    expect(s0.lowData).toBe(true);
    expect(s0.priceBasis).toBe("reference");

    const l1 = await list(a, 100, 10);
    const l2 = await list(a, 200, 12);
    await buy(b, l1.id, 100, 10);
    const s1: MarketStatsDto = await c.ok("GET", `/market/stats?${Q}`);
    expect(s1.lowData).toBe(true); // tek alıcı-satıcı çifti
    expect(s1.distinctPairs).toBe(1);
    expect(s1.priceBasis).toBe("reference");
    await buy(c, l2.id, 100, 12);
    const l3 = await list(b, 50, 14);
    await buy(c, l3.id, 50, 14);

    const s2: MarketStatsDto = await c.ok("GET", `/market/stats?${Q}`);
    expect(s2.playerVolumeKg).toBe(250);
    expect(s2.systemVolumeKg).toBe(0);
    expect(s2.tradeCount).toBe(3);
    expect(s2.p2pShareBp).toBe(10000);
    expect(s2.vwapByQuality).toEqual([{ quality: 3, vwapPerKg: "11", volumeKg: 250, tradeCount: 3 }]); // 2900/250
    expect(s2.lastPlayerTrade).toMatchObject({ pricePerKg: "14", quality: 3, qtyKg: 50 });
    expect(s2.distinctPairs).toBe(3);
    expect(s2.lowData).toBe(false);
    expect(s2.priceBasis).toBe("vwap");
    expect(s2.vwapQ2PerKg).not.toBeNull();

    // kendi emri görünmez: a'nın kalan 100@12 ilanı a için yok, c için var
    const mine = (await a.ok("GET", "/market/mine")) as Array<{ id: string }>;
    expect(mine.some((o) => o.id === l2.id)).toBe(true);
    const cheap = await list(a, 100, 9);
    const sa: MarketStatsDto = await a.ok("GET", `/market/stats?${Q}`);
    expect(sa.bestPlayerAsk).toBeNull(); // kalan tüm oyuncu ilanları a'nın kendisine ait
    expect(sa.bestAsk?.source ?? "system").toBe("system");
    const sc: MarketStatsDto = await c.ok("GET", `/market/stats?${Q}`);
    expect(sc.bestPlayerAsk?.orderId).toBe(cheap.id);
    expect(sc.bestPlayerAsk?.pricePerKg).toBe("9");

    // iptal edilen ilan girmez
    await a.ok("POST", `/market/listings/${cheap.id}/cancel`, withKey(h, {}));
    const sc2: MarketStatsDto = await c.ok("GET", `/market/stats?${Q}`);
    expect(sc2.bestPlayerAsk?.orderId).toBe(l2.id);
    expect(sc2.bestPlayerAsk?.pricePerKg).toBe("12");
    expect(sc2.tradeCount).toBe(3);

    // sistem işlemi oyuncu hacmine ve vwap'a girmez
    const mk = await c.ok("GET", "/market?cityId=akyayla&productId=fodder");
    const bid = mk.orders.find((o: { isSystem: boolean }) => o.isSystem);
    expect(bid).toBeTruthy();
    await grantStock(h, cId, "akyayla", "fodder", 2, 20, 1n);
    await c.ok("POST", `/market/orders/${bid.id}/sell`, withKey(h, { qtyKg: 20, quality: 2, expectedPricePerKg: Number(bid.pricePerKg) }));
    const s3: MarketStatsDto = await c.ok("GET", `/market/stats?${Q}`);
    expect(s3.playerVolumeKg).toBe(250);
    expect(s3.systemVolumeKg).toBe(20);
    expect(s3.tradeCount).toBe(4);
    expect(s3.p2pShareBp).toBe(Math.floor((250 * 10000) / 270));
    expect(s3.vwapByQuality).toEqual(s2.vwapByQuality);
    expect(s3.lastPlayerTrade).toEqual(s2.lastPlayerTrade);
    expect(s3.lastSystemTrade).toMatchObject({ pricePerKg: bid.pricePerKg, qtyKg: 20, quality: 2 });
    expect(s3.bestSystemBid?.source).toBe("system");

    // karşılaştırma
    const cmp: MarketCompareDto = await c.ok("GET", "/market/compare?productId=fodder&qtyKg=20&quality=2&fromCityId=akyayla");
    const row = cmp.rows.find((r) => r.cityId === "akyayla")!;
    expect(row.bestBid?.source).toBe("system");
    expect(row.freight).toBe("0");
    expect(BigInt(row.net!)).toBe(BigInt(row.gross!) - BigInt(row.fee!));
    expect(cmp.bestCityId).not.toBeNull();
    for (const r of cmp.rows) if (r.bestBid && r.freight !== null) expect(BigInt(r.net!)).toBe(BigInt(r.gross!) - BigInt(r.fee!) - BigInt(r.freight));

    // doğrulama
    expect((await c.get(`/market/stats?${Q}&hours=999`)).status).toBe(400);
    expect((await c.get("/market/compare?productId=fodder&qtyKg=0")).status).toBe(400);
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});
