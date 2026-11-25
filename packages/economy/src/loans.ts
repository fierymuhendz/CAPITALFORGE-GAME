import { applyBp, toBig } from "./money";

/** Kredi limiti: seviye × seviye başı limit − açık anapara (negatif olmaz) */
export function loanLimit(level: number, limitPerLevel: bigint | number, outstanding: bigint): bigint {
  const v = toBig(level) * toBig(limitPerLevel) - outstanding;
  return v > 0n ? v : 0n;
}

/**
 * Eşit anaparalı günlük taksit: anapara payı = P / n (kalan son taksite),
 * faiz = kalan anapara × günlük oran (aşağı yuvarlı).
 */
export function loanInstallment(principal: bigint, termDays: number, paidInstallments: number, outstanding: bigint, dailyInterestBp: number): { principalPart: bigint; interest: bigint; total: bigint } {
  const n = toBig(termDays);
  const base = principal / n;
  const isLast = paidInstallments >= termDays - 1;
  const principalPart = isLast ? outstanding : base > outstanding ? outstanding : base;
  const interest = applyBp(outstanding, dailyInterestBp);
  return { principalPart, interest, total: principalPart + interest };
}

/** Erken ödemede bugünkü tahakkuk eden faiz: kalan × oran × geçen gün kesri (saat bazında) */
export function accruedInterest(outstanding: bigint, dailyInterestBp: number, hoursSinceLastPayment: number): bigint {
  const h = Math.max(0, Math.min(24, Math.floor(hoursSinceLastPayment)));
  return (applyBp(outstanding, dailyInterestBp) * toBig(h)) / 24n;
}
