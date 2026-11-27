import type { RecipeDef } from "./types";
import { V4_RECIPES } from "./v4-recipes";

/** Taban değerler, seviye 1, tek parti. Miktarlar kg. */
export const LEGACY_RECIPES: RecipeDef[] = [
  {
    id: "grow_fodder", buildingType: "field", name: { tr: "Yem bitkisi ekimi", en: "Grow feed crops" },
    inputs: [{ productId: "seed", kg: 200 }], output: { productId: "fodder", kg: 2400 },
    minutes: 60, laborHours: 6, energyKwh: 40, waterM3: 30, minBuildingLevel: 1,
  },
  {
    id: "grow_grain", buildingType: "field", name: { tr: "Tahıl ekimi", en: "Grow grain" },
    inputs: [{ productId: "seed", kg: 300 }], output: { productId: "grain", kg: 2000 },
    minutes: 120, laborHours: 10, energyKwh: 60, waterM3: 50, minBuildingLevel: 1,
  },
  {
    id: "milk_cows", buildingType: "barn", name: { tr: "Süt sağımı", en: "Milk the herd" },
    inputs: [{ productId: "fodder", kg: 1200 }], output: { productId: "raw_milk", kg: 1000 },
    minutes: 60, laborHours: 6, energyKwh: 30, waterM3: 10, minBuildingLevel: 1,
  },
  {
    id: "mine_iron", buildingType: "mine", name: { tr: "Demir cevheri çıkarma", en: "Mine iron ore" }, deposit: "iron",
    inputs: [], output: { productId: "iron_ore", kg: 4000 },
    minutes: 60, laborHours: 12, energyKwh: 120, waterM3: 20, minBuildingLevel: 1,
  },
  {
    id: "mine_coal", buildingType: "mine", name: { tr: "Kömür çıkarma", en: "Mine coal" }, deposit: "coal",
    inputs: [], output: { productId: "coal", kg: 3000 },
    minutes: 60, laborHours: 12, energyKwh: 100, waterM3: 15, minBuildingLevel: 1,
  },
  {
    id: "mill_flour", buildingType: "food_plant", name: { tr: "Un öğütme", en: "Mill flour" },
    inputs: [{ productId: "grain", kg: 2000 }], output: { productId: "flour", kg: 1500 },
    minutes: 60, laborHours: 6, energyKwh: 80, waterM3: 5, minBuildingLevel: 1,
  },
  {
    id: "pack_milk", buildingType: "food_plant", name: { tr: "Süt paketleme", en: "Package milk" },
    inputs: [{ productId: "raw_milk", kg: 1000 }], output: { productId: "packaged_milk", kg: 950 },
    minutes: 60, laborHours: 4, energyKwh: 40, waterM3: 4, minBuildingLevel: 1,
  },
  {
    id: "make_cheese", buildingType: "food_plant", name: { tr: "Peynir yapımı", en: "Make cheese" },
    inputs: [{ productId: "raw_milk", kg: 2000 }], output: { productId: "cheese", kg: 200 },
    minutes: 120, laborHours: 10, energyKwh: 60, waterM3: 8, minBuildingLevel: 1,
  },
  {
    id: "smelt_steel", buildingType: "steel_mill", name: { tr: "Çelik dökümü", en: "Smelt steel" },
    inputs: [{ productId: "iron_ore", kg: 2000 }, { productId: "coal", kg: 1000 }], output: { productId: "steel", kg: 1000 },
    minutes: 180, laborHours: 10, energyKwh: 350, waterM3: 20, minBuildingLevel: 1,
  },
];

export const RECIPES: RecipeDef[] = [...LEGACY_RECIPES, ...V4_RECIPES];
