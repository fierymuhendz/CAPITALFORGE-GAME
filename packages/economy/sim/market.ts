/**
 * Ajan tabanlı pazar simülasyonu (saf, deterministik; saat, ağ, veritabanı yok). Zaman bir sayaçtır (saat), rastgelelik `seededRng(seed)`.
 *
 * Sistem şirketleri (SYSTEM_PROFILES): sınırlı günlük arz, bütçeli talep, oyuncular arası 24 sa hacim arttıkça kademeli küçülme
 * (sunucudaki `playerShareBp` + `systemShareFactorBp` ile aynı formül), alış/satış fiyat eğrileri `systemBid`/`systemAsk`,
 * saatlik referans kayması `nextDriftBp`. Oyuncular: her biri bir ya da birkaç üretim hattına (tarif + şehir) sahip üretici/işleyici;
 * girdi için alış emri, çıktı için satış emri; fiyatlar zamanla (emrin yaşıyla) birbirine yaklaşır; eşleşmede fiyat alış-satış ortasıdır,
 * alıcı navlunu (kendi kamyonu) öder, satıcı %1 komisyon öder. Sistemle işlem: satıcı, sistem alışı net satış beklentisine ulaşınca;
 * alıcı, teklifi sistem satışının teslim maliyetine ulaşınca.
 *
 * Basitleştirmeler: her hat seviye 1 (saatte en çok 1 parti, tempo tavanı 60 dk), kalite 2, taşıma süresi 0 (yalnızca maliyet),
 * nakit kısıtı yok (limitsiz kredi), hat başına tek çıktı. Para bigint kuruş; oranlar tam sayı bp.
 */
import {
  BUILDING_TYPES, CITIES, QUALITY_PRICE_BP, RECIPES, SYSTEM_PROFILES, V4_DEMAND_BUDGET, V4_SYSTEM_PROFILES, buildV4Profiles, profileBidBp,
  type DemandBudget, type RecipeDef, type SystemProfile,
} from "@capitalforge/shared";
import {
  applyBp, nextDriftBp, planProduction, playerShareBp, refPrice, seededRng, systemAsk, systemBid, systemBidCap, systemBidForQuality, systemShareFactorBp,
  type Rng,
} from "../src/index";
import { S, freightPerKg, prod } from "./model";

// ───────────────────────── Ayarlar ve senaryo tanımı ─────────────────────────

/** Denge değerleri; "önce/sonra" karşılaştırması için ayrı verilebilir */
export interface Tuning {
  /** sistem talebi sayıları (demand.ts V4_DEMAND_BUDGET ile aynı alanlar) */
  budget: DemandBudget;
  /** oyuncu payı arttıkça sistem küçülme katsayısı (bp) */
  shareDampBp: number;
}
export const CATALOG_TUNING: Tuning = { budget: { ...V4_DEMAND_BUDGET }, shareDampBp: S.system.shareDampBp };

export type EventKind = "shortage" | "surplus";
export interface ScenarioSpec {
  name: string;
  players: number;
  /** hat kümesi kopya sayısı (rekabet yoğunluğu) */
  copies: number;
  event: EventKind;
  seed: number;
  hours?: number;
}

export interface LineSpec { key: string; recipeId: string; cityId: string }
/** Zincirler: karma yem (arpa+mısır → yem → süt → paketli süt), tahıl (un), çelik (cevher+kömür → çelik → inşaat demiri), patates, süt (yem bitkisiyle), tekstil (pamuk → lif → iplik → havlu), fındık (hasat → kavurma) */
export const BASE_LINES: LineSpec[] = [
  { key: "barley", recipeId: "grow_barley", cityId: "yesilova" },
  { key: "corn", recipeId: "grow_corn", cityId: "yesilova" },
  { key: "compound_feed", recipeId: "mix_compound_feed", cityId: "yesilova" },
  { key: "milk_compound", recipeId: "milk_cows_compound", cityId: "akyayla" },
  { key: "pack_milk", recipeId: "pack_milk", cityId: "korfezkent" },
  { key: "grain", recipeId: "grow_grain", cityId: "yesilova" },
  { key: "flour", recipeId: "mill_flour", cityId: "korfezkent" },
  { key: "iron", recipeId: "mine_iron", cityId: "demirdag" },
  { key: "coal", recipeId: "mine_coal", cityId: "demirdag" },
  { key: "steel", recipeId: "smelt_steel", cityId: "demirdag" },
  { key: "rebar", recipeId: "roll_rebar", cityId: "demirdag" },
  { key: "potato", recipeId: "grow_potato", cityId: "korfezkent" },
  { key: "milk_fodder", recipeId: "milk_cows", cityId: "akyayla" },
  { key: "gin", recipeId: "gin_cotton", cityId: "yesilova" },
  { key: "spin", recipeId: "spin_cotton", cityId: "kavsak" },
  { key: "towel", recipeId: "weave_towel", cityId: "kavsak" },
  { key: "hazelnut", recipeId: "harvest_hazelnut", cityId: "yesilova" },
  { key: "roast", recipeId: "roast_hazelnut", cityId: "korfezkent" },
];

