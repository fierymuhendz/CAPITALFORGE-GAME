/**
 * Sunucu düzeyi kabul testleri (v2).
 *
 *  1) Beş sektörün ilk yolculuğu: kuruluş + tek seferlik bağış, ilk iş, sisteme satış (ilk gelir), makul sonraki yatırım
 *  2) 21 günlük çok haftalı simülasyon: beş şirket, tekrarlayan sözleşme, sistem sınırları, günlük bakım, çift yerleşme yok
 *  3) Kalıcılık ve yeniden başlatma: yarım üretim + yarım sevkiyat, aynı veritabanıyla yeni uygulama, ikinci yayın (migrate+seed)
 *  4) Çevrimdışı tamamlanma: oyuncu hiç istek atmadan zaman ilerler, sonuçlar yerleşmiş olur
 *
 * Diğer kabul senaryoları (ortalama maliyet, üç taraflı sözleşme, eşzamanlılık, yükseltme/araştırma/kredi, aynı IP, yönetici
 * erişimi) mevcut dosyalarda kapsanır; eşleme docs/test-sonuclari.md içindedir.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { QUALITY_PRICE_BP, SYSTEM_PROFILES } from "@capitalforge/shared";
import { totpAt } from "../auth/totp";
import { accounts, companies, contractInstallments, contracts, systemDaily } from "../db/schema";
import { createDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import { createHarness, Player, type Harness } from "./harness";
import { checkInvariants } from "./invariants";
import { grantStock } from "./trade-helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RESULTS: Record<string, unknown> = {};

let h: Harness;
const rows = async <T = Record<string, unknown>>(s: ReturnType<typeof sql>): Promise<T[]> => (await h.deps.db.execute(s)) as unknown as T[];
const one = async <T = Record<string, unknown>>(s: ReturnType<typeof sql>): Promise<T> => (await rows<T>(s))[0]!;
const key = () => h.key();
const rnd = () => Math.random().toString(36).slice(2, 6);

afterAll(async () => {
  if (h) await h.close().catch(() => {});
  // sonuç özeti (docs/test-sonuclari.md için)
  console.log("ACCEPTANCE_RESULTS " + JSON.stringify(RESULTS, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
});

// ------------------------------------------------------------------ ortak yardımcılar

interface Co {
  sector: string;
  p: Player;
  companyId: string;
  facilityId: string;
  cityId: string;
  plot: { id: string; price: string; deposit: null | { kind: "iron" | "coal" } };
  body: Record<string, unknown>;
  vehicleId: string | null;
}

async function foundCo(p: Player, sector: string, cityId: string, starterBuilding?: string): Promise<Co> {
  const ob = await p.ok("GET", `/world/onboarding?cityId=${cityId}&sector=${sector}${starterBuilding ? `&starterBuilding=${starterBuilding}` : ""}`);
  const plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
  if (!plot) throw new Error(`uygun arsa yok ${cityId}/${sector}`);
  const body = { name: `Kabul ${sector} ${rnd()}${rnd()}`, cityId, sector, plotId: plot.id, starterBuilding, idempotencyKey: key() };
  const r = await p.ok("POST", "/company", body);
  return { sector, p, companyId: r.companyId, facilityId: r.facilityId, cityId, plot, body, vehicleId: r.vehicleId ?? null };
}

const cashOf = async (companyId: string): Promise<bigint> =>
  BigInt((await one<{ b: string }>(sql`SELECT balance::text b FROM cf.ledger_accounts WHERE company_id = ${companyId} AND code = 'cash'`)).b);

const balOf = async (companyId: string, code: string): Promise<bigint> =>
  BigInt((await one<{ b: string }>(sql`SELECT balance::text b FROM cf.ledger_accounts WHERE company_id = ${companyId} AND code = ${code}`)).b);

/** Kümülatif kâr-zarar: −(gelir hesapları) − (gider hesapları), tüm zamanlar */
async function profitOf(companyId: string): Promise<{ revenue: bigint; expense: bigint; profit: bigint }> {
  const r = await one<{ rev: string; exp: string }>(sql`
    SELECT coalesce(sum(balance) FILTER (WHERE kind = 'revenue'), 0)::text rev,
           coalesce(sum(balance) FILTER (WHERE kind = 'expense'), 0)::text exp
    FROM cf.ledger_accounts WHERE company_id = ${companyId}`);
  const revenue = -BigInt(r.rev);
  const expense = BigInt(r.exp);
  return { revenue, expense, profit: revenue - expense };
}

const netWorthOf = async (companyId: string): Promise<bigint> =>
  BigInt((await one<{ b: string }>(sql`
    SELECT coalesce(sum(balance) FILTER (WHERE code IN ('cash','inventory','wip','escrow','prepaid_freight','fixed_assets','loans','arrears')), 0)::text b
    FROM cf.ledger_accounts WHERE company_id = ${companyId}`)).b);

interface Lot { cityId: string; productId: string; quality: number; qtyKg: number; availableKg: number }
const lots = async (p: Player): Promise<Lot[]> => await p.ok("GET", "/inventory");
const stockKg = async (p: Player, cityId: string, productId: string): Promise<number> =>
  (await lots(p)).filter((l) => l.cityId === cityId && l.productId === productId).reduce((a, l) => a + l.availableKg, 0);

interface Sold { gross: bigint; fee: bigint; cogs: bigint; qtyKg: number }
/** Eldeki tüm (veya keepKg üstü) stoku sistemin alım emirlerine sat; en iyi fiyattan başla */
async function sellToSystem(p: Player, cityId: string, productId: string, keepKg = 0, fails?: Record<string, number>): Promise<Sold> {
  const out: Sold = { gross: 0n, fee: 0n, cogs: 0n, qtyKg: 0 };
  let toSell = (await stockKg(p, cityId, productId)) - keepKg;
  if (toSell <= 0) return out;
  const mine = (await lots(p)).filter((l) => l.cityId === cityId && l.productId === productId && l.availableKg > 0).sort((a, b) => b.quality - a.quality);
  for (const lot of mine) {
    let left = Math.min(lot.availableKg, toSell);
    while (left > 0) {
      const mk = await p.ok("GET", `/market?cityId=${cityId}&productId=${productId}`);
      const bids = (mk.orders as Array<{ id: string; isSystem: boolean; remainingKg: number; pricePerKg: string; quality: number }>)
        .filter((o) => o.isSystem && o.remainingKg > 0 && o.quality <= lot.quality)
        .sort((a, b) => Number(BigInt(b.pricePerKg) - BigInt(a.pricePerKg)));
      const bid = bids[0];
      if (!bid) return out;
      const qty = Math.min(left, bid.remainingKg);
      const expected = Number((BigInt(bid.pricePerKg) * BigInt(QUALITY_PRICE_BP[lot.quality]!)) / 10000n);
      const r = await p.post(`/market/orders/${bid.id}/sell`, { qtyKg: qty, quality: lot.quality, expectedPricePerKg: Math.max(1, expected), idempotencyKey: key() });
      if (r.status !== 200) {
        if (fails) fails[r.body?.error?.code ?? String(r.status)] = (fails[r.body?.error?.code ?? String(r.status)] ?? 0) + 1;
        break;
      }
      out.gross += BigInt(r.body.gross);
      out.fee += BigInt(r.body.fee);
      out.cogs += BigInt(r.body.cogs);
      out.qtyKg += qty;
      left -= qty;
      toSell -= qty;
    }
  }
  return out;
}

