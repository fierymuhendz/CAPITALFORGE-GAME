/**
 * Şirket ve üretim simülasyonu. 1 tick = 1 sn; oyuncular SIM_STEP_TICKS (60) tick'te bir karar verir,
 * fiyat ise HER tick güncellenir (oyuncu akışı adım içinde tick'lere eşit bölünür, NPC akışı eklenir).
 * Tipler: aktif üretici (8 alt tür), pasif tesis sahibi, tüccar, kumarbaz (ödenek testi), nakit tutucu.
 * Saf: Date.now/Math.random yok, tohumlu RNG. Defter denetimi: mint = nakit + market net + vergi + ücretler.
 * env: SIM_PLAYERS (300), SIM_DAYS (30), SIM_SEED (42), SIM_ATTENTION (oyuncunun ortalama kaç dakikada bir döndüğü, 120).
 */
import {
  FACILITY_TYPES,
  PARAMS,
  PRODUCT_IDS,
  RECIPES,
  batchIO,
  createRng,
  facilityPrice,
  formatMoney,
  inventoryValue,
  executeAgainstPool,
  initialPool,
  poolMaxOrder,
  poolPrice,
  replenish,
  type PoolState,
  reliefEligible,
  reliefPeriod,
  upkeep,
  upkeepPeriod,
  type FacilityType,
  type Money,
  type ProductId,
  type Recipe,
} from "../src/index";

const PLAYERS = Number(process.env.SIM_PLAYERS ?? 300);
const DAYS = Number(process.env.SIM_DAYS ?? 30);
const SEED = Number(process.env.SIM_SEED ?? 42);
const ATTENTION = Number(process.env.SIM_ATTENTION ?? 120); // ortalama kaç adımda bir dönüş
const STEP = 60; // tick
const STEPS_PER_DAY = 86_400 / STEP;
const HOLD_RATIO = 60n; // meşru üretici fiyat < ref%85 ise satmaz
const BOT_HOLD = 75n; // bot ref%75'e kadar satar
const FAC_SHARE = Number(process.env.SIM_FAC_SHARE ?? 50);
const START_FAC = Number(process.env.SIM_START_FAC ?? 1);
const MAX_SIM_FACILITIES = Number(process.env.SIM_MAX_FAC ?? 1); // pencere sınırı ek tesisi marjinal yapar
const rng = createRng(SEED);

const K = PRODUCT_IDS.length;
const idx = (p: string): number => PRODUCT_IDS.indexOf(p as ProductId);
const volB: bigint[] = new Array(PRODUCT_IDS.length).fill(0n);
const volS: bigint[] = new Array(PRODUCT_IDS.length).fill(0n);
const pools: PoolState[] = PRODUCT_IDS.map((p) => initialPool(p));
const prices: bigint[] = pools.map((p) => poolPrice(p));
const refs: bigint[] = PRODUCT_IDS.map((p) => PARAMS.refPrice[p]);

type Kind = "producer" | "bot" | "passive" | "trader" | "gambler" | "holder";
interface Facility {
  type: FacilityType;
  active: boolean;
  jobDone: number; // adım numarası, -1 = boşta
  jobRecipe: Recipe | null;
  jobBatches: bigint;
}
interface Player {
  kind: Kind;
  balance: Money;
  inv: bigint[];
  facs: Facility[];
  claims: number;
  lastReliefPeriod: bigint;
  baseline: Money; // kurulum sonrası servet
  startFacType: FacilityType | null;
  nStart: number; // başlangıç tesis sayısı
}

const prodTypes: FacilityType[] = [
  "power_plant", "farm", "power_plant", "mine", "mill", "power_plant", "steelworks", "farm", "power_plant", "mill",
];
const BOT_PCT = Number(process.env.SIM_BOT_PCT ?? 10);
const kindOf = (i: number): Kind => {
  const m = i % 10;
  if (m >= 10 - Math.round(BOT_PCT / 10)) return "bot";
  if (m <= 3) return "producer";
  if (m === 4) return "passive";
  if (m === 5) return "trader";
  if (m === 6) return i % 20 === 6 ? "gambler" : "trader";
  return "holder";
};

