import type { ProductDef } from "./types";

/** Fiyatlar kuruş/kg (kalite 2). Ör. tahıl 500 = ₺5/kg = ₺5.000/ton. */
export const PRODUCTS: ProductDef[] = [
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

/** Kalite çarpanı (bp): kalite 1..5 */
export const QUALITY_PRICE_BP = [0, 8500, 10000, 10900, 11700, 12500] as const;
