import { type Money, BPS_SCALE } from "./money";
import { PARAMS, type ProductId } from "./params";
import { transactionTax, type TradeSide } from "./pricing";

/**
 * Ürün başına ORTAK piyasa havuzu (sabit çarpımlı AMM, x·y=k). Havuz tüm oyuncular için tektir:
 * her işlem havuz durumunu ANINDA ve kalıcı değiştirir; fiyat = value/units. Alım units'i azaltıp
 * value'yu artırır (fiyat yükselir), satım tersini yapar. Alım+satım aynı miktarla yapılırsa havuz
 * kâr/zarar etmez (yol bağımsız), böylece spread+vergi round-trip'i her zaman zarara çevirir.
 * `value` sanal bir değerdir (defter hesabı değil). Gerçek para yalnız oyuncu ile system:market
 * arasında gross kadar akar.
 */
export interface PoolState {
  /** Havuzdaki birim rezervi (x). */
  units: bigint;
  /** Sanal değer rezervi (y, kuruş). Fiyat = value / units. */
  value: bigint;
}

export interface PoolTrade {
  /** Ortalama birim fiyat (alımda yukarı, satımda aşağı yuvarlı). */
  unitPrice: Money;
  gross: Money;
  tax: Money;
  /** Oyuncu bakiyesine etkisi: alımda -(gross+tax), satımda gross-tax. */
  playerDelta: Money;
  newPool: PoolState;
  /** İşlem sonrası havuz fiyatı. */
  newPrice: Money;
}

/** Yeni ürün için başlangıç havuzu: depth birim, değer = depth x initialPrice. */
export function initialPool(productId: ProductId): PoolState {
  const units = PARAMS.poolDepth[productId];
  return { units, value: units * PARAMS.initialPrice[productId] };
}

/** Havuz fiyatı (kuruş), [minPrice, maxPrice] içine kırpılır. */
export function poolPrice(pool: PoolState): Money {
  if (pool.units < 1n || pool.value < 1n) throw new RangeError("geçersiz havuz durumu");
  const p = pool.value / pool.units;
  if (p < PARAMS.minPrice) return PARAMS.minPrice;
  if (p > PARAMS.maxPrice) return PARAMS.maxPrice;
  return p;
}

/** Tek emirde azami adet: havuz rezervinin poolMaxOrderBps kesri (en az 1). */
export function poolMaxOrder(pool: PoolState): bigint {
  const m = (pool.units * PARAMS.poolMaxOrderBps) / BPS_SCALE;
  return m < 1n ? 1n : m;
}

/**
 * Havuza karşı işlem. Saf. Para her adımda sistemin lehine yuvarlanır: alımda havuz bedeli ve
 * spread'li brüt YUKARI, satımda havuz geliri ve spread'li brüt AŞAĞI. Vergi yukarı yuvarlanır
 * ve satımda brüt tutarı aşamaz. qty <= 0 veya qty > poolMaxOrder(pool) için RangeError.
 */
export function executeAgainstPool(side: TradeSide, pool: PoolState, qty: bigint): PoolTrade {
  if (qty <= 0n) throw new RangeError(`miktar pozitif olmalı: ${qty}`);
  if (qty > poolMaxOrder(pool)) throw new RangeError(`emir havuz sınırını aşıyor: ${qty}`);
  let newPool: PoolState;
  let gross: Money;
  if (side === "buy") {
    const x = pool.units - qty; // > 0: poolMaxOrderBps < 10000
    if (x < 1n) throw new RangeError("havuz rezervi yetersiz");
    const poolCost = (pool.value * qty + x - 1n) / x;
    newPool = { units: x, value: pool.value + poolCost };
    gross = (poolCost * (BPS_SCALE + PARAMS.spreadBps) + BPS_SCALE - 1n) / BPS_SCALE;
  } else {
    const proceeds = (pool.value * qty) / (pool.units + qty);
    newPool = { units: pool.units + qty, value: pool.value - proceeds };
    gross = (proceeds * (BPS_SCALE - PARAMS.spreadBps)) / BPS_SCALE;
  }
  const rawTax = transactionTax(gross);
  const tax = rawTax > gross ? gross : rawTax;
  const playerDelta = side === "buy" ? -(gross + tax) : gross - tax;
  const unitPrice = side === "buy" ? (gross + qty - 1n) / qty : gross / qty;
  return { unitPrice, gross, tax, playerDelta, newPool, newPrice: poolPrice(newPool) };
}

const SCALE = 10n ** 18n;

/** (1 - r)^n, 1e18 ölçekli, ikili üs alma. r = poolReplenishPpm / 1e6. */
function retention(ticks: bigint): bigint {
  let base = SCALE - PARAMS.poolReplenishPpm * 10n ** 12n;
  let result = SCALE;
  let e = ticks;
  while (e > 0n) {
    if (e & 1n) result = (result * base) / SCALE;
    base = (base * base) / SCALE;
    e >>= 1n;
  }
  return result;
}

/**
 * Havuz derinliğinin yenilenmesi: ticks tick boyunca units hedef derinliğe (poolDepth),
 * value hedef değere (depth x refPrice) geometrik olarak yaklaşır. Hedefi asla aşmaz. Hem alım hem
 * satım sonrası, işlemi yapan aleyhine çalışır (fiyatı ve derinliği oyuncunun etkisinden uzaklaştırır).
 * Ticker her tick (veya her N tick) için çağırır; ticks = 0 durumu değiştirmez.
 */
export function replenish(pool: PoolState, productId: ProductId, ticks: bigint): PoolState {
  if (ticks < 0n) throw new RangeError(`tick negatif olamaz: ${ticks}`);
  if (ticks === 0n) return pool;
  const D = PARAMS.poolDepth[productId];
  const V = D * PARAMS.refPrice[productId];
  const keep = retention(ticks);
  const units = D + ((pool.units - D) * keep) / SCALE;
  const value = V + ((pool.value - V) * keep) / SCALE;
  return { units: units < 1n ? 1n : units, value: value < 1n ? 1n : value };
}
