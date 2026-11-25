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
}

const wholesale = (cityId: string, tr: string, en: string, buys: Record<string, number>, sells: Record<string, number>, dailyBudget: number): SystemProfile =>
  ({ companyKey: `wholesale_${cityId}`, name: { tr: `${tr} Toptan`, en: `${en} Wholesale` }, cityId, buys, sells, dailyBudget });

const coop = (cityId: string, tr: string, en: string, buys: Record<string, number>, dailyBudget: number): SystemProfile =>
  ({ companyKey: `coop_${cityId}`, name: { tr: `${tr} Tüketici Kooperatifi`, en: `${en} Consumer Co-op` }, cityId, buys, sells: {}, dailyBudget });

export const SYSTEM_PROFILES: SystemProfile[] = [
  wholesale("korfezkent", "Körfezkent", "Korfezkent", { raw_milk: 6000, grain: 6000 }, { seed: 3000, grain: 4000, raw_milk: 4000, fodder: 4000, iron_ore: 4000, coal: 4000 }, 12_000_000),
  wholesale("yesilova", "Yeşilova", "Yesilova", { fodder: 12000, grain: 12000 }, { seed: 6000, fodder: 6000, grain: 6000 }, 10_000_000),
  wholesale("akyayla", "Akyayla", "Akyayla", { raw_milk: 10000, fodder: 8000 }, { seed: 2000, fodder: 6000, raw_milk: 6000 }, 10_000_000),
  wholesale("demirdag", "Demirdağ", "Demirdag", { iron_ore: 20000, coal: 15000 }, { seed: 1000, iron_ore: 8000, coal: 8000, grain: 2000 }, 10_000_000),
  wholesale("kavsak", "Kavşak", "Kavsak", { grain: 6000, fodder: 6000, raw_milk: 4000 }, { seed: 3000, grain: 4000, fodder: 4000, raw_milk: 3000, iron_ore: 3000, coal: 3000 }, 10_000_000),
  coop("korfezkent", "Körfezkent", "Korfezkent", { flour: 12000, packaged_milk: 10000, cheese: 1500 }, 30_000_000),
  coop("kavsak", "Kavşak", "Kavsak", { flour: 6000, packaged_milk: 5000, cheese: 600 }, 14_000_000),
  coop("yesilova", "Yeşilova", "Yesilova", { packaged_milk: 3000, cheese: 300 }, 6_000_000),
  coop("akyayla", "Akyayla", "Akyayla", { flour: 3000 }, 4_000_000),
  coop("demirdag", "Demirdağ", "Demirdag", { flour: 4000, packaged_milk: 4000, cheese: 400 }, 9_000_000),
  { companyKey: "construction", name: { tr: "Ulusal İnşaat A.Ş.", en: "National Construction Inc." }, cityId: "korfezkent", buys: { steel: 15000 }, sells: { steel: 3000 }, dailyBudget: 30_000_000 },
  { companyKey: "construction_kavsak", name: { tr: "Ulusal İnşaat Kavşak", en: "National Construction Kavsak" }, cityId: "kavsak", buys: { steel: 8000 }, sells: { steel: 2000 }, dailyBudget: 15_000_000 },
  { companyKey: "power_plant", name: { tr: "Kavşak Termik Santrali", en: "Kavsak Power Station" }, cityId: "kavsak", buys: { coal: 20000 }, sells: {}, dailyBudget: 8_000_000 },
  { companyKey: "power_plant_demirdag", name: { tr: "Demirdağ Santrali", en: "Demirdag Power Station" }, cityId: "demirdag", buys: { coal: 10000 }, sells: {}, dailyBudget: 3_000_000 },
];

/** Sistem taşımacısı (tek şirket, şehir başına araç) */
export const SYSTEM_CARRIER = {
  companyKey: "carrier",
  name: { tr: "Anadolu Lojistik", en: "Anatolia Logistics" },
  trucksPerCity: 2,
};

/** Sistemin taşımacılara açtığı günlük taşıma işi sayısı (şehir başına) */
export const SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY = 4;
