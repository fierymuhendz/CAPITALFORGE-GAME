import { BP, applyBp, mulDiv, toBig } from "./money";
import { scaleTravelMinutes } from "./pace";

export interface VehicleLike { capacityKg: number; speedKmh: number; fuelPerKm: bigint | number }

/** Yol süresi (dk), araştırma hız bonusu ile; yukarı yuvarlı */
export function travelMinutes(km: number, speedKmh: number, speedBonusBp = 0): number {
  if (km <= 0) return 0;
  return Math.ceil((km * 60 * 10000) / (speedKmh * (10000 + speedBonusBp)));
}

export function fuelCost(km: number, fuelPerKm: bigint | number, fuelSavingBp = 0): bigint {
  return applyBp(toBig(km) * toBig(fuelPerKm), 10000 - Math.min(fuelSavingBp, 5000));
}

/** Sürücü ücreti: yolculuk süresi + yükleme saati × kalkış şehri ücreti */
export function driverCost(minutes: number, wagePerHour: bigint | number, loadingHours = 1): bigint {
  return (toBig(minutes) * toBig(wagePerHour)) / 60n + toBig(loadingHours) * toBig(wagePerHour);
}

export interface TripEstimate { minutes: number; fuel: bigint; driver: bigint; total: bigint }

/**
 * Sefer tahmini. `handlingMinutes`: yükleme + boşaltma süresi (araç bu süre boyunca da meşgul, varsayılan 0 = eski davranış).
 * Sürücü ücreti yalnızca yolculuk dakikası + yükleme saati üzerinden hesaplanır (bekleme ayrıca ücretlenmez).
 */
export function estimateOwnTrip(km: number, v: VehicleLike, wagePerHour: bigint | number, opts?: { speedBonusBp?: number; fuelSavingBp?: number; loadingHours?: number; handlingMinutes?: number; paceScaleBp?: number }): TripEstimate {
  const drive = travelMinutes(km, v.speedKmh, opts?.speedBonusBp ?? 0);
  const minutes = scaleTravelMinutes(drive + (km > 0 ? Math.max(0, opts?.handlingMinutes ?? 0) : 0), opts?.paceScaleBp ?? 10000);
  const fuel = fuelCost(km, v.fuelPerKm, opts?.fuelSavingBp ?? 0);
  const driver = driverCost(drive, wagePerHour, opts?.loadingHours ?? 1);
  return { minutes, fuel, driver, total: fuel + driver };
}

/**
 * Sistem taşıma tarifesi v3 (tüm sabitler tam sayı, bp).
 * - Mesafe: ilk `taperStartKm` km tam fiyat, sonrası `taperBp` (uzun yolda km başına daha az).
 * - Yük: km ücretinin `fixedShareBp` kısmı araç sabit maliyeti (yükten bağımsız), kalanı doluluğa göre.
 *   Bir kamyondan büyük yükte ilk kamyon dolusu tam, sonraki kamyon dolusu `extraLoadBp` (hacim indirimi).
 * - Kalkış ücreti (`baseFee`) iş başına bir kez (yükleme/boşaltma durağı).
 * - `markupBp`: km ücretine genel çarpan.
 * Tam dolu kamyonda eski tarifeyle aynı biçim: (taban + km × km ücreti) ≈ 12 t yükte `markupBp` kadar üstünde.
 */
export const FREIGHT_TARIFF = { fixedShareBp: 4500, taperStartKm: 150, taperBp: 8500, extraLoadBp: 7500, markupBp: 16000 } as const;

/** Mesafe birimi (bp × km): taper uygulanmış etkin km × 10000 */
function effectiveKmBp(km: number): bigint {
  const near = Math.min(km, FREIGHT_TARIFF.taperStartKm);
  const far = Math.max(0, km - FREIGHT_TARIFF.taperStartKm);
  return toBig(near) * BP + toBig(far) * toBig(FREIGHT_TARIFF.taperBp);
}

/** Yük çarpanı (bp, 10000 = tam kamyon dolusu): kısmi yük = sabit pay + doluluk payı; fazla yük hacim indirimiyle */
export function loadFactorBp(kg: number, truckCapacityKg = 12000): number {
  if (kg <= 0) return FREIGHT_TARIFF.fixedShareBp;
  const full = Math.floor(kg / truckCapacityKg);
  const rem = kg - full * truckCapacityKg;
  const part = rem > 0 ? FREIGHT_TARIFF.fixedShareBp + Math.floor(((10000 - FREIGHT_TARIFF.fixedShareBp) * rem) / truckCapacityKg) : 0;
  if (full === 0) return part;
  return 10000 + Math.floor(((full - 1) * 10000 * FREIGHT_TARIFF.extraLoadBp) / 10000) + Math.floor((part * FREIGHT_TARIFF.extraLoadBp) / 10000);
}

