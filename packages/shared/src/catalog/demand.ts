import type { Industry } from "./types";
import { V4_BASIC_SUPPLY } from "./v4-products";
import { V4_PRODUCTS } from "./products";
import { V4_RECIPES } from "./v4-recipes";
/**
 * Sistem şirketlerinin günlük talep ve arz profili (kg/gün), oyuncu yokken ekonominin çalışması için.
 * Gerçek miktar oyuncu payına göre azalır (DEFAULT_SETTINGS.system.shareDampBp).
 */
export interface SystemProfile {
  companyKey: string;
  name: { tr: string; en: string };
  cityId: string;
  /** ürün → günlük alım kg */
  buys: Record<string, number>;
  /** ürün → günlük satış kg */
  sells: Record<string, number>;
  /** günlük bütçe (kuruş) */
  dailyBudget: number;
  /** sistem alış oranı (bp); yoksa settings.system.bidBp. Ara mal ofisleri daha düşük teklif verir. */
  bidBp?: number;
}

const wholesale = (cityId: string, tr: string, en: string, buys: Record<string, number>, sells: Record<string, number>, dailyBudget: number): SystemProfile =>
  ({ companyKey: `wholesale_${cityId}`, name: { tr: `${tr} Toptan`, en: `${en} Wholesale` }, cityId, buys, sells, dailyBudget });

const coop = (cityId: string, tr: string, en: string, buys: Record<string, number>, dailyBudget: number): SystemProfile =>
  ({ companyKey: `coop_${cityId}`, name: { tr: `${tr} Tüketici Kooperatifi`, en: `${en} Consumer Co-op` }, cityId, buys, sells: {}, dailyBudget });

export const SYSTEM_PROFILES: SystemProfile[] = [
  wholesale("korfezkent", "Körfezkent", "Korfezkent", { raw_milk: 9000, grain: 7200 }, { seed: 3000, grain: 4000, raw_milk: 4000, fodder: 4000, iron_ore: 4000, coal: 4000 }, 13_500_000),
  wholesale("yesilova", "Yeşilova", "Yesilova", { fodder: 18000, grain: 14400 }, { seed: 6000, fodder: 6000, grain: 6000 }, 12_500_000),
  wholesale("akyayla", "Akyayla", "Akyayla", { raw_milk: 15000, fodder: 12000 }, { seed: 2000, fodder: 6000, raw_milk: 6000 }, 17_000_000),
  wholesale("demirdag", "Demirdağ", "Demirdag", { iron_ore: 60000, coal: 22500 }, { seed: 1000, iron_ore: 8000, coal: 8000, grain: 2000 }, 23_000_000),
  wholesale("kavsak", "Kavşak", "Kavsak", { grain: 7200, fodder: 9000, raw_milk: 6000 }, { seed: 3000, grain: 4000, fodder: 4000, raw_milk: 3000, iron_ore: 3000, coal: 3000 }, 13_000_000),
  coop("korfezkent", "Körfezkent", "Korfezkent", { flour: 12000, packaged_milk: 10000, cheese: 1800 }, 70_000_000),
  coop("kavsak", "Kavşak", "Kavsak", { flour: 6000, packaged_milk: 5000, cheese: 720 }, 29_000_000),
  coop("yesilova", "Yeşilova", "Yesilova", { packaged_milk: 3000, cheese: 360 }, 11_000_000),
  coop("akyayla", "Akyayla", "Akyayla", { flour: 3000 }, 5_000_000),
  coop("demirdag", "Demirdağ", "Demirdag", { flour: 4000, packaged_milk: 4000, cheese: 480 }, 22_000_000),
  { companyKey: "construction", name: { tr: "Ulusal İnşaat A.Ş.", en: "National Construction Inc." }, cityId: "korfezkent", buys: { steel: 12000 }, sells: { steel: 3000 }, dailyBudget: 28_000_000 },
  { companyKey: "construction_kavsak", name: { tr: "Ulusal İnşaat Kavşak", en: "National Construction Kavsak" }, cityId: "kavsak", buys: { steel: 6400 }, sells: { steel: 2000 }, dailyBudget: 14_000_000 },
  { companyKey: "power_plant", name: { tr: "Kavşak Termik Santrali", en: "Kavsak Power Station" }, cityId: "kavsak", buys: { coal: 30000 }, sells: {}, dailyBudget: 11_500_000 },
  { companyKey: "power_plant_demirdag", name: { tr: "Demirdağ Santrali", en: "Demirdag Power Station" }, cityId: "demirdag", buys: { coal: 15000 }, sells: {}, dailyBudget: 5_500_000 },
];

