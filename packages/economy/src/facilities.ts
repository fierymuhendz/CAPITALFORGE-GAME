import { type Money, BPS_SCALE } from "./money";
import { PARAMS } from "./params";

export const FACILITY_TYPES = ["farm", "mine", "power_plant", "mill", "steelworks"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

/**
 * Sıradaki tesisin fiyatı: taban fiyat her sahip olunan tesis için facilityGrowthBps kadar
 * bileşik büyür. Her adımda YUKARI yuvarlanır (oyuncunun aleyhine, para yaratmaz); büyüme > 0
 * olduğundan fiyat kesin artandır. Sınır kontrolü (maxFacilitiesPerCompany) çağıranındır.
 */
export function facilityPrice(type: FacilityType, ownedCount: bigint): Money {
  if (ownedCount < 0n) throw new RangeError(`tesis sayısı negatif olamaz: ${ownedCount}`);
  const factor = BPS_SCALE + PARAMS.facilityGrowthBps;
  let price = PARAMS.facilityBasePrice[type];
  for (let i = 0n; i < ownedCount; i++) {
    price = (price * factor + BPS_SCALE - 1n) / BPS_SCALE;
  }
  return price;
}

/** Bir bakım dönemi (upkeepPeriodTicks) için tesis bakımı: taban × seviye. Negatif olamaz. */
export function upkeep(type: FacilityType, level: bigint): Money {
  if (level < 1n) throw new RangeError(`seviye en az 1 olmalı: ${level}`);
  return PARAMS.upkeepBase[type] * level;
}

/** Bakım dönemi numarası (tick / upkeepPeriodTicks). */
export function upkeepPeriod(tick: bigint): bigint {
  if (tick < 0n) throw new RangeError(`tick negatif olamaz: ${tick}`);
  return tick / PARAMS.upkeepPeriodTicks;
}