/** Sistem taşımacısı fiyatı (kuruş): kalkış ücreti + mesafe × km ücreti × yük çarpanı × genel çarpan. */
export function systemCarrierQuote(km: number, kg: number, baseFee: bigint | number, perKm: bigint | number, truckCapacityKg = 12000): bigint {
  const dist = mulDiv(toBig(perKm) * effectiveKmBp(km), toBig(loadFactorBp(kg, truckCapacityKg)) * toBig(FREIGHT_TARIFF.markupBp), BP * BP * BP);
  return toBig(baseFee) + dist;
}

/** Süre primi (bp): acil iş daha çok öder. ≤6 sa +%30, ≤12 sa +%15, ≤24 sa 0, uzun süre −%5. */
export function deadlinePremiumBp(deadlineHours: number): number {
  if (deadlineHours <= 6) return 3000;
  if (deadlineHours <= 12) return 1500;
  if (deadlineHours <= 24) return 0;
  return -500;
}

/** Süre primi uygulanmış sistem ücreti */
export function systemCarrierQuoteWithDeadline(km: number, kg: number, baseFee: bigint | number, perKm: bigint | number, deadlineHours: number, truckCapacityKg = 12000): bigint {
  const q = systemCarrierQuote(km, kg, baseFee, perKm, truckCapacityKg);
  return q + mulDiv(q, toBig(deadlinePremiumBp(deadlineHours)), BP);
}

export interface SystemJobSpec { kg: number; deadlineHours: number; destCityId: string }
/**
 * Sistem taşıma işi şablonu (deterministik): yük ve süre karışımı, hedef seçimi.
 * Karışım (k mod 6): 2500 kg/24sa (kamyonet yapabilir), 6000/24, 12000/24, 12000/12 (acil), 9000/6 (çok acil), 24000/48 (tır).
 * Hedef: Kavşak'tan çıkışta dönüşümlü diğer şehirler; diğer şehirlerden %50 Kavşak'a (merkez), kalanı dönüşümlü.
 */
export function systemFreightJobSpec(originCityId: string, k: number, dayIndex: number, cityIds: readonly string[], hubCityId = "kavsak"): SystemJobSpec {
  const MIX: Array<[number, number]> = [[2500, 24], [6000, 24], [12000, 24], [12000, 12], [9000, 6], [24000, 48]];
  const [kg, deadlineHours] = MIX[(k + dayIndex) % MIX.length]!;
  const others = cityIds.filter((c) => c !== originCityId).slice().sort();
  const toHub = originCityId !== hubCityId && others.includes(hubCityId) && (k + dayIndex) % 2 === 0;
  const destCityId = toHub ? hubCityId : others[(k + dayIndex) % others.length]!;
  return { kg, deadlineHours, destCityId };
}

export interface RouteLeg { km: number; kg: number; pay: bigint }
export interface RouteValue { profit: bigint; minutes: number; profitPerHour: bigint }
/**
 * Bir turun (gidiş + dönüş) değeri: gidiş ücreti − gidiş maliyeti + dönüş yükü ücreti − dönüş maliyeti.
 * Dönüş yükü yoksa (`back` = null) araç boş döner (yakıt + sürücü ödenir, gelir yok). `backKm` dönüş mesafesi (null ise gidiş mesafesi).
 * Dönüşte bekleme süresi `waitMinutes` eklenir (iş bulana kadar).
 */
export function roundTripValue(
  out: RouteLeg, back: RouteLeg | null, v: VehicleLike, wagePerHour: bigint | number,
  opts?: { speedBonusBp?: number; fuelSavingBp?: number; handlingMinutes?: number; waitMinutes?: number; paceScaleBp?: number },
): RouteValue {
  const o = estimateOwnTrip(out.km, v, wagePerHour, opts);
  const bKm = back ? back.km : out.km;
  const b = estimateOwnTrip(bKm, v, wagePerHour, opts);
  const wait = back ? 0 : Math.max(0, opts?.waitMinutes ?? 0);
  const profit = out.pay - o.total + (back ? back.pay : 0n) - b.total;
  const minutes = o.minutes + b.minutes + wait;
  return { profit, minutes, profitPerHour: minutes > 0 ? (profit * 60n) / BigInt(minutes) : 0n };
}

/**
 * Teslim maliyeti karşılaştırması: tedarikçi fiyatı + navlun, kg başına ve toplam.
 * Oyuncu "ucuz görünen ama navlunla pahalı" teklifleri bununla karşılaştırır.
 */
export function landedCost(qtyKg: number, pricePerKg: bigint | number, freightTotal: bigint): { goods: bigint; freight: bigint; total: bigint; perKg: bigint } {
  const goods = toBig(qtyKg) * toBig(pricePerKg);
  const total = goods + freightTotal;
  return { goods, freight: freightTotal, total, perKg: qtyKg > 0 ? total / toBig(qtyKg) : 0n };
}

/** Konum enterpolasyonu (0..1), istemci ve sunucu aynı formülü kullanır */
export function transitProgress(departedMs: number, arrivesMs: number, nowMs: number): number {
  if (arrivesMs <= departedMs) return 1;
  return Math.max(0, Math.min(1, (nowMs - departedMs) / (arrivesMs - departedMs)));
}

export { BP };
