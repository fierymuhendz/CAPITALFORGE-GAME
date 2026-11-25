/**
 * Katalog tipleri. Katalog satırları metin kimliklidir; yeni ürün/bina/tarif eklemek
 * mevcut kayıtları bozmaz. Para değerleri kuruş (tam sayı), miktarlar kg (tam sayı).
 */
export type Sector = "crop" | "livestock" | "mining" | "manufacturing" | "freight";
export const SECTORS: readonly Sector[] = ["crop", "livestock", "mining", "manufacturing", "freight"];

export type Localized = { tr: string; en: string };

export interface CityDef {
  id: string;
  name: Localized;
  blurb: Localized;
  /** 3D/2D harita konumu (birim: km, kabaca) */
  map: { x: number; z: number };
  color: string;
  /** kuruş / kWh */
  energyPrice: number;
  /** kuruş / m³ */
  waterPrice: number;
  /** kuruş / işçi-saat */
  wage: number;
  /** iş gücü durumu: tesis başına en fazla işçi-saat/saat çarpanı ve açıklama */
  labor: { availability: number; note: Localized };
  /** sektör verim çarpanı (bp, 10000 = 1.0) */
  sectorYieldBp: Partial<Record<Sector, number>>;
  /** ürün referans fiyat çarpanı (bp). Yerel üretilen ucuz, yerel tüketilen pahalı. */
  priceBp: Record<string, number>;
  /** arsa fiyat çarpanı (bp) */
  landPriceBp: number;
}

export type ProductCategory = "raw" | "agri" | "food" | "industrial";
export interface ProductDef {
  id: string;
  name: Localized;
  category: ProductCategory;
  /** kuruş / kg, kalite 2, şehir çarpanı öncesi */
  basePricePerKg: number;
  color: string;
}

export interface BuildingTypeDef {
  id: string;
  sector: Sector;
  name: Localized;
  /** yeni inşaat maliyeti (kuruş) ve çelik ihtiyacı (kg) */
  buildCost: number;
  buildSteelKg: number;
  buildMinutes: number;
  /** seviye başına: eşzamanlı hat, parti kapasitesi, günlük bakım (kuruş), yükseltme */
  levels: Array<{
    level: number;
    lines: number;
    maxBatches: number;
    upkeepPerDay: number;
    upgradeCost: number;
    upgradeSteelKg: number;
    upgradeMinutes: number;
  }>;
  /** kalite iyileştirme maliyetleri: index 0 → kalite seviyesi 2, index 1 → 3 */
  qualityUpgradeCosts: number[];
  qualityUpgradeMinutes: number;
  /** garaj: seviye başına araç kapasitesi */
  vehicleSlots?: number[];
  /** maden: yalnızca yataklı arsa */
  requiresDeposit?: boolean;
}

export interface RecipeDef {
  id: string;
  buildingType: string;
  name: Localized;
  inputs: Array<{ productId: string; kg: number }>;
  output: { productId: string; kg: number };
  minutes: number;
  laborHours: number;
  energyKwh: number;
  waterM3: number;
  minBuildingLevel: number;
  /** maden tarifi: arsada bu yatak olmalı */
  deposit?: "iron" | "coal";
}

export type ResearchEffect =
  | { kind: "yield"; sector: Sector; bpPerLevel: number }
  | { kind: "efficiency"; sector: Sector; bpPerLevel: number }
  | { kind: "quality"; perLevel: number }
  | { kind: "fuel"; bpPerLevel: number }
  | { kind: "speed"; bpPerLevel: number };

export interface ResearchDef {
  id: string;
  name: Localized;
  description: Localized;
  maxLevel: number;
  /** seviye n maliyeti = baseCost × n² */
  baseCost: number;
  /** seviye n süresi = baseMinutes × n */
  baseMinutes: number;
  effect: ResearchEffect;
}

export interface VehicleModelDef {
  id: string;
  name: Localized;
  capacityKg: number;
  speedKmh: number;
  /** kuruş / km */
  fuelPerKm: number;
  price: number;
  upkeepPerDay: number;
  minCompanyLevel: number;
  minGarageLevel: number;
}

export interface PlotDef {
  id: string;
  cityId: string;
  /** 0..3 ızgara */
  gx: number;
  gz: number;
  price: number;
  minLevel: number;
  sizeHa: number;
  fertilityBp: number;
  pastureBp: number;
  deposit: null | { kind: "iron" | "coal"; richnessBp: number };
  /** şehir merkezine (müşterilere) uzaklık km */
  distanceToCenterKm: number;
}
