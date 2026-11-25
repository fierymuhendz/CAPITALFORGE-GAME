/** Paneller arası tek seferlik yönlendirme niyeti (ör. depodan "Piyasada sat"). */
export interface MarketIntent { productId: string; cityId: string; side?: "sell" | "buy"; quality?: number }
let pending: MarketIntent | null = null;
export const setMarketIntent = (i: MarketIntent | null): void => { pending = i; };
export function takeMarketIntent(): MarketIntent | null { const p = pending; pending = null; return p; }
