/** Ayarlanabilir ekonomi parametreleri. Formüllere sayı gömülmez, buradan okunur. */
export const PARAMS = {
  /** Yeni oyuncuya verilen başlangıç parası (kuruş). Para kaynağıdır (system:mint). */
  startingBalance: 1_000_000n,
  /** Arz-talep dengesizliğine fiyat tepkisi (bp, tick başına en fazla). */
  maxPriceStepBps: 300n,
  /** Alış/satış fiyatına her iki yönde uygulanan spread (bp). Round-trip kârını kapatır. */
  spreadBps: 150n,
  /** İşlem vergisi (bp). Para yutağıdır. */
  transactionTaxBps: 100n,
  /** Likidite: büyüdükçe tek bir emrin fiyata etkisi azalır (birim cinsinden). */
  liquidity: 1_000n,
  /** Asgari fiyat (kuruş). Fiyat sıfıra inemez. */
  minPrice: 1n,
  /** Azami fiyat (kuruş). */
  maxPrice: 10n ** 12n,
} as const;