export const WARMUP = 24;
export const WINDOWS = ["warm", "A", "B", "C"] as const;
export type Win = (typeof WINDOWS)[number];
/** A: normal, B: olay (kıtlık / fazla üretim), C: toparlanma */
export const EVENT_FROM = 72;
export const EVENT_TO = 120;
export const winOf = (t: number): Win => (t < WARMUP ? "warm" : t < EVENT_FROM ? "A" : t < EVENT_TO ? "B" : "C");
/** olay saatlerinde etkilenen hatlar */
const SHORTAGE_LINES = new Set(["barley", "corn"]);
/** kıtlıkta sistem depolarının arpa/mısır arzından geriye kalan oran (bp) */
const SHORTAGE_SYSTEM_LEFT_BP = 3000;
const SHORTAGE_PRODUCTS = ["barley", "corn"];
const SURPLUS_LINES = new Set(["iron", "coal", "steel", "rebar"]);
const SURPLUS_CAPACITY = 3;

const STEP = 250;
const FEE_BP = S.marketFeeBp;
const sale = (gross: bigint) => applyBp(gross, 10000 - FEE_BP);

// ───────────────────────── Sistem tarafı ─────────────────────────

interface SysProfile {
  key: string; cityId: string; buys: Record<string, number>; sells: Record<string, number>; budget: bigint; src: SystemProfile;
  bought: Map<string, number>; sold: Map<string, number>; spent: Map<string, bigint>;
}

/** Eski (v3) sistem şirketleri + `tuning.budget` ile yeniden kurulan v4 profilleri */
export function buildProfiles(tuning: Tuning): SysProfile[] {
  const v4Keys = new Set(V4_SYSTEM_PROFILES.map((p) => p.companyKey));
  const all: SystemProfile[] = [...SYSTEM_PROFILES.filter((p) => !v4Keys.has(p.companyKey)), ...buildV4Profiles(tuning.budget)];
  return all.map((p) => ({ key: p.companyKey, cityId: p.cityId, buys: { ...p.buys }, sells: { ...p.sells }, budget: BigInt(p.dailyBudget), src: p, bought: new Map(), sold: new Map(), spent: new Map() }));
}

export interface BidQuote { unit: bigint; qty: number; prof: SysProfile }
export interface AskQuote { unit: bigint; qty: number; prof: SysProfile }

export class SystemSide {
  readonly profiles: SysProfile[];
  private drift = new Map<string, number>();
  private p2pRing = new Map<string, number[]>();
  private weightCache = new Map<string, bigint>();
  private capCache = new Map<string, bigint | null>();
  /** son 24 sa oyuncular arası (farklı sahip) işlemler: ürün|şehir → [{fiyat, kg, alıcı>satıcı}] */
  private recent: Array<{ t: number; pid: string; city: string; price: bigint; kg: number; pair: string }> = [];
  /** ürün → sistem arzının kalan oranı (bp); kıtlık olayında kesinti */
  supplyScaleBp = new Map<string, number>();
  constructor(readonly tuning: Tuning) { this.profiles = buildProfiles(tuning); }

