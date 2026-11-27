import type { Industry, ProductDef, ProductStage } from "./types";
import { stageOf, V4_PRODUCT_SPECS } from "./v4-products";
import { V4_RECIPES } from "./v4-recipes";
import { V4_BUILDING_TYPES } from "./v4-buildings";

/** Fiyatlar kuruş/kg (kalite 2). Ör. tahıl 500 = ₺5/kg = ₺5.000/ton. */
export const LEGACY_PRODUCTS: ProductDef[] = [
  { id: "seed", name: { tr: "Tohum", en: "Seed" }, category: "agri", basePricePerKg: 800, color: "#b9a46b" },
  { id: "fodder", name: { tr: "Yem bitkisi", en: "Feed crops" }, category: "agri", basePricePerKg: 250, color: "#8fbf4a" },
  { id: "grain", name: { tr: "Tahıl", en: "Grain" }, category: "agri", basePricePerKg: 500, color: "#e0b84f" },
  { id: "raw_milk", name: { tr: "Çiğ süt", en: "Raw milk" }, category: "agri", basePricePerKg: 850, color: "#f2efe6" },
  { id: "flour", name: { tr: "Un", en: "Flour" }, category: "food", basePricePerKg: 1300, color: "#efe3c8" },
  { id: "packaged_milk", name: { tr: "Paketli süt", en: "Packaged milk" }, category: "food", basePricePerKg: 1550, color: "#9fd3f0" },
  { id: "cheese", name: { tr: "Peynir", en: "Cheese" }, category: "food", basePricePerKg: 12500, color: "#f5c542" },
  { id: "iron_ore", name: { tr: "Demir cevheri", en: "Iron ore" }, category: "raw", basePricePerKg: 260, color: "#9b5d43" },
  { id: "coal", name: { tr: "Kömür", en: "Coal" }, category: "raw", basePricePerKg: 340, color: "#3b3b3b" },
  { id: "steel", name: { tr: "Çelik", en: "Steel" }, category: "industrial", basePricePerKg: 1800, color: "#8aa0b4" },
];

/** Mevcut 10 ürünün v4 ek alanları (canlıda revizyonla eklenir) */
export const LEGACY_PRODUCT_EXTRAS: Record<string, { industry: Industry; stage: ProductStage }> = {
  seed: { industry: "field_crops", stage: "raw" },
  fodder: { industry: "feed", stage: "raw" },
  grain: { industry: "field_crops", stage: "raw" },
  raw_milk: { industry: "livestock", stage: "intermediate" },
  flour: { industry: "dairy_food", stage: "final" },
  packaged_milk: { industry: "dairy_food", stage: "final" },
  cheese: { industry: "dairy_food", stage: "final" },
  iron_ore: { industry: "mining_metal", stage: "raw" },
  coal: { industry: "mining_metal", stage: "raw" },
  steel: { industry: "mining_metal", stage: "intermediate" },
};

/** İş kolu renkleri (ürün rengi bunun tonları; UI tokenları theme.css'te) */
export const INDUSTRY_COLORS: Record<Industry, string> = {
  field_crops: "#e0b84f", feed: "#9fcc4f", livestock: "#ef8f7a", dairy_food: "#7fa6f5", textile: "#ef8cc8", forestry: "#5fbf74",
  packaging: "#d9a46a", mining_metal: "#a9b6c4", glass_ceramic: "#5fd3c0", construction: "#c2b29c", machinery: "#9a94f5",
  logistics: "#5cc4e8", chemicals: "#c48af0",
};

/** Fiyat türetmede kullanılan referans işletme fiyatları (kuruş): kWh, m³, işçi-saat */
export const PRICING_REF = { energy: 500, water: 1500, wage: 15000, inputMarkupBp: 15000, valueAddBp: 20000, upkeepBatchesPerDay: 12 } as const;

const CATEGORY_OF: Record<Industry, ProductDef["category"]> = {
  field_crops: "agri", feed: "agri", livestock: "agri", dairy_food: "food", textile: "industrial", forestry: "industrial", packaging: "industrial",
  mining_metal: "raw", glass_ceramic: "industrial", construction: "industrial", machinery: "industrial", logistics: "industrial", chemicals: "industrial",
};

function shade(hex: string, i: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = 0.78 + ((i * 37) % 45) / 100; // 0.78..1.22
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * Türetilmiş taban fiyat (saf, deterministik): ürünün ilk kilitsiz reçetesinden
 * fiyat = (1,5 × Σ girdi değeri + 2,0 × (enerji + su + işçilik + bakım payı)) / çıktı kg, 10 kuruşa yukarı yuvarlı.
 * Sistemden girdi alıp sisteme satmanın başa baş eşiği girdi tarafında 0,85 × 1,5 = 1,275 > 1,20 (ask) ile korunur.
 */
export function deriveV4Prices(known: Map<string, number>): Map<string, number> {
  const out = new Map(known);
  const upkeep = new Map(V4_BUILDING_TYPES.map((b) => [b.id, b.levels[0]!.upkeepPerDay]));
  const legacyUpkeep: Record<string, number> = { field: 40_000, barn: 60_000, mine: 70_000, food_plant: 80_000, steel_mill: 90_000 };
  const primary = new Map<string, (typeof V4_RECIPES)[number]>();
  for (const r of V4_RECIPES) if (!r.research && !primary.has(r.output.productId)) primary.set(r.output.productId, r);
  for (const r of V4_RECIPES) if (!primary.has(r.output.productId)) primary.set(r.output.productId, r);
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const [pid, r] of primary) {
      if (out.has(pid)) continue;
      if (!r.inputs.every((i) => out.has(i.productId))) continue;
      const inputs = r.inputs.reduce((a, i) => a + i.kg * out.get(i.productId)!, 0);
      const up = (upkeep.get(r.buildingType) ?? legacyUpkeep[r.buildingType] ?? 80_000) / PRICING_REF.upkeepBatchesPerDay;
      const op = r.energyKwh * PRICING_REF.energy + r.waterM3 * PRICING_REF.water + r.laborHours * PRICING_REF.wage + up;
      const v = (inputs * PRICING_REF.inputMarkupBp + op * PRICING_REF.valueAddBp) / 10000 / r.output.kg;
      out.set(pid, Math.ceil(v / 10) * 10);
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

const V4_PRICES = deriveV4Prices(
  new Map([...LEGACY_PRODUCTS.map((p) => [p.id, p.basePricePerKg] as const), ...V4_PRODUCT_SPECS.filter((s) => s.price).map((s) => [s.id, s.price!] as const)]),
);

export const V4_PRODUCTS: ProductDef[] = V4_PRODUCT_SPECS.map((s, i) => {
  const price = V4_PRICES.get(s.id);
  if (price === undefined) throw new Error(`fiyat türetilemedi: ${s.id}`);
  return {
    id: s.id, name: { tr: s.tr, en: s.en }, category: CATEGORY_OF[s.industry], basePricePerKg: price,
    color: shade(INDUSTRY_COLORS[s.industry], i), industry: s.industry, stage: stageOf(s.id, !!s.price),
  };
});

export const PRODUCTS: ProductDef[] = [
  ...LEGACY_PRODUCTS.map((p) => ({ ...p, ...LEGACY_PRODUCT_EXTRAS[p.id] })),
  ...V4_PRODUCTS,
];

/** Kalite çarpanı (bp): kalite 1..5 */
export const QUALITY_PRICE_BP = [0, 8500, 10000, 10900, 11700, 12500] as const;
export const MIN_QUALITY = 1;
export const MAX_QUALITY = 5;
