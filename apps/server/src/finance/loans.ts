/**
 * Krediler: kullanım, günlük taksit görevi, erken ödeme. Anapara payı ve faiz packages/economy'den.
 * Ödenemeyen kısım arrears'a yazılır (faiz → exp_interest, anapara → loans azalır), gecikme ücreti exp_penalties.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { LoanDto, LoanReq, RepayReq } from "@capitalforge/shared";
import { accruedInterest, applyBp, loanInstallment, loanLimit } from "@capitalforge/economy";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { companies, loans } from "../db/schema";
import type { Deps } from "../deps";
import { withTx } from "../deps";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { settleArrears } from "./arrears";
import { lockAccounts } from "./locks";

const DAY_MS = 86_400_000;
type LoanRow = typeof loans.$inferSelect;

export function loanDto(l: LoanRow): LoanDto {
  const next =
    l.status === "active"
      ? loanInstallment(l.principal, l.termDays, l.paidInstallments, l.outstanding, l.dailyInterestBp).total
      : 0n;
  return {
    id: l.id, principal: m(l.principal), outstanding: m(l.outstanding), dailyInterestBp: l.dailyInterestBp, termDays: l.termDays,
    installment: m(next), nextDueAt: l.nextDueAt?.toISOString() ?? null, paidInstallments: l.paidInstallments, status: l.status,
    interestPaid: m(l.interestPaid), createdAt: l.createdAt.toISOString(),
  };
}

export async function outstandingTotal(db: Tx | Deps["db"], companyId: string): Promise<bigint> {
  const r = await db
    .select({ s: sql<string>`coalesce(sum(${loans.outstanding}), 0)::text` })
    .from(loans)
    .where(and(eq(loans.companyId, companyId), eq(loans.status, "active")));
  return BigInt(r[0]?.s ?? "0");
}

export async function takeLoan(tx: Tx, uow: UnitOfWork, catalog: Catalog, companyId: string, req: z.infer<typeof LoanReq>, now: Date): Promise<LoanDto> {
  const s = catalog.settings.loan;
  if (!(s.termsDays as readonly number[]).includes(req.termDays)) fail("BAD_REQUEST", { issue: "termDays" });
  // Şirket satırı kilidi: eşzamanlı iki kredi limiti aşamaz
  const c = (await tx.select().from(companies).where(eq(companies.id, companyId)).for("update"))[0];
  if (!c) fail("NOT_FOUND");
  const limit = loanLimit(c.level, s.limitPerLevel, await outstandingTotal(tx, companyId));
  if (BigInt(req.amount) > limit) fail("LOAN_LIMIT", { maxAmount: m(limit) });
  const [loan] = await tx
    .insert(loans)
    .values({
      companyId, principal: BigInt(req.amount), outstanding: BigInt(req.amount), dailyInterestBp: s.dailyInterestBp,
      termDays: req.termDays, nextDueAt: new Date(now.getTime() + DAY_MS), lastPaymentAt: now, createdAt: now,
    })
    .returning();
  await post(tx, {
    kind: "loan_disburse", idempotencyKey: `loan:${loan!.id}`, refType: "loan", refId: loan!.id, at: now, memo: "Kredi kullanımı",
    lines: [{ account: co(companyId, "cash"), amount: BigInt(req.amount) }, { account: co(companyId, "loans"), amount: -BigInt(req.amount) }],
  });
  await settleArrears(tx, uow, companyId, now);
  uow.invalidate(companyId, "company", "finance");
  return loanDto(loan!);
}

/**
 * Erken ödeme. amount < kalan anapara: yalnızca anapara azalır (taksit takvimi sürer).
 * amount >= kalan anapara: kredi kapanır, kalan anapara + tahakkuk eden faiz alınır (amount üst sınır değil niyet).
 */