// ── v4: iş kollarına göre bütçeli tüketim, ara mal alım ofisleri ve temel girdi arzı
const CITY_NAMES: Record<string, [string, string]> = {
  korfezkent: ["Körfezkent", "Korfezkent"], yesilova: ["Yeşilova", "Yesilova"], akyayla: ["Akyayla", "Akyayla"],
  demirdag: ["Demirdağ", "Demirdag"], kavsak: ["Kavşak", "Kavsak"],
};
/** iş kolu → nihai malın tüketildiği iki şehir (taze ürün üretildiği ovadan uzakta tüketilir) */
export const INDUSTRY_MARKETS: Record<Industry, [string, string]> = {
  field_crops: ["korfezkent", "demirdag"], feed: ["akyayla", "yesilova"], livestock: ["korfezkent", "kavsak"],
  dairy_food: ["korfezkent", "kavsak"], textile: ["korfezkent", "kavsak"], forestry: ["kavsak", "korfezkent"],
  packaging: ["korfezkent", "kavsak"], mining_metal: ["demirdag", "korfezkent"], glass_ceramic: ["korfezkent", "demirdag"],
  construction: ["korfezkent", "demirdag"], machinery: ["demirdag", "kavsak"], logistics: ["kavsak", "korfezkent"],
  chemicals: ["korfezkent", "demirdag"],
};
/** ara malın sanayi alım ofisi (tek şehir: o malı kullanan sanayinin yanında) */
const INTERMEDIATE_OFFICE: Record<Industry, string> = {
  field_crops: "yesilova", feed: "akyayla", livestock: "akyayla", dairy_food: "korfezkent", textile: "kavsak", forestry: "kavsak",
  packaging: "korfezkent", mining_metal: "demirdag", glass_ceramic: "demirdag", construction: "demirdag", machinery: "demirdag",
  logistics: "kavsak", chemicals: "korfezkent",
};
const CONSUMER_INDUSTRIES = new Set<Industry>(["field_crops", "livestock", "dairy_food", "textile"]);
const CONSUMER_IDS = new Set(["furniture", "paper_towel", "notebook", "charcoal", "tableware", "soap", "detergent", "candle"]);

/** nihai mal: şehir başına günlük tüketim bütçesi (₺) → kg = bütçe / (fiyat × 0,85) */
export const V4_DEMAND_BUDGET = { consumerTl: 18_000, industrialTl: 15_000, intermediateBatchShareBp: 2500, intermediateBidBp: 7500, supplyBatches: 1.5 } as const;

const round10 = (v: number) => Math.max(20, Math.round(v / 10) * 10);

function buildV4Profiles(): SystemProfile[] {
  const byId = new Map(V4_PRODUCTS.map((p) => [p.id, p]));
  const batchOut = (pid: string) => V4_RECIPES.find((r) => r.output.productId === pid && !r.research)?.output.kg ?? 1000;
  const retail = new Map<string, Record<string, number>>();
  const industry = new Map<string, Record<string, number>>();
  const supply = new Map<string, Record<string, number>>();
  const add = (m: Map<string, Record<string, number>>, city: string, pid: string, kg: number) => {
    const r = m.get(city) ?? {};
    r[pid] = (r[pid] ?? 0) + kg;
    m.set(city, r);
  };
  for (const p of V4_PRODUCTS) {
    const ind = p.industry!;
    if (p.stage === "final") {
      const consumer = CONSUMER_INDUSTRIES.has(ind) || CONSUMER_IDS.has(p.id);
      const tl = consumer ? V4_DEMAND_BUDGET.consumerTl : V4_DEMAND_BUDGET.industrialTl;
      const kg = round10((tl * 100) / (p.basePricePerKg * 0.85));
      for (const c of INDUSTRY_MARKETS[ind]) add(consumer ? retail : industry, c, p.id, kg);
    } else {
      add(industry, INTERMEDIATE_OFFICE[ind], p.id, round10((batchOut(p.id) * V4_DEMAND_BUDGET.intermediateBatchShareBp) / 10000));
    }
  }
  for (const [city, ids] of Object.entries(V4_BASIC_SUPPLY)) {
    for (const id of ids) if (byId.has(id)) add(supply, city, id, round10(batchOut(id) * V4_DEMAND_BUDGET.supplyBatches));
  }
  const value = (buys: Record<string, number>, bp: number) =>
    Math.round(Object.entries(buys).reduce((a, [pid, kg]) => a + kg * byId.get(pid)!.basePricePerKg * bp / 10000, 0) / 100_000) * 100_000;
  const out: SystemProfile[] = [];
  for (const city of Object.keys(CITY_NAMES)) {
    const [tr, en] = CITY_NAMES[city]!;
    const r = retail.get(city);
    if (r) out.push({ companyKey: `retail_${city}`, name: { tr: `${tr} Perakende Zinciri`, en: `${en} Retail Chain` }, cityId: city, buys: r, sells: {}, dailyBudget: value(r, 11000) });
    const i = industry.get(city);
    if (i) out.push({ companyKey: `industry_${city}`, name: { tr: `${tr} Sanayi Alım Ofisi`, en: `${en} Industrial Purchasing` }, cityId: city, buys: i, sells: {}, dailyBudget: value(i, 11000) });
    const s = supply.get(city);
    if (s) out.push({ companyKey: `supply_${city}`, name: { tr: `${tr} Hammadde Deposu`, en: `${en} Raw Materials Depot` }, cityId: city, buys: {}, sells: s, dailyBudget: 2_000_000 });
  }
  return out;
}

/** Ara mal alım fiyatı ofis bazında değil ürün bazında düşüktür: sanayi ofisi ara mallara intermediateBidBp, nihai mallara varsayılan teklif verir. */
export function profileBidBp(p: SystemProfile, productId: string, defaultBp: number): number {
  if (!p.companyKey.startsWith("industry_")) return p.bidBp ?? defaultBp;
  const prod = V4_PRODUCTS.find((x) => x.id === productId);
  return prod && prod.stage !== "final" ? V4_DEMAND_BUDGET.intermediateBidBp : defaultBp;
}

export const V4_SYSTEM_PROFILES: SystemProfile[] = buildV4Profiles();
SYSTEM_PROFILES.push(...V4_SYSTEM_PROFILES);

/** Sistem taşımacısı (tek şirket, şehir başına araç) */
export const SYSTEM_CARRIER = {
  companyKey: "carrier",
  name: { tr: "Anadolu Lojistik", en: "Anatolia Logistics" },
  trucksPerCity: 2,
};

/** Sistemin taşımacılara açtığı günlük taşıma işi sayısı (şehir başına) */
export const SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY = 9;
