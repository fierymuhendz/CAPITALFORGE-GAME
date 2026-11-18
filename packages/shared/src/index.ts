import { z } from "zod";

/** Colyseus oda adları */
export const ROOMS = { market: "market" } as const;

/** İstemci → sunucu mesaj tipleri */
export const MSG = { placeOrder: "placeOrder" } as const;

/**
 * İstemci sadece niyet gönderir: fiyat ve tutar göndermez.
 * Miktar pozitif, tam sayı ve makul bir üst sınırın altında olmalıdır.
 */
export const PlaceOrderSchema = z.object({
  side: z.enum(["buy", "sell"]),
  productId: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(1_000_000),
  idempotencyKey: z.string().uuid(),
});
export type PlaceOrder = z.infer<typeof PlaceOrderSchema>;

/** Sunucu → istemci: para değerleri bigint'i kayıpsız taşımak için string'dir (kuruş). */
export const OrderResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  balance: z.string().optional(),
});
export type OrderResult = z.infer<typeof OrderResultSchema>;
