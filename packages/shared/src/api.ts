/**
 * API yanıt tipleri (sunucu ↔ istemci sözleşmesi).
 * Para: kuruş, ondalık METİN (bigint kayıpsız). Miktar: kg, sayı. Zaman: ISO metin.
 * Yol önekleri: istemci `/api/...` çağırır, Caddy `/api` önekini kırpar; sunucu yolları öneksizdir.
 */
import type { Localized, Sector } from "./catalog/types";

export type Money = string;
export type Iso = string;

export interface AccountDto {
  id: string;
  username: string;
  locale: "tr" | "en";
  graphics: "auto" | "high" | "low" | "lite";
  role: "player" | "admin";
  totpEnabled: boolean;
  /** yönetici oturumu TOTP ile doğrulandı mı */
  adminVerified: boolean;
  canReviewConnections: boolean;
  frozen: boolean;
  createdAt: Iso;
}

export interface MeDto {
  account: AccountDto | null;
  company: CompanySummaryDto | null;
  serverTime: Iso;
}

export interface CompanySummaryDto {
  id: string;
  name: string;
  sector: Sector;
  homeCityId: string;
  level: number;
  xp: number;
  nextLevelXp: number | null;
  reputationBp: number;
  cash: Money;
  arrears: Money;
  unreadNotifications: number;
}

/** GET /world */
export interface WorldDto {
  serverTime: Iso;
  cities: Array<{
    id: string; name: Localized; blurb: Localized; map: { x: number; z: number }; color: string;
    energyPrice: Money; waterPrice: Money; wage: Money; laborNote: Localized; laborAvailability: number;
    sectorYieldBp: Partial<Record<Sector, number>>;
  }>;
  roads: Array<{ a: string; b: string; km: number }>;
  products: Array<{ id: string; name: Localized; category: string; color: string; basePricePerKg: Money }>;
  buildingTypes: Array<{
    id: string; sector: Sector; name: Localized; buildCost: Money; buildSteelKg: number; buildMinutes: number;
    levels: Array<{ level: number; lines: number; maxBatches: number; upkeepPerDay: Money; upgradeCost: Money; upgradeSteelKg: number; upgradeMinutes: number }>;
    qualityUpgradeCosts: Money[]; vehicleSlots?: number[]; requiresDeposit?: boolean;
  }>;
  recipes: Array<{
    id: string; buildingType: string; name: Localized; inputs: Array<{ productId: string; kg: number }>;
    output: { productId: string; kg: number }; minutes: number; laborHours: number; energyKwh: number; waterM3: number;
    minBuildingLevel: number; deposit?: "iron" | "coal"; version: number;
  }>;
  research: Array<{ id: string; name: Localized; description: Localized; maxLevel: number; baseCost: Money; baseMinutes: number; effect: unknown }>;
  vehicleModels: Array<{ id: string; name: Localized; capacityKg: number; speedKmh: number; fuelPerKm: Money; price: Money; upkeepPerDay: Money; minCompanyLevel: number; minGarageLevel: number }>;
  levelXp: number[];
  marketFeeBp: number;
  qualityPriceBp: number[];
  freight: { systemBaseFee: Money; systemPerKm: Money; driverHoursPerTrip: number };
  startingCash: Money;
}

export interface PlotDto {
  id: string; cityId: string; gx: number; gz: number;
  price: Money; minLevel: number; sizeHa: number; fertilityBp: number; pastureBp: number;
  deposit: null | { kind: "iron" | "coal"; richnessBp: number };
  distanceToCenterKm: number;
  owner: null | { companyId: string; companyName: string; isSystem: boolean };
  building: null | FacilityMapDto;
}

export interface FacilityMapDto {
  id: string; type: string; level: number; qualityLevel: number;
  status: "constructing" | "idle" | "working" | "stalled" | "upgrading";
  /** çalışan iş(ler)in bitiş zamanı */
  activeUntil: Iso | null;
  ownerCompanyId: string;
  /** çalışan işin çıktı ürünü (görselde tarla rengi vb.), boşta null */
  outputProductId: string | null;
}

/** GET /world/map: 3D şehir ve 2D harita için tek yük */
export interface WorldMapDto {
  serverTime: Iso;
  plots: PlotDto[];
  vehicles: VehicleMapDto[];
}