// Sayaçlar (defter)
let mint = 0n; // kaynak: başlangıç + ödenek
let taxSink = 0n;
let feeSink = 0n; // kuruluş + tesis + bakım
let marketNet = 0n; // market'e oyunculardan net giden (alım brüt − satım brüt)
let srcSales = 0n; // oyuncu satış geliri (net)
let srcRelief = 0n;
let sinkBuys = 0n; // oyuncu alım harcaması
let sinkFees = 0n;
let upkeepPaid = 0n;
let suspensions = 0;
let measuring = false;
/**
 * Havuza karşı işlem: emirler poolMaxOrder'a bölünür, art arda uygulanır. commit=false: yalnız
 * toplam oyuncu etkisi (önizleme, havuz değişmez). floor: satımda fiyat bunun altına inerse durur.
 */
function runTrade(
  side: "buy" | "sell",
  k: number,
  q: bigint,
  commit: boolean,
  floor = 0n,
): { qty: bigint; delta: bigint; gross: bigint; tax: bigint } {
  let pool = pools[k]!;
  let left = q;
  let done = 0n;
  let delta = 0n;
  let gross = 0n;
  let tax = 0n;
  while (left > 0n) {
    if (side === "sell" && floor > 0n && poolPrice(pool) < floor) break;
    const c = left < poolMaxOrder(pool) ? left : poolMaxOrder(pool);
    if (side === "buy" && c >= pool.units - 1n) break;
    const r = executeAgainstPool(side, pool, c);
    pool = r.newPool;
    done += c;
    left -= c;
    delta += r.playerDelta;
    gross += r.gross;
    tax += r.tax;
  }
  if (commit) {
    if (side === "buy") volB[k] = volB[k]! + done;
    else volS[k] = volS[k]! + done;
    pools[k] = pool;
    prices[k] = poolPrice(pool);
  }
  return { qty: done, delta, gross, tax };
}
const previewBuy = (k: number, q: bigint): bigint => -runTrade("buy", k, q, false).delta;
const previewSell = (k: number, q: bigint): bigint => runTrade("sell", k, q, false).delta;

function buy(pl: Player, k: number, q: bigint): bigint {
  const maxQ = pools[k]!.units * 3n;
  if (q > maxQ) q = maxQ;
  if (q <= 0n) return 0n;
  if (previewBuy(k, q) > pl.balance) {
    let lo = 0n;
    let hi = q;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (previewBuy(k, mid) <= pl.balance) lo = mid;
      else hi = mid - 1n;
    }
    q = lo;
    if (q <= 0n) return 0n;
  }
  const r = runTrade("buy", k, q, true);
  pl.balance += r.delta;
  pl.inv[k]! += r.qty;
  taxSink += r.tax;
  marketNet += r.gross;
  if (measuring) sinkBuys += -r.delta;
  return r.qty;
}
function sell(pl: Player, k: number, q: bigint, floor = 0n): bigint {
  if (q > pl.inv[k]!) q = pl.inv[k]!;
  if (q <= 0n) return 0n;
  const r = runTrade("sell", k, q, true, floor);
  if (r.qty <= 0n) return 0n;
  pl.balance += r.delta;
  pl.inv[k]! -= r.qty;
  taxSink += r.tax;
  marketNet -= r.gross;
  if (measuring) srcSales += r.delta;
  return r.qty;
}
function payFee(pl: Player, amount: Money): boolean {
  if (pl.balance < amount) return false;
  pl.balance -= amount;
  feeSink += amount;
  if (measuring) sinkFees += amount;
  return true;
}
const holdings = (pl: Player) => PRODUCT_IDS.map((_, k) => ({ price: prices[k]!, qty: pl.inv[k]! }));
const wealth = (pl: Player): Money => pl.balance + inventoryValue(holdings(pl));
const book = (pl: Player): Money => {
  let b = 0n;
  const counts: Partial<Record<FacilityType, bigint>> = {};
  for (const f of pl.facs) {
    const n = counts[f.type] ?? 0n;
    b += facilityPrice(f.type, n);
    counts[f.type] = n + 1n;
  }
  return b;
};

