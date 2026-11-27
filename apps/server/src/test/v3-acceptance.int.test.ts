/**
 * v3 kabul testleri (sunucu düzeyi, gerçek PostgreSQL, zaman h.advance ile).
 *
 *  1) İki karşılaştırılabilir anlaşma: teslim maliyeti sıralaması tek etkenle (miktar, ilan şehri, navlun ayarı, hedef şehir) tersine döner;
 *     iki anlaşma da gerçekten alınır, taşınır, işlenir, alım emrine satılır ve stok hareketi, defter, SaleDto ve /finance/outcomes ile mutabık kalır
 *  2) Beş sektörde ilk iş → ilk gelir → gerçek seçenekler arasından sonraki yatırım; süre tavanı 60 dk
 *  3) İki oyuncu şirketi arasında tekrarlayan teslimat sözleşmesi (karşılaştırma, kabul, teslimler, sonuç)
 *  4) Çevrimdışı tamamlanma (oyuncular istek atmaz)
 *  5) Canlı güncellemeden sağ çıkma (ESKİ şema/katalog durumu → migration + katalog revizyonu)
 *
 * Her senaryo sonunda checkInvariants boş döner. Sayılar RESULTS içinde toplanır ve `V3_ACCEPTANCE_RESULTS` satırı olarak yazdırılır.
 */
import { and, eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBp, estimateOwnTrip, systemCarrierQuote } from "@capitalforge/economy";
import { QUALITY_PRICE_BP, roadDistanceKm } from "@capitalforge/shared";
import { totpAt } from "../auth/totp";
import { applyCatalogRevisions, CATALOG_REVISIONS } from "../db/catalogRevision";
import { runMigrations } from "../db/migrate";
import { accounts, catalogHistory, catalogItems, contractInstallments, contracts, freightJobs, meta, productionJobs, shipments } from "../db/schema";
import { found as foundKit, grantCash, grantStock as grantStockKit, setLevel } from "../production/kit";
import { createHarness, Player, type Harness } from "./harness";
import { checkInvariants } from "./invariants";
import { bal, grantStock, holding, HOUR, withKey } from "./trade-helpers";

const MIN = 60_000;
const RESULTS: Record<string, unknown> = {};
// geri alma sondan başa: 0003'ü geri almak için önce ondan sonraki migration'lar geri alınır
const DOWN_0003 = ["0004_v4_market_indexes", "0003_v3_deal_outcomes"]
  .map((n) => readFileSync(join(process.cwd(), `apps/server/drizzle/down/${n}.sql`), "utf8"))
  .join(";\n");
