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
  nextPrice,
  npcFlow,
  quoteTrade,
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
const HOLD_RATIO = 90n; // üretici fiyat < ref%90 ise satmaz
const MAX_SIM_FACILITIES = Number(PARAMS.maxFacilitiesPerCompany);
const rng = createRng(SEED);

const K = PRODUCT_IDS.length;
const idx = (p: string): number => PRODUCT_IDS.indexOf(p as ProductId);
const prices: bigint[] = PRODUCT_IDS.map((p) => PARAMS.initialPrice[p]);
const refs: bigint[] = PRODUCT_IDS.map((p) => PARAMS.refPrice[p]);

type Kind = "producer" | "passive" | "trader" | "gambler" | "holder";
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
}

const prodTypes: FacilityType[] = [
  "power_plant", "farm", "mine", "mill", "steelworks", "farm", "mill", "farm",
];
const kindOf = (i: number): Kind => {
  const m = i % 10;
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
// [ürün][tick ofseti]: her işlem adım içinde rastgele bir tick'e düşer (patlamalı akış, muhafazakâr)
const flowD: bigint[][] = Array.from({ length: K }, () => new Array<bigint>(STEP).fill(0n));
const flowS: bigint[][] = Array.from({ length: K }, () => new Array<bigint>(STEP).fill(0n));
const slot = (): number => Math.floor(rng() * STEP);

function buy(pl: Player, k: number, q: bigint): bigint {
  if (q <= 0n) return 0n;
  let t = quoteTrade("buy", prices[k]!, q);
  if (-t.playerDelta > pl.balance) {
    const unit = -quoteTrade("buy", prices[k]!, 1n).playerDelta;
    q = pl.balance / unit;
    if (q <= 0n) return 0n;
    t = quoteTrade("buy", prices[k]!, q);
    while (-t.playerDelta > pl.balance && q > 0n) {
      q -= 1n;
      if (q > 0n) t = quoteTrade("buy", prices[k]!, q);
    }
    if (q <= 0n) return 0n;
  }
  pl.balance += t.playerDelta;
  pl.inv[k]! += q;
  taxSink += t.tax;
  marketNet += t.gross;
  if (measuring) sinkBuys += -t.playerDelta;
  flowD[k]![slot()]! += q;
  return q;
}
function sell(pl: Player, k: number, q: bigint): bigint {
  if (q > pl.inv[k]!) q = pl.inv[k]!;
  if (q <= 0n) return 0n;
  const t = quoteTrade("sell", prices[k]!, q);
  pl.balance += t.playerDelta;
  pl.inv[k]! -= q;
  taxSink += t.tax;
  marketNet -= t.gross;
  if (measuring) srcSales += t.playerDelta;
  flowS[k]![slot()]! += q;
  return q;
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
  };
  if (kind === "producer") {
    pl.startFacType = prodTypes[Math.floor(i / 10) % prodTypes.length]!;
    buyFacility(pl, pl.startFacType);
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
  if (rng() > 1 / ATTENTION) return;
  // sat: ürettiği ürünleri referansın %90'ının üstündeyse
  for (const f of pl.facs) {
    const out = idx(Object.values(RECIPES).find((r) => r.facility === f.type)!.output.productId);
    if (prices[out]! * 100n >= refs[out]! * HOLD_RATIO) sell(pl, out, pl.inv[out]!);
  }
  // iş başlat
  for (const f of pl.facs) {
    if (!f.active || f.jobRecipe) continue;
    const r = Object.values(RECIPES).find((x) => x.facility === f.type)!;
    const out = idx(r.output.productId);
    if (pl.inv[out]! >= r.output.qty * PARAMS.maxBatchesPerJob * 2n) continue; // satılmamış stok sınırı
    let b = PARAMS.maxBatchesPerJob;
    const reserve = upkeep(f.type, 1n) * 3n;
    for (; b >= 1n; b--) {
      const io = batchIO(r, b);
      let cost = 0n;
      for (const l of io.inputs) {
        const have = pl.inv[idx(l.productId)]!;
        if (have < l.qty) cost += -quoteTrade("buy", prices[idx(l.productId)]!, l.qty - have).playerDelta;
      }
      if (cost + reserve <= pl.balance) break;
    }
    if (b < 1n) continue;
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
  if (pl.facs.length < MAX_SIM_FACILITIES && pl.startFacType) {
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
    else buy(pl, Math.floor(rng() * K), 10n ** 9n);
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
let minIdx = Infinity;
let maxIdx = 0;
const passiveDay: number[] = [];
let passiveLast = players.filter((p) => p.kind === "passive").map(wealth);
const cashSupply0 = players.reduce((a, p) => a + p.balance, 0n);
const perDayWealth: bigint[] = [];

for (let step = 1; step <= totalSteps; step++) {
  const tick = BigInt(step * STEP);
  for (let k = 0; k < K; k++) {
    flowD[k]!.fill(0n);
    flowS[k]!.fill(0n);
  }
  // bakım (saat başı)
  if (upkeepPeriod(tick) > upkeepPeriod(tick - BigInt(STEP))) {
    for (const pl of players) {
      for (const f of pl.facs) {
        const u = upkeep(f.type, 1n);
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
    if (pl.kind === "producer") producerStep(pl, step);
    else if (pl.kind === "trader" || pl.kind === "gambler") traderStep(pl);
  }
  // fiyat: her tick
  for (let k = 0; k < K; k++) {
    const pid = PRODUCT_IDS[k]!;
    let p = prices[k]!;
    for (let t = 0; t < STEP; t++) {
      const f = npcFlow(p, refs[k]!, PARAMS.npcBase[pid]);
      p = nextPrice(p, flowD[k]![t]! + f.demand, flowS[k]![t]! + f.supply);
    }
    prices[k] = p;
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
  sonFiyatlar: prices.map((p, k) => `${PRODUCT_IDS[k]}=${formatMoney(p)}`).join(" "),
  askidaTesisOlayi: String(suspensions),
});
console.table({
  uretici_medyan_kurulum_sonrasi: `${formatMoney(medBase("producer"))} -> ${formatMoney(medW("producer"))}`,
  uretici_medyan_tesis_dahil: `${formatMoney(medBook("producer"))} (baslangic ${formatMoney(PARAMS.startingBalance)})`,
  pasif_gunluk_erime: pct(avgPassive),
  pasif_medyan: `${formatMoney(medBase("passive"))} -> ${formatMoney(medW("passive"))}`,
  nakit_tutucu_medyan: `${formatMoney(medBase("holder"))} -> ${formatMoney(medW("holder"))}`,
  gambler_medyan: `${formatMoney(medBase("gambler"))} -> ${formatMoney(medW("gambler"))}`,
  tuccar_medyan: `${formatMoney(medBase("trader"))} -> ${formatMoney(medW("trader"))}`,
  gini_nakit_envanter: gini(wealths).toFixed(3),
  gini_tesis_dahil: gini(wealthsBook).toFixed(3),
  esikAltiOran: pct(poor / PLAYERS),
  odenekAlanOran: pct(claimed / PLAYERS),
});
const byType = FACILITY_TYPES.map((t) => {
  const g = players.filter((p) => p.kind === "producer" && p.startFacType === t);
  return { tur: t, n: g.length, medyanServet: formatMoney(median(g.map(wealth))), medyanTesisSayisi: median(g.map((p) => BigInt(p.facs.length))).toString() };
});
console.table(byType);