function buyFacility(pl: Player, type: FacilityType): boolean {
  const price = facilityPrice(type, BigInt(pl.facs.length));
  if (pl.facs.length === 0) {
    if (pl.balance < PARAMS.companyFoundingFee + price) return false;
    payFee(pl, PARAMS.companyFoundingFee);
  }
  if (!payFee(pl, price)) return false;
  pl.facs.push({ type, active: true, jobDone: -1, jobRecipe: null, jobBatches: 0n });
  return true;
}

const players: Player[] = Array.from({ length: PLAYERS }, (_, i) => {
  const kind = kindOf(i);
  mint += PARAMS.startingBalance;
  const pl: Player = {
    kind,
    balance: PARAMS.startingBalance,
    inv: new Array(K).fill(0n),
    facs: [],
    claims: 0,
    lastReliefPeriod: -1n,
    baseline: 0n,
    startFacType: null,
    nStart: 1,
  };
  if (kind === "producer" || kind === "bot") {
    pl.startFacType = prodTypes[Math.floor(i / 10) % prodTypes.length]!;
    // N tesisle başlayanlara sermaye farkı verilir (başlangıç hibesi + capex farkı), böylece
    // kurulum sonrası servet karşılaştırılabilir kalır; bu fark mint'e yazılır (kaynak).
    // SIM_FAC_SHARE (%): üretici/botların bu payı N tesisle, kalanı 1 tesisle başlar (rastgele atama)
    const inGroup = (((i * 2654435761) >>> 7) & 127) < (FAC_SHARE * 128) / 100;
    pl.nStart = inGroup ? START_FAC : 1;
    const extra = (() => {
      let c = 0n;
      for (let n = 1; n < pl.nStart; n++) c += facilityPrice(pl.startFacType!, BigInt(n));
      return c;
    })();
    pl.balance += extra;
    mint += extra;
    buyFacility(pl, pl.startFacType);
    for (let n = 1; n < pl.nStart; n++) buyFacility(pl, pl.startFacType);
  } else if (kind === "passive") {
    pl.startFacType = "farm";
    buyFacility(pl, "farm");
  }
  pl.baseline = wealth(pl);
  return pl;
});
measuring = true;

function producerStep(pl: Player, step: number): void {
  for (const f of pl.facs) {
    if (f.jobRecipe && step >= f.jobDone) {
      const io = batchIO(f.jobRecipe, f.jobBatches);
      pl.inv[idx(io.output.productId)]! += io.output.qty;
      f.jobRecipe = null;
      f.jobDone = -1;
    }
  }
  if (pl.kind !== "bot" && rng() > 1 / ATTENTION) return; // bot her adım döner (1 dk)
  // sat: ürettiği ürünleri referansın %90'ının üstündeyse
  for (const f of pl.facs) {
    const out = idx(Object.values(RECIPES).find((r) => r.facility === f.type)!.output.productId);
    sell(pl, out, pl.inv[out]!, (refs[out]! * (pl.kind === "bot" ? BOT_HOLD : HOLD_RATIO)) / 100n);
  }
  // iş başlat
  for (const f of pl.facs) {
    if (!f.active || f.jobRecipe) continue;
    const r = Object.values(RECIPES).find((x) => x.facility === f.type)!;
    const out = idx(r.output.productId);
    if (pl.inv[out]! >= r.output.qty * PARAMS.maxBatchesPerJob * 2n) continue; // satılmamış stok sınırı
    const reserve = upkeep(f.type, 1n, BigInt(pl.facs.length)) * 3n;
    // b batch için girdi maliyeti (null: hacim sınırı veya bakiye elvermiyor)
    const costOf = (b: bigint): bigint | null => {
      let cost = 0n;
      for (const l of batchIO(r, b).inputs) {
        const k = idx(l.productId);
        const need = l.qty - pl.inv[k]!;
        if (need <= 0n) continue;
        if (need >= pools[k]!.units) return null;
        cost += previewBuy(k, need);
      }
      return cost + reserve <= pl.balance ? cost : null;
    };
    let best = 0n;
    let bestProfit = -(10n ** 30n);
    for (let b = PARAMS.maxBatchesPerJob; b >= 1n; b--) {
      const cost = costOf(b);
      if (cost === null) continue;
      {
        // tahmini kârı en yüksek batch'i seç (ek spread dahil), kâr yoksa üretme
        const outQ = batchIO(r, b).output.qty;
        const rev = previewSell(out, outQ);
        const profit = rev - cost;
        if (profit > bestProfit) {
          bestProfit = profit;
          best = b;
        }
      }
    }
    if (best < 1n || bestProfit <= 0n) continue;
    const b = best;
    const io = batchIO(r, b);
    let ok = true;
    for (const l of io.inputs) {
      const k = idx(l.productId);
      if (pl.inv[k]! < l.qty) buy(pl, k, l.qty - pl.inv[k]!);
      if (pl.inv[k]! < l.qty) ok = false;
    }
    if (!ok) continue;
    for (const l of io.inputs) pl.inv[idx(l.productId)]! -= l.qty;
    f.jobRecipe = r;
    f.jobBatches = b;
    f.jobDone = step + Math.ceil(Number(r.durationTicks) / STEP);
  }
  // genişle
  if (pl.facs.length < Math.max(MAX_SIM_FACILITIES, pl.nStart) && pl.startFacType) {
    const price = facilityPrice(pl.startFacType, BigInt(pl.facs.length));
    if (pl.balance >= price * 2n) buyFacility(pl, pl.startFacType);
  }
}