  driftOf(pid: string, city: string): number { return this.drift.get(`${pid}|${city}`) ?? 10000; }
  ref(pid: string, city: string): bigint {
    const c = CITIES.find((x) => x.id === city)!;
    return refPrice(prod(pid).basePricePerKg, c.priceBp[pid] ?? 10000, this.driftOf(pid, city));
  }
  /** alış üst sınırı: güncel referanslardan türetilir (sunucudaki bidCapFromRefs) */
  cap(pid: string): bigint | null {
    const hit = this.capCache.get(pid);
    if (hit !== undefined) return hit;
    if (!this.profiles.some((p) => (p.buys[pid] ?? 0) > 0)) { this.capCache.set(pid, null); return null; }
    let min: bigint | null = null;
    for (const c of CITIES) { const a = systemAsk(this.ref(pid, c.id), S.system.askBp, 0, 1); if (min === null || a < min) min = a; }
    const v = min === null ? null : systemBidCap(min);
    this.capCache.set(pid, v);
    return v;
  }
  private pp24(pid: string, city: string): number { return (this.p2pRing.get(`${pid}|${city}`) ?? []).reduce((a, b) => a + b, 0); }
  factor(pid: string, city: string, nominal: number): number {
    return systemShareFactorBp(playerShareBp(this.pp24(pid, city), nominal), this.tuning.shareDampBp);
  }
  private weight(p: SysProfile): bigint {
    const hit = this.weightCache.get(p.key);
    if (hit !== undefined) return hit;
    const v = Object.entries(p.buys).reduce((a, [pid, kg]) => a + BigInt(kg) * this.ref(pid, p.cityId), 0n);
    this.weightCache.set(p.key, v);
    return v;
  }
  bidQuote(p: SysProfile, pid: string): BidQuote | null {
    const B = p.buys[pid] ?? 0;
    if (B <= 0) return null;
    const f = this.factor(pid, p.cityId, B + (p.sells[pid] ?? 0));
    const eff = Math.floor((B * f) / 10000);
    const bought = p.bought.get(pid) ?? 0;
    const cap = this.cap(pid);
    const bid = systemBid(this.ref(pid, p.cityId), profileBidBp(p.src, pid, S.system.bidBp), bought, B, cap);
    const maxUnit = systemBidForQuality(bid, 5, cap, QUALITY_PRICE_BP);
    const w = this.weight(p);
    const share = w > 0n ? (p.budget * BigInt(B) * this.ref(pid, p.cityId)) / w : 0n;
    const total = applyBp(share, f);
    const spent = p.spent.get(pid) ?? 0n;
    const left = total > spent ? total - spent : 0n;
    const qty = Math.max(0, Math.min(eff - bought, Number(left / maxUnit)));
    return { unit: bid, qty, prof: p };
  }
  askQuote(p: SysProfile, pid: string): AskQuote | null {
    const Sd = p.sells[pid] ?? 0;
    if (Sd <= 0) return null;
    const f = this.factor(pid, p.cityId, Sd + (p.buys[pid] ?? 0));
    const eff = Math.floor((Sd * f) / 10000);
    const sold = p.sold.get(pid) ?? 0;
    const scale = this.supplyScaleBp.get(pid) ?? 10000;
    const left = Math.min(Sd - sold, eff - sold) - Math.floor((Sd * (10000 - scale)) / 10000);
    return { unit: systemAsk(this.ref(pid, p.cityId), S.system.askBp, sold, Sd), qty: Math.max(0, left), prof: p };
  }
  /** ürünü alan sistem şirketleri arasında, teslim şehrinden navlun düşüldükten sonra en iyi net teklif */
  bestBid(pid: string, from: string, qtyHint: number): { net: bigint; quote: BidQuote; freight: bigint } | null {
    let best: { net: bigint; quote: BidQuote; freight: bigint } | null = null;
    for (const p of this.profiles) {
      const q = this.bidQuote(p, pid);
      if (!q || q.qty <= 0) continue;
      const fr = freightPerKg(from, p.cityId, qtyHint);
      const net = sale(q.unit) - fr;
      if (!best || net > best.net) best = { net, quote: q, freight: fr };
    }
    return best;
  }
  /** ürünü satan sistem şirketleri arasında teslim şehrinde en ucuz toplam */
  bestAsk(pid: string, to: string, qtyHint: number): { landed: bigint; quote: AskQuote; freight: bigint } | null {
    let best: { landed: bigint; quote: AskQuote; freight: bigint } | null = null;
    for (const p of this.profiles) {
      const q = this.askQuote(p, pid);
      if (!q || q.qty <= 0) continue;
      const fr = freightPerKg(p.cityId, to, qtyHint);
      const landed = q.unit + fr;
      if (!best || landed < best.landed) best = { landed, quote: q, freight: fr };
    }
    return best;
  }
  resetDay(): void { for (const p of this.profiles) { p.bought.clear(); p.sold.clear(); p.spent.clear(); } }
  recordP2p(t: number, pid: string, city: string, kg: number, price: bigint, pair: string): void {
    const ring = this.p2pRing.get(`${pid}|${city}`) ?? new Array<number>(24).fill(0);
    ring[t % 24]! += kg;
    this.p2pRing.set(`${pid}|${city}`, ring);
    this.recent.push({ t, pid, city, price, kg, pair });
  }
  /** her saat başı: ring'i kaydır, referans kaymasını güncelle (VWAP ≥ 3 farklı alıcı>satıcı çiftiyle) */
  hourStart(t: number): void {
    for (const ring of this.p2pRing.values()) ring[t % 24] = 0;
    this.recent = this.recent.filter((r) => r.t > t - 24);
    this.weightCache.clear(); this.capCache.clear();
    const byKey = new Map<string, typeof this.recent>();
    for (const r of this.recent) { const k = `${r.pid}|${r.city}`; const a = byKey.get(k) ?? []; a.push(r); byKey.set(k, a); }
    const keys = new Set<string>([...this.drift.keys(), ...byKey.keys()]);
    for (const p of this.profiles) for (const pid of Object.keys(p.buys)) keys.add(`${pid}|${p.cityId}`);
    for (const k of keys) {
      const [pid, city] = k.split("|") as [string, string];
      const rows = byKey.get(k) ?? [];
      const total = rows.reduce((a, r) => a + r.kg, 0);
      let ratio: number | null = null;
      if (new Set(rows.map((r) => r.pair)).size >= 3 && total > 0) {
        const sorted = rows.slice().sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
        const trim = Math.floor(total / 10);
        let pos = 0, vol = 0, val = 0n;
        for (const r of sorted) {
          const lo = Math.max(pos, trim), hi = Math.min(pos + r.kg, total - trim);
          if (hi > lo) { vol += hi - lo; val += r.price * BigInt(hi - lo); }
          pos += r.kg;
        }
        if (vol > 0) {
          const c = CITIES.find((x) => x.id === city)!;
          const base = refPrice(prod(pid).basePricePerKg, c.priceBp[pid] ?? 10000, 10000);
          ratio = Number((val / BigInt(vol) * 10000n) / base);
        }
      }
      const profs = this.profiles.filter((p) => p.cityId === city && (p.buys[pid] ?? 0) > 0);
      const nominal = profs.reduce((a, p) => a + (p.buys[pid] ?? 0), 0);
      const bought = profs.reduce((a, p) => a + (p.bought.get(pid) ?? 0), 0);
      const sat = nominal > 0 ? Math.min(10000, Math.round((bought * 10000) / nominal)) : 0;
      this.drift.set(k, nextDriftBp(this.driftOf(pid, city), ratio, sat));
    }
    this.weightCache.clear(); this.capCache.clear();
  }
}

// ───────────────────────── Oyuncular, hatlar, emirler ─────────────────────────

interface Tranche { hour: number; win: Win; kg: number; filled: number }
interface Lot { line: Line; hour: number; win: Win; kg: number; rem: number; unitCost: bigint; ask: bigint }
interface BuyOrder { line: Line; pid: string; tr: Tranche[]; rem: number; maxPayBp: number }
interface Inv { kg: number; cost: bigint }