export interface VehicleMapDto {
  id: string; modelId: string; ownerCompanyId: string; ownerName: string; isMine: boolean;
  status: "idle" | "in_transit" | "loading";
  cityId: string | null;
  shipment: null | {
    id: string; originCityId: string; destCityId: string; departedAt: Iso; arrivesAt: Iso;
    /** yalnızca sahibi, taşımacı veya alıcı görür; diğerleri için toplam kg */
    cargo: Array<{ productId: string; quality: number; qtyKg: number }> | null;
    totalKg: number;
  };
}

/** GET /world/onboarding?cityId=&sector= */
export interface OnboardingDto {
  startingCash: Money;
  plots: Array<PlotDto & {
    eligible: boolean;
    reasons: Array<"LEVEL_TOO_LOW" | "INSUFFICIENT_FUNDS" | "PLOT_TAKEN" | "DEPOSIT_REQUIRED">;
    /** en yakın hammadde ve müşteri şehirleri */
    nearestSupply: Array<{ productId: string; cityId: string; km: number }>;
    nearestBuyers: Array<{ productId: string; cityId: string; km: number; companyName: string }>;
  }>;
  starter: {
    building: string;
    vehicle?: string;
    inputs: Array<{ productId: string; kg: number }>;
    firstJob: { recipeId?: string; estCost: Money; estRevenue: Money; minutes: number; hint: Localized };
  };
}

export interface CompanyDto extends CompanySummaryDto {
  createdAt: Iso;
  facilities: FacilityDto[];
  vehicles: VehicleDto[];
  research: Array<{ researchId: string; level: number; inProgress: null | { targetLevel: number; endsAt: Iso } }>;
  stats: { revenue7d: Money; profit7d: Money; onTimeDeliveries: number; lateOrMissed: number };
  /** "sıradaki adım" önerileri, boş durumlarda gösterilir */
  nextSteps: Array<{ key: string; params?: Record<string, string | number> }>;
}

export interface FacilityDto {
  id: string; plotId: string; cityId: string; type: string; level: number; qualityLevel: number;
  status: FacilityMapDto["status"];
  lines: number; maxBatches: number; upkeepPerDay: Money;
  constructionEndsAt: Iso | null;
  upgrade: null | { kind: "level" | "quality"; target: number; endsAt: Iso };
  jobs: ProductionJobDto[];
  stalledReason: null | { code: "MISSING_INPUT" | "INSUFFICIENT_FUNDS" | "ARREARS"; productId?: string };
  recipes: string[];
}

export interface ProductionJobDto {
  id: string; facilityId: string; recipeId: string; batches: number; repeat: boolean;
  status: "running" | "completed" | "cancelled";
  startedAt: Iso; endsAt: Iso; completedAt: Iso | null;
  output: { productId: string; qtyKg: number; quality: number };
  cost: CostBreakdownDto;
}

export interface CostBreakdownDto {
  inputs: Array<{ productId: string; quality: number; qtyKg: number; cost: Money }>;
  energy: Money; water: Money; labor: Money; freightIn?: Money; purchase?: Money; total: Money;
}

/** POST /production/quote */
export interface ProductionQuoteDto {
  recipeId: string; batches: number; minutes: number; endsAt: Iso;
  inputs: Array<{ productId: string; requiredKg: number; availableKg: number; quality: number | null; estCost: Money }>;
  output: { productId: string; qtyKg: number; quality: number };
  energyKwh: number; waterM3: number; laborHours: number;
  cost: { inputs: Money; energy: Money; water: Money; labor: Money; total: Money };
  unitCostPerKg: Money;
  /** satış tahmini: en iyi alıcı(lar) */
  bestBuyers: Array<{ cityId: string; companyName: string; isSystem: boolean; pricePerKg: Money; km: number }>;
  canStart: boolean;
  blockers: Array<{ code: string; productId?: string; missingKg?: number; missing?: Money }>;
}

export interface VehicleDto {
  id: string; modelId: string; cityId: string | null; status: "idle" | "in_transit";
  shipmentId: string | null; arrivesAt: Iso | null; destCityId: string | null; garageFacilityId: string | null;
}