const URL_ = process.env.DATABASE_URL ?? "postgres://capitalforge:capitalforge@localhost:5432/capitalforge_test";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => {
  if (h) await h.close().catch(() => {});
  console.log("V3_ACCEPTANCE_RESULTS " + JSON.stringify(RESULTS, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
});

// ------------------------------------------------------------------ ortak yardımcılar

const rows = async <T = Record<string, unknown>>(s: ReturnType<typeof sql>): Promise<T[]> => (await h.deps.db.execute(s)) as unknown as T[];
const cashOf = (companyId: string) => bal(h, companyId, "cash");
const rnd = () => Math.random().toString(36).slice(2, 8);
const urlOf = (path: string, q: Record<string, string | number>) => `${path}?${Object.entries(q).map(([k, v]) => `${k}=${v}`).join("&")}`;
const offersUrl = (q: Record<string, string | number>) => urlOf("/market/offers", q);

const CITY_ORDER = ["yesilova", "kavsak", "korfezkent", "akyayla", "demirdag"];
/** şirket kur; istenen şehirde uygun arsa kalmadıysa diğer şehirlere bak */
async function foundCo(p: Player, sector: string, cityId: string, starterBuilding?: string): Promise<{ companyId: string; facilityId: string; cityId: string; plot: { id: string; price: string; deposit: null | { kind: "iron" | "coal" } } }> {
  for (const c of [cityId, ...CITY_ORDER.filter((x) => x !== cityId)]) {
    const ob = await p.ok("GET", `/world/onboarding?cityId=${c}&sector=${sector}${starterBuilding ? `&starterBuilding=${starterBuilding}` : ""}`);
    const plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
    if (!plot) continue;
    const r = await p.ok("POST", "/company", { name: `V3 ${sector} ${rnd()}`, cityId: c, sector, plotId: plot.id, starterBuilding, idempotencyKey: h.key() });
    return { companyId: r.companyId, facilityId: r.facilityId, cityId: c, plot };
  }
  throw new Error(`uygun arsa yok ${sector}/${cityId}`);
}

/** sistem taşımacısı tarifesi (gerçek ayarlardan): her kamyon dolusu parça ayrı */
const truck = () => h.deps.catalog.vehicleModel("truck");
function fq(km: number, kg: number, perKm?: number): bigint {
  const f = h.deps.catalog.settings.freight;
  let total = 0n;
  for (let left = kg; left > 0; left -= truck().capacityKg) total += systemCarrierQuote(km, Math.min(left, truck().capacityKg), f.systemBaseFee, perKm ?? f.systemPerKm, truck().capacityKg);
  return total;
}
const perKgDelivered = (price: bigint, km: number, kg: number, perKm?: number): bigint => price + (fq(km, kg, perKm) + BigInt(kg) - 1n) / BigInt(kg);

async function listing(p: Player, cityId: string, productId: string, qty: number, price: number, quality: number): Promise<string> {
  return (await p.ok("POST", "/market/listings", withKey(h, { cityId, productId, quality, qtyKg: qty, pricePerKg: price }))).id as string;
}

interface Offers { rows: Array<{ orderId: string; perKg: string; total: string; goods: string; freight: string; loads: number; etaMinutes: number; km: number; notes: string[] }>; bestOrderId: string | null }
/** yalnızca ilgilendiğimiz ilanların sırası */
const order = (o: Offers, ids: Record<string, string>): string[] =>
  o.rows.filter((r) => Object.values(ids).includes(r.orderId)).map((r) => Object.entries(ids).find(([, v]) => v === r.orderId)![0]);

const sumBig = (xs: Array<bigint | string>): bigint => xs.reduce<bigint>((a, x) => a + BigInt(x), 0n);

interface TxEntry { transaction_id: string; code: string; amount: string }
/** verilen işlemlerin tüm satırları; her işlemin toplamı 0 olmalı */
async function entriesOf(txIds: string[], companyId: string): Promise<{ perTxSums: Record<string, bigint>; byCode: Record<string, bigint> }> {
  if (!txIds.length) return { perTxSums: {}, byCode: {} };
  const list = sql.join(txIds.map((i) => sql`${i}::uuid`), sql`, `);
  const all = await rows<TxEntry>(sql`SELECT e.transaction_id, a.code, e.amount::text amount FROM cf.ledger_entries e JOIN cf.ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id IN (${list})`);
  const perTxSums: Record<string, bigint> = {};
  for (const r of all) perTxSums[r.transaction_id] = (perTxSums[r.transaction_id] ?? 0n) + BigInt(r.amount);
  const mine = await rows<TxEntry>(sql`SELECT e.transaction_id, a.code, e.amount::text amount FROM cf.ledger_entries e JOIN cf.ledger_accounts a ON a.id = e.account_id WHERE e.transaction_id IN (${list}) AND a.company_id = ${companyId}`);
  const byCode: Record<string, bigint> = {};
  for (const r of mine) byCode[r.code] = (byCode[r.code] ?? 0n) + BigInt(r.amount);
  return { perTxSums, byCode };
}

// ================================================================== 1) iki karşılaştırılabilir anlaşma

interface DealReport {
  label: string; listingCity: string; km: number; priceKg: number; qtyKg: number;
  goods: bigint; freight: bigint; unitDelivered: bigint; operating: bigint; inputsCost: bigint; flourKg: number; flourCost: bigint;
  revenue: bigint; saleFee: bigint; cogs: bigint; netProfit: bigint; batches: number; jobMinutes: number[]; arrivalMinutes: number;
  cashDelta: bigint; dealCashEntries: bigint; otherCash: bigint; movementKinds: Record<string, number>;
  expectedMinutes: number; actualMinutes: number; expectedProfitSum: bigint; feeRoundingGap: bigint; expectedPricePerKg: bigint;
}

describe("1) iki karşılaştırılabilir anlaşma: sıra tersine döner, ikisi de uçtan uca yürür", () => {
  it("yakın-pahalı ↔ uzak-ucuz: miktar, ilan şehri, navlun ayarı ve hedef şehir sırayı çevirir; gerçek alım + taşıma + üretim + satış mutabakatı", async () => {
    const sup = await h.player(); const supId = (await foundCo(sup, "crop", "yesilova")).companyId;
    const cat = h.deps.catalog;
    const mf = await foundKit(h, "manufacturing", "korfezkent", "food_plant");
    const orderer = await h.player(); const ordererId = (await foundCo(orderer, "crop", "akyayla")).companyId;
    await grantCash(h, mf.companyId, 30_000_000n);
    await grantCash(h, ordererId, 60_000_000n);
    const QUAL = 4;
    // başlangıç stoku (bağış) başka kalitede olmalı: üretim en yüksek kaliteden tüketir, anlaşma lotları karışmaz
    const starter = (await mf.p.ok("GET", "/inventory")).filter((l: { productId: string }) => l.productId === "grain");
    expect(starter.length).toBeGreaterThan(0);
    expect(starter.every((l: { quality: number }) => l.quality !== QUAL)).toBe(true);
    const starterQty = starter.reduce((a: number, l: { qtyKg: number }) => a + l.qtyKg, 0);

    // fiyat penceresi: tek kamyon (12.000 kg) uzak ilan kazansın, 13.000 kg (iki kamyon, SPLIT_LOADS) yakın ilan kazansın
    const low = Number(fq(250, 12_000) - fq(120, 12_000)) / 12_000;
    const high = Number(fq(250, 13_000) - fq(120, 13_000)) / 13_000;
    const delta = Math.floor((low + high) / 2);
    expect(delta).toBeGreaterThan(low + 1);
    expect(delta).toBeLessThan(high - 1);
    const FAR_PRICE = 300, NEAR_PRICE = FAR_PRICE + delta;
    for (const c of ["kavsak", "demirdag", "yesilova"]) await grantStock(h, supId, c, "grain", QUAL, 40_000, 1n);
    const near = await listing(sup, "kavsak", "grain", 30_000, NEAR_PRICE, QUAL); // 120 km, pahalı
    const far = await listing(sup, "demirdag", "grain", 30_000, FAR_PRICE, QUAL); // 250 km, ucuz
    const ids = { near, far };
    const get = (q: Record<string, string | number>) => mf.p.ok("GET", offersUrl({ side: "buy", productId: "grain", ...q })) as Promise<Offers>;

    const ranking: Array<Record<string, unknown>> = [];
    const snap = (name: string, o: Offers, only: Record<string, string>) => {
      const rr = o.rows.filter((r) => Object.values(only).includes(r.orderId));
      ranking.push({
        durum: name, sira: order(o, only).join(" > "),
        satirlar: rr.map((r) => `${Object.entries(only).find(([, v]) => v === r.orderId)![0]}: mal ${r.goods} + navlun ${r.freight} = ${r.total} (${r.perKg} kuruş/kg, ${r.loads} kamyon, ${r.etaMinutes} dk)`),
      });
    };

    // (a) 4.000 kg kısmi yük: yakın-pahalı kazanır
    const a = await get({ cityId: "korfezkent", qtyKg: 4000 });
    expect(order(a, ids)).toEqual(["near", "far"]);
    const rn = a.rows.find((r) => r.orderId === near)!, rf = a.rows.find((r) => r.orderId === far)!;
    expect(rn.perKg).toBe(perKgDelivered(BigInt(NEAR_PRICE), 120, 4000).toString());
    expect(rf.perKg).toBe(perKgDelivered(BigInt(FAR_PRICE), 250, 4000).toString());
    expect(rn.freight).toBe(fq(120, 4000).toString());
    expect(rf.freight).toBe(fq(250, 4000).toString());
    expect(rn.goods).toBe((4000n * BigInt(NEAR_PRICE)).toString());
    expect(BigInt(rn.perKg)).toBeLessThan(BigInt(rf.perKg));
    snap("4.000 kg (kısmi yük)", a, ids);
    // (b) 12.000 kg = tam kamyon: etken yalnızca miktar → uzak-ucuz kazanır
    const b = await get({ cityId: "korfezkent", qtyKg: 12_000 });
    expect(order(b, ids)).toEqual(["far", "near"]);
    expect(b.rows.find((r) => r.orderId === far)!.perKg).toBe(perKgDelivered(BigInt(FAR_PRICE), 250, 12_000).toString());
    expect(b.rows.find((r) => r.orderId === near)!.perKg).toBe(perKgDelivered(BigInt(NEAR_PRICE), 120, 12_000).toString());
    snap("12.000 kg (tam kamyon)", b, ids);
    // (c) 13.000 kg: iki kamyon (SPLIT_LOADS), navlun iki katına çıkar → yakın yeniden kazanır
    const c = await get({ cityId: "korfezkent", qtyKg: 13_000 });
    expect(order(c, ids)).toEqual(["near", "far"]);
    expect(c.rows.find((r) => r.orderId === far)!.notes).toContain("SPLIT_LOADS");
    expect(c.rows.find((r) => r.orderId === far)!.loads).toBe(2);
    snap("13.000 kg (2 kamyon, SPLIT_LOADS)", c, ids);
    // (d) navlun ayarı: km başı ücret ×4, 12.000 kg → yakın kazanır (b ile aynı miktar)
    const prev = h.deps.catalog.settings;
    const perKm4 = prev.freight.systemPerKm * 4;
    h.deps.catalog.settings = { ...prev, freight: { ...prev.freight, systemPerKm: perKm4 as never } };
    try {
      const d = await get({ cityId: "korfezkent", qtyKg: 12_000 });
      expect(order(d, ids)).toEqual(["near", "far"]);
      expect(d.rows.find((r) => r.orderId === far)!.perKg).toBe(perKgDelivered(BigInt(FAR_PRICE), 250, 12_000, perKm4).toString());
      snap(`12.000 kg, km başı ücret ×4 (${perKm4})`, d, ids);
    } finally { h.deps.catalog.settings = prev; }
    // (e) hedef şehir: teslimat Kavşak'a → yakın ilan aynı şehirde (navlun 0)
    const e = await get({ cityId: "kavsak", qtyKg: 12_000 });
    expect(order(e, ids)).toEqual(["near", "far"]);
    expect(e.rows.find((r) => r.orderId === near)!.freight).toBe("0");
    expect(e.rows.find((r) => r.orderId === near)!.notes).toContain("SAME_CITY");
    snap("12.000 kg, teslim şehri Kavşak", e, ids);
    // (f) ilan şehri uzaklığı: uzak ilanla aynı fiyatta Yeşilova (180 km) ilanı varken 4.000 kg'da o öne geçer
    const mid = await listing(sup, "yesilova", "grain", 30_000, FAR_PRICE, QUAL);
    const f = await get({ cityId: "korfezkent", qtyKg: 4000 });
    expect(order(f, { near, mid })).toEqual(["mid", "near"]);
    expect(order(f, { near, far })).toEqual(["near", "far"]);
    expect(f.rows.find((r) => r.orderId === mid)!.perKg).toBe(perKgDelivered(BigInt(FAR_PRICE), 180, 4000).toString());
    snap("4.000 kg, aynı fiyatlı ilan 180 km (Yeşilova) ↔ yakın (120 km) ↔ uzak (250 km)", f, { near, mid, far });
    ranking.push({ durum: "pencere", low, high, delta, FAR_PRICE, NEAR_PRICE });
    RESULTS["anlasma.siralama"] = ranking;
    await sup.ok("POST", `/market/listings/${mid}/cancel`, withKey(h, {}));
    expect(await checkInvariants(h.deps.db)).toEqual([]);

    // ---- gerçek yürütme: alım emri (flour) ve iki anlaşma
    const FLOUR_PRICE = 1200;
    const flourOrder = (await orderer.ok("POST", "/market/orders", withKey(h, { cityId: "korfezkent", productId: "flour", minQuality: 1, qtyKg: 30_000, maxPricePerKg: FLOUR_PRICE }))).id as string;
    const reports: DealReport[] = [];
    const runDeal = async (label: string, listingId: string, listingCity: string, priceKg: number, qtyKg: number): Promise<DealReport> => {
      const t0 = h.deps.clock.now();
      const cash0 = await cashOf(mf.companyId);
      const km = roadDistanceKm(listingCity, "korfezkent");
      const freightExp = fq(km, qtyKg);
      const buy = await mf.p.ok("POST", `/market/listings/${listingId}/buy`, { qtyKg, expectedPricePerKg: priceKg, deliverToCityId: "korfezkent", idempotencyKey: h.key() });
      const goods = BigInt(qtyKg) * BigInt(priceKg);
      expect(buy.gross).toBe(goods.toString());
      expect(buy.freightPay).toBe(freightExp.toString());
      expect(await cashOf(mf.companyId)).toBe(cash0 - goods - freightExp); // mal bedeli + navlun emaneti
      expect(await bal(h, mf.companyId, "escrow")).toBe(freightExp);
      // taşıma: sistem taşımacısı üstlenir ve taşır; varışa kadar zaman ilerlet
      let waited = 0;
      while ((await holding(h, mf.companyId, "korfezkent", "grain", QUAL)).qty < qtyKg && waited < 24 * 60) { await h.advance(15 * MIN); waited += 15; }
      const hold = await holding(h, mf.companyId, "korfezkent", "grain", QUAL);
      expect(hold.qty).toBe(qtyKg);
      expect(hold.cost).toBe(goods + freightExp); // varış deposundaki maliyet = mal + navlun (tam)
      expect(await bal(h, mf.companyId, "escrow")).toBe(0n);
      const [ship] = await h.deps.db.select().from(shipments).where(eq(shipments.id, (await h.deps.db.select().from(freightJobs).where(eq(freightJobs.id, buy.freightJobId)))[0]!.shipmentId!));
      const arrivalMinutes = Math.round((ship!.arrivesAt.getTime() - ship!.departedAt.getTime()) / MIN);
      expect(arrivalMinutes).toBeLessThanOrEqual(60);

      // üretim: parti başına 2.000 kg tahıl → un
      const batches = qtyKg / 2000;
      const jobMinutes: number[] = [];
      let operating = 0n, inputsCost = 0n, flourKg = 0, flourCost = 0n;
      const jobIds: string[] = [];
      for (let i = 0; i < batches; i++) {
        const q = await mf.p.ok("POST", "/production/quote", { facilityId: mf.facilityId, recipeId: "mill_flour", batches: 1 });
        expect(q.blockers).toEqual([]);
        expect(q.minutes).toBeLessThanOrEqual(60);
        const job = await mf.p.ok("POST", "/production/start", { facilityId: mf.facilityId, recipeId: "mill_flour", batches: 1, repeat: false, idempotencyKey: h.key() });
        const inp = sumBig(job.cost.inputs.map((x: { cost: string }) => x.cost));
        inputsCost += inp;
        operating += BigInt(job.cost.energy) + BigInt(job.cost.water) + BigInt(job.cost.labor);
        expect(BigInt(job.cost.total)).toBe(inp + BigInt(job.cost.energy) + BigInt(job.cost.water) + BigInt(job.cost.labor));
        flourKg += job.output.qtyKg; flourCost += BigInt(job.cost.total);
        jobMinutes.push(Math.round((new Date(job.endsAt).getTime() - new Date(job.startedAt).getTime()) / MIN));
        jobIds.push(job.id);
        await h.advance((jobMinutes[i]! + 1) * MIN);
      }
      expect(Math.max(...jobMinutes)).toBeLessThanOrEqual(60);
      // girdi lotu tükendi, un lotu çıktı toplamı ve maliyeti ile eşit
      expect((await holding(h, mf.companyId, "korfezkent", "grain", QUAL)).qty).toBe(0);
      expect((await holding(h, mf.companyId, "korfezkent", "grain", QUAL)).cost).toBe(0n);
      // girdi maliyeti = mal + navlun (tüm lot tüketildi)
      expect(inputsCost).toBe(goods + freightExp);
      const lots = (await mf.p.ok("GET", "/inventory")).filter((l: { productId: string }) => l.productId === "flour");
      expect(lots).toHaveLength(1);
      expect(lots[0].qtyKg).toBe(flourKg);
      expect(BigInt(lots[0].costTotal)).toBe(flourCost);

      // satış: alım emrine
      const sale = await mf.p.ok("POST", `/market/orders/${flourOrder}/sell`, withKey(h, { qtyKg: flourKg, quality: lots[0].quality, expectedPricePerKg: FLOUR_PRICE }));
      const revenue = BigInt(flourKg) * BigInt(FLOUR_PRICE);
      expect(sale.gross).toBe(revenue.toString());
      expect(sale.fee).toBe(applyBp(revenue, h.deps.catalog.settings.marketFeeBp).toString());
      expect(sale.cogs).toBe(flourCost.toString()); // tüm lot satıldı → COGS = lot maliyeti
      const dto = await mf.p.ok("GET", `/finance/sales/${sale.saleId}`);
      const saleDto = dto.sale ?? dto;
      const netExp = revenue - BigInt(sale.fee) - flourCost;
      expect(saleDto.gross).toBe(revenue.toString());
      expect(saleDto.cogs).toBe(flourCost.toString());
      expect(saleDto.fees).toBe(sale.fee);
      expect(saleDto.freight).toBe("0");
      expect(saleDto.netProfit).toBe(netExp.toString());
      expect((await mf.p.ok("GET", "/inventory")).filter((l: { productId: string }) => l.productId === "flour")).toHaveLength(0);

      // ---- mutabakat: gerçekleşen = SaleDto net kârı = mal + navlun + işletme gideri düşülmüş gelir
      expect(netExp).toBe(revenue - BigInt(sale.fee) - goods - freightExp - operating);
      // stok hareketleri: varış deposunda tahıl girişi = mal + navlun; üretim girdisi çıkışı; un çıktısı = iş maliyeti; satış çıkışı = COGS
      const mv = await rows<{ kind: string; product_id: string; city_id: string; qty: number; cost: string }>(sql`
        SELECT kind, product_id, city_id, qty_kg::int qty, cost::text cost FROM cf.inventory_movements
        WHERE company_id = ${mf.companyId} AND created_at >= ${t0.toISOString()}::timestamptz AND quality IN (${QUAL}, ${lots[0].quality}) ORDER BY created_at, id`);
      const kinds: Record<string, number> = {};
      for (const r of mv) kinds[`${r.product_id}:${r.kind}`] = (kinds[`${r.product_id}:${r.kind}`] ?? 0) + 1;
      const grainDest = mv.filter((r) => r.product_id === "grain" && r.city_id === "korfezkent");
      expect(sumBig(grainDest.filter((r) => r.qty > 0).map((r) => r.cost))).toBe(goods + freightExp);
      expect(sumBig(grainDest.map((r) => r.cost))).toBe(0n); // giren − çıkan = 0 (lot tükendi)
      expect(grainDest.reduce((a, r) => a + r.qty, 0)).toBe(0);
      expect(sumBig(mv.filter((r) => r.product_id === "flour" && r.qty > 0).map((r) => r.cost))).toBe(flourCost);
      expect(sumBig(mv.filter((r) => r.product_id === "flour" && r.qty < 0).map((r) => r.cost))).toBe(-flourCost);

      // ---- defter: anlaşmaya bağlı işlemler (alım, taşıma, üretim, satış) tek tek dengeli; nakit etkisi = net kâr
      const outs = await mf.p.ok("GET", "/finance/outcomes");
      const purchase = outs.find((x: { id: string }) => x.id === buy.outcomeId);
      expect(purchase.status).toBe("settled");
      expect(purchase.expected.goods).toBe(goods.toString());
      expect(purchase.expected.freight).toBe(freightExp.toString());
      expect(purchase.expected.cost).toBe((goods + freightExp).toString());
      expect(purchase.actual.goods).toBe(goods.toString());
      expect(purchase.actual.freight).toBe(freightExp.toString());
      expect(purchase.actual.cost).toBe((goods + freightExp).toString());
      expect(purchase.actual.minutes).toBeLessThanOrEqual(24 * 60);
      const prod = jobIds.map((id) => outs.find((x: { refId: string; kind: string }) => x.refId === id && x.kind === "production"));
      for (const p of prod) {
        expect(p.status).toBe("settled");
        expect(p.actual.cost).toBe(p.expected.cost); // üretim maliyeti tahmini = gerçekleşen (tam)
        expect(p.actual.qtyKg).toBe(p.expected.qtyKg);
      }
      // üretim tahmini, başlatma anındaki EN İYİ alıcıya göredir (burada sistem/başka emir olabilir); gerçekleşen, seçtiğimiz alım emrine satıştır.
      // Tahmin = qty × tahmini fiyat − komisyon − maliyet (tam); farkı raporlarız.
      const expectedProfitSum = prod.reduce((a: bigint, p: { expected: { profit: string } }) => a + BigInt(p.expected.profit), 0n);
      for (const p of prod) expect(BigInt(p.expected.profit)).toBe(BigInt(p.expected.revenue) - applyBp(BigInt(p.expected.revenue), cat.settings.marketFeeBp) - BigInt(p.expected.cost));
      const feeRoundingGap = expectedProfitSum - netExp;
      const saleOut = outs.find((x: { refId: string; kind: string; saleIds?: string[] }) => x.kind === "sale" && x.saleIds?.includes(sale.saleId));
      expect(saleOut.status).toBe("settled");
      expect(saleOut.expected.revenue).toBe(revenue.toString());
      expect(saleOut.actual.revenue).toBe(revenue.toString());
      expect(saleOut.actual.profit).toBe(netExp.toString());
      expect(saleOut.expected.profit).toBe(netExp.toString());
      const txIds = [...new Set<string>([...purchase.ledgerTransactionIds, ...prod.flatMap((p: { ledgerTransactionIds: string[] }) => p.ledgerTransactionIds), ...saleDto.ledgerTransactionIds, ...saleOut.ledgerTransactionIds])];
      const led = await entriesOf(txIds, mf.companyId);
      for (const [tx, s] of Object.entries(led.perTxSums)) expect(s, `işlem ${tx} dengeli`).toBe(0n);
      expect(led.byCode.cash).toBe(netExp); // anlaşmanın nakit etkisi = gerçekleşen net kâr
      const cash1 = await cashOf(mf.companyId);
      const cashDelta = cash1 - cash0;
      const otherCash = cashDelta - led.byCode.cash!; // anlaşma dışı nakit (günlük bakım vb.)
      expect(otherCash).toBeLessThanOrEqual(0n);
      const upkeep = await rows<{ s: string }>(sql`SELECT coalesce(sum(e.amount),0)::text s FROM cf.ledger_entries e JOIN cf.ledger_accounts a ON a.id = e.account_id JOIN cf.ledger_transactions t ON t.id = e.transaction_id WHERE a.company_id = ${mf.companyId} AND a.code = 'cash' AND t.created_at >= ${t0.toISOString()}::timestamptz AND t.id NOT IN (${sql.join(txIds.map((i) => sql`${i}::uuid`), sql`, `)})`);
      expect(BigInt(upkeep[0]!.s)).toBe(otherCash);
      expect(await checkInvariants(h.deps.db)).toEqual([]);
      return {
        label, listingCity, km, priceKg, qtyKg, goods, freight: freightExp, unitDelivered: perKgDelivered(BigInt(priceKg), km, qtyKg), operating, inputsCost, flourKg, flourCost,
        revenue, saleFee: BigInt(sale.fee), cogs: BigInt(sale.cogs), netProfit: netExp, batches, jobMinutes, arrivalMinutes, cashDelta, dealCashEntries: led.byCode.cash!, otherCash, movementKinds: kinds,
        expectedMinutes: purchase.expected.minutes, actualMinutes: purchase.actual.minutes, expectedProfitSum, feeRoundingGap, expectedPricePerKg: BigInt(prod[0].expected.revenue) / BigInt(prod[0].expected.qtyKg),
      };
    };
    // A: yakın-pahalı 4.000 kg (kısmi yük); B: uzak-ucuz 12.000 kg (tam kamyon): her biri kendi miktarında kazanan teklifti
    reports.push(await runDeal("A (yakın-pahalı)", near, "kavsak", NEAR_PRICE, 4000));
    reports.push(await runDeal("B (uzak-ucuz)", far, "demirdag", FAR_PRICE, 12_000));
    RESULTS["anlasma.raporlar"] = reports;
    // başlangıç stoku dokunulmadı
    expect((await mf.p.ok("GET", "/inventory")).filter((l: { productId: string }) => l.productId === "grain").reduce((a: number, l: { qtyKg: number }) => a + l.qtyKg, 0)).toBe(starterQty);
    // aynı anahtarla tekrar: ikinci alım yok (yanıt aynı), nakit değişmez
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, 600_000);
});

// ================================================================== 2) beş sektörde kazanç yolu

interface Alt { kind: string; id: string; cost: bigint; available: boolean; reason?: string; gainPerUnit: bigint; unit: string; paybackUnits: number | null }

/** stoktan sisteme sat (en iyi alım emrinden başla); toplam brüt, komisyon, miktar */
async function sellToSystem(p: Player, cityId: string, productId: string): Promise<{ gross: bigint; fee: bigint; cogs: bigint; qtyKg: number; saleIds: string[] }> {
  const out = { gross: 0n, fee: 0n, cogs: 0n, qtyKg: 0, saleIds: [] as string[] };
  const inv = (await p.ok("GET", "/inventory")).filter((l: { cityId: string; productId: string; availableKg: number }) => l.cityId === cityId && l.productId === productId && l.availableKg > 0);
  for (const lot of inv.sort((a: { quality: number }, b: { quality: number }) => b.quality - a.quality)) {
    let left = lot.availableKg;
    while (left > 0) {
      const mk = await p.ok("GET", `/market?cityId=${cityId}&productId=${productId}`);
      const bid = (mk.orders as Array<{ id: string; isSystem: boolean; remainingKg: number; pricePerKg: string; quality: number }>)
        .filter((o) => o.isSystem && o.remainingKg > 0 && o.quality <= lot.quality)
        .sort((a, b) => Number(BigInt(b.pricePerKg) - BigInt(a.pricePerKg)))[0];
      if (!bid) return out;
      const qty = Math.min(left, bid.remainingKg);
      const price = Number((BigInt(bid.pricePerKg) * BigInt(QUALITY_PRICE_BP[lot.quality]!)) / 10000n);
      const r = await p.post(`/market/orders/${bid.id}/sell`, { qtyKg: qty, quality: lot.quality, expectedPricePerKg: Math.max(1, price), idempotencyKey: h.key() });
      if (r.status !== 200) return out;
      out.gross += BigInt(r.body.gross); out.fee += BigInt(r.body.fee); out.cogs += BigInt(r.body.cogs); out.qtyKg += qty; out.saleIds.push(r.body.saleId);
      left -= qty;
    }
  }
  return out;
}

interface Journey { sector: string; label: string; cityId: string; starter?: string }
const JOURNEYS: Journey[] = [
  { sector: "crop", label: "Tarım", cityId: "yesilova" },
  { sector: "livestock", label: "Hayvancılık", cityId: "akyayla" },
  { sector: "mining", label: "Madencilik", cityId: "demirdag" },
  { sector: "manufacturing", label: "İmalat (gıda)", cityId: "korfezkent", starter: "food_plant" },
  { sector: "manufacturing", label: "İmalat (çelik)", cityId: "korfezkent", starter: "steel_mill" },
];

describe("2) beş sektörde kazanç yolu: ilk iş → ilk gelir → gerçek seçenekler arasından yatırım; süre tavanı 60 dk", () => {
  for (const j of JOURNEYS) {
    it(`${j.label}`, async () => {
      const cat = h.deps.catalog;
      const p = await h.player();
      const c = await foundCo(p, j.sector, j.cityId, j.starter);
      const startCash = BigInt(cat.settings.startingCash);
      const cash0 = await cashOf(c.companyId);
      expect(cash0).toBe(startCash - BigInt(c.plot.price));
      const fac = (await p.ok("GET", "/facilities"))[0];
      expect(fac.id).toBe(c.facilityId);

      // --- ilk iş: tesisin tüm tarifleri teklif edilir, saat başı tahmini kârı en yüksek başlatılabilir olan seçilir
      const cand: Array<{ recipeId: string; ok: boolean; blockers: string[]; profit: bigint | null; pph: bigint | null; cost: bigint; minutes: number }> = [];
      for (const r of fac.recipes as string[]) {
        const q = await p.ok("POST", "/production/quote", { facilityId: fac.id, recipeId: r, batches: 1 });
        cand.push({ recipeId: r, ok: q.canStart, blockers: q.blockers.map((b: { code: string }) => b.code), profit: q.estimate ? BigInt(q.estimate.profit) : null, pph: q.estimate ? BigInt(q.estimate.profitPerHour) : null, cost: BigInt(q.cost.total), minutes: q.minutes });
        expect(q.minutes).toBeLessThanOrEqual(60);
      }
      const startable = cand.filter((x) => x.ok && x.pph !== null).sort((a, b) => Number(b.pph! - a.pph!));
      expect(startable.length).toBeGreaterThan(0);
      const pick = startable[0]!;
      const q0 = await p.ok("POST", "/production/quote", { facilityId: fac.id, recipeId: pick.recipeId, batches: 1 });
      const job = await p.ok("POST", "/production/start", { facilityId: fac.id, recipeId: pick.recipeId, batches: 1, repeat: false, idempotencyKey: h.key() });
      expect(job.status).toBe("running");
      const jobMin = Math.round((new Date(job.endsAt).getTime() - new Date(job.startedAt).getTime()) / MIN);
      expect(jobMin).toBeLessThanOrEqual(60);
      const operating = BigInt(job.cost.energy) + BigInt(job.cost.water) + BigInt(job.cost.labor);
      await h.advance((jobMin + 1) * MIN);
      const outProduct = job.output.productId as string;
      const stock = (await p.ok("GET", "/inventory")).filter((l: { productId: string; cityId: string }) => l.productId === outProduct && l.cityId === c.cityId);
      expect(stock.reduce((a: number, l: { qtyKg: number }) => a + l.qtyKg, 0)).toBe(job.output.qtyKg);
      expect(await bal(h, c.companyId, "wip")).toBe(0n);

      // --- ilk gelir
      const cashBefore = await cashOf(c.companyId);
      const sold = await sellToSystem(p, c.cityId, outProduct);
      expect(sold.qtyKg).toBe(job.output.qtyKg);
      expect((await cashOf(c.companyId)) - cashBefore).toBe(sold.gross - sold.fee);
      const saleNets: bigint[] = [];
      for (const id of sold.saleIds) { const d = await p.ok("GET", `/finance/sales/${id}`); saleNets.push(BigInt((d.sale ?? d).netProfit)); }
      const net = saleNets.reduce((a, x) => a + x, 0n);
      expect(net).toBe(sold.gross - sold.cogs - sold.fee);
      expect(net).toBeGreaterThan(0n);
      const netPerKg = ((sold.gross - sold.fee) * 1000n) / BigInt(sold.qtyKg); // kuruş / ton (tam sayı)

      // --- sonraki yatırım: gerçek seçenekler
      const level = (await p.ok("GET", "/company")).level as number;
      const alts: Alt[] = [];
      const batchRevenueNet = sold.gross - sold.fee; // bir parti, net satış
      const rv = await p.ok("GET", "/research");
      for (const it of rv.items as Array<{ researchId: string; level: number; nextCost: string | null; nextMinutes: number | null; minCompanyLevel: number }>) {
        const def = cat.researchDef(it.researchId);
        const eff = def.effect as { kind: string; sector?: string; bpPerLevel?: number; perLevel?: number };
        const cost = it.nextCost ? BigInt(it.nextCost) : 0n;
        let gain = 0n; let relevant = false;
        if (eff.kind === "yield" && eff.sector === j.sector) { relevant = true; gain = (batchRevenueNet * BigInt(eff.bpPerLevel!)) / 10000n; }
        else if (eff.kind === "efficiency" && eff.sector === j.sector) { relevant = true; gain = ((BigInt(job.cost.energy) + BigInt(job.cost.labor)) * BigInt(eff.bpPerLevel!)) / 10000n; }
        else if (eff.kind === "quality") {
          relevant = true;
          const qn = job.output.quality as number;
          const qp = BigInt(QUALITY_PRICE_BP[Math.min(5, qn + 1)]!) - BigInt(QUALITY_PRICE_BP[qn]!);
          gain = (batchRevenueNet * qp) / BigInt(QUALITY_PRICE_BP[qn]!);
        }
        if (!relevant) continue;
        const available = it.nextCost !== null && it.minCompanyLevel <= level && it.nextMinutes! <= 60 && cost <= (await cashOf(c.companyId));
        alts.push({ kind: "research", id: it.researchId, cost, available, reason: available ? undefined : "kilitli", gainPerUnit: gain, unit: "parti", paybackUnits: gain > 0n ? Number((cost + gain - 1n) / gain) : null });
      }
      const bt = cat.buildingType(fac.type);
      // tesis kalitesi
      {
        const cost = BigInt(bt.qualityUpgradeCosts[0] ?? 0);
        const qn = job.output.quality as number;
        const qp = BigInt(QUALITY_PRICE_BP[Math.min(5, qn + 1)]!) - BigInt(QUALITY_PRICE_BP[qn]!);
        const gain = (batchRevenueNet * qp) / BigInt(QUALITY_PRICE_BP[qn]!);
        alts.push({ kind: "facility_quality", id: `${fac.type}:q${fac.qualityLevel}→${fac.qualityLevel + 1}`, cost, available: cost > 0n && cost <= (await cashOf(c.companyId)), gainPerUnit: gain, unit: "parti", paybackUnits: gain > 0n ? Number((cost + gain - 1n) / gain) : null });
      }
      // tesis seviyesi: gerçek isteğin sonucu (şirket seviyesi yetmiyorsa LEVEL_TOO_LOW)
      {
        const ld = cat.levelDef(fac.type, fac.level);
        const probe = await p.post(`/facilities/${fac.id}/upgrade`, { idempotencyKey: h.key() });
        expect(probe.status).toBeGreaterThanOrEqual(400); // seviye 1 şirketle yükseltme açık değil
        alts.push({ kind: "facility_level", id: `${fac.type}:L${fac.level}→${fac.level + 1}`, cost: BigInt(ld.upgradeCost), available: false, reason: probe.body.error.code, gainPerUnit: 0n, unit: "parti", paybackUnits: null });
      }
      expect(alts.length).toBeGreaterThanOrEqual(3);
      const avail = alts.filter((a) => a.available && a.paybackUnits !== null).sort((a, b) => a.paybackUnits! - b.paybackUnits! || Number(a.cost - b.cost));
      expect(avail.length).toBeGreaterThan(0);
      const chosen = avail[0]!;
      const cashPre = await cashOf(c.companyId);
      let effect = "";
      if (chosen.kind === "research") {
        await p.ok("POST", `/research/${chosen.id}/start`, { idempotencyKey: h.key() });
        expect(cashPre - (await cashOf(c.companyId))).toBe(chosen.cost);
        const nm = ((await p.ok("GET", "/research")).items as Array<{ researchId: string; nextMinutes: number }>).find((x) => x.researchId === chosen.id)!;
        await h.advance(120 * MIN);
        const def = cat.researchDef(chosen.id);
        const eff = def.effect as { kind: string; bpPerLevel?: number };
        const q1 = await p.ok("POST", "/production/quote", { facilityId: fac.id, recipeId: pick.recipeId, batches: 1 });
        if (eff.kind === "yield") {
          const bp = eff.bpPerLevel!;
          expect(q1.output.qtyKg * 10000).toBeGreaterThan(q0.output.qtyKg * (10000 + bp) - 10000);
          expect(q1.output.qtyKg * 10000).toBeLessThan((q0.output.qtyKg + 1) * (10000 + bp));
          effect = `çıktı ${q0.output.qtyKg} → ${q1.output.qtyKg} kg/parti`;
        } else if (eff.kind === "efficiency") {
          expect(q1.energyKwh).toBe(Math.floor((q0.energyKwh * (10000 - eff.bpPerLevel!)) / 10000));
          expect(q1.laborHours).toBe(Math.floor((q0.laborHours * (10000 - eff.bpPerLevel!)) / 10000));
          expect(BigInt(q1.cost.total)).toBeLessThan(BigInt(q0.cost.total));
          effect = `enerji ${q0.energyKwh} → ${q1.energyKwh} kWh, maliyet ${q0.cost.total} → ${q1.cost.total}`;
        } else { expect(q1.output.quality).toBe(q0.output.quality + 1); effect = `kalite ${q0.output.quality} → ${q1.output.quality}`; }
        expect(nm.nextMinutes).toBeLessThanOrEqual(60);
      } else {
        await p.ok("POST", `/facilities/${fac.id}/quality`, { idempotencyKey: h.key() });
        expect(cashPre - (await cashOf(c.companyId))).toBe(chosen.cost);
        const up = (await p.ok("GET", "/facilities"))[0].upgrade;
        expect(Math.round((new Date(up.endsAt).getTime() - h.deps.clock.nowMs()) / MIN)).toBeLessThanOrEqual(60);
        await h.advance(61 * MIN);
        const q1 = await p.ok("POST", "/production/quote", { facilityId: fac.id, recipeId: pick.recipeId, batches: 1 });
        expect(q1.output.quality).toBe(q0.output.quality + 1);
        effect = `kalite ${q0.output.quality} → ${q1.output.quality}`;
      }
      expect(await cashOf(c.companyId)).toBeGreaterThan(0n);
      RESULTS[`yol:${j.label}`] = {
        city: c.cityId, plotPrice: c.plot.price, cash0, alternatives_firstJob: cand.map((x) => `${x.recipeId}${x.ok ? "" : ` (${x.blockers.join(",")})`}: maliyet ${x.cost}, kâr tahmini ${x.profit ?? "-"}, saat başı ${x.pph ?? "-"}`),
        firstJob: `${pick.recipeId} ${job.output.qtyKg} kg ${outProduct} (${jobMin} dk)`, jobCost: job.cost.total, operating, qtyKg: job.output.qtyKg,
        revenue: sold.gross, fee: sold.fee, cogs: sold.cogs, netProfit: net, netPerTonne: netPerKg,
        alts: alts.map((a) => `${a.kind} ${a.id}: bedel ${a.cost}, ${a.available ? `kazanç/parti ${a.gainPerUnit}, geri dönüş ${a.paybackUnits} parti` : `kapalı (${a.reason})`}`),
        chosen: `${chosen.kind} ${chosen.id}`, chosenCost: chosen.cost, chosenPayback: chosen.paybackUnits, effect,
      };
      expect(await checkInvariants(h.deps.db)).toEqual([]);
    }, 240_000);
  }

  it("taşımacılık: ilan panosundan ilk iş, ilk gelir, araç/araştırma seçenekleri arasından yatırım", async () => {
    const cat = h.deps.catalog;
    const p = await h.player();
    const c = await foundCo(p, "freight", "kavsak");
    const cash0 = await cashOf(c.companyId);
    await h.tick();
    const fleet = await p.ok("GET", "/fleet");
    expect(fleet).toHaveLength(1);
    const board = (await p.ok("GET", "/freight-jobs?scope=board")) as Array<{ id: string; isSystem: boolean; originCityId: string; destCityId: string; payAmount: string; totalKg: number; distanceKm: number; estMinutesForMe: number | null; netPerHourForMe: string | null; bestVehicleIdForMe: string | null; estCostForMe: string | null }>;
    const cands = board.filter((x) => x.isSystem && x.bestVehicleIdForMe && x.netPerHourForMe !== null && x.estMinutesForMe !== null && x.totalKg <= cat.vehicleModel(fleet[0].modelId).capacityKg);
    expect(cands.length).toBeGreaterThan(1); // gerçek seçenek: birden çok iş
    const ranked = [...cands].sort((a, b) => Number(BigInt(b.netPerHourForMe!) - BigInt(a.netPerHourForMe!)));
    const best = ranked[0]!;
    for (const x of cands) expect(x.estMinutesForMe!).toBeLessThanOrEqual(24 * 60);
    const acc = await p.ok("POST", `/freight-jobs/${best.id}/accept`, { vehicleId: best.bestVehicleIdForMe, idempotencyKey: h.key() });
    expect(["assigned", "in_transit"]).toContain(acc.status);
    let waited = 0;
    while (waited < 24 * 60) {
      const mine = (await p.ok("GET", "/freight-jobs?scope=mine")) as Array<{ id: string; status: string }>;
      if (mine.find((x) => x.id === best.id)?.status === "delivered") break;
      await h.advance(15 * MIN); waited += 15;
    }
    const [jobRow] = await h.deps.db.select().from(freightJobs).where(eq(freightJobs.id, best.id));
    expect(jobRow!.status).toBe("delivered");
    const [ship] = await h.deps.db.select().from(shipments).where(eq(shipments.id, jobRow!.shipmentId!));
    const shipMin = Math.round((ship!.arrivesAt.getTime() - ship!.departedAt.getTime()) / MIN);
    expect(shipMin).toBeLessThanOrEqual(60);
    const outs = await p.ok("GET", "/finance/outcomes");
    const o = outs.find((x: { kind: string; refId: string }) => x.kind === "freight_job" && x.refId === best.id);
    expect(o.status).toBe("settled");
    const revenue = BigInt(best.payAmount);
    expect(o.actual.revenue).toBe(revenue.toString());
    const fuel = ship!.fuelCost, driver = ship!.driverCost;
    const fee = applyBp(revenue, cat.settings.marketFeeBp);
    expect(o.actual.cost).toBe((fuel + driver).toString());
    expect(o.actual.fees).toBe(fee.toString());
    const net = revenue - fee - fuel - driver;
    expect(o.actual.profit).toBe(net.toString());
    expect(net).toBeGreaterThan(0n);
    expect((await cashOf(c.companyId)) - cash0).toBe(net);

    // seçenekler: ikinci araç (kamyonet / kamyon), yakıt ve hız araştırmaları
    const alts: Alt[] = [];
    const cash1 = await cashOf(c.companyId);
    for (const m of ["van", "truck"]) {
      const vm = cat.vehicleModel(m);
      const cost = BigInt(vm.price);
      // ikinci aracın getirisi: panodaki, bu aracın kapasitesine uyan en iyi işin net kârı (ücret − komisyon − kendi sefer maliyeti)
      const veh = { capacityKg: vm.capacityKg, speedKmh: vm.speedKmh, fuelPerKm: BigInt(vm.fuelPerKm) };
      const fr = cat.settings.freight;
      let gain = 0n;
      for (const x of board.filter((y) => y.isSystem && y.totalKg <= vm.capacityKg && y.id !== best.id)) {
        const trip = estimateOwnTrip(roadDistanceKm(x.originCityId, x.destCityId), veh, BigInt(cat.city(x.originCityId).wage), { loadingHours: fr.driverHoursPerTrip, handlingMinutes: fr.handlingMinutes });
        const g = BigInt(x.payAmount) - applyBp(BigInt(x.payAmount), cat.settings.marketFeeBp) - trip.total;
        if (g > gain) gain = g;
      }
      let reason: string | undefined; let available = cost <= cash1;
      if (!available) {
        const probe = await p.post("/fleet/buy", { modelId: m, cityId: "kavsak", idempotencyKey: h.key() });
        expect(probe.status).toBeGreaterThanOrEqual(400);
        reason = probe.body.error.code;
      }
      alts.push({ kind: "vehicle", id: m, cost, available, reason, gainPerUnit: gain, unit: "sefer", paybackUnits: gain > 0n ? Number((cost + gain - 1n) / gain) : null });
    }
    const ecoGain = (fuel * 800n) / 10000n;
    const rv = await p.ok("GET", "/research");
    for (const id of ["eco_driving", "route_planning"]) {
      const it = (rv.items as Array<{ researchId: string; nextCost: string; nextMinutes: number; minCompanyLevel: number }>).find((x) => x.researchId === id)!;
      const cost = BigInt(it.nextCost);
      const gain = id === "eco_driving" ? ecoGain : (net * 600n) / 10000n;
      alts.push({ kind: "research", id, cost, available: cost <= cash1 && it.minCompanyLevel <= 1, gainPerUnit: gain, unit: "sefer", paybackUnits: gain > 0n ? Number((cost + gain - 1n) / gain) : null });
      expect(it.nextMinutes).toBeLessThanOrEqual(60);
    }
    const avail = alts.filter((a) => a.available && a.paybackUnits !== null).sort((a, b) => a.paybackUnits! - b.paybackUnits! || Number(a.cost - b.cost));
    expect(alts.length).toBeGreaterThanOrEqual(3);
    expect(avail.length).toBeGreaterThan(0);
    const chosen = avail[0]!;
    const pre = await cashOf(c.companyId);
    let effect = "";
    if (chosen.kind === "vehicle") {
      const b = await p.ok("POST", "/fleet/buy", { modelId: chosen.id, cityId: "kavsak", idempotencyKey: h.key() });
      expect(b.modelId).toBe(chosen.id);
      expect(pre - (await cashOf(c.companyId))).toBe(chosen.cost);
      expect(await p.ok("GET", "/fleet")).toHaveLength(2);
      effect = "filo 1 → 2 araç";
    } else {
      await p.ok("POST", `/research/${chosen.id}/start`, { idempotencyKey: h.key() });
      expect(pre - (await cashOf(c.companyId))).toBe(chosen.cost);
      await h.advance(61 * MIN);
      const lvl = ((await p.ok("GET", "/research")).items as Array<{ researchId: string; level: number }>).find((x) => x.researchId === chosen.id)!.level;
      expect(lvl).toBe(1);
      effect = `${chosen.id} seviye 0 → 1`;
    }
    RESULTS["yol:Taşımacılık"] = {
      city: c.cityId, cash0, boardTop: ranked.slice(0, 3).map((x) => `${x.originCityId}→${x.destCityId} ${x.totalKg} kg, ücret ${x.payAmount}, ${x.estMinutesForMe} dk, saat başı net ${x.netPerHourForMe}`),
      firstJob: `${best.originCityId}→${best.destCityId} ${best.totalKg} kg, ${best.distanceKm} km (${shipMin} dk sefer)`, revenue, fee, fuel, driver, netProfit: net,
      alts: alts.map((a) => `${a.kind} ${a.id}: bedel ${a.cost}, ${a.available ? `kazanç/sefer ${a.gainPerUnit}, geri dönüş ${a.paybackUnits} sefer` : `kapalı (${a.reason})`}`),
      chosen: `${chosen.kind} ${chosen.id}`, chosenCost: chosen.cost, chosenPayback: chosen.paybackUnits, effect,
    };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, 240_000);

  it("inşaat ve yükseltme: yeni arsa + bina, seviye yükseltme, kalite iyileştirme süreleri 60 dk'yı aşmaz", async () => {
    const f = await foundKit(h, "crop", "yesilova");
    await grantCash(h, f.companyId, 60_000_000n);
    await grantStockKit(h, f.companyId, "yesilova", "steel", 2, 30_000, 3_000_000n);
    const plots = (await f.p.ok("GET", "/world/plots?cityId=yesilova")).plots as Array<{ id: string; owner: unknown; minLevel: number; deposit: unknown }>;
    const free = plots.find((x) => !x.owner && x.minLevel <= 1 && !x.deposit)!;
    expect(free).toBeTruthy();
    const cash0 = await cashOf(f.companyId);
    const built = await f.p.ok("POST", `/plots/${free.id}/buy`, { buildingType: "field", idempotencyKey: h.key() });
    expect(built.status).toBe("constructing");
    const bt = h.deps.catalog.buildingType("field");
    const buildMin = Math.round((new Date(built.constructionEndsAt).getTime() - h.deps.clock.nowMs()) / MIN);
    expect(buildMin).toBeLessThanOrEqual(60);
    expect(cash0 - (await cashOf(f.companyId))).toBe(BigInt(bt.buildCost) + BigInt((plots.find((x) => x.id === free.id) as unknown as { price: string }).price));
    await h.advance((buildMin + 1) * MIN);
    const ready = (await f.p.ok("GET", `/facilities/${built.id}`));
    expect(ready.status).toBe("idle"); // inşaat bitti, tesis boşta
    // seviye yükseltme (şirket seviyesi 2)
    await setLevel(h, f.companyId, 2);
    const cash1 = await cashOf(f.companyId);
    const up = await f.p.ok("POST", `/facilities/${built.id}/upgrade`, { idempotencyKey: h.key() });
    const ld = h.deps.catalog.levelDef("field", 1);
    expect(cash1 - (await cashOf(f.companyId))).toBe(BigInt(ld.upgradeCost));
    const upMin = Math.round((new Date(up.upgrade.endsAt).getTime() - h.deps.clock.nowMs()) / MIN);
    expect(upMin).toBeLessThanOrEqual(60);
    await h.advance((upMin + 1) * MIN);
    const l2 = await f.p.ok("GET", `/facilities/${built.id}`);
    expect(l2.level).toBe(2);
    // kalite iyileştirme
    const q = await f.p.ok("POST", `/facilities/${built.id}/quality`, { idempotencyKey: h.key() });
    const qMin = Math.round((new Date(q.upgrade.endsAt).getTime() - h.deps.clock.nowMs()) / MIN);
    expect(qMin).toBeLessThanOrEqual(60);
    await h.advance((qMin + 1) * MIN);
    expect((await f.p.ok("GET", `/facilities/${built.id}`)).qualityLevel).toBe(2);
    RESULTS["tempo.insaat"] = { insaatDk: buildMin, yukseltmeDk: upMin, kaliteDk: qMin, katalogInsaatDk: bt.buildMinutes, katalogYukseltmeDk: ld.upgradeMinutes };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, 120_000);

  it("süre tavanı: üretim, inşaat, yükseltme, araştırma, sevkiyat kayıtlarının hiçbiri 60 dk'yı aşmaz", async () => {
    const w = await (await h.player()).ok("GET", "/world");
    expect(w.pace.maxMinutes).toBe(60);
    expect(h.deps.catalog.settings.pace.maxMinutes).toBe(60);
    expect(Math.max(...w.recipes.map((r: { minutes: number }) => r.minutes))).toBeLessThanOrEqual(60);
    expect(Math.max(...w.buildingTypes.map((b: { buildMinutes: number }) => b.buildMinutes))).toBeLessThanOrEqual(60);
    expect(Math.max(...w.research.map((r: { baseMinutes: number }) => r.baseMinutes))).toBeLessThanOrEqual(60);
    const r = (await rows<{ prod: string; prodN: number; ship: string; shipN: number; build: string; buildN: number; frJob: string }>(sql`
      SELECT (SELECT coalesce(max(extract(epoch from ends_at - started_at)/60),0) FROM cf.production_jobs) prod,
             (SELECT count(*)::int FROM cf.production_jobs) "prodN",
             (SELECT coalesce(max(extract(epoch from arrives_at - departed_at)/60),0) FROM cf.shipments) ship,
             (SELECT count(*)::int FROM cf.shipments) "shipN",
             (SELECT coalesce(max(extract(epoch from construction_ends_at - created_at)/60),0) FROM cf.facilities WHERE construction_ends_at IS NOT NULL) build,
             (SELECT count(*)::int FROM cf.facilities WHERE construction_ends_at IS NOT NULL) "buildN",
             (SELECT coalesce(max(extract(epoch from deadline_at - created_at)/3600),0) FROM cf.freight_jobs) "frJob"`))[0]!;
    expect(Number(r.prod)).toBeLessThanOrEqual(60);
    expect(Number(r.ship)).toBeLessThanOrEqual(60);
    expect(Number(r.build)).toBeLessThanOrEqual(60);
    expect(r.prodN).toBeGreaterThan(0);
    expect(r.shipN).toBeGreaterThan(0);
    RESULTS["tempo"] = { maxUretimDk: Number(r.prod), uretimSayisi: r.prodN, maxSevkiyatDk: Number(r.ship), sevkiyatSayisi: r.shipN, maxInsaatDk: Number(r.build), insaatSayisi: r.buildN };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });
});

// ================================================================== 3) tekrarlayan teslimat sözleşmesi

describe("3) iki oyuncu şirketi arasında tekrarlayan teslimat sözleşmesi", () => {
  it("karşılaştırma (kabul öncesi) → kabul → 4 taksit (kendi aracı, sistem taşımacısı işi, oyuncu taşımacı işi) → hepsi yerleşir; beklenen ↔ gerçekleşen", async () => {
    const cat = h.deps.catalog;
    const seller = await foundKit(h, "crop", "yesilova");
    const buyer = await foundKit(h, "manufacturing", "korfezkent", "food_plant");
    const orderer = await h.player(); const ordererId = (await foundCo(orderer, "crop", "akyayla")).companyId;
    await grantCash(h, buyer.companyId, 15_000_000n);
    await grantCash(h, seller.companyId, 8_000_000n); // teminat + kamyonet
    await grantCash(h, ordererId, 6_000_000n);

    // satıcının stoku: tahıl, birim maliyeti 150 kuruş/kg (üretim zinciri senaryo 2'de ayrıca doğrulandı)
    const QUAL = 3;
    await grantStockKit(h, seller.companyId, seller.cityId, "grain", QUAL, 12_000, 1_800_000n);
    const avgCost = 150n;
    const dest = buyer.cityId;
    const km = roadDistanceKm(seller.cityId, dest);
    const QTY = 3000, N = 4, PRICE = 600;
    const goodsPer = BigInt(QTY * PRICE);
    const frPer = fq(km, QTY);

    // alıcı tarafında rakip: teslim şehrinde tahıl alım emri (spot karşılaştırması için)
    await orderer.ok("POST", "/market/orders", withKey(h, { cityId: dest, productId: "grain", minQuality: 1, qtyKg: 12_000, maxPricePerKg: 380 }));

    const t0 = h.deps.clock.nowMs();
    const prop = await seller.p.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: buyer.companyId, productId: "grain", minQuality: 1, qtyPerInstallmentKg: QTY, pricePerKg: PRICE,
      deliveryCityId: dest, freightPayer: "seller", installments: N, firstDueAt: new Date(t0 + 6 * HOUR).toISOString(), intervalHours: 6, graceHours: 2, penaltyBp: 1000,
    }));

    // ---- kabul ÖNCESİ karşılaştırma (iki taraf)
    const cs = await seller.p.ok("GET", `/contracts/${prop.id}/compare`);
    expect(cs.myRole).toBe("seller");
    const floorDiv = (a: bigint, b: bigint): bigint => (a / b) - (a % b !== 0n && a < 0n ? 1n : 0n);
    expect(cs.perInstallment).toEqual({ qtyKg: QTY, goods: goodsPer.toString(), freight: frPer.toString(), fees: "0", net: (goodsPer - frPer).toString(), perKg: floorDiv(goodsPer - frPer, BigInt(QTY)).toString() });
    expect(cs.total).toEqual({ qtyKg: QTY * N, goods: (goodsPer * 4n).toString(), freight: (frPer * 4n).toString(), fees: "0", net: ((goodsPer - frPer) * 4n).toString() });
    expect(cs.schedule.installments).toBe(N);
    expect(new Date(cs.schedule.lastDueAt).getTime() - new Date(cs.schedule.firstDueAt).getTime()).toBe(18 * HOUR);
    expect(cs.commitment).toEqual({ sellerDeposit: (goodsPer * 4n / 10n).toString(), buyerEscrow: (goodsPer * 4n).toString(), penaltyPerMissed: (goodsPer / 10n).toString() });
    expect(cs.avgCostPerKg).toBe(avgCost.toString());
    expect(cs.myStockKg).toBe(12_000);
    // spot: teslim şehri veya stok şehrindeki en iyi alım emri (kg başı net en yüksek olan)
    expect([dest, seller.cityId]).toContain(cs.spotNow.cityId);
    const fill = cs.spotNow.fillKg as number;
    const spotGoods = BigInt(fill) * BigInt(cs.spotNow.pricePerKg);
    const spotFreight = cs.spotNow.cityId === seller.cityId ? 0n : fq(roadDistanceKm(seller.cityId, cs.spotNow.cityId), fill);
    const spotNet = spotGoods - applyBp(spotGoods, cat.settings.marketFeeBp) - spotFreight;
    expect(cs.spotNow.net).toBe(spotNet.toString());
    expect(cs.spotNow.perKg).toBe((spotNet / BigInt(fill)).toString());
    const cb = await buyer.p.ok("GET", `/contracts/${prop.id}/compare`);
    expect(cb.myRole).toBe("buyer");
    expect(cb.perInstallment.goods).toBe(goodsPer.toString());
    // alıcı için "spot": açık satış ilanlarından en ucuz teslim maliyeti (varsa); mal + navlun
    if (cb.spotNow) {
      const sf = cb.spotNow.cityId === dest ? 0n : fq(roadDistanceKm(cb.spotNow.cityId, dest), cb.spotNow.fillKg);
      expect(cb.spotNow.net).toBe((BigInt(cb.spotNow.fillKg) * BigInt(cb.spotNow.pricePerKg) + sf).toString());
    }

    // ---- kabul
    const bCash0 = await cashOf(buyer.companyId), sCash0 = await cashOf(seller.companyId);
    await buyer.p.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const acceptedAt = h.deps.clock.nowMs();
    expect(await bal(h, buyer.companyId, "escrow")).toBe(goodsPer * 4n);
    expect(await bal(h, seller.companyId, "escrow")).toBe(goodsPer * 4n / 10n);
    expect(bCash0 - (await cashOf(buyer.companyId))).toBe(goodsPer * 4n);
    expect(sCash0 - (await cashOf(seller.companyId))).toBe(goodsPer * 4n / 10n);
    const so0 = (await seller.p.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(so0.status).toBe("pending");
    expect(so0.expected.revenue).toBe((goodsPer * 4n).toString());
    expect(so0.expected.freight).toBe((frPer * 4n).toString());
    expect(so0.expected.cost).toBe((avgCost * BigInt(QTY * N)).toString());
    expect(so0.expected.profit).toBe((goodsPer * 4n - frPer * 4n - avgCost * BigInt(QTY * N)).toString());
    const bo0 = (await buyer.p.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(bo0.expected.goods).toBe((goodsPer * 4n).toString());

    // ---- teslimler
    const carrier = await foundKit(h, "freight", seller.cityId);
    const carrierSameCity = carrier.cityId === seller.cityId;
    await grantCash(h, seller.companyId, 6_000_000n);
    const van = await seller.p.ok("POST", "/fleet/buy", { modelId: "van", cityId: seller.cityId, idempotencyKey: h.key() });
    const mode: string[] = [];
    const settledIn: number[] = [];
    for (let k = 0; k < N; k++) {
      let det = await seller.p.ok("GET", `/contracts/${prop.id}`);
      const opens = new Date(det.schedule[k].windowOpensAt).getTime();
      if (opens > h.deps.clock.nowMs()) await h.advance(opens - h.deps.clock.nowMs() + MIN);
      const cargo = [{ productId: "grain", quality: QUAL, qtyKg: QTY }];
      if (k === 0) {
        mode.push("kendi aracı (kamyonet)");
        await seller.p.ok("POST", "/shipments", { vehicleId: van.id, destCityId: dest, cargo, contractInstallmentId: det.schedule[k].id, idempotencyKey: h.key() });
      } else if (k === 2 && carrierSameCity) {
        mode.push("taşıma işi, oyuncu taşımacı");
        const fj = await seller.p.ok("POST", "/freight-jobs", withKey(h, { originCityId: seller.cityId, destCityId: dest, cargo, contractInstallmentId: det.schedule[k].id, payAmount: Number(frPer), deadlineHours: 24, allowSystemCarrier: false }));
        const veh = (await carrier.p.ok("GET", "/fleet"))[0];
        expect(veh.cityId).toBe(seller.cityId);
        await carrier.p.ok("POST", `/freight-jobs/${fj.id}/accept`, withKey(h, { vehicleId: veh.id }));
      } else {
        mode.push("taşıma işi, sistem taşımacısı");
        await seller.p.ok("POST", "/freight-jobs", withKey(h, { originCityId: seller.cityId, destCityId: dest, cargo, contractInstallmentId: det.schedule[k].id, payAmount: Number(frPer), deadlineHours: 24, allowSystemCarrier: true }));
      }
      let waited = 0;
      for (;;) {
        det = await seller.p.ok("GET", `/contracts/${prop.id}`);
        if (det.schedule[k].status === "fulfilled") break;
        expect(waited, `taksit ${k + 1} teslim süresi`).toBeLessThan(6 * 60);
        await h.advance(15 * MIN); waited += 15;
      }
      settledIn.push(waited);
      expect(det.schedule[k].qtyLateKg).toBe(0);
      expect(det.schedule[k].paidToSeller).toBe(goodsPer.toString());
    }
    // vade sonrasına kadar ilerle: sözleşme kapanır
    await h.advance(26 * HOUR - (h.deps.clock.nowMs() - acceptedAt) > 0 ? 26 * HOUR - (h.deps.clock.nowMs() - acceptedAt) : MIN);
    const [ct] = await h.deps.db.select().from(contracts).where(eq(contracts.id, prop.id));
    expect(ct!.status).toBe("completed");
    const insts = await h.deps.db.select().from(contractInstallments).where(eq(contractInstallments.contractId, prop.id));
    expect(insts).toHaveLength(N);
    for (const i of insts) { expect(i.status).toBe("fulfilled"); expect(i.settledAt).not.toBeNull(); expect(i.qtyDeliveredKg).toBe(QTY); expect(i.penalty).toBe(0n); }
    // hepsi tam bir kez yerleşti
    const settleTx = await rows<{ ref_id: string; n: number }>(sql`SELECT ref_id, count(*)::int n FROM cf.ledger_transactions WHERE kind = 'installment_settle' AND ref_id IN (${sql.join(insts.map((i) => sql`${i.id}`), sql`, `)}) GROUP BY ref_id`);
    expect(settleTx).toHaveLength(N);
    expect(settleTx.every((r) => r.n === 1)).toBe(true);
    expect(await bal(h, buyer.companyId, "escrow")).toBe(0n);
    expect(await bal(h, seller.companyId, "escrow")).toBe(0n);

    // ---- gerçekleşen
    const ss = await rows<{ id: string; gross: string; cogs: string; freight: string; fees: string; net_profit: string; qty_kg: number; source: string; shipment_id: string | null }>(sql`SELECT id, gross::text, cogs::text, freight::text, fees::text, net_profit::text, qty_kg::int, source, shipment_id FROM cf.sales WHERE contract_id = ${prop.id} ORDER BY created_at, id`);
    expect(ss).toHaveLength(N);
    for (const x of ss) {
      expect(x.source).toBe("contract");
      expect(x.gross).toBe(goodsPer.toString());
      expect(x.fees).toBe("0");
      expect(BigInt(x.net_profit)).toBe(BigInt(x.gross) - BigInt(x.cogs) - BigInt(x.freight) - BigInt(x.fees));
    }
    const sumSales = (f: (x: typeof ss[number]) => string) => ss.reduce((a, x) => a + BigInt(f(x)), 0n);
    const so = (await seller.p.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(so.status).toBe("settled");
    expect(so.actual.qtyKg).toBe(QTY * N);
    expect(so.actual.revenue).toBe((goodsPer * 4n).toString());
    expect(so.actual.cost).toBe(sumSales((x) => x.cogs).toString());
    expect(so.actual.freight).toBe(sumSales((x) => x.freight).toString());
    expect(so.actual.profit).toBe(sumSales((x) => x.net_profit).toString());
    expect(so.saleIds).toHaveLength(N);
    const bo = (await buyer.p.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(bo.status).toBe("settled");
    expect(bo.actual.goods).toBe((goodsPer * 4n).toString());
    expect(bo.actual.qtyKg).toBe(QTY * N);
    // alıcının stoğu: 4 × 500 kg, maliyet = 900.000
    const bh = await holding(h, buyer.companyId, dest, "grain", QUAL);
    expect(bh.qty).toBe(QTY * N);
    expect(bh.cost).toBe(goodsPer * 4n);
    // defter: bütün sözleşme işlemleri dengeli; alıcı nakdi tam 900.000 azaldı (emanet → satıcı)
    const led = await entriesOf(so.ledgerTransactionIds, seller.companyId);
    for (const [tx, v] of Object.entries(led.perTxSums)) expect(v, `işlem ${tx}`).toBe(0n);
    const ledB = await entriesOf(bo.ledgerTransactionIds, buyer.companyId);
    expect(ledB.byCode.escrow ?? 0n).toBe(0n); // emanet: kabulde girdi, teslimlerde çıktı
    expect(ledB.byCode.cash).toBe(-(goodsPer * 4n));
    expect(ledB.byCode.inventory).toBe(goodsPer * 4n);
    RESULTS["sozlesme"] = {
      route: `${seller.cityId} → ${dest} (${km} km)`, qtyPerInstallment: QTY, installments: N, price: PRICE, avgCostPerKg: avgCost,
      compare: { perInstallment: cs.perInstallment, total: cs.total, commitment: cs.commitment, spotNow: cs.spotNow, contractNetPerKg: cs.perInstallment.perKg },
      modes: mode, minutesToSettle: settledIn,
      expected: { revenue: so0.expected.revenue, freight: so0.expected.freight, cost: so0.expected.cost, profit: so0.expected.profit },
      actual: { revenue: so.actual.revenue, freight: so.actual.freight, cost: so.actual.cost, profit: so.actual.profit, fees: so.actual.fees },
      salesFreight: ss.map((x) => x.freight), buyerGoods: bo.actual.goods, carrierSameCity,
    };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, 300_000);
});

// ================================================================== 4) çevrimdışı tamamlanma

describe("4) çevrimdışı tamamlanma: oyuncu istek atmaz, saat ilerler", () => {
  it("üretim zinciri, araştırma, kendi sevkiyatı, alım+teslim, sözleşme taksitleri tam bir kez yerleşir", async () => {
    const cat = h.deps.catalog;
    // oyuncular
    const mf = await foundKit(h, "manufacturing", "korfezkent", "food_plant");
    const fr = await foundKit(h, "freight", "kavsak");
    const sup = await h.player(); const supId = (await foundCo(sup, "crop", "yesilova")).companyId;
    const buyer = await foundKit(h, "crop", "yesilova");
    const cs = await foundKit(h, "crop", "yesilova"); // sözleşme satıcısı
    const cb = await foundKit(h, "manufacturing", "korfezkent", "food_plant"); // sözleşme alıcısı
    for (const id of [mf.companyId, buyer.companyId, cs.companyId, cb.companyId, fr.companyId]) await grantCash(h, id, 20_000_000n);
    // 1) üretim zinciri: başlangıç 2.000 + 6.000 kg tahıl = 4 parti; tekrar modu
    await grantStockKit(h, mf.companyId, "korfezkent", "grain", 3, 6000, 600_000n);
    const first = await mf.p.ok("POST", "/production/start", { facilityId: mf.facilityId, recipeId: "mill_flour", batches: 1, repeat: true, idempotencyKey: h.key() });
    const xp0 = (await mf.p.ok("GET", "/company")).xp as number;
    // 2) araştırma
    await mf.p.ok("POST", "/research/lean_process/start", { idempotencyKey: h.key() });
    // 3) kendi sevkiyatı: taşımacı kendi stokunu taşır
    await grantStockKit(h, fr.companyId, fr.cityId, "grain", 3, 1000, 100_000n);
    const veh = (await fr.p.ok("GET", "/fleet"))[0];
    const frDest = fr.cityId === "yesilova" ? "kavsak" : "yesilova";
    const ship = await fr.p.ok("POST", "/shipments", { vehicleId: veh.id, destCityId: frDest, cargo: [{ productId: "grain", quality: 3, qtyKg: 1000 }], idempotencyKey: h.key() });
    // 4) alım + teslim (sistem taşımacısı işi)
    await grantStock(h, supId, "demirdag", "grain", 3, 6000, 1n);
    const lid = await listing(sup, "demirdag", "grain", 6000, 300, 3);
    const buyRes = await buyer.p.ok("POST", `/market/listings/${lid}/buy`, { qtyKg: 6000, expectedPricePerKg: 300, deliverToCityId: buyer.cityId, idempotencyKey: h.key() });
    const buyCash = await cashOf(buyer.companyId);
    // 5) sözleşme: 3 taksit için taşıma işleri önceden açık; 4. taksit hiç teslim edilmez (kaçırılır)
    await grantStockKit(h, cs.companyId, cs.cityId, "grain", 3, 2000, 200_000n);
    const t0 = h.deps.clock.nowMs();
    const prop = await cs.p.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: cb.companyId, productId: "grain", minQuality: 1, qtyPerInstallmentKg: 500, pricePerKg: 450,
      deliveryCityId: cb.cityId, freightPayer: "seller", installments: 4, firstDueAt: new Date(t0 + 3 * HOUR).toISOString(), intervalHours: 2, graceHours: 2, penaltyBp: 1000,
    }));
    await cb.p.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const det = await cs.p.ok("GET", `/contracts/${prop.id}`);
    const frPer = fq(roadDistanceKm(cs.cityId, cb.cityId), 500);
    for (let k = 0; k < 3; k++) {
      await cs.p.ok("POST", "/freight-jobs", withKey(h, { originCityId: cs.cityId, destCityId: cb.cityId, cargo: [{ productId: "grain", quality: 3, qtyKg: 500 }], contractInstallmentId: det.schedule[k].id, payAmount: Number(frPer), deadlineHours: 24, allowSystemCarrier: true }));
    }
    const bCash0 = await cashOf(cb.companyId);
    const cashes0 = { mf: await cashOf(mf.companyId) };
    const keysBefore = (await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.idempotency_keys`))[0]!.n;

    // ---- çevrimdışı: hiçbir HTTP isteği yok
    let calls = 0;
    const app = h.app as unknown as { inject: (...a: unknown[]) => unknown };
    const origInject = app.inject.bind(h.app);
    app.inject = (...a: unknown[]) => { calls++; return origInject(...a); };
    try { await h.advance(60 * HOUR); } finally { app.inject = origInject; }
    expect(calls).toBe(0);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.idempotency_keys`))[0]!.n).toBe(keysBefore);

    // ---- sonuçlar
    const jobsRows = await h.deps.db.select().from(productionJobs).where(eq(productionJobs.companyId, mf.companyId));
    const done = jobsRows.filter((j) => j.status === "completed");
    expect(done).toHaveLength(4); // 8.000 kg tahıl / 2.000
    expect(jobsRows.filter((j) => j.status === "running")).toHaveLength(0);
    expect(done.every((j) => j.settleTransactionId !== null)).toBe(true);
    const settleN = (await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'production_settle' AND ref_id IN (${sql.join(done.map((j) => sql`${j.id}`), sql`, `)})`))[0]!.n;
    expect(settleN).toBe(4);
    const outMoves = (await rows<{ n: number; q: number }>(sql`SELECT count(*)::int n, coalesce(sum(qty_kg),0)::int q FROM cf.inventory_movements WHERE kind = 'production_output' AND ref_id IN (${sql.join(done.map((j) => sql`${j.id}`), sql`, `)})`))[0]!;
    expect(outMoves.n).toBe(4);
    const outKg = done.reduce((a, j) => a + j.outputKg, 0);
    expect(outMoves.q).toBe(outKg);
    const flourStock = (await mf.p.ok("GET", "/inventory")).filter((l: { productId: string }) => l.productId === "flour").reduce((a: number, l: { qtyKg: number }) => a + l.qtyKg, 0);
    expect(flourStock).toBe(outKg);
    expect(await bal(h, mf.companyId, "wip")).toBe(0n);
    expect((await mf.p.ok("GET", "/company")).xp).toBe(xp0 + 4 * cat.settings.xp.productionJob);
    expect(first.id).toBeTruthy();
    const rs = ((await mf.p.ok("GET", "/research")).items as Array<{ researchId: string; level: number; inProgress: unknown }>).find((x) => x.researchId === "lean_process")!;
    expect(rs.level).toBe(1);
    expect(rs.inProgress).toBeNull();
    const resTx = (await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'research' AND ref_id = 'lean_process' AND idempotency_key LIKE ${`research:${mf.companyId}:%`}`))[0]!.n;
    expect(resTx).toBe(1);
    // kendi sevkiyatı
    expect((await holding(h, fr.companyId, frDest, "grain", 3)).qty).toBe(1000);
    expect((await holding(h, fr.companyId, fr.cityId, "grain", 3)).qty).toBe(0);
    // alım + teslim
    const bh = await holding(h, buyer.companyId, buyer.cityId, "grain", 3);
    expect(bh.qty).toBe(6000);
    expect(bh.cost).toBe(6000n * 300n + BigInt(buyRes.freightPay));
    expect(await bal(h, buyer.companyId, "escrow")).toBe(0n);
    void buyCash; void ship;
    // sözleşme: 3 teslim edildi, 4. kaçırıldı; hepsi tam bir kez yerleşti
    const insts = await h.deps.db.select().from(contractInstallments).where(eq(contractInstallments.contractId, prop.id));
    insts.sort((a, b) => a.seq - b.seq);
    expect(insts.map((i) => i.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "missed"]);
    expect(insts[3]!.penalty).toBe(22_500n);
    expect(insts.every((i) => i.settledAt !== null)).toBe(true);
    const cr = await rows<{ ref_id: string; n: number }>(sql`SELECT ref_id, count(*)::int n FROM cf.ledger_transactions WHERE kind = 'installment_settle' AND ref_id IN (${sql.join(insts.map((i) => sql`${i.id}`), sql`, `)}) GROUP BY ref_id`);
    expect(cr).toHaveLength(4); expect(cr.every((r) => r.n === 1)).toBe(true);
    expect((await h.deps.db.select().from(contracts).where(eq(contracts.id, prop.id)))[0]!.status).toBe("completed");
    expect(await bal(h, cb.companyId, "escrow")).toBe(0n);
    expect(await bal(h, cs.companyId, "escrow")).toBe(0n);
    // alıcı: kabulde 4 × 225.000 emanet (nakit −900.000); 3 teslim emanetten satıcıya; kaçan taksit: emanet iadesi 225.000 + ceza 22.500
    const cbOut = (await cb.p.ok("GET", "/finance/outcomes")).find((x: { kind: string; refId: string }) => x.kind === "contract" && x.refId === prop.id);
    expect(cbOut.status).toBe("settled");
    const cbLed = await entriesOf(cbOut.ledgerTransactionIds, cb.companyId);
    for (const [tx, v] of Object.entries(cbLed.perTxSums)) expect(v, `işlem ${tx}`).toBe(0n);
    expect(cbLed.byCode.cash).toBe(-900_000n + 225_000n + 22_500n);
    expect(cbLed.byCode.escrow ?? 0n).toBe(0n);
    expect(cbOut.actual.goods).toBe("675000");
    void bCash0;
    const sales = await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.sales WHERE contract_id = ${prop.id}`);
    expect(sales[0]!.n).toBe(3);
    // sevkiyatlar: hepsi teslim, varış işlemi tek
    const shRows = await rows<{ id: string; status: string; job: string | null; n: number }>(sql`SELECT s.id, s.status, s.freight_job_id::text job, (SELECT count(*)::int FROM cf.ledger_transactions t WHERE t.kind = 'shipment_arrive' AND t.ref_id = s.id::text) n FROM cf.shipments s`);
    expect(shRows.length).toBeGreaterThanOrEqual(5); // 1 kendi + 1 alım teslimi + 3 sözleşme
    for (const r of shRows) { expect(r.status).toBe("delivered"); expect(r.n).toBeLessThanOrEqual(1); if (r.job) expect(r.n).toBe(1); }
    const frj = await rows<{ status: string }>(sql`SELECT status FROM cf.freight_jobs WHERE shipper_company_id IN (${buyer.companyId}, ${cs.companyId})`);
    expect(frj).toHaveLength(4); // 1 alım teslimi (6.000 kg = tek kamyon) + 3 sözleşme taksiti
    expect(frj.every((r) => r.status === "delivered")).toBe(true);

    // ---- çift yerleşme yok: eşzamanlı üç tur + 24 saat daha; sayımlar aynı
    const snap = async () => ({
      tx: (await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions`))[0]!.n,
      settle: (await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind IN ('production_settle','shipment_arrive','installment_settle')`))[0]!.n,
    });
    const before = await snap();
    await Promise.all([h.tick(), h.tick(), h.tick()]);
    const after1 = await snap();
    expect(after1.settle).toBe(before.settle);
    // oyuncu döndü: bildirimler
    const notes = (await mf.p.ok("GET", "/notifications")) as Array<{ kind: string }> | { items: Array<{ kind: string }> };
    const list = Array.isArray(notes) ? notes : notes.items;
    expect(list.filter((n) => n.kind === "production_done").length).toBe(4);
    const cNotes = (await cb.p.ok("GET", "/notifications")) as Array<{ kind: string }> | { items: Array<{ kind: string }> };
    const cList = Array.isArray(cNotes) ? cNotes : cNotes.items;
    expect(cList.filter((n) => n.kind === "installment_closed").length).toBe(4);
    // /company nakdi defterle aynı
    expect((await mf.p.ok("GET", "/company")).cash).toBe((await cashOf(mf.companyId)).toString());
    RESULTS["cevrimdisi"] = {
      saatIlerletme: 60, httpIstegi: calls, idempotencyAnahtarDegisimi: 0,
      uretim: { tamamlanan: done.length, settleTx: settleN, cikti: outKg, un: flourStock, xpArtis: 4 * cat.settings.xp.productionJob },
      arastirma: "lean_process seviye 1 (1 işlem)", kendiSevkiyat: "1.000 kg varış, 1 varış işlemi",
      alimTeslim: { kg: 6000, maliyet: bh.cost, navlun: buyRes.freightPay },
      sozlesme: insts.map((i) => `${i.seq}:${i.status}${i.penalty ? ` ceza ${i.penalty}` : ""}`), sevkiyatSayisi: shRows.length, cashMf0: cashes0.mf,
    };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  }, 300_000);
});

// ================================================================== 5) canlı güncellemeden sağ çıkma

/** cf şemasındaki (katalog, meta ve tahmin tablosu hariç) her tablonun satır sayısı + içerik özeti */
async function worldDigest(): Promise<Record<string, string>> {
  const tables = (await rows<{ t: string }>(sql`SELECT table_name t FROM information_schema.tables WHERE table_schema = 'cf' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.t);
  const out: Record<string, string> = {};
  for (const t of tables) {
    if (["catalog_items", "catalog_history", "meta", "deal_outcomes"].includes(t)) continue;
    const r = (await rows<{ n: number; d: string | null }>(sql.raw(`SELECT count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text), '')) d FROM cf."${t}" x`)))[0]!;
    out[t] = `${r.n}:${r.d}`;
  }
  return out;
}

describe("5) canlı güncelleme: ESKİ durumda kurulan dünya, migration + katalog revizyonundan sonra aynen sürer", () => {
  it("şirket (nakit, stok, tesis, çalışan iş) ve yoldaki sözleşme korunur ve yerleşir; yönetici düzenlemeleri ezilmez", async () => {
    await h.close();
    h = await createHarness(); // temiz dünya (yeni katalog)
    const db = h.deps.db;
    const cat = () => h.deps.catalog;

    // ---- 1) kataloğu ESKİ (v2) değerlere ve revizyonu "uygulanmamış" duruma getir
    const OLD_PRICE: Record<string, number> = { iron_ore: 180, coal: 220, flour: 1050, packaged_milk: 1400 };
    const NEW_PRICE: Record<string, number> = { iron_ore: 260, coal: 340, flour: 1300, packaged_milk: 1550 };
    const OLD_BATCHES = [2, 3, 4];
    const NEW_BATCHES = [1, 2, 3];
    const BT = ["field", "barn", "mine", "food_plant", "steel_mill"];
    const getItem = async (kind: "product" | "building_type" | "recipe", id: string) => (await db.select().from(catalogItems).where(and(eq(catalogItems.kind, kind), eq(catalogItems.id, id))))[0]!;
    for (const [id, v] of Object.entries(OLD_PRICE)) {
      const r = await getItem("product", id);
      expect((r.data as { basePricePerKg: number }).basePricePerKg).toBe(NEW_PRICE[id]); // taze dünya yeni değerle gelir
      await db.update(catalogItems).set({ data: { ...(r.data as object), basePricePerKg: v } }).where(and(eq(catalogItems.kind, "product"), eq(catalogItems.id, id)));
    }
    for (const id of BT) {
      const r = await getItem("building_type", id);
      const data = structuredClone(r.data) as { levels: Array<{ maxBatches: number }> };
      expect(data.levels.map((l) => l.maxBatches)).toEqual(NEW_BATCHES);
      data.levels.forEach((l, i) => { l.maxBatches = OLD_BATCHES[i]!; });
      await db.update(catalogItems).set({ data }).where(and(eq(catalogItems.kind, "building_type"), eq(catalogItems.id, id)));
    }
    await db.delete(meta).where(eq(meta.key, `catalog.rev.${CATALOG_REVISIONS[0]!.id}`));
    await db.execute(sql`DELETE FROM cf.catalog_history WHERE reasoning LIKE 'revizyon %'`);

    // ---- 2) yönetici düzenlemeleri (gerçek yönetici API'si): flour ve coal fiyatı, mill_flour süresi, bir ayar
    const adminP = await h.player();
    const me = await adminP.ok("GET", "/auth/me");
    await db.update(accounts).set({ role: "admin", canReviewConnections: true }).where(eq(accounts.id, me.account.id));
    const { secret } = await adminP.ok("POST", "/auth/totp/setup");
    await adminP.ok("POST", "/auth/totp/enable", { code: totpAt(secret, Math.floor(h.deps.clock.nowMs() / 30000)) });
    const adminFlour = await adminP.ok("PATCH", "/admin/catalog/products/flour", { basePricePerKg: 1111, reasoning: "yönetici düzenlemesi: un" });
    const adminCoal = await adminP.ok("PATCH", "/admin/catalog/products/coal", { basePricePerKg: 250, reasoning: "yönetici düzenlemesi: kömür" });
    const adminRecipe = await adminP.ok("PATCH", "/admin/catalog/recipes/mill_flour", { minutes: 77, reasoning: "yönetici düzenlemesi: süre" });
    const adminSetting = await adminP.ok("PATCH", "/admin/settings", { key: "marketFeeBp", value: 150, reasoning: "yönetici düzenlemesi: komisyon" });
    expect([adminFlour.version, adminCoal.version, adminRecipe.version]).toEqual([2, 2, 2]);
    // bina satırı: DB düzeyinde yönetici düzenlemesi benzetimi (bu satır için yönetici API'si yok): sürüm 2, eski parti sayısı
    const steel = await getItem("building_type", "steel_mill");
    const steelData = structuredClone(steel.data) as { levels: Array<{ upgradeCost: number }> };
    steelData.levels[0]!.upgradeCost += 1_000_000;
    await db.update(catalogItems).set({ version: 2, data: steelData }).where(and(eq(catalogItems.kind, "building_type"), eq(catalogItems.id, "steel_mill")));
    await cat().reload(db);
    expect(cat().product("coal").basePricePerKg).toBe(250);
    expect(cat().buildingType("food_plant").levels[0]!.maxBatches).toBe(2); // eski katalog etkin

    // ---- 3) ESKİ durumda dünya kur: şirket, stok, tesis, çalışan iş, araştırma, yoldaki sözleşme
    const X = await foundKit(h, "manufacturing", "korfezkent", "food_plant");
    const S = await foundKit(h, "crop", "yesilova");
    await grantCash(h, X.companyId, 10_000_000n);
    await grantCash(h, S.companyId, 3_000_000n);
    await grantStockKit(h, X.companyId, "korfezkent", "grain", 3, 4000, 400_000n);
    await grantStockKit(h, S.companyId, X.cityId, "grain", 3, 1500, 150_000n);
    const q2 = await X.p.ok("POST", "/production/quote", { facilityId: X.facilityId, recipeId: "mill_flour", batches: 2 });
    expect(q2.blockers).toEqual([]); // eski katalogda 2 parti serbest
    const runJob = await X.p.ok("POST", "/production/start", { facilityId: X.facilityId, recipeId: "mill_flour", batches: 2, repeat: false, idempotencyKey: h.key() });
    await X.p.ok("POST", "/research/lean_process/start", { idempotencyKey: h.key() });
    const t0 = h.deps.clock.nowMs();
    const prop = await S.p.ok("POST", "/contracts", withKey(h, {
      role: "seller", counterpartyCompanyId: X.companyId, productId: "grain", minQuality: 1, qtyPerInstallmentKg: 500, pricePerKg: 450,
      deliveryCityId: X.cityId, freightPayer: "seller", installments: 3, firstDueAt: new Date(t0 + 1 * HOUR).toISOString(), intervalHours: 2, graceHours: 1, penaltyBp: 1000,
    }));
    await X.p.ok("POST", `/contracts/${prop.id}/accept`, withKey(h, {}));
    const det0 = await S.p.ok("GET", `/contracts/${prop.id}`);
    await S.p.ok("POST", `/contracts/installments/${det0.schedule[0].id}/deliver`, withKey(h, { qtyKg: 500, quality: 3 })); // 1. taksit teslim ve yerleşti
    await S.p.ok("POST", "/market/listings", withKey(h, { cityId: S.cityId, productId: "grain", quality: 3, qtyKg: 100, pricePerKg: 400 })).catch(() => null);
    await h.advance(20 * MIN);
    const jobBefore = (await db.select().from(productionJobs).where(eq(productionJobs.id, runJob.id)))[0]!;
    expect(jobBefore.status).toBe("running");
    expect(jobBefore.batches).toBe(2);
    const oldCash = { X: await cashOf(X.companyId), S: await cashOf(S.companyId) };
    const oldHold = { grain: await holding(h, X.companyId, X.cityId, "grain", 3) };
    const company0 = await X.p.ok("GET", "/company");
    const inst0 = (await db.select().from(contractInstallments).where(eq(contractInstallments.contractId, prop.id))).sort((a, b) => a.seq - b.seq);
    expect(inst0.map((i) => i.status)).toEqual(["fulfilled", "open", "open"]);
    expect(await checkInvariants(db)).toEqual([]);

    // ---- 4) ESKİ şema: 0003 geri alınır (tahmin tablosu gider), sunucu kapanır
    const nOutcomes = ((await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.deal_outcomes`))[0]!.n);
    expect(nOutcomes).toBeGreaterThan(0);
    for (const stmt of DOWN_0003.replace(/^--.*$/gm, "").split(";").map((x) => x.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
    expect((await rows<{ t: string | null }>(sql`SELECT to_regclass('cf.deal_outcomes')::text t`))[0]!.t).toBeNull();
    const catBefore = await db.select().from(catalogItems);
    const digestBefore = await worldDigest();
    const sessions = [X.p, S.p].map((p) => ({ username: p.username, ip: p.ip, cookie: p.cookie }));
    const keyBefore = (await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.idempotency_keys`))[0]!.n;
    await h.close();

    // ---- 5) YENİ sürüm: migration + tohumlama + katalog revizyonu (aynı veritabanı)
    h = await createHarness({ keepDb: true });
    const db2 = h.deps.db;
    const [xp, sp] = sessions.map((s0) => Object.assign(new Player(h, s0.username, s0.ip), { cookie: s0.cookie }));
    X.p = xp!; S.p = sp!;
    expect((await rows<{ t: string | null }>(sql`SELECT to_regclass('cf.deal_outcomes')::text t`))[0]!.t).toBe("cf.deal_outcomes");
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.deal_outcomes`))[0]!.n).toBe(0);
    // oyuncu verisi bayt bayt aynı (tüm tablolar, katalog/meta/tahmin hariç)
    expect(await worldDigest()).toEqual(digestBefore);
    expect(await cashOf(X.companyId)).toBe(oldCash.X);
    expect(await cashOf(S.companyId)).toBe(oldCash.S);
    expect(await holding(h, X.companyId, X.cityId, "grain", 3)).toEqual(oldHold.grain);
    const company1 = await X.p.ok("GET", "/company"); // eski oturum çerezi geçerli
    // tesisin parti sınırı katalogdan okunur (2 → 1); bunun dışında şirket görünümü birebir aynı, çalışan iş (2 parti) listede
    const strip = (c: { facilities: Array<Record<string, unknown>> }) => ({ ...c, facilities: c.facilities.map(({ maxBatches: _m, ...rest }) => rest) });
    expect(company0.facilities[0].maxBatches).toBe(2);
    expect(company1.facilities[0].maxBatches).toBe(1);
    expect(strip(company1)).toEqual(strip(company0));
    expect(company1.facilities[0].jobs).toHaveLength(1);
    expect(company1.facilities[0].jobs[0].batches).toBe(2);
    const jobAfter = (await db2.select().from(productionJobs).where(eq(productionJobs.id, runJob.id)))[0]!;
    expect(jobAfter).toEqual(jobBefore);
    expect((jobAfter.recipeSnapshot as { minutes: number }).minutes).toBe(77); // başlatma anındaki (yönetici düzenlemeli) tarif
    expect(keyBefore).toBeGreaterThan(0);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.idempotency_keys`))[0]!.n).toBe(keyBefore);

    // katalog: düzenlenmemiş satırlar güncellendi, yönetici düzenlemeleri aynen
    const rev = (await db2.select().from(meta).where(eq(meta.key, `catalog.rev.${CATALOG_REVISIONS[0]!.id}`)))[0]!;
    const report = rev.value as { applied: Array<{ kind: string; id: string; paths: string[] }>; skipped: Array<{ kind: string; id: string; path?: string; reason: string }> };
    const itemNow = async (kind: "product" | "building_type" | "recipe", id: string) => (await db2.select().from(catalogItems).where(and(eq(catalogItems.kind, kind), eq(catalogItems.id, id))))[0]!;
    expect((await itemNow("product", "iron_ore"))).toMatchObject({ version: 2, data: expect.objectContaining({ basePricePerKg: 260 }) });
    expect((await itemNow("product", "packaged_milk"))).toMatchObject({ version: 2, data: expect.objectContaining({ basePricePerKg: 1550 }) });
    expect((await itemNow("product", "flour"))).toMatchObject({ version: 2, data: expect.objectContaining({ basePricePerKg: 1111 }) }); // yönetici, ezilmedi
    expect((await itemNow("product", "coal"))).toMatchObject({ version: 2, data: expect.objectContaining({ basePricePerKg: 250 }) }); // yönetici, ezilmedi
    for (const id of ["field", "barn", "mine", "food_plant"]) {
      const r = await itemNow("building_type", id);
      expect((r.data as { levels: Array<{ maxBatches: number }> }).levels.map((l) => l.maxBatches), id).toEqual(NEW_BATCHES);
      expect(r.version).toBe(4); // her yama (3 seviye) ayrı sürüm ve geçmiş satırı yazar
    }
    const st = await itemNow("building_type", "steel_mill");
    expect((st.data as { levels: Array<{ maxBatches: number; upgradeCost: number }> }).levels.map((l) => l.maxBatches)).toEqual(OLD_BATCHES); // yönetici satırı: dokunulmadı
    expect(st.version).toBe(2);
    expect((st.data as { levels: Array<{ upgradeCost: number }> }).levels[0]!.upgradeCost).toBe(steelData.levels[0]!.upgradeCost);
    expect((await itemNow("recipe", "mill_flour")).data).toMatchObject({ minutes: 77 });
    expect(cat().settings.marketFeeBp).toBe(150);
    expect([...new Set(report.applied.map((a) => `${a.kind}:${a.id}`))].sort()).toEqual(["building_type:barn", "building_type:field", "building_type:food_plant", "building_type:mine", "product:iron_ore", "product:packaged_milk"]);
    const skippedIds = report.skipped.map((x) => `${x.kind}:${x.id}:${x.reason}`).sort();
    expect([...new Set(skippedIds)]).toEqual(expect.arrayContaining(["building_type:steel_mill:edited", "product:coal:edited", "product:flour:edited"]));
    // değişmeyen satırlar (v3 revizyonunun dokunmadığı) birebir aynı
    const catAfter = await db2.select().from(catalogItems);
    const touched = new Set(["product:iron_ore", "product:packaged_milk", "building_type:field", "building_type:barn", "building_type:mine", "building_type:food_plant"]);
    for (const a of catAfter) {
      if (touched.has(`${a.kind}:${a.id}`)) continue;
      const b = catBefore.find((x) => x.kind === a.kind && x.id === a.id)!;
      expect({ v: a.version, d: a.data }, `${a.kind}:${a.id}`).toEqual({ v: b.version, d: b.data });
    }
    expect((await db2.select().from(catalogHistory).where(sql`${catalogHistory.reasoning} LIKE 'revizyon %'`)).length).toBe(14); // 2 ürün × 1 + 4 bina × 3
    // ikinci yayın: yeniden migration + revizyon hiçbir şeyi değiştirmez
    await runMigrations(URL_);
    await runMigrations(URL_);
    expect(await applyCatalogRevisions(db2)).toEqual([]);
    expect(await worldDigest()).toEqual(digestBefore);
    expect((await db2.select().from(catalogHistory).where(sql`${catalogHistory.reasoning} LIKE 'revizyon %'`)).length).toBe(14); // 2 ürün × 1 + 4 bina × 3
    expect(await checkInvariants(db2)).toEqual([]);

    // ---- 6) güncellemeden sonra: çalışan iş, kurulu kayıtlar ve yoldaki sözleşme yerleşir
    // eski idempotency anahtarıyla kuruluş tekrarı aynı şirketi verir
    const replay = await X.p.ok("GET", "/company");
    expect(replay.cash).toBe(oldCash.X.toString());
    // yeni kural etkin (düzeltilen parti sayısı): yeni iş en çok 1 parti; çalışan eski iş (2 parti) yine de biter
    const bad = await X.p.post("/production/quote", { facilityId: X.facilityId, recipeId: "mill_flour", batches: 2 });
    expect(bad.status).toBe(200);
    expect(bad.body.blockers.map((b: { code: string }) => b.code)).toContain("BATCHES_EXCEED_CAPACITY");
    const det1 = await S.p.ok("GET", `/contracts/${prop.id}`);
    expect(det1.contract.status).toBe("active");
    const cmp = await S.p.ok("GET", `/contracts/${prop.id}/compare`);
    expect(cmp.myRole).toBe("seller");
    for (const k of [1, 2]) await S.p.ok("POST", `/contracts/installments/${det1.schedule[k].id}/deliver`, withKey(h, { qtyKg: 500, quality: 3 }));
    await h.advance(3 * HOUR);
    const insts = (await db2.select().from(contractInstallments).where(eq(contractInstallments.contractId, prop.id))).sort((a, b) => a.seq - b.seq);
    expect(insts.map((i) => i.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(insts.every((i) => i.settledAt !== null && i.paidToSeller === 225_000n)).toBe(true);
    expect((await db2.select().from(contracts).where(eq(contracts.id, prop.id)))[0]!.status).toBe("completed");
    const settle = await rows<{ ref_id: string; n: number }>(sql`SELECT ref_id, count(*)::int n FROM cf.ledger_transactions WHERE kind = 'installment_settle' AND ref_id IN (${sql.join(insts.map((i) => sql`${i.id}`), sql`, `)}) GROUP BY ref_id`);
    expect(settle).toHaveLength(3); expect(settle.every((r) => r.n === 1)).toBe(true);
    // çalışan iş: tam bir kez, eski anlık görüntüyle (2 parti, 1.650 × 2 kg) yerleşti
    const jobDone = (await db2.select().from(productionJobs).where(eq(productionJobs.id, runJob.id)))[0]!;
    expect(jobDone.status).toBe("completed");
    expect(jobDone.outputKg).toBe(jobBefore.outputKg);
    expect(jobDone.outputKg).toBe(runJob.output.qtyKg);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'production_settle' AND ref_id = ${runJob.id}`))[0]!.n).toBe(1);
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int n FROM cf.inventory_movements WHERE kind = 'production_output' AND ref_id = ${runJob.id}`))[0]!.n).toBe(1);
    const flour = (await X.p.ok("GET", "/inventory")).filter((l: { productId: string }) => l.productId === "flour").reduce((a: number, l: { qtyKg: number }) => a + l.qtyKg, 0);
    expect(flour).toBe(runJob.output.qtyKg);
    expect(await bal(h, X.companyId, "wip")).toBe(0n);
    // araştırma da yerleşti
    expect(((await X.p.ok("GET", "/research")).items as Array<{ researchId: string; level: number }>).find((r) => r.researchId === "lean_process")!.level).toBe(1);
    // yeni sürümde yeni iş: 1 parti kabul, tahmin kaydı yazılır
    const nj = await X.p.ok("POST", "/production/start", { facilityId: X.facilityId, recipeId: "mill_flour", batches: 1, repeat: false, idempotencyKey: h.key() });
    expect((await X.p.ok("GET", "/finance/outcomes")).some((o: { refId: string; kind: string }) => o.refId === nj.id && o.kind === "production")).toBe(true);
    await h.advance(61 * MIN);
    expect((await db2.select().from(productionJobs).where(eq(productionJobs.id, nj.id)))[0]!.status).toBe("completed");
    RESULTS["canliGuncelleme"] = {
      oncesiKatalog: { iron_ore: 180, coal: 220, flour: 1050, packaged_milk: 1400, maxBatches: OLD_BATCHES },
      sonrasi: { iron_ore: 260, packaged_milk: 1550, maxBatches: NEW_BATCHES, flour_yonetici: 1111, coal_yonetici: 250, steel_mill_yonetici: "levels[0].upgradeCost +1.000.000, maxBatches eski" },
      uygulanan: report.applied.map((a) => `${a.kind}:${a.id} (${a.paths.join(",")})`), atlanan: skippedIds,
      nakit: { X: oldCash.X, S: oldCash.S }, tahminKaydiKaybi: nOutcomes, tabloOzeti: Object.keys(digestBefore).length,
      calisanIs: `${jobBefore.batches} parti, ${jobBefore.outputKg} kg, tek settle`, sozlesme: insts.map((i) => `${i.seq}:${i.status}`),
    };
    expect(await checkInvariants(db2)).toEqual([]);
  }, 300_000);
});
