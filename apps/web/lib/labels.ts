import type { ActionErrorCode, FacilityTypeId, OrderErrorCode, RecipeIdString } from "@capitalforge/shared";

export const PRODUCT_LABELS: Record<string, string> = {
  wheat: "Buğday",
  iron: "Demir",
  energy: "Enerji",
  flour: "Un",
  steel: "Çelik",
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
  VOLUME_LIMIT: "Bu ürün için saatlik işlem hacmi sınırına ulaştınız. Biraz sonra yeniden deneyin.",
  ORDER_TOO_LARGE: "Emir piyasa derinliğine göre çok büyük, daha küçük parçalara bölün.",
  INTERNAL: "Sunucu hatası. Tekrar deneyebilirsiniz.",
};

/** Aynı anahtarla yeniden denemenin güvenli ve anlamlı olduğu hatalar. */
export const RETRYABLE: ReadonlySet<OrderErrorCode> = new Set(["RATE_LIMITED", "INTERNAL"]);

export const FACILITY_LABELS: Record<FacilityTypeId, string> = {
  farm: "Çiftlik",
  mine: "Maden",
  power_plant: "Santral",
  mill: "Değirmen",
  steelworks: "Çelikhane",
};

/** Renk tek bilgi kaynağı olmasın diye ızgarada tür harfi gösterilir. */
export const FACILITY_GLYPH: Record<FacilityTypeId, string> = {
  farm: "Ç",
  mine: "M",
  power_plant: "S",
  mill: "D",
  steelworks: "K",
};

export const RECIPE_LABELS: Record<RecipeIdString, string> = {
  grow_wheat: "Buğday yetiştir",
  mine_iron: "Demir çıkar",
  generate_energy: "Enerji üret",
  mill_flour: "Un öğüt",
  smelt_steel: "Çelik üret",
};

export function facilityLabel(t: string): string {
  return (FACILITY_LABELS as Record<string, string>)[t] ?? t;
}
export function recipeLabel(r: string): string {
  return (RECIPE_LABELS as Record<string, string>)[r] ?? r;
}

export const ACTION_ERROR_TEXT: Record<ActionErrorCode, string> = {
  INVALID: "Geçersiz istek. Girdileri kontrol edin.",
  UNAUTHORIZED: "Oturum geçersiz. Yeniden giriş yapın.",
  RATE_LIMITED: "Çok hızlı işlem yapıyorsunuz. Biraz bekleyip tekrar deneyin.",
  NO_COMPANY: "Önce bir şirket kurmalısınız.",
  COMPANY_EXISTS: "Zaten bir şirketiniz var.",
  NAME_TAKEN: "Bu şirket adı alınmış, başka bir ad seçin.",
  PLOT_TAKEN: "Bu arsa az önce satıldı. Başka bir arsa seçin.",
  FACILITY_LIMIT: "Tesis sınırına ulaştınız.",
  FACILITY_BUSY: "Bu tesiste zaten bir üretim sürüyor.",
  FACILITY_SUSPENDED: "Tesis askıda: bakım ücreti ödenemedi. Bakiye yeterli olunca yeniden etkinleşir.",
  UNKNOWN_RECIPE: "Bilinmeyen tarif.",
  RECIPE_FACILITY_MISMATCH: "Bu tarif bu tesis türünde üretilemez.",
  INSUFFICIENT_FUNDS: "Yetersiz bakiye.",
  INSUFFICIENT_INVENTORY: "Yetersiz envanter: tarifin girdileri eksik.",
  NOT_ELIGIBLE: "Şu an ödenek almaya uygun değilsiniz.",
  IDEMPOTENCY_MISMATCH: "Bu istek anahtarı farklı bir işlemle kullanılmış. İşlemi yeniden başlatın.",
  INTERNAL: "Sunucu hatası. Tekrar deneyebilirsiniz.",
};

export const ACTION_RETRYABLE: ReadonlySet<ActionErrorCode> = new Set(["RATE_LIMITED", "INTERNAL"]);

/** Sunucu oyun saati: 1 tick = 1 saniye (sunucu sabitiyle aynı tutulmalı). Süre gösterimi tek yerden geçer. */
export const TICK_SECONDS = 1;

/** Tick sayısını okunur süreye çevirir: "2 sa 0 dk", "5 dk 30 sn", "45 sn". */
export function formatDuration(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks * TICK_SECONDS));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} sa ${m} dk`;
  if (m > 0) return `${m} dk ${s} sn`;
  return `${s} sn`;
}

/** Sunucudan gelen tam sayı dizgesini binlik ayraçla gösterir (hesap yapmaz). */
export function formatQuantity(q: string): string {
  return BigInt(q).toLocaleString("tr-TR");
}