interface Line {
  id: number; spec: LineSpec; ownerId: number; recipe: RecipeDef; industry: string;
  outPid: string; outKg: number; inputs: Array<{ pid: string; kg: number }>; opCost: bigint; upkeepHour: bigint; patienceBp: number;
  inv: Map<string, Inv>; lots: Lot[]; pipeline: Array<{ done: number; kg: number; cost: bigint }>; orders: Map<string, BuyOrder>;
  revenue: bigint; purchases: bigint; ops: bigint; upkeep: bigint; freightPaid: bigint; feesPaid: bigint; idleHours: number; batches: number;
}

/** kg, değer (kuruş) ve aynı işlemlerin taban referans (kayma 10000) değeri: fiyat endeksi = değer / refValue */
interface Stat { kg: number; value: bigint; refValue: bigint }
const zeroStat = (): Stat => ({ kg: 0, value: 0n, refValue: 0n });
export interface ProductWinStats {
  p2p: Stat; sysBuy: Stat; sysSell: Stat; p2pLast: bigint | null; /** pencerede son satış fiyatı ve taban referansı */ last: bigint | null; lastRef: bigint; delayKgH: number; delayKg: number; internal: Stat; producedKg: number;
}
export interface WinStats {
  products: Map<string, ProductWinStats>;
  sellPostedKg: number; sellFilledKg: number; buyPostedKg: number; buyFilledKg: number;
  sysPaid: bigint; sysReceived: bigint;
}

export interface MarketResult {
  spec: ScenarioSpec; tuning: Tuning; hours: number;
  win: Record<Win, WinStats>;
  /** iş kolu → hat başına günlük kâr (kuruş), hat sayısı */
  industryProfit: Array<{ industry: string; lines: number; profitPerLineDay: bigint; profit: bigint }>;
  lineProfit: Array<{ key: string; industry: string; ownerId: number; profit: bigint; batches: number; idleHours: number }>;
  totals: { sysPaid: bigint; sysReceived: bigint; fees: bigint; freight: bigint; ops: bigint; upkeep: bigint; playerCash: bigint };
  /** sistem şirketlerinin hiç alıcı bulamadığı (oyuncu stoğunda biriken) kg */
  closingLotKg: number;
  closingByProduct: Record<string, number>;
  minShareFactorBp: number;
  /** her saatte "sistemden en ucuza al, sisteme en pahalıya sat" kârı (kuruş/kg, navlun ve komisyon sonrası) en yüksek değer */
  maxRoundTripPerKg: bigint;
  /** saat × ürün için sistem alış > sistem satış gözlemi */
  bidAboveAsk: number;
}

