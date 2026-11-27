/** Paneller arası tek seferlik yönlendirme niyeti (ör. depodan "Piyasada sat"). */
/** `returnTo`: eksik girdiyi almaya gelen oyuncuyu aynı tesis ve tarife geri götürür. */
export interface MarketIntent { productId: string; cityId: string; side?: "sell" | "buy"; quality?: number; qtyKg?: number; returnTo?: { facilityId: string; name: string; recipeId: string } }
let pending: MarketIntent | null = null;
export const setMarketIntent = (i: MarketIntent | null): void => { pending = i; };
export function takeMarketIntent(): MarketIntent | null { const p = pending; pending = null; return p; }

/** Pazar → Lojistik: "Oraya gönder" için yük ve rota ön dolumu. */
export interface ShipIntent { fromCityId: string; destCityId: string; productId: string; quality: number; qtyKg: number }
let pendingShip: ShipIntent | null = null;
export const setShipIntent = (i: ShipIntent | null): void => { pendingShip = i; };
export function takeShipIntent(): ShipIntent | null { const p = pendingShip; pendingShip = null; return p; }
export const peekShipIntent = (): ShipIntent | null => pendingShip;

/** Depodan/panodan pazara "Sat": seçim URL'de de taşınır (yenilemede ve geri dönüşte korunur). */
export function sellParams(h: { productId: string; cityId: string; quality: number; availableKg: number }): Record<string, string> {
  return { side: "sell", product: h.productId, city: h.cityId, quality: String(h.quality), qty: String(h.availableKg) };
}
