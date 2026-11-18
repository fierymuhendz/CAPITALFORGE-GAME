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

  /** Oyuncu başına ürün başına kayan pencerede azami işlem adedi (alım+satım). */
  maxPlayerVolumePerWindow: 2_000n,
  /** Hacim penceresi uzunluğu (tick). */
  volumeWindowTicks: 3_600n,

  // --- Şirket ve üretim ---
  /** Şirket kuruluş ücreti (kuruş, tek sefer). Yutak: system:fees. */
  companyFoundingFee: 500_000n,
  /** Tür bazlı ilk tesis fiyatı (kuruş). */
  facilityBasePrice: {
    farm: 5_000_000n,
    mine: 2_500_000n,
    power_plant: 5_000_000n,
    mill: 2_000_000n,
    steelworks: 1_750_000n,
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
    farm: 2_000n,
    mine: 1_000n,
    power_plant: 2_000n,
    mill: 800n,
    steelworks: 700n,
  } satisfies Record<FacilityType, bigint>,

  // --- Asgari ödenek ---
  /** Nakit + envanter değeri bunun altındaysa (ve tesisi yoksa) ödenek alınabilir. */
  reliefThreshold: 1_500_000n,
  reliefAmount: 400_000n,
  reliefCooldownTicks: 86_400n,

  // --- Fiyatlar ve NPC ---
  /** Yeni ürünlerin başlangıç fiyatı (kuruş) ve diğerleri için referans. */
  initialPrice: {
    wheat: 500n,
    iron: 600n,
    energy: 500n,
    flour: 900n,
    steel: 1_500n,
  } satisfies Record<ProductId, bigint>,
  /** NPC'nin fiyatı çektiği referans fiyat (kuruş). */
  refPrice: {
    wheat: 500n,
    iron: 600n,
    energy: 500n,
    flour: 900n,
    steel: 1_500n,
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