function traderStep(pl: Player): void {
  if (rng() > 1 / ATTENTION) return;
  if (pl.kind === "gambler") {
    // tüm bakiyeyi rastgele bir ürüne yatır, sonraki dönüşte hepsini sat (sürtünmeyle erir)
    const held = PRODUCT_IDS.findIndex((_, k) => pl.inv[k]! > 0n);
    if (held >= 0) sell(pl, held, pl.inv[held]!);
    else buy(pl, Math.floor(rng() * K), 300n);
    return;
  }
  const k = Math.floor(rng() * K);
  const q = BigInt(1 + Math.floor(rng() * 20));
  if (rng() < 0.5) buy(pl, k, q);
  else sell(pl, k, q);
}

const gini = (xs: bigint[]): number => {
  const s = xs.map(Number).sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let w = 0;
  s.forEach((x, i) => (w += (i + 1) * x));
  return (2 * w) / (n * sum) - (n + 1) / n;
};
const median = (xs: bigint[]): bigint => {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s[Math.floor(s.length / 2)] ?? 0n;
};
const priceIdx = (): number => prices.reduce((a, p, k) => a + Number(p) / Number(refs[k]!), 0) / K;

const totalSteps = DAYS * STEPS_PER_DAY;
const dailyRows: { day: number; supply: bigint; index: number; gini: number }[] = [];
const pMin: number[] = new Array(K).fill(Infinity);
const pMax: number[] = new Array(K).fill(0);
let minIdx = Infinity;
let maxIdx = 0;
const passiveDay: number[] = [];
let passiveLast = players.filter((p) => p.kind === "passive").map(wealth);
const cashSupply0 = players.reduce((a, p) => a + p.balance, 0n);
const perDayWealth: bigint[] = [];

