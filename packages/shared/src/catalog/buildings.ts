import type { BuildingTypeDef } from "./types";

const lv = (
  level: number, lines: number, maxBatches: number, upkeepPerDay: number,
  upgradeCost: number, upgradeSteelKg: number, upgradeMinutes: number,
  bonus?: [yieldBp: number, efficiencyBp: number, inputSavingBp: number, qualityBonus?: number],
) => ({
  level, lines, maxBatches, upkeepPerDay, upgradeCost, upgradeSteelKg, upgradeMinutes,
  ...(bonus ? { yieldBp: bonus[0], efficiencyBp: bonus[1], inputSavingBp: bonus[2], ...(bonus[3] ? { qualityBonus: bonus[3] } : {}) } : {}),
});

/**
 * levels[i].upgradeCost: i. seviyeden i+1'e geçiş maliyeti (son seviyede 0).
 * Para kuruş. Ör. 8_000_000 = ₺80.000.
 */
export const BUILDING_TYPES: BuildingTypeDef[] = [
  {
    id: "field", sector: "crop", name: { tr: "Tarla", en: "Field" },
    buildCost: 6_000_000, buildSteelKg: 1000, buildMinutes: 240,
    levels: [lv(1, 1, 1, 40_000, 2_000_000, 1000, 360), lv(2, 2, 2, 90_000, 18_000_000, 9000, 720, [1800, 1000, 2500]), lv(3, 3, 3, 180_000, 0, 0, 0, [3500, 1000, 1000, 1])],
    qualityUpgradeCosts: [5_000_000, 14_000_000], qualityUpgradeMinutes: 240,
  },
  {
    id: "barn", sector: "livestock", name: { tr: "Ahır", en: "Dairy barn" },
    buildCost: 9_000_000, buildSteelKg: 2000, buildMinutes: 300,
    levels: [lv(1, 1, 1, 60_000, 4_500_000, 2000, 360), lv(2, 2, 2, 130_000, 22_000_000, 10000, 720, [1000, 500, 1500]), lv(3, 3, 3, 250_000, 0, 0, 0, [2000, 1000, 2500])],
    qualityUpgradeCosts: [7_000_000, 18_000_000], qualityUpgradeMinutes: 240,
  },
  {
    id: "mine", sector: "mining", name: { tr: "Maden ocağı", en: "Mine" }, requiresDeposit: true,
    buildCost: 12_000_000, buildSteelKg: 3000, buildMinutes: 360,
    levels: [lv(1, 1, 1, 70_000, 5_000_000, 2500, 360), lv(2, 2, 2, 150_000, 25_000_000, 12000, 720, [1500, 1500, 0, 1]), lv(3, 3, 3, 280_000, 0, 0, 0, [3000, 2500, 0, 1])],
    qualityUpgradeCosts: [6_000_000, 16_000_000], qualityUpgradeMinutes: 240,
  },
  {
    id: "food_plant", sector: "manufacturing", name: { tr: "Gıda fabrikası", en: "Food plant" },
    buildCost: 14_000_000, buildSteelKg: 4000, buildMinutes: 360,
    levels: [lv(1, 1, 1, 80_000, 6_000_000, 3000, 360), lv(2, 2, 2, 170_000, 28_000_000, 14000, 720, [300, 700, 1000]), lv(3, 3, 3, 320_000, 0, 0, 0, [600, 1400, 1800])],
    qualityUpgradeCosts: [10_000_000, 24_000_000], qualityUpgradeMinutes: 300,
  },
  {
    id: "steel_mill", sector: "manufacturing", name: { tr: "Çelikhane", en: "Steel mill" },
    buildCost: 16_000_000, buildSteelKg: 5000, buildMinutes: 420,
    levels: [lv(1, 1, 1, 90_000, 4_000_000, 2000, 360), lv(2, 2, 2, 190_000, 30_000_000, 15000, 720, [300, 600, 800]), lv(3, 3, 3, 350_000, 0, 0, 0, [600, 1200, 1600])],
    qualityUpgradeCosts: [10_000_000, 24_000_000], qualityUpgradeMinutes: 300,
  },
  {
    id: "garage", sector: "freight", name: { tr: "Garaj", en: "Garage" },
    buildCost: 5_000_000, buildSteelKg: 1500, buildMinutes: 240,
    levels: [lv(1, 0, 0, 30_000, 6_000_000, 3000, 360), lv(2, 0, 0, 70_000, 15_000_000, 8000, 720), lv(3, 0, 0, 140_000, 0, 0, 0)],
    qualityUpgradeCosts: [], qualityUpgradeMinutes: 0,
    vehicleSlots: [2, 4, 8],
  },
];
