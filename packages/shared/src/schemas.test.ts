import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BuyFacilitySchema,
  ClaimReliefSchema,
  CompanyNameSchema,
  FoundCompanySchema,
  PlaceOrderSchema,
  StartProductionSchema,
  UsernameSchema,
} from "./index";

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

describe("BuyFacilitySchema", () => {
  const ok = () => ({ type: "farm" as const, plotX: 0, plotY: 0, idempotencyKey: randomUUID() });

  it("geçerli girdiyi kabul eder", () => {
    expect(BuyFacilitySchema.safeParse(ok()).success).toBe(true);
  });

  it("arsa sınırları 0..15: dışındaki x ve y reddedilir", () => {
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotX: 15, plotY: 15 }).success).toBe(true);
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotX: 16 }).success).toBe(false);
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotX: -1 }).success).toBe(false);
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotY: 16 }).success).toBe(false);
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotY: -1 }).success).toBe(false);
  });

  it("tam sayı olmayan ve string arsa koordinatı reddedilir", () => {
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotX: 1.5 }).success).toBe(false);
    expect(BuyFacilitySchema.safeParse({ ...ok(), plotY: "2" }).success).toBe(false);
  });

  it("fazladan alan (ör. fiyat, sahip) reddedilir", () => {
    expect(BuyFacilitySchema.safeParse({ ...ok(), price: "1" }).success).toBe(false);
    expect(BuyFacilitySchema.safeParse({ ...ok(), companyId: randomUUID() }).success).toBe(false);
  });

  it("uuid olmayan idempotencyKey ve bilinmeyen tür reddedilir", () => {
    expect(BuyFacilitySchema.safeParse({ ...ok(), idempotencyKey: "anahtar-1" }).success).toBe(false);
    expect(BuyFacilitySchema.safeParse({ ...ok(), type: "castle" }).success).toBe(false);
  });
});

describe("StartProductionSchema", () => {
  const ok = () => ({
    facilityId: randomUUID(),
    recipeId: "grow_wheat" as const,
    batches: 1,
    idempotencyKey: randomUUID(),
  });

  it("geçerli girdiyi kabul eder", () => {
    expect(StartProductionSchema.safeParse(ok()).success).toBe(true);
  });

  it("batch sınırları 1..10: 0 ve 11 reddedilir, 1 ve 10 kabul edilir", () => {
    expect(StartProductionSchema.safeParse({ ...ok(), batches: 1 }).success).toBe(true);
    expect(StartProductionSchema.safeParse({ ...ok(), batches: 10 }).success).toBe(true);
    expect(StartProductionSchema.safeParse({ ...ok(), batches: 0 }).success).toBe(false);
    expect(StartProductionSchema.safeParse({ ...ok(), batches: 11 }).success).toBe(false);
    expect(StartProductionSchema.safeParse({ ...ok(), batches: -1 }).success).toBe(false);
    expect(StartProductionSchema.safeParse({ ...ok(), batches: 1.5 }).success).toBe(false);
  });

  it("uuid olmayan facilityId ve idempotencyKey reddedilir", () => {
    expect(StartProductionSchema.safeParse({ ...ok(), facilityId: "tesis-1" }).success).toBe(false);
    expect(StartProductionSchema.safeParse({ ...ok(), facilityId: "" }).success).toBe(false);
    expect(StartProductionSchema.safeParse({ ...ok(), idempotencyKey: "x" }).success).toBe(false);
  });

  it("bilinmeyen tarif ve fazladan alan (ör. outputQty) reddedilir", () => {
    expect(StartProductionSchema.safeParse({ ...ok(), recipeId: "print_money" }).success).toBe(false);
    expect(StartProductionSchema.safeParse({ ...ok(), outputQty: "1000" }).success).toBe(false);
  });
});

describe("FoundCompanySchema ve CompanyNameSchema", () => {
  const ok = () => ({ name: "Acme Ltd", idempotencyKey: randomUUID() });

  it("geçerli ad ve anahtarı kabul eder", () => {
    expect(FoundCompanySchema.safeParse(ok()).success).toBe(true);
  });

  it("geçersiz ad reddedilir: çok kısa, boş, boşluk, özel karakter, çok uzun", () => {
    expect(CompanyNameSchema.safeParse("AB").success).toBe(false);
    expect(CompanyNameSchema.safeParse("   ").success).toBe(false);
    expect(CompanyNameSchema.safeParse("").success).toBe(false);
    expect(CompanyNameSchema.safeParse("<script>x</script>").success).toBe(false);
    expect(CompanyNameSchema.safeParse("Firma;DROP").success).toBe(false);
    expect(CompanyNameSchema.safeParse("a".repeat(33)).success).toBe(false);
    expect(CompanyNameSchema.safeParse("abc").success).toBe(true);
    expect(CompanyNameSchema.safeParse("a".repeat(32)).success).toBe(true);
  });

  it("baştaki ve sondaki boşluk kırpılır; kırpılınca geçerliyse kabul edilir", () => {
    const r = CompanyNameSchema.safeParse("  Acme  ");
    expect(r.success && r.data).toBe("Acme");
  });

  it("FoundCompany: uuid olmayan anahtar ve fazladan alan (ör. ücret) reddedilir", () => {
    expect(FoundCompanySchema.safeParse({ ...ok(), idempotencyKey: "anahtar" }).success).toBe(false);
    expect(FoundCompanySchema.safeParse({ ...ok(), fee: "1" }).success).toBe(false);
    expect(FoundCompanySchema.safeParse({ name: "Acme" }).success).toBe(false);
  });
});

describe("ClaimReliefSchema", () => {
  it("geçerli anahtarı kabul eder; uuid olmayan anahtar ve fazladan alan reddedilir", () => {
    expect(ClaimReliefSchema.safeParse({ idempotencyKey: randomUUID() }).success).toBe(true);
    expect(ClaimReliefSchema.safeParse({ idempotencyKey: "k" }).success).toBe(false);
    expect(ClaimReliefSchema.safeParse({ idempotencyKey: randomUUID(), amount: "400000" }).success).toBe(false);
    expect(ClaimReliefSchema.safeParse({}).success).toBe(false);
  });
});