/** Sistemin satış ilanından al (en ucuzdan) */
async function buyFromSystem(p: Player, cityId: string, productId: string, qtyKg: number, fails?: Record<string, number>): Promise<number> {
  let bought = 0;
  while (bought < qtyKg) {
    const mk = await p.ok("GET", `/market?cityId=${cityId}&productId=${productId}`);
    const ask = (mk.listings as Array<{ id: string; isSystem: boolean; remainingKg: number; pricePerKg: string }>)
      .filter((l) => l.isSystem && l.remainingKg > 0)
      .sort((a, b) => Number(BigInt(a.pricePerKg) - BigInt(b.pricePerKg)))[0];
    if (!ask) break;
    const qty = Math.min(qtyKg - bought, ask.remainingKg);
    const r = await p.post(`/market/listings/${ask.id}/buy`, { qtyKg: qty, expectedPricePerKg: Number(ask.pricePerKg), idempotencyKey: key() });
    if (r.status !== 200) {
      if (fails) fails[r.body?.error?.code ?? String(r.status)] = (fails[r.body?.error?.code ?? String(r.status)] ?? 0) + 1;
      break;
    }
    bought += qty;
  }
  return bought;
}

// ================================================================== 1) beş sektörün ilk yolculuğu

interface Spec {
  sector: string;
  cityId: string;
  starterBuilding?: string;
  recipe: (deposit: "iron" | "coal" | null) => string;
  batches: number;
  research: string;
  yieldResearch: boolean;
}
const SPECS: Spec[] = [
  { sector: "crop", cityId: "yesilova", recipe: () => "grow_fodder", batches: 2, research: "agronomy", yieldResearch: true },
  { sector: "livestock", cityId: "akyayla", recipe: () => "milk_cows", batches: 2, research: "herd_health", yieldResearch: true },
  { sector: "mining", cityId: "demirdag", recipe: (d) => (d === "coal" ? "mine_coal" : "mine_iron"), batches: 2, research: "drilling", yieldResearch: true },
  { sector: "manufacturing", cityId: "korfezkent", starterBuilding: "food_plant", recipe: () => "mill_flour", batches: 1, research: "lean_process", yieldResearch: false },
];

describe("1) beş sektörün ilk yolculuğu", () => {
  it("hazırlık: temiz veritabanı ve sistem döngüsü", async () => {
    h = await createHarness();
    await h.tick();
  });

  for (const spec of SPECS) {
    it(`${spec.sector}: kuruluş, tek seferlik bağış, ilk iş, sisteme satış, sonraki yatırım`, async () => {
      const p = await h.player();
      const startCash = BigInt(h.deps.catalog.settings.startingCash);
      const c = await foundCo(p, spec.sector, spec.cityId, spec.starterBuilding);

      // --- kuruluş: uygun arsa, nakit = başlangıç − arsa, bağış tam bir kez
      const plotPrice = BigInt(c.plot.price);
      expect(await cashOf(c.companyId)).toBe(startCash - plotPrice);
      const grantCount = async () => ({
        rows: Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.starter_grants WHERE company_id = ${c.companyId}`)).n),
        tx: Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'starter_grant' AND ref_id = ${c.companyId}`)).n),
        equity: await balOf(c.companyId, "equity"),
        inv: await balOf(c.companyId, "inventory"),
        fixed: await balOf(c.companyId, "fixed_assets"),
        movements: Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.inventory_movements WHERE company_id = ${c.companyId} AND kind = 'starter_grant'`)).n),
      });
      const g1 = await grantCount();
      expect(g1.rows).toBe(1);
      expect(g1.tx).toBe(1);
      // tekrar (aynı anahtar): aynı sonuç, yeni bağış yok
      const replay = await p.ok("POST", "/company", c.body);
      expect(replay.companyId).toBe(c.companyId);
      expect(await grantCount()).toEqual(g1);
      // ikinci şirket denemesi (yeni anahtar, yeni ad): reddedilir, yeni bağış yok
      const second = await p.post("/company", { ...c.body, name: `${c.body.name as string} II`, idempotencyKey: key() });
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect(second.body.error.code).toBe("COMPANY_EXISTS");
      expect(await grantCount()).toEqual(g1);
      expect(Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.companies WHERE account_id = (SELECT account_id FROM cf.companies WHERE id = ${c.companyId})`)).n)).toBe(1);
      // bağış içeriği: sektöre göre girdi stoku
      const me0 = await p.ok("GET", "/company");
      expect(me0.level).toBe(1);
      expect(me0.xp).toBe(0);
      expect(me0.cash).toBe((startCash - plotPrice).toString());

      const out: Record<string, unknown> = { sector: spec.sector, city: spec.cityId };
      const cashStart = await cashOf(c.companyId);

      // --- ilk iş
      const recipeId = spec.recipe(c.plot.deposit?.kind ?? null);
      const q1 = await p.ok("POST", "/production/quote", { facilityId: c.facilityId, recipeId, batches: spec.batches });
      expect(q1.blockers, JSON.stringify(q1.blockers)).toEqual([]);
      const job = await p.ok("POST", "/production/start", { facilityId: c.facilityId, recipeId, batches: spec.batches, repeat: false, idempotencyKey: key() });
      expect(job.status).toBe("running");
      await h.advance(6 * HOUR);
      const stock = (await lots(p)).filter((l) => l.productId === job.output.productId && l.cityId === spec.cityId);
      expect(stock.reduce((a, l) => a + l.qtyKg, 0)).toBe(job.output.qtyKg);
      expect(await balOf(c.companyId, "wip")).toBe(0n);

      // --- sisteme sat: ilk gelir
      const cashBeforeSale = await cashOf(c.companyId);
      const sold = await sellToSystem(p, spec.cityId, job.output.productId);
      expect(sold.qtyKg).toBe(job.output.qtyKg);
      expect(sold.gross).toBeGreaterThan(0n);
      expect((await cashOf(c.companyId)) - cashBeforeSale).toBe(sold.gross - sold.fee);
      const pl1 = await profitOf(c.companyId);
      expect(pl1.revenue).toBe(sold.gross);
      const saleRows = await rows<{ net_profit: string; source: string }>(sql`SELECT net_profit::text, source FROM cf.sales WHERE seller_company_id = ${c.companyId}`);
      const net = saleRows.reduce((a, r) => a + BigInt(r.net_profit), 0n);
      expect(saleRows.every((r) => r.source === "system" || r.source === "spot")).toBe(true);
      expect(net).toBe(sold.gross - sold.cogs - sold.fee);
      out.firstJobOutput = `${job.output.qtyKg} kg ${job.output.productId}`;
      out.firstRevenue = sold.gross;
      out.firstSaleNetProfit = net;
      expect(net, `ilk satış net kârı (${spec.sector})`).toBeGreaterThan(0n);

      // --- sonraki makul yatırım: araştırma (verim / verimlilik)
      const before = await p.ok("POST", "/production/quote", { facilityId: c.facilityId, recipeId, batches: spec.batches });
      const rv = await p.ok("GET", "/research");
      const item = rv.items.find((i: { researchId: string }) => i.researchId === spec.research);
      const cost = BigInt(item.nextCost);
      const cashPre = await cashOf(c.companyId);
      expect(cashPre).toBeGreaterThanOrEqual(cost);
      await p.ok("POST", `/research/${spec.research}/start`, { idempotencyKey: key() });
      expect(cashPre - (await cashOf(c.companyId))).toBe(cost);
      await h.advance(item.nextMinutes * 60_000 + HOUR);
      const after = await p.ok("POST", "/production/quote", { facilityId: c.facilityId, recipeId, batches: spec.batches });
      if (spec.yieldResearch) {
        // before = floor(X), after = floor(X × 1,08)  ⇒  before × 1,08 − 1 < after < (before + 1) × 1,08 (tam tamsayı aralığı)
        expect(after.output.qtyKg * 10000).toBeGreaterThan(before.output.qtyKg * 10800 - 10000);
        expect(after.output.qtyKg * 10000).toBeLessThan((before.output.qtyKg + 1) * 10800);
      } else {
        expect(after.energyKwh).toBeLessThan(before.energyKwh);
        expect(BigInt(after.cost.total)).toBeLessThan(BigInt(before.cost.total));
      }
      out.investment = `${spec.research} (${cost} kuruş)`;
      out.cashStart = cashStart;
      out.cashEnd = await cashOf(c.companyId);
      expect(await cashOf(c.companyId)).toBeGreaterThan(0n);
      RESULTS[`ilkYolculuk:${spec.sector}`] = out;
      expect(await checkInvariants(h.deps.db)).toEqual([]);
    });
  }

  it("freight: kuruluş (bağış tek sefer, kamyon dahil), sistem taşıma işi ile ilk gelir, araç alımı", async () => {
    const p = await h.player();
    const startCash = BigInt(h.deps.catalog.settings.startingCash);
    const c = await foundCo(p, "freight", "kavsak");
    expect(await cashOf(c.companyId)).toBe(startCash - BigInt(c.plot.price));
    const vehCount = async () => Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.vehicles WHERE company_id = ${c.companyId}`)).n);
    const grants = async () => Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.starter_grants WHERE company_id = ${c.companyId}`)).n);
    expect(await vehCount()).toBe(1);
    expect(await grants()).toBe(1);
    const replay = await p.ok("POST", "/company", c.body);
    expect(replay.companyId).toBe(c.companyId);
    const second = await p.post("/company", { ...c.body, name: `${c.body.name as string} II`, idempotencyKey: key() });
    expect(second.body.error.code).toBe("COMPANY_EXISTS");
    expect(await vehCount()).toBe(1);
    expect(await grants()).toBe(1);
    const fleet = await p.ok("GET", "/fleet");
    expect(fleet).toHaveLength(1);
    expect(fleet[0].modelId).toBe("truck");
    expect(fleet[0].cityId).toBe("kavsak");

    // ilk iş: Kavşak çıkışlı açık sistem işi
    await h.tick();
    const board = await p.ok("GET", "/freight-jobs?scope=board");
    const job = (board as Array<{ id: string; isSystem: boolean; originCityId: string; payAmount: string; estCostForMe: string | null; distanceKm: number; destCityId: string }>)
      .filter((j) => j.isSystem && j.originCityId === "kavsak")
      .sort((a, b) => Number(BigInt(b.payAmount) - BigInt(a.payAmount)))[0];
    expect(job, "Kavşak çıkışlı sistem taşıma işi").toBeTruthy();
    const acc = await p.ok("POST", `/freight-jobs/${job!.id}/accept`, { vehicleId: fleet[0].id, idempotencyKey: key() });
    expect(acc.status === "assigned" || acc.status === "in_transit").toBe(true);
    // aynı işi ikinci kez almak (yeni anahtar) reddedilir
    const again = await p.post(`/freight-jobs/${job!.id}/accept`, { vehicleId: fleet[0].id, idempotencyKey: key() });
    expect(again.status).toBeGreaterThanOrEqual(400);
    await h.advance(12 * HOUR);
    const done = await p.ok("GET", "/freight-jobs?scope=mine");
    expect((done as Array<{ id: string; status: string }>).find((j) => j.id === job!.id)!.status).toBe("delivered");
    const pl = await profitOf(c.companyId);
    const rev = -(await balOf(c.companyId, "revenue_freight"));
    expect(rev).toBe(BigInt(job!.payAmount));
    const ship = await one<{ fuel: string; driver: string }>(sql`SELECT fuel_cost::text fuel, driver_cost::text driver FROM cf.shipments WHERE carrier_company_id = ${c.companyId}`);
    const shipNet = rev - BigInt(ship.fuel) - BigInt(ship.driver);
    expect(shipNet, "ilk taşıma işi net kârı").toBeGreaterThan(0n);
    expect((await p.ok("GET", "/fleet"))[0].cityId).toBe(job!.destCityId);

    // sonraki yatırım: kamyonet
    const van = h.deps.catalog.vehicleModel("van");
    const cashPre = await cashOf(c.companyId);
    expect(cashPre).toBeGreaterThanOrEqual(BigInt(van.price));
    const bought = await p.ok("POST", "/fleet/buy", { modelId: "van", cityId: "kavsak", idempotencyKey: key() });
    expect(bought.modelId).toBe("van");
    expect(cashPre - (await cashOf(c.companyId))).toBe(BigInt(van.price));
    expect(await p.ok("GET", "/fleet")).toHaveLength(2);
    expect(await cashOf(c.companyId)).toBeGreaterThan(0n);
    RESULTS["ilkYolculuk:freight"] = {
      sector: "freight", city: "kavsak", firstJobOutput: `sistem taşıma işi ${job!.distanceKm} km`, firstRevenue: rev, firstSaleNetProfit: shipNet,
      investment: `kamyonet (${van.price} kuruş)`, cashEnd: await cashOf(c.companyId), pnl: pl.profit,
    };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
  });

  it("kapanış: sistem sayaçları sınır içinde", async () => {
    expect(await checkInvariants(h.deps.db)).toEqual([]);
    await h.close();
  });
});