export function runMarket(spec: ScenarioSpec, tuning: Tuning = CATALOG_TUNING): MarketResult {
  const hours = spec.hours ?? 168;
  const rng = seededRng(spec.seed);
  const sys = new SystemSide(tuning);
  const lines = makeLines(spec, rng);
  const cash = new Map<number, bigint>();
  for (let i = 0; i < spec.players; i++) cash.set(i, BigInt(S.startingCash) * BigInt(Math.ceil(lines.length / spec.players)));
  const startCash = new Map(cash);
  const win = Object.fromEntries(WINDOWS.map((w) => [w, { products: new Map(), sellPostedKg: 0, sellFilledKg: 0, buyPostedKg: 0, buyFilledKg: 0, sysPaid: 0n, sysReceived: 0n } as WinStats])) as Record<Win, WinStats>;
  const ps = (w: Win, pid: string): ProductWinStats => {
    let r = win[w].products.get(pid);
    if (!r) { r = { p2p: zeroStat(), sysBuy: zeroStat(), sysSell: zeroStat(), p2pLast: null, last: null, lastRef: 0n, delayKgH: 0, delayKg: 0, internal: zeroStat(), producedKg: 0 }; win[w].products.set(pid, r); }
    return r;
  };
  let minFactor = 10000, maxRound = -(10n ** 18n), bidAboveAsk = 0;
  const baseRef = (pid: string, city: string) => refPrice(prod(pid).basePricePerKg, CITIES.find((x) => x.id === city)!.priceBp[pid] ?? 10000, 10000);
  const lastP2p = new Map<string, { t: number; price: bigint }>();
  const pay = (id: number, v: bigint) => cash.set(id, cash.get(id)! + v);

  const expOut = (l: Line, t: number): bigint => {
    const b = sys.bestBid(l.outPid, l.spec.cityId, l.outKg);
    const sysNet = b ? b.net : 0n;
    const lp = lastP2p.get(l.outPid);
    const p2p = lp && t - lp.t <= 24 ? sale(lp.price) : 0n;
    // gözlenen fiyat yokken oyuncu referansın %85'ini umar (ilk işlem fiyat keşfi için)
    const hope = applyBp(sale(sys.ref(l.outPid, l.spec.cityId)), 8500);
    const best = sysNet > p2p ? sysNet : p2p;
    return best > hope ? best : hope;
  };
  /** sevkiyat konsolide edilir: navlun/kg, satıcının eldeki tüm stoğuna göre hesaplanır */
  const stockKg = (l: Line) => Math.max(1, l.lots.reduce((a, x) => a + x.rem, 0));
  const lotKg = (l: Line) => l.lots.reduce((a, x) => a + x.rem, 0) + l.pipeline.reduce((a, x) => a + x.kg, 0);
  const capMult = (l: Line, t: number) => (spec.event === "surplus" && SURPLUS_LINES.has(l.spec.key) && t >= EVENT_FROM && t < EVENT_TO ? SURPLUS_CAPACITY : 1);
  const online = (l: Line, t: number) => !(spec.event === "shortage" && SHORTAGE_LINES.has(l.spec.key) && t >= EVENT_FROM && t < EVENT_TO);
  const sellFilled = (lot: Lot, kg: number, t: number, pid: string) => {
    win[lot.win].sellFilledKg += kg;
    const s = ps(winOf(t), pid);
    s.delayKgH += kg * (t - lot.hour); s.delayKg += kg;
  };
  const fillTranches = (o: BuyOrder, kg: number) => {
    let left = kg;
    for (const tr of o.tr) { const take = Math.min(left, tr.kg - tr.filled); tr.filled += take; win[tr.win].buyFilledKg += take; left -= take; if (left <= 0) break; }
    o.rem -= kg;
  };
  const addInv = (l: Line, pid: string, kg: number, cost: bigint) => {
    const cur = l.inv.get(pid) ?? { kg: 0, cost: 0n };
    cur.kg += kg; cur.cost += cost; l.inv.set(pid, cur);
    l.purchases += cost;
  };

  /** satıcı ve alıcı sahibine göre p2p / iç aktarım kaydı */
  const recordTrade = (t: number, pid: string, city: string, kg: number, price: bigint, buyer: Line, seller: Line) => {
    const w = winOf(t);
    lastP2p.set(pid, { t, price });
    { const x = ps(w, pid); x.last = price; x.lastRef = baseRef(pid, city); }
    if (buyer.ownerId === seller.ownerId) { const s = ps(w, pid).internal; s.kg += kg; s.value += price * BigInt(kg); s.refValue += baseRef(pid, city) * BigInt(kg); return; }
    const s = ps(w, pid);
    s.p2p.kg += kg; s.p2p.value += price * BigInt(kg); s.p2p.refValue += baseRef(pid, city) * BigInt(kg); s.p2pLast = price;
    sys.recordP2p(t, pid, city, kg, price, `${buyer.ownerId}>${seller.ownerId}`);
  };

  /**
   * Satıcının istediği fiyat (FOB): rezervasyon = sistemin net alışı (komisyon öncesine çevrilmiş) ya da referansın %50'si, hangisi yüksekse.
   * Başlangıç = rezervasyon + %20 prim (en çok referansın %115'i); prim 8 saatte sıfırlanır (sabırlı satıcıda uzar).
   */
  const askOf = (l: Line, lot: Lot, t: number): bigint => {
    const r = sys.ref(l.outPid, l.spec.cityId);
    const b = sys.bestBid(l.outPid, l.spec.cityId, stockKg(l));
    const sysGross = b && b.net > 0n ? (b.net * 10000n) / BigInt(10000 - FEE_BP) : 0n;
    const half = applyBp(r, 5000);
    const floor = sysGross > half ? sysGross : half;
    const ceil = applyBp(r, 11500);
    let start = applyBp(floor, 12000);
    if (start > ceil) start = ceil;
    if (start < floor) start = floor;
    const span = Math.max(1, Math.floor((8 * l.patienceBp) / 10000));
    const left = Math.max(0, span - (t - lot.hour));
    return floor + ((start - floor) * BigInt(left)) / BigInt(span);
  };
  const bidBpOf = (l: Line, o: BuyOrder, t: number) => Math.min(o.maxPayBp, Math.floor(((8500 + 300 * (t - o.tr[0]!.hour)) * (20000 - l.patienceBp)) / 10000));
  const bidOf = (l: Line, o: BuyOrder, t: number) => applyBp(sys.ref(o.pid, l.spec.cityId), bidBpOf(l, o, t));

  for (let t = 0; t < hours; t++) {
    const w = winOf(t);
    if (t % 24 === 0) sys.resetDay();
    if (spec.event === "shortage") {
      if (t === EVENT_FROM) {
        for (const pid of SHORTAGE_PRODUCTS) sys.supplyScaleBp.set(pid, SHORTAGE_SYSTEM_LEFT_BP);
        // ürün kaybı: kesinti başında çevrimdışı hatların satılmamış stoğu yok olur
        for (const l of lines) if (SHORTAGE_LINES.has(l.spec.key)) { for (const lot of l.lots) lot.rem = 0; l.lots = []; }
      }
      if (t === EVENT_TO) sys.supplyScaleBp.clear();
    }
    sys.hourStart(t);
    const order = lines.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }

    // 1) biten partiler → satış partisi (lot)
    for (const l of order) {
      const done = l.pipeline.filter((x) => x.done <= t);
      l.pipeline = l.pipeline.filter((x) => x.done > t);
      for (const d of done) {
        l.lots.push({ line: l, hour: t, win: w, kg: d.kg, rem: d.kg, unitCost: d.kg > 0 ? d.cost / BigInt(d.kg) : 0n, ask: 0n });
        win[w].sellPostedKg += d.kg;
      }
    }

    for (const l of order) for (const lot of l.lots) lot.ask = askOf(l, lot, t);

    // 2) oyuncular arası eşleşme (ürün başına): alış teklifi yüksekten, satış isteği düşükten
    for (const pid of new Set(lines.flatMap((l) => [...l.orders.keys()]))) {
      const buys = lines.flatMap((l) => (l.orders.get(pid) && l.orders.get(pid)!.rem > 0 ? [l.orders.get(pid)!] : []));
      const sells = lines.flatMap((l) => l.lots.filter((x) => x.rem > 0 && x.line.outPid === pid));
      if (!buys.length || !sells.length) continue;
      buys.sort((a, b) => Number(bidOf(b.line, b, t) - bidOf(a.line, a, t)) || a.tr[0]!.hour - b.tr[0]!.hour);
      for (const bo of buys) {
        const bid = bidOf(bo.line, bo, t);
        while (bo.rem > 0) {
          let best: { lot: Lot; landed: bigint; ask: bigint; fr: bigint; qty: number } | null = null;
          for (const lot of sells) {
            if (lot.rem <= 0 || lot.line === bo.line) continue;
            const qty = Math.min(lot.rem, bo.rem);
            const fr = freightPerKg(lot.line.spec.cityId, bo.line.spec.cityId, qty);
            const ask = lot.ask;
            const landed = ask + fr;
            if (landed <= bid && (!best || landed < best.landed)) best = { lot, landed, ask, fr, qty };
          }
          if (!best) break;
          const { lot, ask, fr, qty } = best;
          const price = (ask + (bid - fr)) / 2n;
          const gross = price * BigInt(qty);
          const fee = gross - sale(gross);
          // alıcı: mal + navlun; satıcı: mal − komisyon
          bo.line.freightPaid += fr * BigInt(qty);
          addInv(bo.line, pid, qty, gross + fr * BigInt(qty));
          pay(bo.line.ownerId, -(gross + fr * BigInt(qty)));
          lot.line.revenue += gross - fee; lot.line.feesPaid += fee;
          pay(lot.line.ownerId, gross - fee);
          lot.rem -= qty;
          fillTranches(bo, qty);
          sellFilled(lot, qty, t, pid);
          recordTrade(t, pid, bo.line.spec.cityId, qty, price, bo.line, lot.line);
        }
      }
    }

    // 3) sistemle işlemler
    for (const l of order) {
      // 3a) satış: ask, sistemin net alışının altına inince (ya da eşitse) sisteme sat
      for (const lot of l.lots) {
        while (lot.rem > 0) {
          const best = sys.bestBid(l.outPid, l.spec.cityId, stockKg(l));
          if (!best) break;
          const sellerNet = sale(askOf(l, lot, t));
          if (best.net < sellerNet) break;
          const qty = Math.min(lot.rem, STEP, best.quote.qty);
          if (qty <= 0) break;
          const unit = best.quote.unit;
          const gross = unit * BigInt(qty);
          const fee = gross - sale(gross);
          const fr = best.freight * BigInt(qty);
          const p = best.quote.prof;
          p.bought.set(l.outPid, (p.bought.get(l.outPid) ?? 0) + qty);
          p.spent.set(l.outPid, (p.spent.get(l.outPid) ?? 0n) + gross);
          l.revenue += gross - fee - fr; l.feesPaid += fee; l.freightPaid += fr;
          pay(l.ownerId, gross - fee - fr);
          win[w].sysPaid += gross;
          const s = ps(w, l.outPid).sysBuy; s.kg += qty; s.value += unit * BigInt(qty); s.refValue += baseRef(l.outPid, p.cityId) * BigInt(qty); { const x = ps(w, l.outPid); x.last = unit; x.lastRef = baseRef(l.outPid, p.cityId); }
          lot.rem -= qty;
          sellFilled(lot, qty, t, l.outPid);
        }
      }
      l.lots = l.lots.filter((x) => x.rem > 0);
      // 3b) alım: teklif, sistem satışının teslim maliyetine ulaşınca sistemden al
      for (const o of l.orders.values()) {
        while (o.rem > 0) {
          const best = sys.bestAsk(o.pid, l.spec.cityId, o.rem);
          if (!best || bidOf(l, o, t) < best.landed) break;
          const qty = Math.min(o.rem, STEP, best.quote.qty);
          if (qty <= 0) break;
          const unit = best.quote.unit;
          const gross = unit * BigInt(qty);
          const fr = best.freight * BigInt(qty);
          const p = best.quote.prof;
          p.sold.set(o.pid, (p.sold.get(o.pid) ?? 0) + qty);
          l.freightPaid += fr;
          addInv(l, o.pid, qty, gross + fr);
          pay(l.ownerId, -(gross + fr));
          win[w].sysReceived += gross;
          const s = ps(w, o.pid).sysSell; s.kg += qty; s.value += gross; s.refValue += baseRef(o.pid, p.cityId) * BigInt(qty);
          fillTranches(o, qty);
        }
      }
      for (const [k, o] of l.orders) if (o.rem <= 0) l.orders.delete(k);
    }

    // 4) üretim başlat (kâr kapısı + stok sınırı), bakım
    for (const l of order) {
      pay(l.ownerId, -l.upkeepHour); l.upkeep += l.upkeepHour;
      if (!online(l, t)) { l.idleHours++; continue; }
      const mult = capMult(l, t);
      let started = 0;
      for (let k = 0; k < mult; k++) {
        if (l.inputs.some((i) => (l.inv.get(i.pid)?.kg ?? 0) < i.kg)) break;
        if (lotKg(l) + l.outKg > 3 * l.outKg * mult) break;
        let inCost = 0n;
        for (const i of l.inputs) { const v = l.inv.get(i.pid)!; inCost += (v.cost * BigInt(i.kg)) / BigInt(v.kg); }
        if (expOut(l, t) * BigInt(l.outKg) < inCost + l.opCost) break;
        for (const i of l.inputs) {
          const v = l.inv.get(i.pid)!;
          const c = (v.cost * BigInt(i.kg)) / BigInt(v.kg);
          v.kg -= i.kg; v.cost -= c;
        }
        pay(l.ownerId, -l.opCost); l.ops += l.opCost;
        l.pipeline.push({ done: t + 1, kg: l.outKg, cost: inCost + l.opCost });
        l.batches++; started++;
        ps(w, l.outPid).producedKg += l.outKg;
      }
      if (!started) l.idleHours++;
    }

    // 5) bir sonraki saat için girdi alış emirleri
    for (const l of order) {
      if (!online(l, t + 1) || l.inputs.length === 0) { l.orders.clear(); continue; }
      const mult = capMult(l, t + 1);
      const ex = expOut(l, t);
      let inRef = 0n;
      for (const i of l.inputs) inRef += sys.ref(i.pid, l.spec.cityId) * BigInt(i.kg);
      const margin = ex * BigInt(l.outKg) - inRef - l.opCost;
      const maxPayBp = inRef > 0n ? Math.max(0, Math.min(16000, 10000 + Number((margin * 10000n) / inRef))) : 0;
      for (const i of l.inputs) {
        const have = l.inv.get(i.pid)?.kg ?? 0;
        const o = l.orders.get(i.pid);
        const need = 2 * mult * i.kg - have - (o?.rem ?? 0);
        if (maxPayBp < 6000) { if (o) { o.rem = 0; l.orders.delete(i.pid); } continue; }
        if (o) o.maxPayBp = maxPayBp;
        if (need <= 0) continue;
        const tr: Tranche = { hour: t + 1, win: winOf(t + 1), kg: need, filled: 0 };
        win[tr.win].buyPostedKg += need;
        if (o) { o.tr.push(tr); o.rem += need; } else l.orders.set(i.pid, { line: l, pid: i.pid, tr: [tr], rem: need, maxPayBp });
      }
    }

    // 6) denetimler: en kötü çevre faktörü, sistemden al-sisteme sat turu
    for (const p of sys.profiles) for (const pid of Object.keys(p.buys)) minFactor = Math.min(minFactor, sys.factor(pid, p.cityId, p.buys[pid]! + (p.sells[pid] ?? 0)));
    for (const pid of new Set(sys.profiles.flatMap((p) => Object.keys(p.sells)))) {
      for (const sp of sys.profiles) {
        const a = sys.askQuote(sp, pid);
        if (!a) continue;
        for (const bp of sys.profiles) {
          const b = sys.bidQuote(bp, pid);
          if (!b) continue;
          // sıfır doygunlukta, dolu kamyonla en iyi tur
          const ask0 = systemAsk(sys.ref(pid, sp.cityId), S.system.askBp, 0, 1);
          const bid0 = systemBid(sys.ref(pid, bp.cityId), profileBidBp(bp.src, pid, S.system.bidBp), 0, bp.buys[pid]!, sys.cap(pid));
          const net = sale(bid0) - ask0 - freightPerKg(sp.cityId, bp.cityId, 12000);
          if (net > maxRound) maxRound = net;
          if (bid0 >= ask0) bidAboveAsk++;
        }
      }
    }
  }

  // ── kapanış: kâr, toplamlar
  const lineProfit = lines.map((l) => {
    let inv = 0n;
    for (const v of l.inv.values()) inv += v.cost;
    for (const lot of l.lots) inv += lot.unitCost * BigInt(lot.rem);
    for (const p of l.pipeline) inv += p.cost;
    return { key: l.spec.key, industry: l.industry, ownerId: l.ownerId, batches: l.batches, idleHours: l.idleHours, profit: l.revenue - l.purchases - l.ops - l.upkeep + inv };
  });
  const byInd = new Map<string, { lines: number; profit: bigint }>();
  for (const lp of lineProfit) { const r = byInd.get(lp.industry) ?? { lines: 0, profit: 0n }; r.lines++; r.profit += lp.profit; byInd.set(lp.industry, r); }
  const days = BigInt(hours) / 24n;
  const industryProfit = [...byInd].map(([industry, r]) => ({ industry, lines: r.lines, profit: r.profit, profitPerLineDay: r.profit / BigInt(r.lines) / days }));
  let playerCash = 0n;
  for (const [id, c] of cash) playerCash += c - startCash.get(id)!;
  const sum = (f: (l: Line) => bigint) => lines.reduce((a, l) => a + f(l), 0n);
  return {
    spec, tuning, hours, win, industryProfit, lineProfit,
    totals: {
      sysPaid: WINDOWS.reduce((a, x) => a + win[x].sysPaid, 0n), sysReceived: WINDOWS.reduce((a, x) => a + win[x].sysReceived, 0n),
      fees: sum((l) => l.feesPaid), freight: sum((l) => l.freightPaid), ops: sum((l) => l.ops), upkeep: sum((l) => l.upkeep), playerCash,
    },
    closingLotKg: lines.reduce((a, l) => a + l.lots.reduce((b, x) => b + x.rem, 0), 0),
    closingByProduct: Object.fromEntries(lines.map((l) => [l.outPid, 0]).map(([k]) => [k as string, lines.filter((l) => l.outPid === k).reduce((a, l) => a + l.lots.reduce((b, x) => b + x.rem, 0), 0)])),
    minShareFactorBp: minFactor, maxRoundTripPerKg: maxRound, bidAboveAsk,
  };
}