export async function repayLoan(tx: Tx, uow: UnitOfWork, companyId: string, loanId: string, req: z.infer<typeof RepayReq>, now: Date): Promise<LoanDto> {
  const l = (await tx.select().from(loans).where(and(eq(loans.id, loanId), eq(loans.companyId, companyId))).for("update"))[0];
  if (!l) fail("NOT_FOUND");
  if (l.status !== "active") fail("LOAN_NOT_ACTIVE");
  const amount = BigInt(req.amount);
  const key = `loan-repay:${l.id}:${req.idempotencyKey}`;
  if (amount >= l.outstanding) {
    const hours = Math.floor((now.getTime() - l.lastPaymentAt.getTime()) / 3_600_000);
    const accrued = accruedInterest(l.outstanding, l.dailyInterestBp, hours);
    const total = l.outstanding + accrued;
    await post(tx, {
      kind: "loan_repay", idempotencyKey: key, refType: "loan", refId: l.id, at: now, memo: "Kredi erken kapama",
      lines: [
        { account: co(companyId, "loans"), amount: l.outstanding },
        { account: co(companyId, "exp_interest"), amount: accrued },
        { account: co(companyId, "cash"), amount: -total },
      ],
    });
    const [u] = await tx
      .update(loans)
      .set({ outstanding: 0n, status: "repaid", nextDueAt: null, lastPaymentAt: now, interestPaid: l.interestPaid + accrued })
      .where(eq(loans.id, l.id))
      .returning();
    uow.invalidate(companyId, "company", "finance");
    return loanDto(u!);
  }
  await post(tx, {
    kind: "loan_repay", idempotencyKey: key, refType: "loan", refId: l.id, at: now, memo: "Kredi kısmi ödeme",
    lines: [{ account: co(companyId, "loans"), amount }, { account: co(companyId, "cash"), amount: -amount }],
  });
  const [u] = await tx.update(loans).set({ outstanding: l.outstanding - amount }).where(eq(loans.id, l.id)).returning();
  uow.invalidate(companyId, "company", "finance");
  return loanDto(u!);
}

/** Bir kredinin vadesi gelen taksitlerini işler (en çok 10, gerisi sonraki turda). */
async function settleInstallments(tx: Tx, uow: UnitOfWork, catalog: Catalog, loanId: string, now: Date): Promise<number> {
  let done = 0;
  const lateFeeBp = catalog.settings.loan.lateFeeBp;
  for (let i = 0; i < 10; i++) {
    const l = (await tx.select().from(loans).where(and(eq(loans.id, loanId), eq(loans.status, "active"), lte(loans.nextDueAt, now))).for("update", { skipLocked: true }))[0];
    if (!l || !l.nextDueAt) break;
    const inst = loanInstallment(l.principal, l.termDays, l.paidInstallments, l.outstanding, l.dailyInterestBp);
    const bal = await lockAccounts(tx, l.companyId, ["cash", "arrears"]);
    const cash = bal.cash ?? 0n;
    const paid = cash < inst.total ? cash : inst.total;
    const unpaid = inst.total - paid;
    const fee = unpaid > 0n ? applyBp(unpaid, lateFeeBp) : 0n;
    await post(tx, {
      kind: "loan_installment", idempotencyKey: `loan-inst:${l.id}:${l.paidInstallments + 1}`, refType: "loan", refId: l.id, at: now,
      memo: `Kredi taksiti ${l.paidInstallments + 1}/${l.termDays}`,
      lines: [
        { account: co(l.companyId, "loans"), amount: inst.principalPart },
        { account: co(l.companyId, "exp_interest"), amount: inst.interest },
        { account: co(l.companyId, "cash"), amount: -paid },
        { account: co(l.companyId, "arrears"), amount: -unpaid },
        { account: co(l.companyId, "exp_penalties"), amount: fee },
        { account: co(l.companyId, "arrears"), amount: -fee },
      ],
    });
    const outstanding = l.outstanding - inst.principalPart;
    const interestPaid = paid < inst.interest ? paid : inst.interest;
    await tx
      .update(loans)
      .set({
        outstanding, paidInstallments: l.paidInstallments + 1, lastPaymentAt: l.nextDueAt, interestPaid: l.interestPaid + interestPaid,
        status: outstanding === 0n ? "repaid" : "active",
        nextDueAt: outstanding === 0n ? null : new Date(l.nextDueAt.getTime() + DAY_MS),
      })
      .where(eq(loans.id, l.id));
    if (unpaid === 0n) {
      await notify(tx, uow, l.companyId, "loan_installment_paid", { amount: m(inst.total), remaining: m(outstanding) }, now, "/play?tab=finance");
    } else {
      const totalArrears = -((bal.arrears ?? 0n) - unpaid - fee);
      await notify(tx, uow, l.companyId, "loan_installment_missed", { amount: m(unpaid + fee), arrears: m(totalArrears) }, now, "/play?tab=finance");
    }
    uow.invalidate(l.companyId, "company", "finance");
    done++;
  }
  return done;
}

export async function loanInstallmentTask(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.status, "active"), lte(loans.nextDueAt, now)))
    .orderBy(loans.nextDueAt)
    .limit(200);
  let n = 0;
  for (const d of due) {
    try {
      n += await withTx(deps, (tx, uow) => settleInstallments(tx, uow, deps.catalog, d.id, now));
    } catch (err) {
      deps.log.error({ err, loanId: d.id }, "kredi taksiti işlenemedi");
    }
  }
  return n;
}
