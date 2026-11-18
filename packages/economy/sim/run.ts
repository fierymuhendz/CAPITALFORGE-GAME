/**
 * Ekonomi simülasyonu: 3 ürün, N oyuncu, T gün (1 tick = 1 gün, ürün başına tek fiyat adımı).
 * Oyuncu tipleri: rastgele tüccar, trend takipçisi, arbitrajcı (al, sonraki tick sat), biriktirici.
 * Raporlanan: para arzı, fiyat endeksi, Gini, iflas oranı, vergi yutağı, arbitrajcı kârı.
 * Saf: Date.now/Math.random yok, tohumlu RNG.
 */
import {
  PARAMS,
  createRng,
  formatMoney,
  nextPrice,
  quoteTrade,
  type Money,
} from "../src/index";

const PLAYERS = Number(process.env.SIM_PLAYERS ?? 300);
const DAYS = Number(process.env.SIM_TICKS ?? 365);
const rng = createRng(Number(process.env.SIM_SEED ?? 42));
const MAX_QTY = Number(process.env.SIM_MAX_QTY ?? 5);

const PRODUCTS = [
  { id: "wheat", start: 5_000n },
  { id: "iron", start: 20_000n },
  { id: "energy", start: 10_000n },
];
type Kind = "random" | "trend" | "arb" | "hoarder";
interface Player {
  kind: Kind;
  balance: Money;
  inv: bigint[];
  lastBuy: bigint[]; // arbitrajcı: önceki tick'te alınan miktar
}

const kinds: Kind[] = ["random", "random", "random", "trend", "trend", "arb", "hoarder"];
const players: Player[] = Array.from({ length: PLAYERS }, (_, i) => ({
  kind: kinds[i % kinds.length]!,
  balance: PARAMS.startingBalance,
  inv: PRODUCTS.map(() => 0n),
  lastBuy: PRODUCTS.map(() => 0n),
}));

const prices = PRODUCTS.map((p) => p.start);
const prevPrices = [...prices];
let mint = BigInt(PLAYERS) * PARAMS.startingBalance; // kaynak
let taxSink = 0n; // yutak
let marketNet = 0n; // market'in oyunculardan net aldığı para (brüt)
let bankrupt = 0;
const bankruptSet = new Set<number>();

function trade(pl: Player, k: number, side: "buy" | "sell", q: bigint): bigint {
  if (q <= 0n) return 0n;
  if (side === "sell") q = q > pl.inv[k]! ? pl.inv[k]! : q;
  if (q <= 0n) return 0n;
  let t = quoteTrade(side, prices[k]!, q);
  if (side === "buy" && -t.playerDelta > pl.balance) {
    const unit = quoteTrade("buy", prices[k]!, 1n);
    q = pl.balance / (-unit.playerDelta);
    if (q <= 0n) return 0n;
    t = quoteTrade("buy", prices[k]!, q);
    if (-t.playerDelta > pl.balance) return 0n;
  }
  pl.balance += t.playerDelta;
  taxSink += t.tax;
  marketNet += side === "buy" ? t.gross : -t.gross;
  pl.inv[k]! += side === "buy" ? q : -q;
  return q;
}

const gini = (xs: bigint[]): number => {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(Number);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let w = 0;
  s.forEach((x, i) => (w += (i + 1) * x));
  return (2 * w) / (n * sum) - (n + 1) / n;
};
const wealth = (pl: Player): bigint =>
  pl.balance + pl.inv.reduce((a, q, k) => a + q * prices[k]!, 0n);
const priceIndex = (): number =>
  prices.reduce((a, p, k) => a + Number(p) / Number(PRODUCTS[k]!.start), 0) / prices.length;

const rows: Record<string, string>[] = [];
let minIdx = Infinity;
let maxIdx = 0;
for (let day = 1; day <= DAYS; day++) {
  const demand = PRODUCTS.map(() => 0n);
  const supply = PRODUCTS.map(() => 0n);
  for (let i = 0; i < PLAYERS; i++) {
    const pl = players[i]!;
    for (let k = 0; k < PRODUCTS.length; k++) {
      const q = BigInt(1 + Math.floor(rng() * MAX_QTY));
      const rising = prices[k]! >= prevPrices[k]!;
      if (pl.kind === "arb") {
        // önceki tick'te aldığını şimdi sat, sonra yeniden al
        supply[k]! += trade(pl, k, "sell", pl.lastBuy[k]!);
        pl.lastBuy[k] = trade(pl, k, "buy", q);
        demand[k]! += pl.lastBuy[k]!;
        continue;
      }
      if (rng() > 0.5) continue;
      let side: "buy" | "sell";
      if (pl.kind === "random") side = rng() < 0.5 ? "buy" : "sell";
      else if (pl.kind === "trend") side = rising ? "buy" : "sell";
      else side = rng() < 0.8 ? "buy" : "sell"; // biriktirici
      const done = trade(pl, k, side, q);
      if (side === "buy") demand[k]! += done;
      else supply[k]! += done;
    }
  }
  PRODUCTS.forEach((_, k) => {
    prevPrices[k] = prices[k]!;
    prices[k] = nextPrice(prices[k]!, demand[k]!, supply[k]!);
  });
  players.forEach((pl, i) => {
    const cheapest = quoteTrade("buy", prices[0]!, 1n);
    const stuck = pl.balance < -cheapest.playerDelta && pl.inv.every((q) => q === 0n);
    if (stuck && !bankruptSet.has(i)) bankruptSet.add(i);
  });
  const idx = priceIndex();
  minIdx = Math.min(minIdx, idx);
  maxIdx = Math.max(maxIdx, idx);
  if (day % Math.max(1, Math.floor(DAYS / 6)) === 0 || day === DAYS) {
    const bal = players.reduce((a, p) => a + p.balance, 0n);
    rows.push({
      gun: String(day),
      nakitArzi: formatMoney(bal),
      fiyatEndeksi: idx.toFixed(3),
      gini: gini(players.map(wealth)).toFixed(3),
      iflasOrani: ((bankruptSet.size / PLAYERS) * 100).toFixed(1) + "%",
    });
  }
}
bankrupt = bankruptSet.size;

const cash = players.reduce((a, p) => a + p.balance, 0n);
// Defter denetimi: kaynak = oyuncu nakdi + market net + vergi (marketNet oyunculardan market'e giden)
const ledgerOk = mint === cash + marketNet + taxSink;
console.log(`oyuncu=${PLAYERS} gun=${DAYS} maxAlim=${MAX_QTY}`);
console.table(rows);
const byKind = (k: Kind): string => {
  const g = players.filter((p) => p.kind === k);
  const avg = g.reduce((a, p) => a + wealth(p), 0n) / BigInt(g.length);
  return formatMoney(avg);
};
console.table({
  kaynak_mint: formatMoney(mint),
  yutak_vergi: formatMoney(taxSink),
  market_net: formatMoney(marketNet),
  oyuncuNakdi: formatMoney(cash),
  toplamServetEnvanterDahil: formatMoney(players.reduce((a, p) => a + wealth(p), 0n)),
  defterDengeli: String(ledgerOk),
  endeksMinMax: `${minIdx.toFixed(3)} / ${maxIdx.toFixed(3)}`,
  iflas: String(bankrupt),
  sonFiyatlar: prices.map((p) => formatMoney(p)).join(" | "),
  ortServet_random: byKind("random"),
  ortServet_trend: byKind("trend"),
  ortServet_arb: byKind("arb"),
  ortServet_hoarder: byKind("hoarder"),
  baslangic: formatMoney(PARAMS.startingBalance),
});
