/**
 * Katalog tipleri. Katalog satırları metin kimliklidir; yeni ürün/bina/tarif eklemek
 * mevcut kayıtları bozmaz. Para değerleri kuruş (tam sayı), miktarlar kg (tam sayı).
 */
export type Sector = "crop" | "livestock" | "mining" | "manufacturing" | "freight";
export const SECTORS: readonly Sector[] = ["crop", "livestock", "mining", "manufacturing", "freight"];

export type Localized = { tr: string; en: string };

/** İş kolu: ürün, bina ve araştırmanın ekranda gruplandığı sanayi dalı (verim çarpanları `Sector` ile kalır). */
export type Industry =
  | "field_crops" | "feed" | "livestock" | "dairy_food" | "textile" | "forestry" | "packaging"
  | "mining_metal" | "glass_ceramic" | "construction" | "machinery" | "logistics" | "chemicals";
export const INDUSTRIES: readonly Industry[] = [
  "field_crops", "feed", "livestock", "dairy_food", "textile", "forestry", "packaging",
  "mining_metal", "glass_ceramic", "construction", "machinery", "logistics", "chemicals",
];

/** Maden/ocak yatağı türleri (arsada en fazla bir yatak) */
export type DepositKind = "iron" | "coal" | "copper" | "limestone" | "clay" | "sand" | "salt";
export const DEPOSIT_KINDS: readonly DepositKind[] = ["iron", "coal", "copper", "limestone", "clay", "sand", "salt"];

/** Zincirdeki aşama: hammadde (girdisiz/temel), ara mal (başka reçetede girdi), nihai mal (tüketiciye/sanayiye satılır) */
export type ProductStage = "raw" | "intermediate" | "final";

/** 3D/2D haritada binanın prosedürel silüeti */
export type BuildingArchetype =
  | "field" | "barn" | "mine" | "quarry" | "factory" | "mill" | "kiln" | "warehouse"
  | "greenhouse" | "orchard" | "forest" | "workshop" | "garage";

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
  /** isteğe bağlı (eski kayıtlarda revizyonla eklenir) */
  industry?: Industry;
  stage?: ProductStage;
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
    /** seviye bonusları (bp, isteğe bağlı; yoksa 0): çıktı +, enerji/işçilik −, girdi tasarrufu */
    yieldBp?: number;
    efficiencyBp?: number;
    inputSavingBp?: number;
    /** tesis kalite seviyesine eklenir (tam sayı, isteğe bağlı) */
    qualityBonus?: number;
  }>;
  /** kalite iyileştirme maliyetleri: index 0 → kalite seviyesi 2, index 1 → 3 */
  qualityUpgradeCosts: number[];
  qualityUpgradeMinutes: number;
  /** garaj: seviye başına araç kapasitesi */
  vehicleSlots?: number[];
  /** maden: yalnızca yataklı arsa */
  requiresDeposit?: boolean;
  /** yataklı bina: kabul ettiği yatak türleri (yoksa herhangi bir yatak) */
  deposits?: DepositKind[];
  industry?: Industry;
  archetype?: BuildingArchetype;
  /** ilerleme basamağı: 1 başlangıç, 2 uzmanlaşma, 3 ileri sanayi */
  tier?: 1 | 2 | 3;
  /** arsa alıp inşa etmek için gereken şirket seviyesi (yoksa 1) */
  minCompanyLevel?: number;
  /** bu binanın değiştirdiği karar (kısa açıklama) */
  description?: Localized;
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
  deposit?: DepositKind;
  /** araştırma kilidi: şirkette bu araştırma en az bu seviyede olmalı */
  research?: { researchId: string; level: number };
}

export type ResearchEffect =
  | { kind: "yield"; sector: Sector; bpPerLevel: number }
  | { kind: "efficiency"; sector: Sector; bpPerLevel: number }
  | { kind: "quality"; perLevel: number }
  | { kind: "fuel"; bpPerLevel: number }
  | { kind: "speed"; bpPerLevel: number }
  /** belirli bina türlerinde çıktı + */
  | { kind: "building_yield"; buildingTypes: string[]; bpPerLevel: number }
  /** belirli bina türlerinde enerji ve işçilik − */
  | { kind: "building_efficiency"; buildingTypes: string[]; bpPerLevel: number }
  /** belirli bina türlerinde yalnızca enerji − */
  | { kind: "energy"; buildingTypes: string[]; bpPerLevel: number }
  /** belirli bina türlerinde girdi tasarrufu */
  | { kind: "input_saving"; buildingTypes: string[]; bpPerLevel: number }
  /** belirli bina türlerinde üretim süresi − */
  | { kind: "duration"; buildingTypes: string[]; bpPerLevel: number }
  /** belirli bina türlerinde parti kapasitesi + (seviye başına) */
  | { kind: "capacity"; buildingTypes: string[]; batchesPerLevel: number }
  /** belirli bina türlerinde çıktı kalitesi + */
  | { kind: "building_quality"; buildingTypes: string[]; perLevel: number }
  /** reçete kilidi açar (RecipeDef.research bu araştırmayı gösterir) */
  | { kind: "unlock"; recipeIds: string[] };

export type ResearchBranch = Industry | "general";

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
  branch?: ResearchBranch;
  /** önkoşullar: her biri en az bu seviyede olmalı (ilk seviyeyi başlatmak için) */
  prerequisites?: Array<{ researchId: string; level: number }>;
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
  deposit: null | { kind: DepositKind; richnessBp: number };
  /** şehir merkezine (müşterilere) uzaklık km */
  distanceToCenterKm: number;
}

/** Arsa bu bina türü için uygun mu (yatak kuralı). Yataksız binalar her arsaya kurulur. */
export function depositFits(bt: Pick<BuildingTypeDef, "requiresDeposit" | "deposits">, depositKind: string | null | undefined): boolean {
  if (!bt.requiresDeposit) return true;
  if (!depositKind) return false;
  return !bt.deposits || bt.deposits.includes(depositKind as DepositKind);
}
