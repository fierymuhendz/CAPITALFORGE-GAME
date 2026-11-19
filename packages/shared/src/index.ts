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
  /** istemci → sunucu: şirket ve üretim niyetleri */
  foundCompany: "foundCompany",
  buyFacility: "buyFacility",
  startProduction: "startProduction",
  claimRelief: "claimRelief",
  /** sunucu → istemci: ticaret dışı niyetlerin sonucu */
  actionResult: "actionResult",
  /** sunucu → istemci: yalnızca ilgili oyuncunun şirket görünümü */
  company: "company",
  /** sunucu → istemci: bir üretim işi sunucu tarafından tamamlandı (yalnızca sahibine) */
  jobCompleted: "jobCompleted",
} as const;

/** Ürün kimlikleri (seed ile aynı). */
export const PRODUCT_IDS = ["wheat", "iron", "energy", "flour", "steel"] as const;
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

export const GuestLoginSchema = z.object({ username: UsernameSchema }).strict();
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
  /** Yeni hesap bekleme süresinin bittiği an (ISO 8601). Sunucu hesaplar; yalnızca gösterim içindir. */
  tradeUnlockAt: z.string().datetime(),
});
export type Me = z.infer<typeof MeSchema>;

/** Çıkış: gövde boş ({}) olabilir. all=true tüm cihazlardaki oturumları kapatır. */
export const LogoutRequestSchema = z.object({ all: z.boolean().optional() }).strict();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/** İstemci hata bildirimi (kimliksiz). Yalnızca pathname alınır, sorgu dizesi/URL gönderilmez. */
export const ClientErrorReportSchema = z
  .object({
    kind: z.enum(["error", "unhandledrejection", "react"]),
    message: z.string().min(1).max(500),
    stack: z.string().max(4000).optional(),
    path: z.string().max(200).regex(/^\//).optional(),
    release: z.string().max(64).optional(),
  })
  .strict();
export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

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
  error: z.enum(["INVALID", "UNAUTHORIZED", "USERNAME_TAKEN", "RATE_LIMITED", "UNKNOWN_PRODUCT", "NO_COMPANY", "INTERNAL"]),
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
}).strict();
export type PlaceOrder = z.infer<typeof PlaceOrderSchema>;

export const ORDER_ERRORS = [
  "INVALID",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "UNKNOWN_PRODUCT",
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_INVENTORY",
  "VOLUME_LIMIT",
  "ORDER_TOO_LARGE",
  "IDEMPOTENCY_MISMATCH",
  "NEW_ACCOUNT_COOLDOWN",
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

/* ---------- Şirket ve üretim ---------- */

/** Tesis türleri ve tarif kimlikleri (packages/economy ile aynı; sunucuda derleme zamanında denetlenir). */
export const FACILITY_TYPE_IDS = ["farm", "mine", "power_plant", "mill", "steelworks"] as const;
export const FacilityTypeSchema = z.enum(FACILITY_TYPE_IDS);
export type FacilityTypeId = z.infer<typeof FacilityTypeSchema>;

export const RECIPE_ID_LIST = ["grow_wheat", "mine_iron", "generate_energy", "mill_flour", "smelt_steel"] as const;
export const RecipeIdSchema = z.enum(RECIPE_ID_LIST);
export type RecipeIdString = z.infer<typeof RecipeIdSchema>;

/** Şehir: ızgara arsa sınırları (veritabanındaki CHECK ile aynı). */
export const CITY = { defaultId: "merkez", width: 16, height: 16 } as const;
export const CityIdSchema = z.string().regex(/^[a-z0-9_]{1,32}$/);

export const MAX_BATCHES = 10;

export const CompanyNameSchema = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,30}[\p{L}\p{N}]$/u);

const IdempotencyKeySchema = z.string().uuid();

export const FoundCompanySchema = z.object({ name: CompanyNameSchema, idempotencyKey: IdempotencyKeySchema }).strict();
export type FoundCompany = z.infer<typeof FoundCompanySchema>;