function makeLines(spec: ScenarioSpec, rng: Rng): Line[] {
  const out: Line[] = [];
  let id = 0;
  for (let c = 0; c < spec.copies; c++) {
    for (const ls of BASE_LINES) {
      const recipe = RECIPES.find((r) => r.id === ls.recipeId)!;
      const bt = BUILDING_TYPES.find((b) => b.id === recipe.buildingType)!;
      const city = CITIES.find((x) => x.id === ls.cityId)!;
      const lv = bt.levels[0]!;
      const sector = bt.sector;
      const cityYield = sector === "crop" || sector === "livestock" ? 10000 : city.sectorYieldBp[sector as "mining"] ?? 10000;
      const plan = planProduction(recipe, {
        batches: 1, plotYieldBp: 10000, cityYieldBp: cityYield, researchYieldBp: 0, researchEfficiencyBp: 0, facilityQualityLevel: 1, researchQualityLevels: 0,
        levelYieldBp: lv.yieldBp ?? 0, levelEfficiencyBp: lv.efficiencyBp ?? 0, levelInputSavingBp: lv.inputSavingBp ?? 0, laborAvailabilityBp: city.labor.availability, inputLots: [],
        prices: { energyPerKwh: BigInt(city.energyPrice), waterPerM3: BigInt(city.waterPrice), wagePerHour: BigInt(city.wage) },
      });
      const p = prod(recipe.output.productId);
      out.push({
        id, spec: ls, ownerId: id % spec.players, recipe, industry: p.industry ?? "none", outPid: p.id, outKg: plan.outputKg,
        inputs: plan.inputs.map((i) => ({ pid: i.productId, kg: i.kg })), opCost: plan.energyCost + plan.waterCost + plan.laborCost,
        upkeepHour: BigInt(lv.upkeepPerDay) / 24n, patienceBp: 9000 + Math.floor(rng() * 2001),
        inv: new Map(), lots: [], pipeline: [], orders: new Map(),
        revenue: 0n, purchases: 0n, ops: 0n, upkeep: 0n, freightPaid: 0n, feesPaid: 0n, idleHours: 0, batches: 0,
      });
      id++;
    }
  }
  return out;
}

