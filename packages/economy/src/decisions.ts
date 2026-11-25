/**
 * Karar yardımcıları (saf): oyuncunun "hangisi daha iyi" sorularını tek formülde toplar. Sunucu otoritesi değildir,
 * arayüz tahmini ve denge simülasyonu içindir; para bigint kuruş, oranlar bp.
 */
import { BP, applyBp, mulDiv, toBig } from "./money";
import { estimateOwnTrip, systemCarrierQuote, type VehicleLike } from "./freight";

export interface ContractVsSpotInput {
  /** taksit başına kg ve taksit sayısı */
  qtyPerInstallmentKg: number;
  installments: number;
  /** sözleşme birim fiyatı (kalite fark etmez) */
  contractPricePerKg: bigint;
  /** her taksit gününde beklenen spot net birim fiyat (kalite dahil), uzunluk = taksit sayısı */
  spotPricePerKg: bigint[];
  /** teslim edememe olasılığı bp (stok yetmez, araç gecikir) */
  missProbBp: number;
  /** eksik teslim cezası bp (teminattan) ve teminatın bağlı kaldığı gün sayısı × günlük faiz (bp) */
  penaltyBp: number;
  depositDays: number;
  dailyInterestBp: number;
  /** satıcının ödediği navlun (kg başına): sözleşme teslim şehrine, spot satış yerine */
  contractFreightPerKg: bigint;
  spotFreightPerKg: bigint;
  /** piyasa komisyonu (bp), spotta ödenir */
  spotFeeBp: number;
}
export interface ContractVsSpotResult { contractValue: bigint; spotValue: bigint; better: "contract" | "spot"; advantage: bigint }

/** Beklenen değer: sözleşme (prim, kilitli talep, ceza riski, teminat maliyeti) ile taksit günlerinde spot satış */
export function contractVsSpot(i: ContractVsSpotInput): ContractVsSpotResult {
  const q = toBig(i.qtyPerInstallmentKg);
  const n = BigInt(i.installments);
  const gross = q * n * i.contractPricePerKg;
  const hit = BP - toBig(i.missProbBp);
  const revenue = mulDiv(gross, hit, BP);
  const penalty = mulDiv(applyBp(gross, i.penaltyBp), toBig(i.missProbBp), BP);
  const deposit = applyBp(gross, i.penaltyBp);
  const depositCost = mulDiv(deposit, toBig(i.dailyInterestBp) * toBig(i.depositDays), BP);
  const contractValue = revenue - penalty - depositCost - mulDiv(q * n * i.contractFreightPerKg, hit, BP);
  let spot = 0n;
  for (let k = 0; k < i.installments; k++) {
    const p = i.spotPricePerKg[k] ?? i.spotPricePerKg[i.spotPricePerKg.length - 1] ?? 0n;
    spot += applyBp(q * p, BP - toBig(i.spotFeeBp)) - q * i.spotFreightPerKg;
  }
  const better = contractValue >= spot ? "contract" : "spot";
  return { contractValue, spotValue: spot, better, advantage: contractValue >= spot ? contractValue - spot : spot - contractValue };
}

export interface SupplierOffer { id: string; pricePerKg: bigint; km: number; availableKg: number; fromSystem?: boolean }
export interface SupplierChoice { id: string; perKg: bigint; total: bigint; freight: bigint }
/**
 * Tedarikçi seçimi: teslim maliyeti = mal + navlun. Navlun, en ucuzu: kendi kamyonu (yük başına sefer) veya sistem tarifesi.
 * Sipariş kg küçükse kısmi yük navlunu kg başına pahalıdır; "uzak ama ucuz" ancak dolu kamyonda kazanır.
 */
export function chooseSupplier(offers: SupplierOffer[], qtyKg: number, truck: VehicleLike, wagePerHour: bigint | number, opts?: { handlingMinutes?: number; baseFee?: bigint | number; perKm?: bigint | number }): SupplierChoice | null {
  let best: SupplierChoice | null = null;
  for (const o of offers) {
    if (o.availableKg < qtyKg) continue;
    const loads = BigInt(Math.max(1, Math.ceil(qtyKg / truck.capacityKg)));
    const own = estimateOwnTrip(o.km, truck, wagePerHour, { handlingMinutes: opts?.handlingMinutes ?? 0 }).total * loads;
    const sys = o.km > 0 ? systemCarrierQuote(o.km, qtyKg, opts?.baseFee ?? 45_000, opts?.perKm ?? 3200, truck.capacityKg) : 0n;
    const freight = o.km === 0 ? 0n : own < sys || sys === 0n ? own : sys;
    const total = o.pricePerKg * toBig(qtyKg) + freight;
    const c: SupplierChoice = { id: o.id, perKg: qtyKg > 0 ? total / toBig(qtyKg) : 0n, total, freight };
    if (!best || c.total < best.total) best = c;
  }
  return best;
}

/** Geri dönüş (gün): maliyet / günlük kazanç, yukarı yuvarlı; kazanç ≤ 0 ise null */
export function paybackDays(cost: bigint, dailyGain: bigint): number | null {
  if (dailyGain <= 0n) return null;
  return Number((cost + dailyGain - 1n) / dailyGain);
}

/** Bir hattın günlük parti kapasitesi: floor(hat × parti × 1440 / dakika) */
export function batchesPerDay(lines: number, maxBatches: number, minutes: number): number {
  return minutes > 0 ? Math.floor((lines * maxBatches * 1440) / minutes) : 0;
}
