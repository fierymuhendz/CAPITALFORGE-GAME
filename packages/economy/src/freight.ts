import { BP, applyBp, toBig } from "./money";

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

export function estimateOwnTrip(km: number, v: VehicleLike, wagePerHour: bigint | number, opts?: { speedBonusBp?: number; fuelSavingBp?: number; loadingHours?: number }): TripEstimate {
  const minutes = travelMinutes(km, v.speedKmh, opts?.speedBonusBp ?? 0);
  const fuel = fuelCost(km, v.fuelPerKm, opts?.fuelSavingBp ?? 0);
  const driver = driverCost(minutes, wagePerHour, opts?.loadingHours ?? 1);
  return { minutes, fuel, driver, total: fuel + driver };
}

/** Sistem taşımacısı fiyatı: (kalkış ücreti + km × km ücreti) × kamyon dolusu sayısı */
export function systemCarrierQuote(km: number, kg: number, baseFee: bigint | number, perKm: bigint | number, truckCapacityKg = 12000): bigint {
  const loads = BigInt(Math.max(1, Math.ceil(kg / truckCapacityKg)));
  return (toBig(baseFee) + toBig(km) * toBig(perKm)) * loads;
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
