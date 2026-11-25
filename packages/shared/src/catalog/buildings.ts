import type { BuildingTypeDef } from "./types";

const lv = (
  level: number, lines: number, maxBatches: number, upkeepPerDay: number,
  upgradeCost: number, upgradeSteelKg: number, upgradeMinutes: number,
) => ({ level, lines, maxBatches, upkeepPerDay, upgradeCost, upgradeSteelKg, upgradeMinutes });

/**
 * levels[i].upgradeCost: i. seviyeden i+1'e geçiş maliyeti (son seviyede 0).
 * Para kuruş. Ör. 8_000_000 = ₺80.000.
 */
export const BUILDING_TYPES: BuildingTypeDef[] = [
  {
    id: "field", sector: "crop", name: { tr: "Tarla", en: "Field" },
    buildCost: 6_000_000, buildSteelKg: 1000, buildMinutes: 240,
    levels: [lv(1, 1, 2, 40_000, 7_000_000, 3000, 360), lv(2, 2, 3, 90_000, 18_000_000, 9000, 720), lv(3, 3, 4, 180_000, 0, 0, 0)],
    qualityUpgradeCosts: [3_500_000, 10_000_000], qualityUpgradeMinutes: 240,
  },
  {
    id: "barn", sector: "livestock", name: { tr: "Ahır", en: "Dairy barn" },
    buildCost: 9_000_000, buildSteelKg: 2000, buildMinutes: 300,
    levels: [lv(1, 1, 2, 60_000, 9_000_000, 4000, 360), lv(2, 2, 3, 130_000, 22_000_000, 10000, 720), lv(3, 3, 4, 250_000, 0, 0, 0)],
    qualityUpgradeCosts: [4_000_000, 12_000_000], qualityUpgradeMinutes: 240,
  },
  {
    id: "mine", sector: "mining", name: { tr: "Maden ocağı", en: "Mine" }, requiresDeposit: true,
    buildCost: 12_000_000, buildSteelKg: 3000, buildMinutes: 360,
    levels: [lv(1, 1, 2, 70_000, 10_000_000, 5000, 360), lv(2, 2, 3, 150_000, 25_000_000, 12000, 720), lv(3, 3, 4, 280_000, 0, 0, 0)],
    qualityUpgradeCosts: [4_000_000, 12_000_000], qualityUpgradeMinutes: 240,
  },
  {
    id: "food_plant", sector: "manufacturing", name: { tr: "Gıda fabrikası", en: "Food plant" },
    buildCost: 14_000_000, buildSteelKg: 4000, buildMinutes: 360,
    levels: [lv(1, 1, 2, 80_000, 12_000_000, 6000, 360), lv(2, 2, 3, 170_000, 28_000_000, 14000, 720), lv(3, 3, 4, 320_000, 0, 0, 0)],
    qualityUpgradeCosts: [5_000_000, 14_000_000], qualityUpgradeMinutes: 300,
  },
  {
    id: "steel_mill", sector: "manufacturing", name: { tr: "Çelikhane", en: "Steel mill" },
    buildCost: 16_000_000, buildSteelKg: 5000, buildMinutes: 420,
    levels: [lv(1, 1, 2, 90_000, 13_000_000, 6000, 360), lv(2, 2, 3, 190_000, 30_000_000, 15000, 720), lv(3, 3, 4, 350_000, 0, 0, 0)],
    qualityUpgradeCosts: [5_000_000, 14_000_000], qualityUpgradeMinutes: 300,
  },
  {
    id: "garage", sector: "freight", name: { tr: "Garaj", en: "Garage" },
    buildCost: 5_000_000, buildSteelKg: 1500, buildMinutes: 240,
    levels: [lv(1, 0, 0, 30_000, 6_000_000, 3000, 360), lv(2, 0, 0, 70_000, 15_000_000, 8000, 720), lv(3, 0, 0, 140_000, 0, 0, 0)],
    qualityUpgradeCosts: [], qualityUpgradeMinutes: 0,
    vehicleSlots: [2, 4, 8],
  },
];
