import { allocate, applyBp, toBig } from "./money";

export interface ContractTerms {
  qtyPerInstallmentKg: number;
  pricePerKg: bigint;
  installments: number;
  penaltyBp: number;
  lateFeeBp: number;
}

export function contractValue(t: ContractTerms): bigint {
  return toBig(t.qtyPerInstallmentKg) * t.pricePerKg * toBig(t.installments);
}

/** Alıcı emaneti = toplam değer; satıcı teminatı = toplam değer × ceza oranı */
export function contractEscrows(t: ContractTerms): { buyerEscrow: bigint; sellerDeposit: bigint; perInstallmentDeposit: bigint[] } {
  const v = contractValue(t);
  const sellerDeposit = applyBp(v, t.penaltyBp);
  return {
    buyerEscrow: v,
    sellerDeposit,
    perInstallmentDeposit: allocate(sellerDeposit, Array.from({ length: t.installments }, () => 1)),
  };
}

/** Teslim ödemesi: brüt, gecikme cezası (geç ise), satıcıya net */
export function deliveryPayment(qtyKg: number, pricePerKg: bigint, late: boolean, lateFeeBp: number): { gross: bigint; lateFee: bigint; net: bigint } {
  const gross = toBig(qtyKg) * pricePerKg;
  const lateFee = late ? applyBp(gross, lateFeeBp) : 0n;
  return { gross, lateFee, net: gross - lateFee };
}

/**
 * Taksit kapanışı (vade + tolerans doldu): eksik miktar bedeli alıcıya iade edilir,
 * eksik × fiyat × ceza oranı satıcı teminatından alıcıya geçer (teminat payıyla sınırlı).
 */
export function settleInstallment(qtyDueKg: number, deliveredKg: number, pricePerKg: bigint, penaltyBp: number, depositShare: bigint): {
  missingKg: number; refundToBuyer: bigint; penaltyToBuyer: bigint; depositReleasedToSeller: bigint;
  status: "fulfilled" | "partial" | "missed";
} {
  const missingKg = Math.max(0, qtyDueKg - deliveredKg);
  const refundToBuyer = toBig(missingKg) * pricePerKg;
  const rawPenalty = applyBp(refundToBuyer, penaltyBp);
  const penaltyToBuyer = rawPenalty > depositShare ? depositShare : rawPenalty;
  const status = missingKg === 0 ? "fulfilled" : deliveredKg > 0 ? "partial" : "missed";
  return { missingKg, refundToBuyer, penaltyToBuyer, depositReleasedToSeller: depositShare - penaltyToBuyer, status };
}

/**
 * İptal: kalan (teslim edilmemiş) değer üzerinden ceza.
 * Satıcı iptal ederse ceza teminattan alıcıya; alıcı iptal ederse ceza emanetten satıcıya.
 */
export function cancellationPenalty(remainingValue: bigint, penaltyBp: number): bigint {
  return applyBp(remainingValue, penaltyBp);
}

/** Taksit vadeleri (ms) */
export function installmentSchedule(firstDueMs: number, intervalHours: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => firstDueMs + i * intervalHours * 3_600_000);
}
