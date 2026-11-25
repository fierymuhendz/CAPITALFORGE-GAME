/**
 * Denge ayarları. Varsayılanlar burada; canlıdaki değerler veritabanındaki `settings`
 * satırlarıdır ve yönetici panelinden değiştirilir (denetim kaydıyla).
 * Para kuruş, oranlar baz puan (bp, 10000 = %100).
 */
export const DEFAULT_SETTINGS = {
  startingCash: 15_000_000,
  /** ilk işi garanti eden bağış girdileri (sektöre göre) */
  starterInputs: {
    crop: [{ productId: "seed", kg: 400 }],
    livestock: [{ productId: "fodder", kg: 3000 }],
    mining: [],
    manufacturing_food_plant: [{ productId: "grain", kg: 2000 }],
    manufacturing_steel_mill: [{ productId: "iron_ore", kg: 2000 }, { productId: "coal", kg: 1000 }],
    freight: [],
  } as Record<string, Array<{ productId: string; kg: number }>>,
  marketFeeBp: 100,
  /** seviye eşikleri (deneyim puanı): index = seviye−1 */
  levelXp: [0, 120, 400, 1000, 2200],
  xp: { productionJob: 10, delivery: 15, contractInstallment: 25, freightJob: 20, perRevenue100k: 4, minInstallmentValue: 500_000, minJobValue: 100_000 },
  loan: {
    /** seviye başına limit (kuruş) */
    limitPerLevel: 10_000_000,
    dailyInterestBp: 40,
    termsDays: [3, 7, 14],
    lateFeeBp: 200,
  },
  contracts: {
    minPenaltyBp: 500,
    maxPenaltyBp: 5000,
    defaultGraceHours: 2,
    lateFeeBp: 1000,
    windowHoursBeforeDue: 12,
  },
  freight: {
    /** sistem taşımacısı ücret tarifesi: kalkış ücreti + km başına (kamyon dolusu) */
    systemBaseFee: 45_000,
    systemPerKm: 3200,
    systemPickupAfterMinutes: 120,
    driverHoursPerTrip: 1,
  },
  system: {
    /** sistem alış fiyatı = referans × bidBp; sistem satış = referans × askBp */
    bidBp: 8500,
    askBp: 12000,
    /** oyuncu payı arttıkça sistem bütçesi azalır: bütçe × (1 − pay × shareDampBp) */
    shareDampBp: 8000,
    unsoldListingHours: 6,
    unfilledOrderHours: 3,
    reputationPremiumBp: 500,
  },
  anomaly: { thresholdBp: 3500, minComparables: 5, windowHours: 72 },
  ipRetentionDays: 30,
  /** şirket kapatıldıktan sonra yeniden kurma bekleme süresi (saat) */
  refoundCooldownHours: 72,
  newAccountTradeDelaySeconds: 0,
} as const;

export type Settings = typeof DEFAULT_SETTINGS;
