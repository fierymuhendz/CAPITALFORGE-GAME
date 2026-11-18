import type { FacilityType } from "./facilities";

export const PRODUCT_IDS = ["wheat", "iron", "energy", "flour", "steel"] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** Ayarlanabilir ekonomi parametreleri. Formüllere sayı gömülmez, buradan okunur. */
export const PARAMS = {
  /** Yeni oyuncuya verilen başlangıç parası (kuruş). Para kaynağıdır (system:mint). */
  startingBalance: 10_000_000n,
  /** Arz-talep dengesizliğine fiyat tepkisi (bp, tick başına en fazla). */
  maxPriceStepBps: 300n,
  /** Alış/satış fiyatına her iki yönde uygulanan spread (bp). Round-trip kârını kapatır. */
  spreadBps: 150n,
  /** İşlem vergisi (bp). Para yutağıdır. */
  transactionTaxBps: 50n,
  /** Likidite: büyüdükçe tek bir emrin fiyata etkisi azalır (birim cinsinden). */
  liquidity: 100n,
  /** Asgari fiyat (kuruş). Fiyat sıfıra inemez. */
  minPrice: 1n,
  /** Azami fiyat (kuruş). */
  maxPrice: 10n ** 12n,

  /** Oyuncu başına ürün başına kayan pencerede azami işlem adedi (alım+satım). Gevşek güvenlik ağı: asıl sınır ortak havuzdur. */
  maxPlayerVolumePerWindow: 50_000n,
  /** Hacim penceresi uzunluğu (tick). */
  volumeWindowTicks: 3_600n,

  // --- Şirket ve üretim ---
  /** Şirket kuruluş ücreti (kuruş, tek sefer). Yutak: system:fees. */
  companyFoundingFee: 500_000n,
  /** Tür bazlı ilk tesis fiyatı (kuruş). */
  facilityBasePrice: {
    farm: 1800000n,
    mine: 2200000n,
    power_plant: 2500000n,
    mill: 1800000n,
    steelworks: 2400000n,
  } satisfies Record<FacilityType, bigint>,
  /** Sahip olunan her tesis için sıradaki tesis fiyatının bileşik artışı (bp). */
  facilityGrowthBps: 2_000n,
  maxFacilitiesPerCompany: 20n,
  /** Bir işteki en fazla batch sayısı (shared zod şemasıyla aynı: 1..10). */
  maxBatchesPerJob: 10n,
  /** Bakım dönemi uzunluğu (tick; 1 tick = 1 sn). */
  upkeepPeriodTicks: 3_600n,
  /** Tür bazlı dönem başına bakım (kuruş), seviye ile çarpılır. */
  upkeepBase: {
    farm: 1800n,
    mine: 2200n,
    power_plant: 2100n,
    mill: 1800n,
    steelworks: 2300n,
  } satisfies Record<FacilityType, bigint>,

  // --- Asgari ödenek ---
  /** Nakit + envanter değeri bunun altındaysa (ve tesisi yoksa) ödenek alınabilir. */
  reliefThreshold: 1_500_000n,
  reliefAmount: 400_000n,
  reliefCooldownTicks: 86_400n,

  // --- Ortak piyasa havuzu (src/pool.ts) ---
  /** Ürün başına hedef havuz derinliği (birim). Büyüdükçe emir etkisi küçülür, günlük para tavanı artar. */
  poolDepth: {
    wheat: 14000n,
    iron: 7000n,
    energy: 7000n,
    flour: 9000n,
    steel: 3500n,
  } satisfies Record<ProductId, bigint>,
  /** Tick başına yenilenme oranı (ppm): havuz her tick hedefe bu kesir kadar yaklaşır. */
  poolReplenishPpm: 150n,
  /** Tek emirde azami adet, havuz rezervinin kesri (bp). */
  poolMaxOrderBps: 1_000n,

  // --- Fiyatlar ve NPC ---
  /** Yeni ürünlerin başlangıç fiyatı (kuruş) ve diğerleri için referans. */
  initialPrice: {
    wheat: 560n,
    iron: 2300n,
    energy: 4000n,
    flour: 1650n,
    steel: 7600n,
  } satisfies Record<ProductId, bigint>,
  /** NPC'nin fiyatı çektiği referans fiyat (kuruş). */
  refPrice: {
    wheat: 560n,
    iron: 2300n,
    energy: 4000n,
    flour: 1650n,
    steel: 7600n,
  } satisfies Record<ProductId, bigint>,
  /** NPC'nin referans fiyatta tick başına alım ve satım birimi (her biri). */
  npcBase: {
    wheat: 50n,
    iron: 40n,
    energy: 50n,
    flour: 40n,
    steel: 40n,
  } satisfies Record<ProductId, bigint>,
  /** NPC tepki eğimi (bp): %1 sapma, talep/arzı base'in slope/10000 × %1'i kadar kaydırır. */
  npcSlopeBps: 30_000n,
} as const;
