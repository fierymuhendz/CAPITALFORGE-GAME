/**
 * İstek şemaları. Sunucu her isteği bunlarla doğrular; istemci formları da aynı şemaları kullanır.
 * Miktarlar kg (pozitif tam sayı), para kuruş (pozitif tam sayı, JSON'da sayı veya ondalık metin).
 */
import { z } from "zod";

export const MAX_QTY_KG = 10_000_000; // 10.000 t
export const MAX_MONEY = 100_000_000_000; // ₺1 milyar (kuruş)
export const MAX_PRICE_PER_KG = 10_000_000; // ₺100.000/kg

export const idempotencyKey = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);
export const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
export const uuid = z.uuid();
export const qtyKg = z.number().int().positive().max(MAX_QTY_KG);
export const pricePerKg = z.number().int().positive().max(MAX_PRICE_PER_KG);
export const money = z.number().int().positive().max(MAX_MONEY);
export const quality = z.number().int().min(1).max(5);
export const locale = z.enum(["tr", "en"]);
export const sector = z.enum(["crop", "livestock", "mining", "manufacturing", "freight"]);

export const usernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-zA-Z0-9_.-]+$/);
export const passwordSchema = z.string().min(8).max(128);

export const RegisterReq = z.object({ username: usernameSchema, password: passwordSchema, locale: locale.default("tr") });
export const LoginReq = z.object({ username: z.string().min(1).max(24), password: z.string().min(1).max(128) });
export const TotpCodeReq = z.object({ code: z.string().regex(/^\d{6}$/) });
export const AdminClaimReq = z.object({ setupCode: z.string().min(16).max(128) });
export const ChangePasswordReq = z.object({ oldPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export const PrefsReq = z.object({ locale: locale.optional(), graphics: z.enum(["auto", "high", "low", "lite"]).optional() });
export const DissolveReq = z.object({ confirmName: z.string().min(1).max(40) });

export const companyName = z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N} .&'-]+$/u);
export const FoundCompanyReq = z.object({
  name: companyName,
  cityId: id,
  sector,
  plotId: id,
  /** imalat için başlangıç binası */
  starterBuilding: z.enum(["food_plant", "steel_mill"]).optional(),
  idempotencyKey,
});

export const BuyPlotReq = z.object({ buildingType: id, idempotencyKey });
export const FacilityActionReq = z.object({ idempotencyKey });

export const ProductionQuoteReq = z.object({ facilityId: uuid, recipeId: id, batches: z.number().int().min(1).max(16) });
export const ProductionStartReq = ProductionQuoteReq.extend({ repeat: z.boolean().default(false), idempotencyKey });

export const ListingReq = z.object({ cityId: id, productId: id, quality, qtyKg, pricePerKg, idempotencyKey });
export const BuyOrderReq = z.object({ cityId: id, productId: id, minQuality: quality, qtyKg, maxPricePerKg: pricePerKg, idempotencyKey });
export const BuyFromListingReq = z.object({ qtyKg, expectedPricePerKg: pricePerKg, deliverToCityId: id.optional(), idempotencyKey });
export const SellToOrderReq = z.object({ qtyKg, quality, expectedPricePerKg: pricePerKg, idempotencyKey });
/** Satış için stoğu alıcının şehrine sistem taşımacısı tarifesiyle taşıt (kamyon dolusu başına bir taşıma işi). */
export const HaulReq = z.object({ originCityId: id, destCityId: id, productId: id, quality, qtyKg, idempotencyKey });
export const CancelReq = z.object({ idempotencyKey });

export const ContractProposalReq = z
  .object({
    role: z.enum(["seller", "buyer"]),
    counterpartyCompanyId: uuid.optional(),
    productId: id,
    minQuality: quality,
    qtyPerInstallmentKg: qtyKg,
    pricePerKg,
    deliveryCityId: id,
    freightPayer: z.enum(["seller", "buyer"]),
    installments: z.number().int().min(1).max(30),
    /** ISO zaman */
    firstDueAt: z.iso.datetime(),
    intervalHours: z.number().int().min(1).max(168).default(24),
    graceHours: z.number().int().min(0).max(24).default(2),
    penaltyBp: z.number().int().min(0).max(5000).default(1000),
    expiresInHours: z.number().int().min(1).max(168).default(24),
    note: z.string().max(200).optional(),
    idempotencyKey,
  })
  .refine((v) => BigInt(v.qtyPerInstallmentKg) * BigInt(v.pricePerKg) * BigInt(v.installments) <= BigInt(MAX_MONEY), {
    message: "contract value too large",
  });
export const DeliverReq = z.object({ qtyKg, quality, idempotencyKey });

export const cargoLine = z.object({ productId: id, quality, qtyKg });
export const BuyVehicleReq = z.object({ modelId: id, cityId: id, idempotencyKey });
export const ShipmentReq = z.object({
  vehicleId: uuid,
  destCityId: id,
  cargo: z.array(cargoLine).max(6),
  contractInstallmentId: uuid.optional(),
  idempotencyKey,
});
export const FreightJobReq = z.object({
  originCityId: id,
  destCityId: id,
  cargo: z.array(cargoLine).min(1).max(6),
  consigneeCompanyId: uuid.optional(),
  contractInstallmentId: uuid.optional(),
  payAmount: money,
  deadlineHours: z.number().int().min(1).max(168),
  allowSystemCarrier: z.boolean().default(true),
  idempotencyKey,
});
export const AcceptFreightReq = z.object({ vehicleId: uuid, idempotencyKey });

export const LoanReq = z.object({ amount: money, termDays: z.number().int().min(1).max(30), idempotencyKey });
export const RepayReq = z.object({ amount: money, idempotencyKey });
export const ResearchStartReq = z.object({ idempotencyKey });
export const NotificationsReadReq = z.object({ ids: z.array(uuid).max(200).optional(), all: z.boolean().optional() });
// Modül A: GET sorgu şemaları
export const BeforeQuery = z.object({ before: z.iso.datetime().optional() });
export const MovementsQuery = z.object({ productId: id.optional(), cityId: id.optional(), quality: z.coerce.number().int().min(1).max(5).optional() });
export const CompanySearchQuery = z.object({ q: z.string().trim().min(1).max(40) });

// Yönetici
export const AdminCaseReq = z.object({
  subjectType: z.enum(["account", "company", "connection_group", "transaction", "alert"]),
  subjectId: z.string().min(1).max(80),
  title: z.string().min(3).max(120),
  reasoning: z.string().min(3).max(2000),
  idempotencyKey: idempotencyKey.optional(),
});
export const AdminNoteReq = z.object({ text: z.string().min(1).max(2000), idempotencyKey: idempotencyKey.optional() });
export const AdminCloseReq = z.object({ resolution: z.enum(["no_action", "warning", "enforced"]), reasoning: z.string().min(3).max(2000), idempotencyKey: idempotencyKey.optional() });
export const AdminEnforceReq = z.object({
  action: z.enum(["freeze_account", "unfreeze_account", "reverse_transaction", "cancel_listing", "cancel_contract"]),
  targetId: z.string().min(1).max(80),
  reasoning: z.string().min(3).max(2000),
  idempotencyKey,
});
export const AdminRecipePatchReq = z.object({
  minutes: z.number().int().min(1).max(10080).optional(),
  laborHours: z.number().int().min(0).max(10000).optional(),
  energyKwh: z.number().int().min(0).max(100000).optional(),
  waterM3: z.number().int().min(0).max(100000).optional(),
  outputKg: z.number().int().min(1).max(MAX_QTY_KG).optional(),
  inputs: z.array(z.object({ productId: id, kg: z.number().int().positive().max(MAX_QTY_KG) })).max(6).optional(),
  reasoning: z.string().min(3).max(500),
  idempotencyKey: idempotencyKey.optional(),
});
export const AdminSettingReq = z.object({ key: z.string().min(1).max(80), value: z.unknown(), reasoning: z.string().min(3).max(500), idempotencyKey: idempotencyKey.optional() });
export const AdminProductPatchReq = z.object({ basePricePerKg: pricePerKg, reasoning: z.string().min(3).max(500), idempotencyKey: idempotencyKey.optional() });
export const AdminTimeReq = z.object({ minutes: z.number().int().min(1).max(60 * 24 * 30) });
export const AdminResetPasswordReq = z.object({ accountId: uuid, newPassword: passwordSchema, reasoning: z.string().min(3).max(500), idempotencyKey: idempotencyKey.optional() });
export const AdminConnectionsAccessReq = z.object({ enabled: z.boolean(), reason: z.string().min(3).max(500), idempotencyKey: idempotencyKey.optional() });
export const AdminAckReq = z.object({ idempotencyKey: idempotencyKey.optional() });
/** Oyuncu yönetimi: hesabı askıya al / yeniden etkinleştir */
export const AdminPlayerStatusReq = z.object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(500), idempotencyKey });
/** Oyuncu yönetimi: nakit ayarı (kuruş). add/deduct: tutar > 0; set: hedef bakiye ≥ 0. Her istek tek kez uygulanır (idempotencyKey zorunlu). */
export const AdminBalanceReq = z
  .object({
    mode: z.enum(["add", "deduct", "set"]),
    amount: z.number().int().min(0).max(MAX_MONEY),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey,
  })
  .refine((b) => b.mode === "set" || b.amount > 0, { path: ["amount"] });
/** GET sorguları (query string) */
const likeText = z.string().trim().min(1).max(40);
export const AdminSearchQuery = z.object({ q: likeText });
export const AdminPlayersQuery = z.object({ q: z.string().trim().max(40).optional() });
export const AdminOverviewQuery = z.object({ productId: id.optional(), cityId: id.optional(), byCity: z.enum(["0", "1"]).optional() });
export const AdminProductQuery = z.object({ cityId: id.optional() });
export const AdminAlertsQuery = z.object({
  kind: z.enum(["price_anomaly", "shortage", "excess_inventory", "wealth_spike", "price_spike", "unfilled_freight", "stalled_production"]).optional(),
  status: z.enum(["open", "acknowledged", "case_opened"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export const AdminCasesQuery = z.object({ status: z.enum(["open", "closed"]).optional() });
export const AdminAuditQuery = z.object({ action: z.string().min(1).max(60).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

export const ClientErrorReq = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(300).optional(),
});