// ───────────────────────── Denetim yardımcıları ─────────────────────────

/** Tek küçük işlemden sonra sistemin her (şirket, ürün) için alım/satış kapasitesi */
export function smallTradeAudit(tuning: Tuning = CATALOG_TUNING, tradeKg = 250): { total: number; below9000: number; minFactorBp: number; closed: string[] } {
  let total = 0, below = 0, minF = 10000;
  const closed: string[] = [];
  for (const p of buildProfiles(tuning)) {
    for (const side of ["buys", "sells"] as const) {
      for (const [pid, kg] of Object.entries(p[side])) {
        const nominal = kg + (side === "buys" ? p.sells[pid] ?? 0 : p.buys[pid] ?? 0);
        const f = systemShareFactorBp(playerShareBp(tradeKg, nominal), tuning.shareDampBp);
        total++; minF = Math.min(minF, f);
        if (f < 9000) below++;
        if (Math.floor((kg * f) / 10000) < 1) closed.push(`${p.key}/${pid}`);
      }
    }
  }
  return { total, below9000: below, minFactorBp: minF, closed };
}

/** Sistem tarafı en iyi tur: her (satış, alış) şehir çifti, sıfır doygunluk, kalite 2, dolu kamyon navlunu, %1 komisyon */
export function roundTripAudit(tuning: Tuning = CATALOG_TUNING): { worstPerKg: bigint; worst: string; pairs: number } {
  const side = new SystemSide(tuning);
  let worst = -(10n ** 18n), at = "", pairs = 0;
  for (const pid of new Set(side.profiles.flatMap((p) => Object.keys(p.sells)))) {
    for (const sp of side.profiles.filter((p) => (p.sells[pid] ?? 0) > 0)) {
      for (const bp of side.profiles.filter((p) => (p.buys[pid] ?? 0) > 0)) {
        const ask0 = systemAsk(side.ref(pid, sp.cityId), S.system.askBp, 0, 1);
        const bid0 = systemBid(side.ref(pid, bp.cityId), profileBidBp(bp.src, pid, S.system.bidBp), 0, bp.buys[pid]!, side.cap(pid));
        const net = sale(bid0) - ask0 - freightPerKg(sp.cityId, bp.cityId, 12000);
        pairs++;
        if (net > worst) { worst = net; at = `${pid}: ${sp.key} → ${bp.key}`; }
      }
    }
  }
  return { worstPerKg: worst, worst: at, pairs };
}

export const SCENARIOS: ScenarioSpec[] = [
  { name: "tek oyuncu (1)", players: 1, copies: 1, event: "shortage", seed: 11 },
  { name: "tek oyuncu (1)", players: 1, copies: 1, event: "surplus", seed: 12 },
  { name: "az oyuncu (4)", players: 4, copies: 1, event: "shortage", seed: 21 },
  { name: "az oyuncu (4)", players: 4, copies: 1, event: "surplus", seed: 22 },
  { name: "yoğun (16)", players: 16, copies: 2, event: "shortage", seed: 31 },
  { name: "yoğun (16)", players: 16, copies: 2, event: "surplus", seed: 32 },
];