export const BuyFacilitySchema = z
  .object({
    type: FacilityTypeSchema,
    plotX: z.number().int().min(0).max(CITY.width - 1),
    plotY: z.number().int().min(0).max(CITY.height - 1),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type BuyFacility = z.infer<typeof BuyFacilitySchema>;

export const StartProductionSchema = z
  .object({
    facilityId: z.string().uuid(),
    recipeId: RecipeIdSchema,
    batches: z.number().int().min(1).max(MAX_BATCHES),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type StartProduction = z.infer<typeof StartProductionSchema>;

export const ClaimReliefSchema = z.object({ idempotencyKey: IdempotencyKeySchema }).strict();
export type ClaimRelief = z.infer<typeof ClaimReliefSchema>;

export const ACTION_ERRORS = [
  "INVALID",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "NO_COMPANY",
  "COMPANY_EXISTS",
  "NAME_TAKEN",
  "PLOT_TAKEN",
  "FACILITY_LIMIT",
  "FACILITY_BUSY",
  "FACILITY_SUSPENDED",
  "UNKNOWN_RECIPE",
  "RECIPE_FACILITY_MISMATCH",
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_INVENTORY",
  "NOT_ELIGIBLE",
  "IDEMPOTENCY_MISMATCH",
  "INTERNAL",
] as const;
export const ActionErrorCodeSchema = z.enum(ACTION_ERRORS);
export type ActionErrorCode = z.infer<typeof ActionErrorCodeSchema>;

export const ACTION_KINDS = ["foundCompany", "buyFacility", "startProduction", "claimRelief"] as const;
export const ActionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof ActionKindSchema>;

/** Sunucu → istemci: ticaret dışı bir niyetin sonucu. Para değerleri kuruş string'i. */
export const ActionResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: ActionKindSchema,
    /** Aynı anahtarla yeniden gelen istek: kayıtlı orijinal sonuç döner. */
    duplicate: z.boolean(),
    idempotencyKey: z.string().uuid(),
    /** Oluşan kaynak (şirket, tesis veya iş kimliği); claimRelief'te yok. */
    refId: z.string().uuid().optional(),
    /** Tahsil edilen (−) / alınan (+) tutar; para hareketi yoksa "0". */
    amount: MoneySchema,
    /** İşlem sonrası oyuncu bakiyesi. */
    balance: MoneySchema,
  }),
  z.object({
    ok: z.literal(false),
    error: ActionErrorCodeSchema,
    idempotencyKey: z.string().uuid().optional(),
  }),
]);
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const FacilityViewSchema = z.object({
  id: z.string().uuid(),
  type: FacilityTypeSchema,
  level: z.number().int(),
  cityId: z.string(),
  plotX: z.number().int(),
  plotY: z.number().int(),
  status: z.enum(["active", "suspended"]),
  purchasePrice: MoneySchema,
  /** Bir sonraki bakım dönemi için tutar (kuruş). */
  upkeep: MoneySchema,
});
export type FacilityView = z.infer<typeof FacilityViewSchema>;

export const JobViewSchema = z.object({
  id: z.string().uuid(),
  facilityId: z.string().uuid(),
  recipeId: RecipeIdSchema,
  batches: z.number().int(),
  startedTick: z.number().int(),
  completesAtTick: z.number().int(),
  outputProductId: z.string(),
  outputQty: QuantityStringSchema,
});
export type JobView = z.infer<typeof JobViewSchema>;

/** Oyuncuya özel şirket görünümü (GET /company ve `company` mesajı). */
export const CompanyViewSchema = z.object({
  company: z
    .object({ id: z.string().uuid(), name: z.string(), cityId: z.string(), foundedAt: z.string() })
    .nullable(),
  facilities: z.array(FacilityViewSchema),
  /** Çalışan işler; biten işler `jobCompleted` ile bildirilir ve envantere yazılmıştır. */
  jobs: z.array(JobViewSchema),
  /** Sunucu oyun saati: ilerleme çubukları istemci saatine değil bununla hesaplanır. */
  clockTick: z.number().int().nonnegative(),
  /** Asgari ödenek şu an talep edilebilir mi (sunucu hesabı). */
  reliefAvailable: z.boolean(),
});
export type CompanyView = z.infer<typeof CompanyViewSchema>;

export const JobCompletedSchema = z.object({
  jobId: z.string().uuid(),
  facilityId: z.string().uuid(),
  recipeId: RecipeIdSchema,
  outputProductId: z.string(),
  outputQty: QuantityStringSchema,
  completedTick: z.number().int(),
});
export type JobCompleted = z.infer<typeof JobCompletedSchema>;

export const CatalogSchema = z.object({
  clockTick: z.number().int().nonnegative(),
  companyFoundingFee: MoneySchema,
  maxFacilitiesPerCompany: z.number().int(),
  upkeepPeriodTicks: z.number().int(),
  reliefAmount: MoneySchema,
  reliefCooldownTicks: z.number().int(),
  /** Ürün başına güncel havuz fiyatı ve tek emirde izin verilen en büyük adet (poolMaxOrder). */
  products: z.array(z.object({ productId: z.string(), price: MoneySchema, maxOrder: QuantityStringSchema })),
  facilityTypes: z.array(
    z.object({
      type: FacilityTypeSchema,
      /** Bu oyuncunun alacağı sıradaki tesisin fiyatı (sahip olunan sayıya göre). */
      price: MoneySchema,
      /** Seviye 1 için dönem bakımı. */
      upkeep: MoneySchema,
    }),
  ),
  recipes: z.array(
    z.object({
      id: RecipeIdSchema,
      facilityType: FacilityTypeSchema,
      inputs: z.array(z.object({ productId: z.string(), qty: QuantityStringSchema })),
      output: z.object({ productId: z.string(), qty: QuantityStringSchema }),
      durationTicks: z.number().int(),
    }),
  ),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const CityQuerySchema = z.object({ cityId: CityIdSchema.default(CITY.defaultId) });
export type CityQuery = z.infer<typeof CityQuerySchema>;

/** Herkese açık arsa listesi: sahip adı dışında oyuncu verisi yok. */
export const CityPlotSchema = z.object({
  plotX: z.number().int(),
  plotY: z.number().int(),
  type: FacilityTypeSchema,
  level: z.number().int(),
  companyName: z.string(),
});
export const CityResponseSchema = z.object({
  cityId: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  plots: z.array(CityPlotSchema),
});
export type CityResponse = z.infer<typeof CityResponseSchema>;