export interface HoldingDto {
  cityId: string; productId: string; quality: number;
  qtyKg: number; reservedKg: number; availableKg: number;
  costTotal: Money; avgCostPerKg: Money;
  /** avgCostPerKg × 1000, gösterim için */
  avgCostPerTonne: Money;
}

export interface MovementDto {
  id: string; at: Iso; kind: string; cityId: string; productId: string; quality: number;
  qtyKg: number; cost: Money; refType: string | null; refId: string | null;
  breakdown: CostBreakdownDto | null;
}

export interface ListingDto {
  id: string; side: "sell" | "buy"; companyId: string; companyName: string; isSystem: boolean;
  cityId: string; productId: string; quality: number; qtyKg: number; remainingKg: number;
  pricePerKg: Money; createdAt: Iso; status: "open" | "filled" | "cancelled"; mine: boolean;
}

export interface MarketDto {
  cityId: string; productId: string;
  refPricePerKg: Money;
  listings: ListingDto[];
  orders: ListingDto[];
  recentTrades: Array<{ at: Iso; qtyKg: number; pricePerKg: Money; quality: number; system: boolean }>;
}

/** GET /market/overview: ürün × şehir */
export interface MarketOverviewDto {
  rows: Array<{
    productId: string; cityId: string; refPricePerKg: Money;
    bestAsk: Money | null; askKg: number; bestBid: Money | null; bidKg: number;
    systemBidRemainingKg: number; volume24hKg: number;
  }>;
}

export interface SaleDto {
  id: string; at: Iso; source: "spot" | "contract" | "system";
  productId: string; quality: number; qtyKg: number; pricePerKg: Money;
  buyerName: string; sellerName: string; cityId: string;
  gross: Money; cogs: Money; freight: Money; fees: Money; netProfit: Money;
  contractId: string | null; installmentId: string | null; shipmentId: string | null;
  ledgerTransactionIds: string[];
}

export interface ContractDto {
  id: string; status: "proposed" | "active" | "completed" | "cancelled" | "expired" | "declined";
  isSystem: boolean; isPublic: boolean;
  proposerCompanyId: string; sellerCompanyId: string | null; buyerCompanyId: string | null;
  sellerName: string | null; buyerName: string | null;
  myRole: "seller" | "buyer" | null;
  productId: string; minQuality: number; qtyPerInstallmentKg: number; pricePerKg: Money;
  deliveryCityId: string; freightPayer: "seller" | "buyer";
  installments: number; firstDueAt: Iso; intervalHours: number; graceHours: number;
  penaltyBp: number; lateFeeBp: number; expiresAt: Iso; createdAt: Iso; acceptedAt: Iso | null;
  totalValue: Money; buyerEscrow: Money; sellerDeposit: Money;
  sellerReputationBp: number | null; buyerReputationBp: number | null;
  note: string | null;
}

export interface InstallmentDto {
  id: string; seq: number; dueAt: Iso; windowOpensAt: Iso; graceEndsAt: Iso;
  qtyDueKg: number; qtyDeliveredKg: number; qtyLateKg: number;
  status: "scheduled" | "open" | "fulfilled" | "partial" | "missed" | "cancelled";
  paidToSeller: Money; lateFees: Money; penalty: Money; refundedToBuyer: Money;
  /** açık yükümlülük: satıcı daha ne kadar teslim etmeli, alıcı emanette ne bekliyor */
  outstandingKg: number; escrowRemaining: Money;
  deliveries: Array<{ id: string; at: Iso; qtyKg: number; quality: number; late: boolean; shipmentId: string | null; saleId: string; ledgerTransactionId: string }>;
  freightJobId: string | null;
}

export interface ContractDetailDto {
  contract: ContractDto;
  terms: Record<string, unknown>;
  schedule: InstallmentDto[];
  /** taraf başına özet: kim ne borçlu / alacaklı */
  balances: {
    seller: { delivered: number; owedKg: number; received: Money; penaltiesPaid: Money; depositHeld: Money };
    buyer: { received: number; paid: Money; escrowHeld: Money; refunds: Money; penaltiesReceived: Money };
  };
}

