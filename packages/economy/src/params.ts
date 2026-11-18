/** Ayarlanabilir ekonomi parametreleri. Formüllere sayı gömülmez, buradan okunur. */
export const PARAMS = {
  /** Arz-talep dengesizliğine fiyat tepkisi (bp, tick başına en fazla). */
  maxPriceStepBps: 500n,
  /** İşlem vergisi (bp). Para yutağıdır. */
  transactionTaxBps: 100n,
  /** Asgari fiyat (kuruş). Fiyat sıfıra inemez. */
  minPrice: 1n,
} as const;
