import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PlaceOrderSchema, UsernameSchema } from "./index";

const valid = () => ({
  side: "buy" as const,
  productId: "wheat",
  quantity: 10,
  idempotencyKey: randomUUID(),
});

describe("PlaceOrderSchema", () => {
  it("geçerli emri kabul eder", () => {
    expect(PlaceOrderSchema.safeParse(valid()).success).toBe(true);
  });

  it("miktar sınırları: 1 ve 1_000_000 kabul, 0 ve 1_000_001 reddedilir", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 1 }).success).toBe(true);
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 1_000_000 }).success).toBe(true);
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 0 }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 1_000_001 }).success).toBe(false);
  });

  it("negatif miktar reddedilir", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: -1 }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: -1_000 }).success).toBe(false);
  });

  it("ondalıklı miktar reddedilir", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 1.5 }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 0.1 + 0.2 }).success).toBe(false);
  });

  it("aşırı büyük miktar (güvenli tam sayı dışı) reddedilir", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: Number.MAX_SAFE_INTEGER }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: 1e21 }).success).toBe(false);
  });

  it("miktar string olarak gelirse reddedilir (tip sıkı)", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), quantity: "10" }).success).toBe(false);
  });

  it("UUID olmayan idempotencyKey reddedilir", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), idempotencyKey: "anahtar-1" }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), idempotencyKey: "" }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), idempotencyKey: undefined }).success).toBe(false);
  });

  it("fazladan fiyat alanı reddedilir (fiyat yalnızca sunucuda belirlenir)", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), price: "1" }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), unitPrice: "1" }).success).toBe(false);
  });

  it("geçersiz taraf ve boş ürün kimliği reddedilir", () => {
    expect(PlaceOrderSchema.safeParse({ ...valid(), side: "short" }).success).toBe(false);
    expect(PlaceOrderSchema.safeParse({ ...valid(), productId: "" }).success).toBe(false);
  });
});

describe("UsernameSchema", () => {
  it("3-20 karakter harf/rakam/alt çizgi kabul eder", () => {
    expect(UsernameSchema.safeParse("abc").success).toBe(true);
    expect(UsernameSchema.safeParse("a".repeat(20)).success).toBe(true);
    expect(UsernameSchema.safeParse("Kaan_01").success).toBe(true);
  });

  it("2 ve 21 karakter, boşluk ve tire reddedilir", () => {
    expect(UsernameSchema.safeParse("ab").success).toBe(false);
    expect(UsernameSchema.safeParse("a".repeat(21)).success).toBe(false);
    expect(UsernameSchema.safeParse("a b c").success).toBe(false);
    expect(UsernameSchema.safeParse("ab-cd").success).toBe(false);
  });
});