export interface ShipmentDto {
  id: string; vehicleId: string; modelId: string; carrierCompanyId: string; carrierName: string;
  originCityId: string; destCityId: string; distanceKm: number;
  departedAt: Iso; arrivesAt: Iso; deliveredAt: Iso | null;
  status: "in_transit" | "delivered";
  purpose: "own" | "freight_job" | "reposition";
  freightJobId: string | null;
  cargo: Array<{ productId: string; quality: number; qtyKg: number; ownerCompanyId: string; consigneeCompanyId: string; installmentId: string | null }>;
  cost: { fuel: Money; driver: Money; total: Money } | null;
  proof: null | { deliveredAt: Iso; receivedBy: string; lines: Array<{ productId: string; qtyKg: number }>; hash: string };
}

export interface FreightJobDto {
  id: string; status: "open" | "assigned" | "in_transit" | "delivered" | "expired" | "cancelled";
  isSystem: boolean; shipperCompanyId: string; shipperName: string; consigneeName: string;
  originCityId: string; destCityId: string; distanceKm: number;
  cargo: Array<{ productId: string; quality: number; qtyKg: number }>; totalKg: number;
  payAmount: Money; deadlineAt: Iso; createdAt: Iso;
  carrierCompanyId: string | null; carrierName: string | null; shipmentId: string | null;
  installmentId: string | null; allowSystemCarrier: boolean; mine: "shipper" | "carrier" | null;
  /** taşımacı için: yakıt + sürücü tahmini ve net */
  estCostForMe: Money | null;
}

export interface LoanDto {
  id: string; principal: Money; outstanding: Money; dailyInterestBp: number; termDays: number;
  installment: Money; nextDueAt: Iso | null; paidInstallments: number; status: "active" | "repaid" | "defaulted";
  interestPaid: Money; createdAt: Iso;
}

export interface FinanceDto {
  balances: Record<string, Money>;
  /** son N gün kâr-zarar */
  pnl: { revenue: Money; cogs: Money; grossProfit: Money; expenses: Record<string, Money>; netProfit: Money; days: number };
  cashflow: { operating: Money; investing: Money; financing: Money; net: Money; days: number };
  loans: LoanDto[];
  loanOffer: { maxAmount: Money; dailyInterestBp: number; termsDays: number[] };
  netWorth: Money;
}

/** GET /companies/:id, /companies/search */
export interface PublicCompanyDto {
  id: string; name: string; sector: Sector; homeCityId: string; level: number; reputationBp: number;
  onTimeDeliveries: number; lateOrMissed: number; isSystem: boolean; createdAt: Iso;
}

/** GET /finance/sales/:id: satış izi (yalnızca isteyen şirketin defter satırları gösterilir) */
export interface SaleTraceDto {
  sale: SaleDto;
  contract: null | { id: string; status: string; pricePerKg: Money; deliveryCityId: string; installments: number };
  installment: null | { id: string; seq: number; dueAt: Iso; status: string };
  shipment: null | { id: string; originCityId: string; destCityId: string; departedAt: Iso; arrivesAt: Iso; deliveredAt: Iso | null; status: string };
  transactions: Array<{ id: string; at: Iso; kind: string; memo: string; lines: Array<{ account: string; amount: Money }> }>;
}

export interface LedgerLineDto {
  transactionId: string; at: Iso; kind: string; memo: string; account: string; amount: Money;
  refType: string | null; refId: string | null;
}

export interface NotificationDto {
  id: string; at: Iso; kind: string; params: Record<string, string | number>; read: boolean;
  link: string | null;
}

export interface ResearchDto {
  items: Array<{ researchId: string; level: number; nextCost: Money | null; nextMinutes: number | null; minCompanyLevel: number; inProgress: null | { targetLevel: number; endsAt: Iso } }>;
}

/** WebSocket olayları (/ws/events) */
export type ServerEvent =
  | { type: "hello"; serverTime: Iso }
  | { type: "invalidate"; topics: Topic[] }
  | { type: "notification"; notification: NotificationDto }
  | { type: "world"; topics: Array<"map" | "market"> };

export type Topic = "company" | "inventory" | "facilities" | "market" | "contracts" | "shipments" | "freight" | "finance" | "research" | "notifications" | "map";

// ---- Yönetici ----
export interface AdminProductMetricsDto {
  rows: Array<{
    productId: string; cityId: string | null;
    inventoryKg: number; openListingsKg: number; openOrdersKg: number;
    avgHoursToBuyer: number | null; refPricePerKg: Money; vwap24h: Money | null;
    volume24hKg: number; volume7dKg: number; systemShareBp: number;
    priceChange24hBp: number | null;
  }>;
}

