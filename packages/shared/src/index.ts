import { z } from "zod";

/** Colyseus oda adları */
export const ROOMS = { market: "market" } as const;

/** İstemci ↔ sunucu mesaj tipleri */
export const MSG = {
  /** istemci → sunucu */
  placeOrder: "placeOrder",
  /** sunucu → istemci */
  orderResult: "orderResult",
  /** sunucu → istemci: yalnızca ilgili oyuncunun bakiye ve envanteri */
  portfolio: "portfolio",
} as const;

/** Ürün kimlikleri (seed ile aynı). */
export const PRODUCT_IDS = ["wheat", "iron", "energy"] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/** Geçmiş fiyat uç noktasının döndürdüğü azami nokta sayısı. */
export const HISTORY_LIMIT = 300;

/** Para JSON'da kuruş cinsinden tam sayı string'idir (bigint'i kayıpsız taşır). */
export const MoneySchema = z.string().regex(/^-?\d{1,19}$/);
export type MoneyString = z.infer<typeof MoneySchema>;

/** Miktar (adet) JSON'da string'dir. */
export const QuantityStringSchema = z.string().regex(/^\d{1,19}$/);

export const UsernameSchema = z.string().regex(/^[a-zA-Z0-9_]{3,20}$/);

/* ---------- HTTP ---------- */

export const GuestLoginSchema = z.object({ username: UsernameSchema });
export type GuestLogin = z.infer<typeof GuestLoginSchema>;

export const GuestLoginResponseSchema = z.object({
  token: z.string().min(1),
  playerId: z.string().uuid(),
  username: UsernameSchema,
});
export type GuestLoginResponse = z.infer<typeof GuestLoginResponseSchema>;

export const InventoryItemSchema = z.object({
  productId: z.string(),
  quantity: QuantityStringSchema,
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const PortfolioSchema = z.object({
  balance: MoneySchema,
  inventory: z.array(InventoryItemSchema),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;

export const MeSchema = PortfolioSchema.extend({
  playerId: z.string().uuid(),
  username: UsernameSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const HistoryQuerySchema = z.object({ productId: z.string().min(1).max(64) });
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const PricePointSchema = z.object({
  tick: z.number().int().nonnegative(),
  price: MoneySchema,
  /** ISO 8601 */
  at: z.string(),
});
export type PricePoint = z.infer<typeof PricePointSchema>;

export const HistoryResponseSchema = z.object({
  productId: z.string(),
  points: z.array(PricePointSchema),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

/** HTTP hata gövdesi: iç ayrıntı içermez. */
export const ApiErrorSchema = z.object({
  error: z.enum(["INVALID", "UNAUTHORIZED", "USERNAME_TAKEN", "RATE_LIMITED", "UNKNOWN_PRODUCT", "INTERNAL"]),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ---------- Colyseus ---------- */

/**
 * İstemci sadece niyet gönderir: fiyat ve tutar göndermez.
 * Miktar pozitif, tam sayı ve makul bir üst sınırın altında olmalıdır.
 * idempotencyKey istemcide üretilir; yeniden denemede aynı anahtar kullanılır.
 */
export const PlaceOrderSchema = z.object({
  side: z.enum(["buy", "sell"]),
  productId: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(1_000_000),
  idempotencyKey: z.string().uuid(),
});
export type PlaceOrder = z.infer<typeof PlaceOrderSchema>;

export const ORDER_ERRORS = [
  "INVALID",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "UNKNOWN_PRODUCT",
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_INVENTORY",
  "IDEMPOTENCY_MISMATCH",
  "INTERNAL",
] as const;
export const OrderErrorCodeSchema = z.enum(ORDER_ERRORS);
export type OrderErrorCode = z.infer<typeof OrderErrorCodeSchema>;

/** Sunucu → istemci. Para değerleri kuruş cinsinden string'dir. */
export const OrderResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** Aynı anahtarla yeniden gelen istek: kayıtlı orijinal sonuç döner. */
    duplicate: z.boolean(),
    idempotencyKey: z.string().uuid(),
    tradeId: z.string().uuid(),
    side: z.enum(["buy", "sell"]),
    productId: z.string(),
    quantity: QuantityStringSchema,
    /** Gerçekleşen birim fiyat (spread dahil). */
    unitPrice: MoneySchema,
    gross: MoneySchema,
    tax: MoneySchema,
    /** İşlem sonrası oyuncu bakiyesi. */
    balance: MoneySchema,
  }),
  z.object({
    ok: z.literal(false),
    error: OrderErrorCodeSchema,
    idempotencyKey: z.string().uuid().optional(),
  }),
]);
export type OrderResult = z.infer<typeof OrderResultSchema>;