// ================================================================== 2) 21 günlük çok haftalı simülasyon

const SIM_DAYS = 21;
let simProfits: Record<string, { profit: bigint; revenue: bigint; expense: bigint; netWorthDelta: bigint }> | null = null;
const CYCLE = 4 * HOUR;

describe("2) çok haftalı zaman ilerletme (21 gün)", () => {
  it("beş sektör, tekrarlayan sözleşme, sistem sınırları, günlük bakım, çift yerleşme yok", async () => {
    h = await createHarness();
    await h.tick();
    const fails: Record<string, number> = {};
    const note = (r: { status: number; body: { error?: { code?: string } } }) => {
      if (r.status >= 300) { const k = r.body?.error?.code ?? String(r.status); fails[k] = (fails[k] ?? 0) + 1; }
      return r;
    };

    const crop = await foundCo(await h.player(), "crop", "korfezkent");
    const live = await foundCo(await h.player(), "livestock", "akyayla");
    const mine = await foundCo(await h.player(), "mining", "demirdag");
    const fact = await foundCo(await h.player(), "manufacturing", "korfezkent", "food_plant");
    const frt = await foundCo(await h.player(), "freight", "kavsak");
    const all = [crop, live, mine, fact, frt];
    const t0 = h.deps.clock.nowMs();
    const startNet = new Map<string, bigint>();
    for (const c of all) startNet.set(c.companyId, await netWorthOf(c.companyId));

    // --- tekrarlayan sözleşme: tarım (satıcı) → imalat (alıcı), Körfezkent'te aynı şehir; tahıl 570 kuruş/kg
    //     (sistem alışı ~432, sistem satışı ~630 arasında: iki taraf da sisteme göre kazanır). 12 taksit, 36 saat arayla.
    const contractQty = 1000;
    const contractPrice = 570;
    const installments = 12;
    const prop = await crop.p.ok("POST", "/contracts", {
      role: "seller", counterpartyCompanyId: fact.companyId, productId: "grain", minQuality: 1, qtyPerInstallmentKg: contractQty, pricePerKg: contractPrice,
      deliveryCityId: "korfezkent", freightPayer: "seller", installments, firstDueAt: new Date(t0 + 30 * HOUR).toISOString(), intervalHours: 36,
      graceHours: 4, penaltyBp: 1000, expiresInHours: 24, idempotencyKey: key(),
    });
    await fact.p.ok("POST", `/contracts/${prop.id}/accept`, { idempotencyKey: key() });
    const contractId = prop.id as string;

    interface Plan { co: Co; recipe: string; batches: number; inputs: Array<{ productId: string; perBatchKg: number }>; outProduct: string; sellCity: string; keepKg: number }
    const plans: Plan[] = [
      { co: crop, recipe: "grow_grain", batches: 2, inputs: [{ productId: "seed", perBatchKg: 300 }], outProduct: "grain", sellCity: "korfezkent", keepKg: 2 * contractQty },
      { co: live, recipe: "milk_cows", batches: 2, inputs: [{ productId: "fodder", perBatchKg: 1200 }], outProduct: "raw_milk", sellCity: "akyayla", keepKg: 0 },
      { co: mine, recipe: mine.plot.deposit?.kind === "coal" ? "mine_coal" : "mine_iron", batches: 2, inputs: [], outProduct: mine.plot.deposit?.kind === "coal" ? "coal" : "iron_ore", sellCity: "demirdag", keepKg: 0 },
      { co: fact, recipe: "mill_flour", batches: 2, inputs: [{ productId: "grain", perBatchKg: 2000 }], outProduct: "flour", sellCity: "korfezkent", keepKg: 0 },
    ];
    const productionStarts: Record<string, number> = {};
    const skippedUnprofitable: Record<string, number> = {};
    let contractLive = true;
    /** Kâr bilinçli tekrar: yalnızca tahmini gelir > tahmini maliyet × %105 ise girdileri al ve işi başlat */
    const productionRuns = async (pl: Plan) => {
      const { co } = pl;
      const fac = await co.p.ok("GET", `/facilities/${co.facilityId}`);
      if (fac.jobs.some((j: { status: string }) => j.status === "running")) return;
      // sözleşme tedarikçisi: stok sözleşme payının altındaysa üretim, sistem marjına bakmadan sürer (sözleşme fiyatı maliyetin üstünde)
      const supplying = pl.keepKg > 0 && contractLive && (await stockKg(co.p, pl.sellCity, pl.outProduct)) < pl.keepKg;
      const q = await co.p.ok("POST", "/production/quote", { facilityId: co.facilityId, recipeId: pl.recipe, batches: pl.batches });
      let cost = BigInt(q.cost.total);
      for (const i of q.inputs as Array<{ productId: string; requiredKg: number; availableKg: number; estCost: string }>) {
        const short = i.requiredKg - i.availableKg;
        if (short <= 0) continue;
        const mk = await co.p.ok("GET", `/market?cityId=${co.cityId}&productId=${i.productId}`);
        const ask = (mk.listings as Array<{ isSystem: boolean; remainingKg: number; pricePerKg: string }>).filter((l) => l.isSystem && l.remainingKg > 0)
          .map((l) => BigInt(l.pricePerKg)).sort((a, b) => Number(a - b))[0];
        if (ask === undefined) { skippedUnprofitable[co.sector] = (skippedUnprofitable[co.sector] ?? 0) + 1; return; }
        cost += BigInt(short) * (ask - BigInt(i.estCost) / BigInt(i.requiredKg));
      }
      const bid = (q.bestBuyers as Array<{ cityId: string; isSystem: boolean; pricePerKg: string }>).find((b) => b.cityId === pl.sellCity && b.isSystem);
      const revenue = bid ? BigInt(bid.pricePerKg) * BigInt(q.output.qtyKg) : 0n;
      if (!supplying && revenue * 99n < cost * 105n) { skippedUnprofitable[co.sector] = (skippedUnprofitable[co.sector] ?? 0) + 1; return; }
      for (const inp of pl.inputs) {
        const need = inp.perBatchKg * pl.batches;
        const have = await stockKg(co.p, co.cityId, inp.productId);
        if (have < need) await buyFromSystem(co.p, co.cityId, inp.productId, need - have, fails);
      }
      const r = note(await co.p.post("/production/start", { facilityId: co.facilityId, recipeId: pl.recipe, batches: pl.batches, repeat: false, idempotencyKey: key() }));
      if (r.status === 200) productionStarts[co.sector] = (productionStarts[co.sector] ?? 0) + 1;
    };
    const deliverContract = async () => {
      const det = await crop.p.ok("GET", `/contracts/${contractId}`);
      contractLive = det.contract.status === "active";
      for (const s of det.schedule as Array<{ id: string; status: string; qtyDueKg: number; qtyDeliveredKg: number }>) {
        if (s.status !== "open") continue;
        const left = s.qtyDueKg - s.qtyDeliveredKg;
        if (left <= 0) continue;
        const have = (await lots(crop.p)).filter((l) => l.cityId === "korfezkent" && l.productId === "grain" && l.availableKg > 0).sort((a, b) => b.quality - a.quality);
        for (const l of have) {
          const q = Math.min(left, l.availableKg);
          const r = await crop.p.post(`/contracts/installments/${s.id}/deliver`, { qtyKg: q, quality: l.quality, idempotencyKey: key() });
          if (r.status === 200) break;
          // pencere açık değilse (INSTALLMENT_NOT_OPEN) sessizce geç
          if (r.body?.error?.code !== "INSTALLMENT_NOT_OPEN") note(r);
          break;
        }
      }
    };
    const freightStats = { accepted: 0, repositioned: 0 };
    const freightCycle = async () => {
      const fleet = (await frt.p.ok("GET", "/fleet")) as Array<{ id: string; status: string; cityId: string | null }>;
      const v = fleet.find((x) => x.status === "idle");
      if (!v || !v.cityId) return;
      const board = (await frt.p.ok("GET", "/freight-jobs?scope=board")) as Array<{ id: string; isSystem: boolean; originCityId: string; payAmount: string; estCostForMe: string | null; totalKg: number }>;
      const net = (j: { payAmount: string; estCostForMe: string | null }) => BigInt(j.payAmount) - BigInt(j.estCostForMe ?? "0");
      const here = board.filter((j) => j.isSystem && j.originCityId === v.cityId && net(j) > 0n).sort((a, b) => Number(net(b) - net(a)))[0];
      if (here) {
        const r = note(await frt.p.post(`/freight-jobs/${here.id}/accept`, { vehicleId: v.id, idempotencyKey: key() }));
        if (r.status === 200) freightStats.accepted++;
        return;
      }
      const there = board.filter((j) => j.isSystem && net(j) > 0n).sort((a, b) => Number(net(b) - net(a)))[0];
      if (there && there.originCityId !== v.cityId) {
        const r = note(await frt.p.post("/shipments", { vehicleId: v.id, destCityId: there.originCityId, cargo: [], idempotencyKey: key() }));
        if (r.status === 200) freightStats.repositioned++;
      }
    };

    let minSystemCash: bigint | null = null;
    const cycles = (SIM_DAYS * DAY) / CYCLE;
    for (let i = 0; i < cycles; i++) {
      for (const pl of plans) {
        if (pl.co === crop) await deliverContract();
        await sellToSystem(pl.co.p, pl.sellCity, pl.outProduct, pl.keepKg, fails);
        await productionRuns(pl);
      }
      await freightCycle();
      await h.advance(CYCLE, HOUR);
      const m = await one<{ m: string }>(sql`SELECT min(a.balance)::text m FROM cf.ledger_accounts a JOIN cf.companies c ON c.id = a.company_id WHERE c.is_system AND a.code = 'cash'`);
      const mv = BigInt(m.m);
      if (minSystemCash === null || mv < minSystemCash) minSystemCash = mv;
    }
    // son yerleşim turu ve tahliye
    await h.advance(6 * HOUR, HOUR);
    for (const pl of plans) await sellToSystem(pl.co.p, pl.sellCity, pl.outProduct, 0, fails);
    await deliverContract();
    await h.advance(HOUR, HOUR);

    // ---------------- sonuçlar
    const profits: Record<string, { profit: bigint; revenue: bigint; expense: bigint; netWorthDelta: bigint }> = {};
    for (const c of all) {
      const pl = await profitOf(c.companyId);
      profits[c.sector] = { ...pl, netWorthDelta: (await netWorthOf(c.companyId)) - startNet.get(c.companyId)! };
    }
    const elapsedDays = (h.deps.clock.nowMs() - t0) / DAY;
    RESULTS["çokHafta"] = { elapsedDays, profits, productionStarts, skippedUnprofitable, freightStats, fails, minSystemCash };
    console.log("MULTIWEEK", JSON.stringify(RESULTS["çokHafta"], (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(elapsedDays).toBeGreaterThanOrEqual(SIM_DAYS);

    // 1) sektör kârları ayrı testlerde denetlenir (aşağıda, "21 günlük kümülatif kâr pozitif")
    simProfits = profits;

    // 2) sistem şirketleri: günlük bütçe, günlük kg kapasitesi, nakit ≥ 0
    expect(minSystemCash! >= 0n).toBe(true);
    const sd = await h.deps.db.select({ r: systemDaily, key: companies.systemKey }).from(systemDaily).innerJoin(companies, eq(companies.id, systemDaily.companyId));
    expect(sd.length).toBeGreaterThan(0);
    const spentBy = new Map<string, bigint>();
    for (const { r, key: k } of sd) {
      const prof = SYSTEM_PROFILES.find((x) => x.companyKey === k);
      if (!prof) continue;
      expect(r.boughtKg, `${k} ${r.productId} ${r.day} alım`).toBeLessThanOrEqual(prof.buys[r.productId] ?? 0);
      expect(r.soldKg, `${k} ${r.productId} ${r.day} satış`).toBeLessThanOrEqual(prof.sells[r.productId] ?? 0);
      spentBy.set(`${k}|${r.day}`, (spentBy.get(`${k}|${r.day}`) ?? 0n) + r.spent);
    }
    let maxBudgetUse = 0;
    for (const [k, v] of spentBy) {
      const prof = SYSTEM_PROFILES.find((x) => x.companyKey === k.split("|")[0])!;
      expect(v, `${k} günlük bütçe`).toBeLessThanOrEqual(BigInt(prof.dailyBudget));
      maxBudgetUse = Math.max(maxBudgetUse, Number((v * 10000n) / BigInt(prof.dailyBudget)) / 100);
    }
    // sayaçlar fiilî işlemlerle uyumlu: sistemin alıcı olduğu işlemlerin toplam kg'ı = bought_kg toplamı
    const tradedBuy = await rows<{ k: string; kg: string }>(sql`
      SELECT c.system_key k, sum(t.qty_kg)::text kg FROM cf.trades t JOIN cf.companies c ON c.id = t.buyer_company_id
      WHERE t.buyer_is_system AND c.system_key IS NOT NULL GROUP BY c.system_key`);
    for (const r of tradedBuy) {
      const counted = sd.filter((x) => x.key === r.k).reduce((a, x) => a + x.r.boughtKg, 0);
      expect(counted, `${r.k} sayaç ≥ işlem`).toBeGreaterThanOrEqual(Number(r.kg));
    }
    RESULTS["çokHafta.sistem"] = { maxBudgetUsePercent: maxBudgetUse, minSystemCash };

    // 3) sözleşme: birkaç taksit ilerledi
    const ct = (await h.deps.db.select().from(contracts).where(eq(contracts.id, contractId)))[0]!;
    const insts = await h.deps.db.select().from(contractInstallments).where(eq(contractInstallments.contractId, contractId)).orderBy(contractInstallments.seq);
    const settled = insts.filter((i) => i.settledAt);
    const fulfilled = insts.filter((i) => i.status === "fulfilled");
    RESULTS["çokHafta.sözleşme"] = { status: ct.status, installments: insts.length, settled: settled.length, fulfilled: fulfilled.length, statuses: insts.map((i) => i.status) };
    expect(settled.length).toBeGreaterThanOrEqual(5);
    expect(fulfilled.length).toBeGreaterThanOrEqual(3);
    for (const i of settled) expect(i.qtyDeliveredKg).toBeLessThanOrEqual(i.qtyDueKg);
    expect(ct.status).toBe(settled.length === insts.length ? "completed" : "active");

    // 4) günlük bakım: şirket başına dönem boyunca her gün bir kez, çift yok
    const upk: Record<string, { charged: number; amountsDistinct: number; dupes: number }> = {};
    for (const c of all) {
      const ups = await rows<{ key: string; amt: string }>(sql`
        SELECT t.idempotency_key key, e.amount::text amt FROM cf.ledger_transactions t
        JOIN cf.ledger_entries e ON e.transaction_id = t.id JOIN cf.ledger_accounts a ON a.id = e.account_id
        WHERE t.kind = 'upkeep' AND t.ref_id = ${c.companyId} AND a.code = 'exp_upkeep' AND a.company_id = ${c.companyId}`);
      const keys = new Set(ups.map((u) => u.key));
      upk[c.sector] = { charged: ups.length, amountsDistinct: new Set(ups.map((u) => u.amt)).size, dupes: ups.length - keys.size };
      expect(ups.length, `${c.sector} bakım sayısı`).toBeGreaterThanOrEqual(SIM_DAYS - 1);
      expect(ups.length).toBeLessThanOrEqual(SIM_DAYS + 1);
      expect(ups.length - keys.size).toBe(0);
      const co = (await h.deps.db.select().from(companies).where(eq(companies.id, c.companyId)))[0]!;
      expect(co.nextUpkeepAt.getTime()).toBeGreaterThan(h.deps.clock.nowMs());
      // her gece bir bakım: ardışık vade aralıkları 24 sa
      const dues = ups.map((u) => new Date(u.key.slice(`upkeep:${c.companyId}:`.length)).getTime()).sort((a, b) => a - b);
      for (let k = 1; k < dues.length; k++) expect(dues[k]! - dues[k - 1]!).toBe(DAY);
      expect(await balOf(c.companyId, "arrears")).toBe(0n);
    }
    RESULTS["çokHafta.bakım"] = upk;

    // 5) hiçbir iş iki kez yerleşmedi
    const dupSettle = await rows(sql`SELECT ref_id FROM cf.ledger_transactions WHERE kind = 'production_settle' GROUP BY ref_id HAVING count(*) > 1`);
    expect(dupSettle).toEqual([]);
    const jobsDone = await one<{ n: number; s: number }>(sql`
      SELECT (SELECT count(*)::int FROM cf.production_jobs WHERE status = 'completed') n,
             (SELECT count(*)::int FROM cf.ledger_transactions WHERE kind = 'production_settle') s`);
    expect(jobsDone.s).toBe(jobsDone.n);
    const outMoves = await rows(sql`SELECT ref_id FROM cf.inventory_movements WHERE kind = 'production_output' GROUP BY ref_id HAVING count(*) > 1`);
    expect(outMoves).toEqual([]);
    const shipDone = await one<{ n: number; a: number }>(sql`
      SELECT (SELECT count(*)::int FROM cf.shipments WHERE status = 'delivered') n,
             (SELECT count(*)::int FROM cf.ledger_transactions WHERE kind = 'shipment_arrive') a`);
    expect(shipDone.a).toBeLessThanOrEqual(shipDone.n); // yalnızca navlun yerleşimi olan sevkiyatlar arrive işlemi yazar
    const dupArrive = await rows(sql`SELECT ref_id FROM cf.ledger_transactions WHERE kind = 'shipment_arrive' GROUP BY ref_id HAVING count(*) > 1`);
    expect(dupArrive).toEqual([]);
    const dupInst = await rows(sql`SELECT ref_id FROM cf.ledger_transactions WHERE kind = 'installment_settle' GROUP BY ref_id HAVING count(*) > 1`);
    expect(dupInst).toEqual([]);
    const instSettleTx = await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'installment_settle'`);
    const instSettledRows = await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.contract_installments WHERE settled_at IS NOT NULL`);
    expect(instSettleTx.n).toBe(instSettledRows.n);
    const dupFreight = await rows(sql`SELECT freight_job_id FROM cf.shipments WHERE freight_job_id IS NOT NULL GROUP BY freight_job_id HAVING count(*) > 1`);
    expect(dupFreight).toEqual([]);
    // sistem taşıma işi sayısı: taşımacı şirket birkaç iş üstlendi ve teslim etti
    const frtDelivered = await one<{ n: number }>(sql`
      SELECT count(*)::int n FROM cf.freight_jobs WHERE is_system AND status = 'delivered' AND carrier_company_id = ${frt.companyId}`);
    RESULTS["çokHafta.yerleşme"] = { productionSettled: jobsDone.n, shipmentsDelivered: shipDone.n, installmentsSettled: instSettledRows.n, freightJobsDelivered: frtDelivered.n };
    expect(frtDelivered.n).toBeGreaterThanOrEqual(5);
    expect(freightStats.accepted).toBeGreaterThanOrEqual(5);

    expect(await checkInvariants(h.deps.db)).toEqual([]);
    await h.close();
  }, 1_800_000);

  for (const sector of ["crop", "livestock", "mining", "manufacturing", "freight"]) {
    it(`21 günlük kümülatif kâr pozitif: ${sector}`, () => {
      expect(simProfits, "simülasyon testi önce çalışmalı").not.toBeNull();
      const pr = simProfits![sector]!;
      expect(pr.profit, `${sector}: gelir ${pr.revenue}, gider ${pr.expense}, kâr ${pr.profit} kuruş`).toBeGreaterThan(0n);
    });
  }
});

// ================================================================== 3) kalıcılık, yeniden başlatma, ikinci yayın

const DBURL = () => process.env.DATABASE_URL ?? "postgres://capitalforge:capitalforge@localhost:5432/capitalforge_test";

/** Oyuncu verisi + katalog düzenlemeleri için karşılaştırılabilir özet (sistem şirketleri ve zamanla değişen satırlar hariç) */
async function dataFingerprint(): Promise<Record<string, unknown>> {
  const fp: Record<string, unknown> = {};
  fp.companies = await rows(sql`SELECT id, name, sector, level, xp, home_city_id, on_time_deliveries, late_or_missed FROM cf.companies WHERE NOT is_system ORDER BY id`);
  fp.balances = await rows(sql`
    SELECT a.company_id, a.code, a.balance::text FROM cf.ledger_accounts a JOIN cf.companies c ON c.id = a.company_id WHERE NOT c.is_system ORDER BY a.company_id, a.code`);
  fp.holdings = await rows(sql`
    SELECT h.company_id, h.city_id, h.product_id, h.quality, h.qty_kg, h.reserved_kg, h.cost_total::text FROM cf.holdings h
    JOIN cf.companies c ON c.id = h.company_id WHERE NOT c.is_system ORDER BY h.company_id, h.city_id, h.product_id, h.quality`);
  fp.plots = await rows(sql`SELECT id, owner_company_id FROM cf.plots WHERE owner_company_id IS NOT NULL ORDER BY id`);
  fp.grants = await rows(sql`SELECT company_id, details FROM cf.starter_grants ORDER BY company_id`);
  fp.jobs = await rows(sql`SELECT id, status, ends_at, completed_at FROM cf.production_jobs ORDER BY id`);
  fp.shipments = await rows(sql`SELECT id, status, arrives_at FROM cf.shipments ORDER BY id`);
  fp.catalog = await rows(sql`SELECT kind, id, data, version FROM cf.catalog_items ORDER BY kind, id`);
  fp.settings = await rows(sql`SELECT key, value FROM cf.settings ORDER BY key`);
  fp.playerTx = await rows(sql`
    SELECT count(*)::int n, coalesce(sum(abs(e.amount)),0)::text s FROM cf.ledger_entries e JOIN cf.ledger_accounts a ON a.id = e.account_id
    JOIN cf.companies c ON c.id = a.company_id WHERE NOT c.is_system`);
  fp.systemCapital = await rows(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'system_capital'`);
  fp.accounts = await rows(sql`SELECT id, username FROM cf.accounts ORDER BY id`);
  return fp;
}

async function mkAdmin(hh: Harness): Promise<Player> {
  const p = await hh.player();
  const me = await p.ok("GET", "/auth/me");
  await hh.deps.db.update(accounts).set({ role: "admin", canReviewConnections: true }).where(eq(accounts.id, me.account.id));
  const { secret } = await p.ok("POST", "/auth/totp/setup");
  await p.ok("POST", "/auth/totp/enable", { code: totpAt(secret, Math.floor(hh.deps.clock.nowMs() / 30000)) });
  return p;
}

const bumpClockWhileDown = async (ms: number): Promise<void> => {
  const { db, sql: client } = createDb(DBURL(), 1);
  await db.execute(sql`UPDATE cf.world_clock SET offset_ms = offset_ms + ${ms} WHERE id = 1`);
  await client.end({ timeout: 2 });
};

describe("3) kalıcılık ve yeniden başlatma", () => {
  it("yarım üretim + yarım sevkiyat: yeniden başlatma, kapalıyken geçen süre, ikinci yayın; her iş tam bir kez yerleşir", async () => {
    h = await createHarness();
    await h.tick();
    const admin = await mkAdmin(h);

    // oyuncular: üretici (tarım), taşımacı A (kendi sevkiyatı), taşımacı B (taşıma işi), yük sahibi (hayvancılık)
    const prod = await foundCo(await h.player("uretici_" + rnd(), "10.20.0.1"), "crop", "yesilova");
    const carA = await foundCo(await h.player("tasimaciA_" + rnd(), "10.20.0.2"), "freight", "kavsak");
    const carB = await foundCo(await h.player("tasimaciB_" + rnd(), "10.20.0.3"), "freight", "akyayla");
    const shipper = await foundCo(await h.player("yuk_" + rnd(), "10.20.0.4"), "livestock", "akyayla");
    const names = new Map<string, string>([
      [prod.companyId, "uretici"], [carA.companyId, "tasimaciA"], [carB.companyId, "tasimaciB"], [shipper.companyId, "yuk"],
    ]);
    void names;

    // yönetici katalog düzenlemesi (ikinci yayında ezilmemeli)
    const recipe = h.deps.catalog.recipe("grow_grain");
    await admin.ok("PATCH", `/admin/catalog/recipes/grow_grain`, { minutes: recipe.minutes + 17, reasoning: "kabul testi", idempotencyKey: key() });
    const grainBase = h.deps.catalog.product("grain").basePricePerKg;
    await admin.ok("PATCH", "/admin/catalog/products/grain", { basePricePerKg: grainBase + 50, reasoning: "kabul testi", idempotencyKey: key() });
    await admin.ok("PATCH", "/admin/settings", { key: "anomaly.thresholdBp", value: 4100, reasoning: "kabul testi" });

    // yarım üretim (60+ dk sürer)
    const quote = await prod.p.ok("POST", "/production/quote", { facilityId: prod.facilityId, recipeId: "grow_fodder", batches: 2 });
    const job = await prod.p.ok("POST", "/production/start", { facilityId: prod.facilityId, recipeId: "grow_fodder", batches: 2, repeat: false, idempotencyKey: key() });
    expect(quote.minutes).toBeGreaterThan(30);

    // yarım sevkiyat: kendi araçlı (A) ve taşıma işi (B, yük sahibi)
    await grantStock(h, carA.companyId, "kavsak", "grain", 2, 1000, 10n);
    const vehA = (await carA.p.ok("GET", "/fleet"))[0];
    const shipA = await carA.p.ok("POST", "/shipments", { vehicleId: vehA.id, destCityId: "korfezkent", cargo: [{ productId: "grain", quality: 2, qtyKg: 1000 }], idempotencyKey: key() });
    await grantStock(h, shipper.companyId, "akyayla", "fodder", 3, 2000, 10n);
    const fjob = await shipper.p.ok("POST", "/freight-jobs", {
      originCityId: "akyayla", destCityId: "kavsak", cargo: [{ productId: "fodder", quality: 3, qtyKg: 2000 }], payAmount: 300_000, deadlineHours: 48, allowSystemCarrier: false, idempotencyKey: key(),
    });
    const vehB = (await carB.p.ok("GET", "/fleet"))[0];
    await carB.p.ok("POST", `/freight-jobs/${fjob.id}/accept`, { vehicleId: vehB.id, idempotencyKey: key() });
    const shipBrow = await one<{ id: string; arrives_at: string }>(sql`SELECT id, arrives_at FROM cf.shipments WHERE carrier_company_id = ${carB.companyId}`);

    await h.advance(20 * 60_000, 10 * 60_000);
    // yarıda: hiçbiri bitmedi
    const inFlight = async () => ({
      job: (await one<{ status: string }>(sql`SELECT status FROM cf.production_jobs WHERE id = ${job.id}`)).status,
      shipA: (await one<{ status: string }>(sql`SELECT status FROM cf.shipments WHERE id = ${shipA.id}`)).status,
      shipB: (await one<{ status: string }>(sql`SELECT status FROM cf.shipments WHERE id = ${shipBrow.id}`)).status,
    });
    expect(await inFlight()).toEqual({ job: "running", shipA: "in_transit", shipB: "in_transit" });
    const wipBefore = await balOf(prod.companyId, "wip");
    expect(wipBefore).toBe(BigInt(job.cost.total));
    const cookie = prod.p.cookie;
    const fp1 = await dataFingerprint();
    const editedRecipeMinutes = recipe.minutes + 17;

    // --- yeniden başlatma #1 (kapalı süre yok): uygulamayı kapat, aynı veritabanıyla yeni örnek
    await h.close();
    h = await createHarness({ keepDb: true });
    const fp2 = await dataFingerprint();
    expect(fp2).toEqual(fp1);
    // oturum ve katalog kalıcı
    const prod2 = new Player(h, prod.p.username, prod.p.ip);
    prod2.cookie = cookie;
    const me = await prod2.ok("GET", "/company");
    expect(me.id).toBe(prod.companyId);
    expect(me.facilities[0].jobs.find((j: { id: string }) => j.id === job.id).status).toBe("running");
    expect(h.deps.catalog.recipe("grow_grain").minutes).toBe(editedRecipeMinutes);
    expect(h.deps.catalog.product("grain").basePricePerKg).toBe(grainBase + 50);
    expect(h.deps.catalog.settings.anomaly.thresholdBp).toBe(4100);
    // yeniden başlatmadan sonra iş hâlâ yarım; erken tick bitirmez
    await h.tick();
    expect(await inFlight()).toEqual({ job: "running", shipA: "in_transit", shipB: "in_transit" });

    // --- yeniden başlatma #2: sunucu kapalıyken zaman geçer (18 sa); açılışta gecikmiş işler ilk turda yerleşir
    await h.close();
    await bumpClockWhileDown(18 * HOUR);
    h = await createHarness({ keepDb: true });
    const first = await h.tick();
    expect(first["production.settle"]).toBe(1);
    expect(first["b.shipments.arrive"]).toBeGreaterThanOrEqual(2);
    expect(await inFlight()).toEqual({ job: "completed", shipA: "delivered", shipB: "delivered" });
    // yarış: üç eşzamanlı tur + ek turlar hiçbir şeyi ikinci kez yerleştirmez
    const now = h.deps.clock.now();
    const { runDue } = await import("../scheduler/scheduler");
    const conc = await Promise.all([runDue(h.deps, now, true), runDue(h.deps, now, true), runDue(h.deps, now, true)]);
    expect(conc.reduce((a, r) => a + (r["production.settle"] ?? 0), 0)).toBe(0);
    expect(conc.reduce((a, r) => a + (r["b.shipments.arrive"] ?? 0), 0)).toBe(0);
    await h.advance(2 * HOUR, HOUR);

    const cnt = async (kind: string, refId: string) => Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = ${kind} AND ref_id = ${refId}`)).n);
    expect(await cnt("production_settle", job.id)).toBe(1);
    expect(await cnt("shipment_arrive", shipA.id)).toBeLessThanOrEqual(1);
    expect(await cnt("shipment_arrive", shipBrow.id)).toBe(1);
    // üretim: stok = çıktı (bir kez), wip boşaldı, XP bir kez
    const prodNow = new Player(h, prod.p.username, prod.p.ip);
    prodNow.cookie = cookie;
    expect(await stockKg(prodNow, "yesilova", "fodder")).toBe(job.output.qtyKg);
    expect(await balOf(prod.companyId, "wip")).toBe(0n);
    expect((await one<{ xp: number }>(sql`SELECT xp FROM cf.companies WHERE id = ${prod.companyId}`)).xp).toBe(h.deps.catalog.settings.xp.productionJob);
    expect(Number((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.inventory_movements WHERE kind = 'production_output' AND ref_id = ${job.id}`)).n)).toBe(1);
    // sevkiyat A: hedefte tam 1000 kg, maliyete navlun eklendi, araç hedefte boşta
    const hA = await one<{ qty: number; cost: string }>(sql`SELECT qty_kg::int qty, cost_total::text cost FROM cf.holdings WHERE company_id = ${carA.companyId} AND city_id = 'korfezkent' AND product_id = 'grain'`);
    expect(hA.qty).toBe(1000);
    expect(BigInt(hA.cost)).toBe(10_000n + BigInt(shipA.cost.total));
    expect((await one<{ city_id: string; status: string }>(sql`SELECT city_id, status FROM cf.vehicles WHERE id = ${vehA.id}`))).toMatchObject({ city_id: "korfezkent", status: "idle" });
    // taşıma işi B: ücret taşımacıya bir kez, yük sahibinin emaneti boş, teslim kanıtı
    expect(-(await balOf(carB.companyId, "revenue_freight"))).toBe(300_000n);
    expect(await balOf(shipper.companyId, "escrow")).toBe(0n);
    const hB = await one<{ qty: number }>(sql`SELECT qty_kg::int qty FROM cf.holdings WHERE company_id = ${shipper.companyId} AND city_id = 'kavsak' AND product_id = 'fodder'`);
    expect(hB.qty).toBe(2000);
    expect((await one<{ status: string }>(sql`SELECT status FROM cf.freight_jobs WHERE id = ${fjob.id}`)).status).toBe("delivered");
    const fingerAfterSettle = await dataFingerprint();

    // --- ikinci yayın: migration + tohumlama tekrar; oyuncu verisi ve katalog düzenlemeleri aynen kalır
    await runMigrations(DBURL());
    await runMigrations(DBURL());
    const fp4 = await dataFingerprint();
    expect(fp4).toEqual(fingerAfterSettle);
    // katalog düzenlemeleri hâlâ yerinde ve yeni örnek bunları okur
    await h.close();
    h = await createHarness({ keepDb: true });
    expect(h.deps.catalog.recipe("grow_grain").minutes).toBe(editedRecipeMinutes);
    expect(h.deps.catalog.product("grain").basePricePerKg).toBe(grainBase + 50);
    expect(h.deps.catalog.settings.anomaly.thresholdBp).toBe(4100);
    expect((await dataFingerprint()).catalog).toEqual(fp1.catalog);
    expect(await dataFingerprint()).toEqual(fingerAfterSettle); // üçüncü açılış da hiçbir oyuncu verisini değiştirmedi
    // sistem şirketleri sermayesi yeniden verilmedi
    const cap = await one<{ n: number; c: number }>(sql`SELECT (SELECT count(*)::int FROM cf.ledger_transactions WHERE kind = 'system_capital') n, (SELECT count(*)::int FROM cf.companies WHERE is_system) c`);
    expect(cap.n).toBe(cap.c);
    // yeniden başlatılmış örnekte tam iş akışı sürer (üretim yeniden başlar ve biter)
    const p2 = new Player(h, prod.p.username, prod.p.ip);
    p2.cookie = cookie;
    await buyFromSystem(p2, "yesilova", "seed", 200);
    const again = await p2.ok("POST", "/production/start", { facilityId: prod.facilityId, recipeId: "grow_fodder", batches: 1, repeat: false, idempotencyKey: key() });
    await h.advance(3 * HOUR, HOUR);
    expect((await one<{ status: string }>(sql`SELECT status FROM cf.production_jobs WHERE id = ${again.id}`)).status).toBe("completed");
    RESULTS["yenidenBaşlatma"] = { restarts: 3, secondDeployRuns: 2, productionSettleTx: 1, shipmentArriveTx: 1, freightPaid: 300_000 };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
    await h.close();
  }, 300_000);
});

// ================================================================== 4) çevrimdışı tamamlanma

describe("4) çevrimdışı tamamlanma", () => {
  it("oyuncu hiç istek atmadan zaman ilerler; üretim zinciri, sevkiyat, araştırma, sahipsiz ilan satışı, bakım yerleşir", async () => {
    h = await createHarness();
    await h.tick();
    const crop = await foundCo(await h.player(), "crop", "yesilova");
    const live = await foundCo(await h.player(), "livestock", "akyayla");
    const frt = await foundCo(await h.player(), "freight", "kavsak");

    // 1) tekrar modunda üretim zinciri (400 kg tohum → iki iş)
    await crop.p.ok("POST", "/production/start", { facilityId: crop.facilityId, recipeId: "grow_fodder", batches: 1, repeat: true, idempotencyKey: key() });
    // 2) araştırma
    await crop.p.ok("POST", "/research/agronomy/start", { idempotencyKey: key() });
    // 3) kendi sevkiyatı
    await grantStock(h, frt.companyId, "kavsak", "grain", 2, 1000, 10n);
    const veh = (await frt.p.ok("GET", "/fleet"))[0];
    const ship = await frt.p.ok("POST", "/shipments", { vehicleId: veh.id, destCityId: "korfezkent", cargo: [{ productId: "grain", quality: 2, qtyKg: 1000 }], idempotencyKey: key() });
    // 4) sahipsiz ilan: sistem fiyatın altındaysa üstlenir (6 saat sonra)
    await grantStock(h, live.companyId, "akyayla", "fodder", 2, 3000, 100n);
    const ref = await one<{ p: string }>(sql`SELECT ref_price_per_kg::text p FROM cf.price_refs WHERE product_id = 'fodder' AND city_id = 'akyayla'`);
    const listPrice = Number(BigInt(ref.p) / 2n);
    const listing = await live.p.ok("POST", "/market/listings", { cityId: "akyayla", productId: "fodder", quality: 2, qtyKg: 3000, pricePerKg: listPrice, idempotencyKey: key() });
    const liveCash0 = await cashOf(live.companyId);
    const cropXp0 = (await one<{ xp: number }>(sql`SELECT xp FROM cf.companies WHERE id = ${crop.companyId}`)).xp;
    const cropCash0 = await cashOf(crop.companyId);

    // --- oyuncular çevrimdışı: hiçbir istek yok, yalnızca saat ve zamanlayıcı ilerler (60 saat)
    const sessionsBefore = await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.idempotency_keys`);
    await h.advance(60 * HOUR, HOUR);
    expect((await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.idempotency_keys`)).n).toBe(sessionsBefore.n); // oyuncu isteği yok

    const q = async <T = Record<string, unknown>>(s: ReturnType<typeof sql>) => (await rows<T>(s));
    // üretim zinciri: iki iş tamamlandı, wip boş
    const jobs = await q<{ status: string }>(sql`SELECT status FROM cf.production_jobs WHERE company_id = ${crop.companyId}`);
    expect(jobs.filter((j) => j.status === "completed")).toHaveLength(2);
    expect(jobs.filter((j) => j.status === "running")).toHaveLength(0);
    expect(await balOf(crop.companyId, "wip")).toBe(0n);
    const settleTx = await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'production_settle' AND ref_id IN (SELECT id::text FROM cf.production_jobs WHERE company_id = ${crop.companyId})`);
    expect(settleTx.n).toBe(2);
    expect((await one<{ xp: number }>(sql`SELECT xp FROM cf.companies WHERE id = ${crop.companyId}`)).xp - cropXp0).toBe(2 * h.deps.catalog.settings.xp.productionJob);
    // araştırma
    expect((await one<{ level: number }>(sql`SELECT level FROM cf.research WHERE company_id = ${crop.companyId} AND research_id = 'agronomy'`)).level).toBe(1);
    // sevkiyat
    expect((await one<{ status: string }>(sql`SELECT status FROM cf.shipments WHERE id = ${ship.id}`)).status).toBe("delivered");
    expect((await one<{ qty: number }>(sql`SELECT qty_kg::int qty FROM cf.holdings WHERE company_id = ${frt.companyId} AND city_id = 'korfezkent' AND product_id = 'grain'`)).qty).toBe(1000);
    // sahipsiz ilan: sistem aldı, satıcı nakdi tam brüt − komisyon − bakım kadar değişti
    const ord = await one<{ status: string; first_fill_at: string | null; remaining_kg: number }>(sql`SELECT status, first_fill_at, remaining_kg::int remaining_kg FROM cf.market_orders WHERE id = ${listing.id}`);
    expect(ord.first_fill_at, "sahipsiz ilan sistem tarafından üstlenildi").not.toBeNull();
    const sale = await one<{ gross: string; fees: string; qty: number }>(sql`
      SELECT coalesce(sum(gross),0)::text gross, coalesce(sum(fees),0)::text fees, coalesce(sum(qty_kg),0)::int qty FROM cf.sales WHERE seller_company_id = ${live.companyId}`);
    expect(sale.qty).toBe(3000 - ord.remaining_kg);
    const upkeep = await one<{ s: string }>(sql`
      SELECT coalesce(sum(e.amount),0)::text s FROM cf.ledger_entries e JOIN cf.ledger_accounts a ON a.id = e.account_id JOIN cf.ledger_transactions t ON t.id = e.transaction_id
      WHERE a.company_id = ${live.companyId} AND a.code = 'cash' AND t.kind = 'upkeep'`);
    expect((await cashOf(live.companyId)) - liveCash0).toBe(BigInt(sale.gross) - BigInt(sale.fees) + BigInt(upkeep.s));
    // günlük bakım çevrimdışıyken de alındı
    for (const c of [crop, live, frt]) {
      const n = await one<{ n: number }>(sql`SELECT count(*)::int n FROM cf.ledger_transactions WHERE kind = 'upkeep' AND ref_id = ${c.companyId}`);
      expect(n.n, `${c.sector} bakım`).toBeGreaterThanOrEqual(1);
    }
    expect(cropCash0).toBeGreaterThan(await cashOf(crop.companyId)); // araştırma + bakım + üretim gideri nakitten düştü

    // oyuncu geri döner: ilk istekle her şeyi görür
    const notes = await crop.p.ok("GET", "/notifications");
    expect(notes.filter((n: { kind: string }) => n.kind === "production_done")).toHaveLength(2);
    expect(notes.some((n: { kind: string }) => n.kind === "research_done" || n.kind === "research_completed")).toBe(true);
    const me = await live.p.ok("GET", "/company");
    expect(me.cash).toBe((await cashOf(live.companyId)).toString());
    RESULTS["çevrimdışı"] = { hoursOffline: 60, productionJobsSettled: 2, shipmentDelivered: 1, researchLevel: 1, orphanListingSoldKg: sale.qty, orphanGross: sale.gross };
    expect(await checkInvariants(h.deps.db)).toEqual([]);
    await h.close();
  }, 300_000);
});