for (let step = 1; step <= totalSteps; step++) {
  const tick = BigInt(step * STEP);
  // bakım (saat başı)
  if (upkeepPeriod(tick) > upkeepPeriod(tick - BigInt(STEP))) {
    for (const pl of players) {
      for (const f of pl.facs) {
        const u = upkeep(f.type, 1n, BigInt(pl.facs.length));
        if (pl.balance >= u) {
          pl.balance -= u;
          feeSink += u;
          sinkFees += u;
          upkeepPaid += u;
          f.active = true;
        } else if (f.active) {
          f.active = false;
          suspensions++;
        }
      }
    }
  }
  // ödenek (günlük dönem)
  const period = reliefPeriod(tick);
  for (const pl of players) {
    if (!pl.facs.some((f) => f.active) && pl.lastReliefPeriod < period) {
      if (reliefEligible({ cash: pl.balance, inventoryValue: inventoryValue(holdings(pl)), hasActiveFacility: false })) {
        pl.balance += PARAMS.reliefAmount;
        mint += PARAMS.reliefAmount;
        srcRelief += PARAMS.reliefAmount;
        pl.claims++;
        pl.lastReliefPeriod = period;
      }
    }
  }
  for (const pl of players) {
    if (pl.kind === "producer" || pl.kind === "bot") producerStep(pl, step);
    else if (pl.kind === "trader" || pl.kind === "gambler") traderStep(pl);
  }
  // havuz yenilenmesi (adım = STEP tick)
  for (let k = 0; k < K; k++) {
    pools[k] = replenish(pools[k]!, PRODUCT_IDS[k]!, BigInt(STEP));
    prices[k] = poolPrice(pools[k]!);
  }
  for (let k = 0; k < K; k++) {
    const rr = Number(prices[k]!) / Number(refs[k]!);
    pMin[k] = Math.min(pMin[k]!, rr);
    pMax[k] = Math.max(pMax[k]!, rr);
  }
  const i = priceIdx();
  minIdx = Math.min(minIdx, i);
  maxIdx = Math.max(maxIdx, i);
  if (step % STEPS_PER_DAY === 0) {
    const day = step / STEPS_PER_DAY;
    const w = players.map(wealth);
    dailyRows.push({ day, supply: players.reduce((a, p) => a + p.balance, 0n), index: i, gini: gini(w) });
    const pw = players.filter((p) => p.kind === "passive").map(wealth);
    const rates = pw.map((x, j) => (passiveLast[j]! === 0n ? 0 : Number(passiveLast[j]! - x) / Number(passiveLast[j]!)));
    passiveDay.push(rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length));
    passiveLast = pw;
    perDayWealth.push(median(players.filter((p) => p.kind === "producer").map(wealth)));
  }
}

const cash = players.reduce((a, p) => a + p.balance, 0n);
const ledgerOk = mint === cash + marketNet + taxSink + feeSink;
const grp = (k: Kind): Player[] => players.filter((p) => p.kind === k);
const medW = (k: Kind): Money => median(grp(k).map(wealth));
const medBase = (k: Kind): Money => median(grp(k).map((p) => p.baseline));
const medBook = (k: Kind): Money => median(grp(k).map((p) => wealth(p) + book(p)));
const wealths = players.map(wealth);
const wealthsBook = players.map((p) => wealth(p) + book(p));
const poor = players.filter((p) => wealth(p) < PARAMS.reliefThreshold).length;
const claimed = players.filter((p) => p.claims > 0).length;
const avgPassive = passiveDay.reduce((a, b) => a + b, 0) / Math.max(1, passiveDay.length);
const pct = (n: number): string => (n * 100).toFixed(2) + "%";
const dayStr = (r: (typeof dailyRows)[number] | undefined): string => (r ? `${formatMoney(r.supply)}` : "-");
const sourceTotal = srcSales + srcRelief;
const sinkTotal = sinkBuys + sinkFees;
const supplyGrowth = Number(cash - cashSupply0) / Number(cashSupply0);