export interface AdminAlertDto {
  id: string; at: Iso; kind: "price_anomaly" | "shortage" | "excess_inventory" | "wealth_spike" | "price_spike" | "unfilled_freight" | "stalled_production";
  severity: "info" | "warn" | "high";
  productId: string | null; cityId: string | null; companyIds: string[]; companyNames: string[];
  details: Record<string, string | number | boolean | null>;
  status: "open" | "acknowledged" | "case_opened";
}

export interface AdminConnectionGroupDto {
  groupId: string; label: string; accountCount: number; lastSeenAt: Iso;
  accounts: Array<{ accountId: string; username: string; companyId: string | null; companyName: string | null }>;
  interactions: number; flaggedTrades: number;
}

export interface AdminReviewDto {
  group: AdminConnectionGroupDto;
  trades: Array<{ at: Iso; kind: string; refId: string; from: string; to: string; productId: string | null; qtyKg: number | null; pricePerKg: Money | null; value: Money; anomaly: null | { refPricePerKg: Money; deviationBp: number; comparables: number; insufficientData: boolean; flagged?: boolean } }>;
  totals: { valueTransferred: Money; byDirection: Array<{ from: string; to: string; value: Money }> };
}

export interface AdminCaseDto {
  id: string; title: string; subjectType: string; subjectId: string; status: "open" | "closed";
  openedBy: string; openedAt: Iso; closedAt: Iso | null; resolution: string | null;
  events: Array<{ at: Iso; by: string; kind: "opened" | "note" | "enforcement" | "closed"; text: string; action?: string; targetId?: string }>;
}

export interface AdminAuditDto {
  rows: Array<{ id: string; at: Iso; adminUsername: string; action: string; target: string; before: unknown; after: unknown; reasoning: string | null }>;
}

/** GET /admin/products/:productId */
export interface AdminProductDetailDto {
  productId: string; cityId: string | null;
  metrics: AdminProductMetricsDto["rows"];
  holders: Array<{ companyId: string; companyName: string; isSystem: boolean; cityId: string; quality: number; qtyKg: number; reservedKg: number; avgCostPerKg: Money }>;
  recentTrades: Array<{ id: string; at: Iso; cityId: string; quality: number; qtyKg: number; pricePerKg: Money; buyerName: string; sellerName: string; buyerIsSystem: boolean; sellerIsSystem: boolean }>;
}

/** GET /admin/search */
export interface AdminSearchDto {
  accounts: Array<{ id: string; username: string; role: "player" | "admin"; frozen: boolean; createdAt: Iso; companyId: string | null; companyName: string | null }>;
  companies: Array<{ id: string; name: string; sector: Sector; homeCityId: string; level: number; isSystem: boolean; dissolved: boolean; accountId: string | null; username: string | null }>;
}

/** GET /admin/companies/:id */
export interface AdminCompanyDetailDto {
  company: { id: string; name: string; sector: Sector; homeCityId: string; level: number; xp: number; isSystem: boolean; createdAt: Iso; dissolvedAt: Iso | null; onTimeDeliveries: number; lateOrMissed: number };
  account: null | { id: string; username: string; role: "player" | "admin"; frozen: boolean };
  balances: Record<string, Money>;
  ledger: LedgerLineDto[];
  sales: SaleDto[];
  holdings: HoldingDto[];
  facilities: Array<{ id: string; type: string; level: number; qualityLevel: number; state: string; cityId: string; stalledReason: unknown; runningJobs: number }>;
  counts: { openListings: number; openOrders: number; activeContracts: number; openFreightJobs: number; vehicles: number };
}

/** GET /admin/catalog */
export interface AdminCatalogDto {
  recipes: Array<{ id: string; version: number; data: unknown; updatedAt: Iso }>;
  products: Array<{ id: string; version: number; data: unknown; updatedAt: Iso }>;
  settings: Record<string, { value: unknown; updatedAt: Iso | null }>;
}

/** PATCH /admin/catalog/*, /admin/settings */
export interface AdminChangeResultDto {
  id: string; version: number;
  /** etkilenen kayıtlar: ör. bu tarifi kullanan çalışan iş sayısı */
  affected: Record<string, number>;
}
