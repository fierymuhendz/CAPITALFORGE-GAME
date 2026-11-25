import type { CityDef } from "./types";

const flat = (v: number): Record<string, number> => ({
  seed: v, fodder: v, grain: v, raw_milk: v, flour: v, packaged_milk: v, cheese: v, iron_ore: v, coal: v, steel: v,
});

export const CITIES: CityDef[] = [
  {
    id: "korfezkent",
    name: { tr: "Körfezkent", en: "Korfezkent" },
    blurb: {
      tr: "Liman ve sanayi metropolü. Tüketim talebi yüksek, arsa pahalı, fabrika işçileri nitelikli.",
      en: "Port and industrial metropolis. High consumer demand, pricey land, skilled factory workers.",
    },
    map: { x: 0, z: 0 },
    color: "#2f6fde",
    energyPrice: 500,
    waterPrice: 2500,
    wage: 18000,
    labor: { availability: 12000, note: { tr: "Geniş, nitelikli iş gücü", en: "Large, skilled workforce" } },
    sectorYieldBp: { manufacturing: 11000, crop: 9000, livestock: 9000 },
    priceBp: { ...flat(10500), cheese: 11500, packaged_milk: 11000, flour: 10800, steel: 11000 },
    landPriceBp: 14000,
  },
  {
    id: "yesilova",
    name: { tr: "Yeşilova", en: "Yesilova" },
    blurb: {
      tr: "Verimli ova. Su ucuz, tarlalar bereketli; sanayi alıcıları uzakta.",
      en: "Fertile plains. Cheap water, rich fields; industrial buyers are far away.",
    },
    map: { x: 170, z: -60 },
    color: "#3fa34d",
    energyPrice: 450,
    waterPrice: 800,
    wage: 13000,
    labor: { availability: 9000, note: { tr: "Mevsimlik tarım işçisi bol", en: "Plenty of seasonal farm labour" } },
    sectorYieldBp: { crop: 12000, livestock: 10000 },
    priceBp: { ...flat(10200), grain: 9000, fodder: 9000, seed: 9500, raw_milk: 10000 },
    landPriceBp: 8000,
  },
  {
    id: "akyayla",
    name: { tr: "Akyayla", en: "Akyayla" },
    blurb: {
      tr: "Serin yayla ve geniş meralar. Hayvancılık için en iyi yer, yem dışarıdan gelir.",
      en: "Cool highlands and wide pastures. Best place for livestock; feed comes from elsewhere.",
    },
    map: { x: 220, z: 60 },
    color: "#c58b2a",
    energyPrice: 500,
    waterPrice: 1000,
    wage: 14000,
    labor: { availability: 8000, note: { tr: "Deneyimli çobanlar, küçük nüfus", en: "Experienced herders, small population" } },
    sectorYieldBp: { livestock: 12000, crop: 9500 },
    priceBp: { ...flat(10300), raw_milk: 9000, cheese: 9500, packaged_milk: 9800, fodder: 10600 },
    landPriceBp: 8500,
  },
  {
    id: "demirdag",
    name: { tr: "Demirdağ", en: "Demirdag" },
    blurb: {
      tr: "Maden kenti. Demir ve kömür yatakları, ucuz enerji; su pahalı, ücretler yüksek.",
      en: "Mining town. Iron and coal deposits, cheap energy; expensive water, high wages.",
    },
    map: { x: 60, z: 230 },
    color: "#8a5a44",
    energyPrice: 250,
    waterPrice: 3000,
    wage: 20000,
    labor: { availability: 7000, note: { tr: "Zorlu koşullar, deneyimli madenciler", en: "Harsh conditions, veteran miners" } },
    sectorYieldBp: { mining: 11500, manufacturing: 10000, crop: 8000, livestock: 8500 },
    priceBp: { ...flat(10800), iron_ore: 8500, coal: 8500, steel: 9500 },
    landPriceBp: 9000,
  },
  {
    id: "kavsak",
    name: { tr: "Kavşak", en: "Kavsak" },
    blurb: {
      tr: "Ülkenin ortasında lojistik merkezi. Her şehre kısa yol, garajlar ucuz, santral kömür alır.",
      en: "Logistics hub in the middle. Short roads everywhere, cheap garages, the power plant buys coal.",
    },
    map: { x: 110, z: 90 },
    color: "#7b4fc9",
    energyPrice: 400,
    waterPrice: 1500,
    wage: 15000,
    labor: { availability: 10000, note: { tr: "Sürücü ve depo işçisi bol", en: "Plenty of drivers and warehouse staff" } },
    sectorYieldBp: { freight: 10000 },
    priceBp: { ...flat(10000), coal: 10500, steel: 10200 },
    landPriceBp: 10000,
  },
];

/** Yol mesafeleri (km), simetrik */
const ROADS: Array<[string, string, number]> = [
  ["korfezkent", "kavsak", 120],
  ["kavsak", "yesilova", 90],
  ["kavsak", "akyayla", 110],
  ["kavsak", "demirdag", 150],
  ["korfezkent", "yesilova", 180],
  ["korfezkent", "akyayla", 230],
  ["korfezkent", "demirdag", 250],
  ["yesilova", "akyayla", 70],
  ["yesilova", "demirdag", 210],
  ["akyayla", "demirdag", 190],
];

export function roadDistanceKm(a: string, b: string): number {
  if (a === b) return 0;
  for (const [x, y, d] of ROADS) {
    if ((x === a && y === b) || (x === b && y === a)) return d;
  }
  throw new Error(`Bilinmeyen yol: ${a}-${b}`);
}

export const ROAD_LIST = ROADS;
