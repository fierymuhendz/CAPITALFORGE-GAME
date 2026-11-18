import type { OrderErrorCode } from "@capitalforge/shared";

export const PRODUCT_LABELS: Record<string, string> = {
  wheat: "Buğday",
  iron: "Demir",
  energy: "Enerji",
};

export function productLabel(id: string): string {
  return PRODUCT_LABELS[id] ?? id;
}

export const ORDER_ERROR_TEXT: Record<OrderErrorCode, string> = {
  INVALID: "Geçersiz emir. Miktarı kontrol edin.",
  UNAUTHORIZED: "Oturum geçersiz. Yeniden giriş yapın.",
  RATE_LIMITED: "Çok hızlı işlem yapıyorsunuz. Biraz bekleyip tekrar deneyin.",
  UNKNOWN_PRODUCT: "Bilinmeyen ürün.",
  INSUFFICIENT_FUNDS: "Yetersiz bakiye.",
  INSUFFICIENT_INVENTORY: "Yetersiz stok.",
  IDEMPOTENCY_MISMATCH: "Bu istek anahtarı farklı bir emirle kullanılmış. Emri yeniden gönderin.",
  INTERNAL: "Sunucu hatası. Tekrar deneyebilirsiniz.",
};

/** Aynı anahtarla yeniden denemenin güvenli ve anlamlı olduğu hatalar. */
export const RETRYABLE: ReadonlySet<OrderErrorCode> = new Set(["RATE_LIMITED", "INTERNAL"]);