console.log(`oyuncu=${PLAYERS} gun=${DAYS} seed=${SEED} dikkat=${ATTENTION} adim=${STEP}tick`);
console.table(
  dailyRows
    .filter((r) => r.day === 1 || r.day % Math.max(1, Math.floor(DAYS / 6)) === 0 || r.day === DAYS)
    .map((r) => ({ gun: r.day, nakitArzi: dayStr(r), fiyatEndeksi: r.index.toFixed(3), gini: r.gini.toFixed(3) })),
);
console.table({
  defterDengeli: String(ledgerOk),
  kaynak_satis: formatMoney(srcSales),
  kaynak_odenek: formatMoney(srcRelief),
  yutak_alim: formatMoney(sinkBuys),
  yutak_ucret_bakim: formatMoney(sinkFees),
  yutak_vergi: formatMoney(taxSink),
  kaynakYutakOrani: (Number(sourceTotal) / Number(sinkTotal)).toFixed(3),
  nakitArziDegisimi: pct(supplyGrowth),
  fiyatEndeksiMinMax: `${minIdx.toFixed(3)} / ${maxIdx.toFixed(3)}`,
  gunlukHacim_alim_satim: PRODUCT_IDS.map((p, k) => `${p}=${volB[k]! / BigInt(DAYS)}/${volS[k]! / BigInt(DAYS)}`).join(" "),
  urunMinMax: PRODUCT_IDS.map((p, k) => `${p}=${pMin[k]!.toFixed(2)}/${pMax[k]!.toFixed(2)}`).join(" "),
  sonFiyatlar: prices.map((p, k) => `${PRODUCT_IDS[k]}=${formatMoney(p)}`).join(" "),
  askidaTesisOlayi: String(suspensions),
});
console.table({
  uretici_medyan_kurulum_sonrasi: `${formatMoney(medBase("producer"))} -> ${formatMoney(medW("producer"))}`,
  uretici_medyan_tesis_dahil: `${formatMoney(medBook("producer"))} (baslangic ${formatMoney(PARAMS.startingBalance)})`,
  pasif_gunluk_erime: pct(avgPassive),
  pasif_medyan: `${formatMoney(medBase("passive"))} -> ${formatMoney(medW("passive"))}`,
  nakit_tutucu_medyan: `${formatMoney(medBase("holder"))} -> ${formatMoney(medW("holder"))}`,
  bot_medyan: `${formatMoney(medBase("bot"))} -> ${formatMoney(medW("bot"))}`,
  bot_gunluk_getiri: pct(Math.pow(Number(medW("bot")) / Math.max(1, Number(medBase("bot"))), 1 / DAYS) - 1),
  uretici_gunluk_kazanc_TL: formatMoney((medW("producer") - medBase("producer")) / BigInt(DAYS)),
  bot_gunluk_kazanc_TL: formatMoney((medW("bot") - medBase("bot")) / BigInt(DAYS)),
  uretici_kazanc_N_vs_1_TL: (["producer", "bot"] as const)
    .map((k) => {
      const gain = (g: Player[]): string => (g.length ? formatMoney(median(g.map((p) => (wealth(p) - p.baseline) / BigInt(DAYS)))) : "-");
      const a = grp(k).filter((p) => p.nStart === START_FAC);
      const b = grp(k).filter((p) => p.nStart === 1);
      return `${k}: N=${START_FAC} ${gain(a)} (n=${a.length}), N=1 ${gain(b)} (n=${b.length})`;
    })
    .join(" | "),
  uretici_gunluk_getiri: pct(Math.pow(Number(medW("producer")) / Math.max(1, Number(medBase("producer"))), 1 / DAYS) - 1),
  gambler_medyan: `${formatMoney(medBase("gambler"))} -> ${formatMoney(medW("gambler"))}`,
  tuccar_medyan: `${formatMoney(medBase("trader"))} -> ${formatMoney(medW("trader"))}`,
  gini_nakit_envanter: gini(wealths).toFixed(3),
  gini_tesis_dahil: gini(wealthsBook).toFixed(3),
  esikAltiOran: pct(poor / PLAYERS),
  odenekAlanOran: pct(claimed / PLAYERS),
});
const byType = FACILITY_TYPES.flatMap((t) =>
  (["producer", "bot"] as const).map((kind) => {
    const g = players.filter((p) => p.kind === kind && p.startFacType === t);
    const base = median(g.map((p) => p.baseline));
    const w = median(g.map(wealth));
    return { tur: t, tip: kind, n: g.length, medyanServet: `${formatMoney(base)} -> ${formatMoney(w)}`, gunluk: pct(Math.pow(Number(w) / Math.max(1, Number(base)), 1 / DAYS) - 1), tesisDahilGunluk: pct(Math.pow(Number(median(g.map((p) => wealth(p) + book(p)))) / Math.max(1, Number(median(g.map((p) => p.baseline + book(p))))), 1 / DAYS) - 1) };
  }),
);
console.table(byType);
