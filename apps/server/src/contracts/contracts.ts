/**
 * Sözleşmeler: teklif, kabul (emanet + teminat), teslim, taksit kapanışı, iptal, süre dolumu.
 * Kilit sırası: sözleşme satırı → taksit satırı → stok satırları (sıralı) → defter.
 * Koşullar kabulde `terms` JSON'a dondurulur; taksitler terms + taksit satırlarıyla yerleşir.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  allocate, cancellationPenalty, contractEscrows, deliveryPayment, installmentSchedule, reputationBp, settleInstallment,
} from "@capitalforge/economy";
import type {
  ContractDetailDto, ContractDto, ContractProposalReq, DeliverReq, InstallmentDto,
} from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import type { Db, DbOrTx, Tx } from "../db/client";
import {
  companies, contractDeliveries, contractInstallments, contracts, freightJobs, notifications, sales,
} from "../db/schema";
import type { Deps } from "../deps";
import { fail } from "../errors";
import { UnitOfWork } from "../events/bus";
import { addXp } from "../company/found";
import { addStock, lockHolding, removeStock, type HoldingKey } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { afterCashIn, companyBriefs, HOUR, linkMovements, type CompanyRow } from "../market/common";

export type ContractRow = typeof contracts.$inferSelect;
export type InstRow = typeof contractInstallments.$inferSelect;

export interface FrozenTerms {
  productId: string; minQuality: number; qtyPerInstallmentKg: number; pricePerKg: string; deliveryCityId: string;
  freightPayer: "seller" | "buyer"; installments: number; firstDueAt: string; intervalHours: number; graceHours: number;
  penaltyBp: number; lateFeeBp: number; windowHoursBeforeDue: number; buyerEscrow: string; sellerDeposit: string;
  sellerCompanyId: string; buyerCompanyId: string; acceptedAt: string;
  schedule: Array<{ seq: number; dueAt: string; windowOpensAt: string; graceEndsAt: string; depositShare: string }>;
}

/** Yerleşimde kullanılan koşullar: dondurulmuş terms, yoksa sütunlar */
export function termsOf(c: ContractRow) {
  const t = c.terms as FrozenTerms | null;
  return {
    price: t ? BigInt(t.pricePerKg) : c.pricePerKg,
    penaltyBp: t?.penaltyBp ?? c.penaltyBp,
    lateFeeBp: t?.lateFeeBp ?? c.lateFeeBp,
    minQuality: t?.minQuality ?? c.minQuality,
    productId: t?.productId ?? c.productId,
    deliveryCityId: t?.deliveryCityId ?? c.deliveryCityId,
    freightPayer: t?.freightPayer ?? c.freightPayer,
  };
}

export async function lockContract(tx: Tx, id: string): Promise<ContractRow> {
  const r = (await tx.select().from(contracts).where(eq(contracts.id, id)).for("update"))[0];
  if (!r) fail("NOT_FOUND");
  return r;
}
export async function lockInstallment(tx: Tx, id: string): Promise<InstRow> {
  const r = (await tx.select().from(contractInstallments).where(eq(contractInstallments.id, id)).for("update"))[0];
  if (!r) fail("NOT_FOUND");
  return r;
}

const SYSTEM_BAD = "BAD_REQUEST" as const;

// ---------------------------------------------------------------- teklif

export async function proposeContract(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof ContractProposalReq>, now: Date,
): Promise<ContractRow> {
  const s = catalog.settings.contracts;
  catalog.product(req.productId);
  catalog.city(req.deliveryCityId);
  if (req.penaltyBp < s.minPenaltyBp || req.penaltyBp > s.maxPenaltyBp) fail(SYSTEM_BAD, { issue: "penaltyBp" });
  const firstDue = new Date(req.firstDueAt);
  if (!(firstDue.getTime() > now.getTime())) fail(SYSTEM_BAD, { issue: "firstDueAt" });
  if (req.counterpartyCompanyId) {
    if (req.counterpartyCompanyId === company.id) fail("OWN_ORDER");
    const cp = (await tx.select().from(companies).where(eq(companies.id, req.counterpartyCompanyId)))[0];
    if (!cp || cp.dissolvedAt || cp.isSystem) fail("NOT_FOUND");
  }
  const open = await tx.select({ n: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.proposerCompanyId, company.id), eq(contracts.status, "proposed")));
  if ((open[0]?.n ?? 0) >= 50) fail("CONFLICT");
  const cpId = req.counterpartyCompanyId ?? null;
  const [row] = await tx
    .insert(contracts)
    .values({
      status: "proposed", proposerCompanyId: company.id, proposerRole: req.role, counterpartyCompanyId: cpId,
      sellerCompanyId: req.role === "seller" ? company.id : cpId, buyerCompanyId: req.role === "buyer" ? company.id : cpId,
      productId: req.productId, minQuality: req.minQuality, qtyPerInstallmentKg: req.qtyPerInstallmentKg,
      pricePerKg: BigInt(req.pricePerKg), deliveryCityId: req.deliveryCityId, freightPayer: req.freightPayer,
      installments: req.installments, firstDueAt: firstDue, intervalHours: req.intervalHours, graceHours: req.graceHours,
      penaltyBp: req.penaltyBp, lateFeeBp: s.lateFeeBp, expiresAt: new Date(now.getTime() + req.expiresInHours * HOUR),
      note: req.note ?? null, createdAt: now,
    })
    .returning();
  if (cpId) {
    await notify(tx, uow, cpId, "contract_offer_received", { contractId: row!.id, productId: req.productId, from: company.name }, now, `/play?tab=contracts&id=${row!.id}`);
  }
  uow.invalidate(company.id, "contracts");
  uow.invalidate(cpId, "contracts");
  return row!;
}

// ---------------------------------------------------------------- kabul

export async function acceptContract(tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, contractId: string, now: Date): Promise<ContractRow> {
  const c = await lockContract(tx, contractId);
  if (c.status !== "proposed" || c.expiresAt.getTime() <= now.getTime() || c.firstDueAt.getTime() <= now.getTime()) fail("CONTRACT_NOT_OPEN");
  if (c.proposerCompanyId === company.id) fail("OWN_ORDER");
  if (c.counterpartyCompanyId && c.counterpartyCompanyId !== company.id) fail("NOT_PARTY");
  const sellerId = c.proposerRole === "seller" ? c.proposerCompanyId : company.id;
  const buyerId = c.proposerRole === "buyer" ? c.proposerCompanyId : company.id;
  const window = catalog.settings.contracts.windowHoursBeforeDue;
  const price = c.pricePerKg;
  const esc = contractEscrows({ qtyPerInstallmentKg: c.qtyPerInstallmentKg, pricePerKg: price, installments: c.installments, penaltyBp: c.penaltyBp, lateFeeBp: c.lateFeeBp });
  // Emanet + teminat: tek işlem; hesaplar post() içinde sıralı kilitlenir
  await post(tx, {
    kind: "contract_accept", idempotencyKey: `contract-accept:${c.id}`, refType: "contract", refId: c.id, at: now, memo: "Sözleşme emaneti ve teminatı",
    lines: [
      { account: co(buyerId, "escrow"), amount: esc.buyerEscrow }, { account: co(buyerId, "cash"), amount: -esc.buyerEscrow },
      { account: co(sellerId, "escrow"), amount: esc.sellerDeposit }, { account: co(sellerId, "cash"), amount: -esc.sellerDeposit },
    ],
  });
  const dues = installmentSchedule(c.firstDueAt.getTime(), c.intervalHours, c.installments);
  const perQty = BigInt(c.qtyPerInstallmentKg) * price;
  const schedule = dues.map((d, i) => ({
    seq: i + 1, dueAt: new Date(d), windowOpensAt: new Date(d - window * HOUR), graceEndsAt: new Date(d + c.graceHours * HOUR), depositShare: esc.perInstallmentDeposit[i]!,
  }));
  await tx.insert(contractInstallments).values(
    schedule.map((x) => ({
      contractId: c.id, seq: x.seq, dueAt: x.dueAt, windowOpensAt: x.windowOpensAt, graceEndsAt: x.graceEndsAt,
      qtyDueKg: c.qtyPerInstallmentKg, status: (x.windowOpensAt.getTime() <= now.getTime() ? "open" : "scheduled") as "open" | "scheduled",
      escrowRemaining: perQty, depositShare: x.depositShare,
    })),
  );
  const terms: FrozenTerms = {
    productId: c.productId, minQuality: c.minQuality, qtyPerInstallmentKg: c.qtyPerInstallmentKg, pricePerKg: price.toString(),
    deliveryCityId: c.deliveryCityId, freightPayer: c.freightPayer, installments: c.installments, firstDueAt: c.firstDueAt.toISOString(),
    intervalHours: c.intervalHours, graceHours: c.graceHours, penaltyBp: c.penaltyBp, lateFeeBp: c.lateFeeBp, windowHoursBeforeDue: window,
    buyerEscrow: esc.buyerEscrow.toString(), sellerDeposit: esc.sellerDeposit.toString(), sellerCompanyId: sellerId, buyerCompanyId: buyerId,
    acceptedAt: now.toISOString(),
    schedule: schedule.map((x) => ({ seq: x.seq, dueAt: x.dueAt.toISOString(), windowOpensAt: x.windowOpensAt.toISOString(), graceEndsAt: x.graceEndsAt.toISOString(), depositShare: x.depositShare.toString() })),
  };
  const [row] = await tx
    .update(contracts)
    .set({ status: "active", sellerCompanyId: sellerId, buyerCompanyId: buyerId, terms, buyerEscrow: esc.buyerEscrow, sellerDeposit: esc.sellerDeposit, acceptedAt: now })
    .where(eq(contracts.id, c.id))
    .returning();
  const names = await companyBriefs(tx, [c.proposerCompanyId]);
  if (!names.get(c.proposerCompanyId)?.isSystem) {
    await notify(tx, uow, c.proposerCompanyId, "contract_accepted", { contractId: c.id, productId: c.productId, by: company.name }, now, `/play?tab=contracts&id=${c.id}`);
  }
  uow.invalidate(sellerId, "contracts", "finance", "company");
  uow.invalidate(buyerId, "contracts", "finance", "company");
  return row!;
}

export async function declineContract(tx: Tx, uow: UnitOfWork, company: CompanyRow, contractId: string, now: Date): Promise<void> {
  const c = await lockContract(tx, contractId);
  if (c.status !== "proposed") fail("CONTRACT_NOT_OPEN");
  if (c.counterpartyCompanyId !== company.id) fail("NOT_PARTY");
  await tx.update(contracts).set({ status: "declined", closedAt: now }).where(eq(contracts.id, c.id));
  await notify(tx, uow, c.proposerCompanyId, "contract_declined", { contractId: c.id, by: company.name }, now, `/play?tab=contracts&id=${c.id}`);
  uow.invalidate(c.proposerCompanyId, "contracts");
  uow.invalidate(company.id, "contracts");
}

export async function withdrawContract(tx: Tx, uow: UnitOfWork, company: CompanyRow, contractId: string, now: Date): Promise<void> {
  const c = await lockContract(tx, contractId);
  if (c.proposerCompanyId !== company.id) fail("NOT_PARTY");
  if (c.status !== "proposed") fail("CONTRACT_NOT_OPEN");
  await tx.update(contracts).set({ status: "cancelled", closedAt: now, cancelledBy: company.id }).where(eq(contracts.id, c.id));
  uow.invalidate(company.id, "contracts");
  uow.invalidate(c.counterpartyCompanyId, "contracts");
}

// ---------------------------------------------------------------- teslim

export interface DeliveryArgs {
  contractId: string;
  installmentId: string;
  qtyKg: number;
  quality: number;
  at: Date;
  source: { kind: "stock" } | { kind: "cargo"; costBasis: bigint; shipmentId: string };
  /** satış kaydına yazılan, bu teslime düşen satıcı navlunu (defter işlemi sevkiyat varışında ayrıca yazılır) */
  freight: bigint;
}

export interface DeliveryResult { deliveryId: string; saleId: string; transactionId: string; gross: bigint; lateFee: bigint; net: bigint; cogs: bigint; late: boolean }

/** Bir teslimi yerleştirir (elle veya sevkiyat varışı). Çağıran sözleşmeyi kilitlemiş olmalıdır. */
export async function applyContractDelivery(tx: Tx, uow: UnitOfWork, catalog: Catalog, a: DeliveryArgs): Promise<DeliveryResult> {
  const c = (await tx.select().from(contracts).where(eq(contracts.id, a.contractId)))[0];
  if (!c || c.status !== "active") fail("CONTRACT_NOT_ACTIVE");
  const inst = await lockInstallment(tx, a.installmentId);
  if (inst.contractId !== c.id) fail("NOT_FOUND");
  if (inst.settledAt) fail("INSTALLMENT_NOT_OPEN");
  const t = termsOf(c);
  const left = inst.qtyDueKg - inst.qtyDeliveredKg;
  if (a.qtyKg <= 0 || a.qtyKg > left) fail("BAD_REQUEST", { issue: "qtyKg" });
  if (a.quality < t.minQuality) fail("QUALITY_TOO_LOW", { minQuality: t.minQuality });
  const sellerId = c.sellerCompanyId!;
  const buyerId = c.buyerCompanyId!;
  const late = a.at.getTime() > inst.dueAt.getTime();
  const dp = deliveryPayment(a.qtyKg, t.price, late, t.lateFeeBp);
  const deliveryId = randomUUID();
  const saleId = randomUUID();
  const bk: HoldingKey = { companyId: buyerId, cityId: t.deliveryCityId, productId: t.productId, quality: a.quality };
  let cogs: bigint;
  if (a.source.kind === "stock") {
    const sk: HoldingKey = { ...bk, companyId: sellerId };
    const ks = [sk, bk].sort((x, y) => x.companyId.localeCompare(y.companyId));
    for (const k of ks) await lockHolding(tx, k);
    cogs = await removeStock(tx, sk, a.qtyKg, { kind: "contract_delivery", refType: "contract_delivery", refId: deliveryId, at: a.at });
  } else {
    cogs = a.source.costBasis;
    await lockHolding(tx, bk);
  }
  await addStock(tx, bk, a.qtyKg, dp.gross, { kind: "contract_receipt", refType: "contract_delivery", refId: deliveryId, at: a.at });
  const led = await post(tx, {
    kind: "contract_delivery", idempotencyKey: `contract-delivery:${deliveryId}`, refType: "contract_delivery", refId: deliveryId, at: a.at,
    memo: `Sözleşme teslimi ${t.productId} ${a.qtyKg} kg`,
    lines: [
      { account: co(sellerId, "cogs"), amount: cogs }, { account: co(sellerId, "inventory"), amount: -cogs },
      { account: co(sellerId, "cash"), amount: dp.net }, { account: co(sellerId, "revenue_sales"), amount: -dp.gross },
      { account: co(sellerId, "exp_penalties"), amount: dp.lateFee },
      { account: co(buyerId, "inventory"), amount: dp.gross }, { account: co(buyerId, "escrow"), amount: -dp.gross },
      { account: co(buyerId, "cash"), amount: dp.lateFee }, { account: co(buyerId, "revenue_other"), amount: -dp.lateFee },
    ],
  });
  await linkMovements(tx, "contract_delivery", deliveryId, led.id);
  await tx.insert(sales).values({
    id: saleId, sellerCompanyId: sellerId, buyerCompanyId: buyerId, source: "contract", cityId: t.deliveryCityId, productId: t.productId,
    quality: a.quality, qtyKg: a.qtyKg, pricePerKg: t.price, gross: dp.gross, cogs, freight: a.freight, fees: dp.lateFee,
    netProfit: dp.gross - cogs - a.freight - dp.lateFee, contractId: c.id, installmentId: inst.id,
    shipmentId: a.source.kind === "cargo" ? a.source.shipmentId : null, transactionIds: [led.id], createdAt: a.at,
  });
  await tx.insert(contractDeliveries).values({
    id: deliveryId, installmentId: inst.id, contractId: c.id, qtyKg: a.qtyKg, quality: a.quality, late,
    shipmentId: a.source.kind === "cargo" ? a.source.shipmentId : null, saleId, transactionId: led.id, deliveredAt: a.at,
  });
  const delivered = inst.qtyDeliveredKg + a.qtyKg;
  await tx
    .update(contractInstallments)
    .set({
      qtyDeliveredKg: delivered, qtyLateKg: inst.qtyLateKg + (late ? a.qtyKg : 0), escrowRemaining: inst.escrowRemaining - dp.gross,
      paidToSeller: inst.paidToSeller + dp.net, lateFees: inst.lateFees + dp.lateFee, status: "open",
    })
    .where(eq(contractInstallments.id, inst.id));
  await addXp(tx, sellerId, catalog.settings.xp.delivery, catalog.settings.levelXp);
  await notify(tx, uow, buyerId, "contract_delivery_received", { contractId: c.id, productId: t.productId, qtyKg: a.qtyKg, late: late ? 1 : 0 }, a.at, `/play?tab=contracts&id=${c.id}`);
  uow.invalidate(sellerId, "contracts", "inventory", "finance", "company");
  uow.invalidate(buyerId, "contracts", "inventory", "finance", "company");
  await afterCashIn(tx, uow, sellerId, a.at);
  await afterCashIn(tx, uow, buyerId, a.at);
  if (delivered >= inst.qtyDueKg) await settleInstallmentTx(tx, uow, catalog, c, inst.id, a.at);
  return { deliveryId, saleId, transactionId: led.id, gross: dp.gross, lateFee: dp.lateFee, net: dp.net, cogs, late };
}

export async function deliverManual(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, installmentId: string, req: z.infer<typeof DeliverReq>, now: Date,
): Promise<DeliveryResult> {
  const probe = (await tx.select({ contractId: contractInstallments.contractId }).from(contractInstallments).where(eq(contractInstallments.id, installmentId)))[0];
  if (!probe) fail("NOT_FOUND");
  const c = await lockContract(tx, probe.contractId);
  if (c.sellerCompanyId !== company.id) fail("NOT_PARTY");
  if (c.status !== "active") fail("CONTRACT_NOT_ACTIVE");
  const inst = await lockInstallment(tx, installmentId);
  if (inst.settledAt || now.getTime() < inst.windowOpensAt.getTime() || now.getTime() >= inst.graceEndsAt.getTime()) fail("INSTALLMENT_NOT_OPEN");
  return applyContractDelivery(tx, uow, catalog, {
    contractId: c.id, installmentId, qtyKg: req.qtyKg, quality: req.quality, at: now, source: { kind: "stock" }, freight: 0n,
  });
}

// ---------------------------------------------------------------- taksit kapanışı

/** Taksiti kapatır (tam teslimde hemen, aksi halde tolerans sonunda). Sözleşme ve taksit satırı kilitli olmalı. */
export async function settleInstallmentTx(tx: Tx, uow: UnitOfWork, catalog: Catalog, c: ContractRow, instId: string, now: Date): Promise<void> {
  const inst = await lockInstallment(tx, instId);
  if (inst.settledAt) return;
  const t = termsOf(c);
  const sellerId = c.sellerCompanyId!;
  const buyerId = c.buyerCompanyId!;
  const r = settleInstallment(inst.qtyDueKg, inst.qtyDeliveredKg, t.price, t.penaltyBp, inst.depositShare);
  const led = await post(tx, {
    kind: "installment_settle", idempotencyKey: `inst-settle:${inst.id}`, refType: "installment", refId: inst.id, at: now, memo: `Taksit ${inst.seq} kapanışı`,
    lines: [
      { account: co(buyerId, "escrow"), amount: -r.refundToBuyer }, { account: co(buyerId, "cash"), amount: r.refundToBuyer + r.penaltyToBuyer },
      { account: co(buyerId, "revenue_other"), amount: -r.penaltyToBuyer },
      { account: co(sellerId, "escrow"), amount: -inst.depositShare },
      { account: co(sellerId, "exp_penalties"), amount: r.penaltyToBuyer },
      { account: co(sellerId, "cash"), amount: r.depositReleasedToSeller },
    ],
  });
  await tx
    .update(contractInstallments)
    .set({ status: r.status, penalty: r.penaltyToBuyer, refundedToBuyer: r.refundToBuyer, escrowRemaining: 0n, settledAt: now, settleTransactionId: led.id })
    .where(eq(contractInstallments.id, inst.id));
  const onTime = r.status === "fulfilled" && inst.qtyLateKg === 0;
  await tx
    .update(companies)
    .set(onTime ? { onTimeDeliveries: sql`${companies.onTimeDeliveries} + 1` } : { lateOrMissed: sql`${companies.lateOrMissed} + 1` })
    .where(eq(companies.id, sellerId));
  if (r.status === "fulfilled") {
    await addXp(tx, sellerId, catalog.settings.xp.contractInstallment, catalog.settings.levelXp);
    await addXp(tx, buyerId, catalog.settings.xp.contractInstallment, catalog.settings.levelXp);
  }
  const params = { contractId: c.id, seq: inst.seq, result: r.status, penalty: r.penaltyToBuyer.toString(), refund: r.refundToBuyer.toString(), missingKg: r.missingKg };
  await notify(tx, uow, sellerId, "installment_closed", params, now, `/play?tab=contracts&id=${c.id}`);
  await notify(tx, uow, buyerId, "installment_closed", params, now, `/play?tab=contracts&id=${c.id}`);
  const rest = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contractInstallments)
    .where(and(eq(contractInstallments.contractId, c.id), isNull(contractInstallments.settledAt)));
  if ((rest[0]?.n ?? 0) === 0) await tx.update(contracts).set({ status: "completed", closedAt: now }).where(eq(contracts.id, c.id));
  uow.invalidate(sellerId, "contracts", "finance", "company");
  uow.invalidate(buyerId, "contracts", "finance", "company");
  await afterCashIn(tx, uow, sellerId, now);
  await afterCashIn(tx, uow, buyerId, now);
}

// ---------------------------------------------------------------- iptal

export async function cancelContract(tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, contractId: string, now: Date): Promise<{ penalty: bigint }> {
  const c = await lockContract(tx, contractId);
  if (c.sellerCompanyId !== company.id && c.buyerCompanyId !== company.id) fail("NOT_PARTY");
  if (c.status !== "active") fail("CONTRACT_NOT_ACTIVE");
  const t = termsOf(c);
  const sellerId = c.sellerCompanyId!;
  const buyerId = c.buyerCompanyId!;
  const insts = await tx
    .select()
    .from(contractInstallments)
    .where(and(eq(contractInstallments.contractId, c.id), isNull(contractInstallments.settledAt)))
    .orderBy(asc(contractInstallments.seq))
    .for("update");
  const rem = insts.map((i) => BigInt(i.qtyDueKg - i.qtyDeliveredKg) * t.price);
  const remaining = rem.reduce((a, b) => a + b, 0n);
  const escrowLeft = insts.reduce((a, i) => a + i.escrowRemaining, 0n);
  const depositLeft = insts.reduce((a, i) => a + i.depositShare, 0n);
  const sellerCancels = company.id === sellerId;
  let penalty = cancellationPenalty(remaining, t.penaltyBp);
  const cap = sellerCancels ? depositLeft : escrowLeft;
  if (penalty > cap) penalty = cap;
  await post(tx, {
    kind: "contract_cancel", idempotencyKey: `contract-cancel:${c.id}`, refType: "contract", refId: c.id, at: now, memo: "Sözleşme iptali",
    lines: [
      { account: co(buyerId, "escrow"), amount: -escrowLeft },
      { account: co(buyerId, "cash"), amount: sellerCancels ? escrowLeft + penalty : escrowLeft - penalty },
      { account: co(sellerId, "escrow"), amount: -depositLeft },
      { account: co(sellerId, "cash"), amount: sellerCancels ? depositLeft - penalty : depositLeft + penalty },
      { account: co(sellerCancels ? sellerId : buyerId, "exp_penalties"), amount: penalty },
      { account: co(sellerCancels ? buyerId : sellerId, "revenue_other"), amount: -penalty },
    ],
  });
  const share = allocate(penalty, rem.map((x) => Number(x)));
  for (let i = 0; i < insts.length; i++) {
    await tx
      .update(contractInstallments)
      .set({
        status: "cancelled", settledAt: now, escrowRemaining: 0n, penalty: share[i] ?? 0n,
        refundedToBuyer: sellerCancels ? rem[i]! : rem[i]! - (share[i] ?? 0n),
      })
      .where(eq(contractInstallments.id, insts[i]!.id));
  }
  await tx.update(contracts).set({ status: "cancelled", closedAt: now, cancelledBy: company.id }).where(eq(contracts.id, c.id));
  await tx.update(companies).set({ lateOrMissed: sql`${companies.lateOrMissed} + 1` }).where(eq(companies.id, company.id));
  const other = sellerCancels ? buyerId : sellerId;
  await notify(tx, uow, other, "contract_cancelled", { contractId: c.id, by: company.name, penalty: penalty.toString() }, now, `/play?tab=contracts&id=${c.id}`);
  uow.invalidate(sellerId, "contracts", "finance", "company");
  uow.invalidate(buyerId, "contracts", "finance", "company");
  void catalog;
  await afterCashIn(tx, uow, sellerId, now);
  await afterCashIn(tx, uow, buyerId, now);
  return { penalty };
}

// ---------------------------------------------------------------- görevler

/** Süresi dolan (veya ilk vadesi geçen) teklifleri kapatır */
export async function expireProposals(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.status, "proposed"), or(lte(contracts.expiresAt, now), lte(contracts.firstDueAt, now))))
    .limit(200);
  let n = 0;
  for (const d of due) {
    await deps.db.transaction(async (tx) => {
      const c = (await tx.select().from(contracts).where(eq(contracts.id, d.id)).for("update", { skipLocked: true }))[0];
      if (!c || c.status !== "proposed") return;
      await tx.update(contracts).set({ status: "expired", closedAt: now }).where(eq(contracts.id, c.id));
      const u = new UnitOfWork();
      await notify(tx, u, c.proposerCompanyId, "contract_expired", { contractId: c.id, productId: c.productId }, now, `/play?tab=contracts&id=${c.id}`);
      u.invalidate(c.proposerCompanyId, "contracts");
      u.flush(deps.events);
      n++;
    });
  }
  return n;
}

/** Taksit pencereleri: scheduled → open (bildirim) ve vadesi yaklaşan taksit uyarısı */
export async function openWindows(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: contractInstallments.id })
    .from(contractInstallments)
    .where(and(eq(contractInstallments.status, "scheduled"), lte(contractInstallments.windowOpensAt, now), isNull(contractInstallments.settledAt)))
    .limit(500);
  let n = 0;
  for (const d of due) {
    const uow = new UnitOfWork();
    const done = await deps.db.transaction(async (tx) => {
      const i = (await tx.select().from(contractInstallments).where(eq(contractInstallments.id, d.id)).for("update", { skipLocked: true }))[0];
      if (!i || i.status !== "scheduled" || i.settledAt) return false;
      const c = (await tx.select().from(contracts).where(eq(contracts.id, i.contractId)))[0];
      if (!c || c.status !== "active") return false;
      await tx.update(contractInstallments).set({ status: "open" }).where(eq(contractInstallments.id, i.id));
      await notify(tx, uow, c.sellerCompanyId!, "installment_window_open", { contractId: c.id, installmentId: i.id, seq: i.seq, dueAt: i.dueAt.toISOString(), qtyKg: i.qtyDueKg, productId: c.productId }, now, `/play?tab=contracts&id=${c.id}`);
      uow.invalidate(c.sellerCompanyId, "contracts");
      uow.invalidate(c.buyerCompanyId, "contracts");
      return true;
    });
    if (done) { uow.flush(deps.events); n++; }
  }
  // vadesine 1 saat kala eksik teslim uyarısı (taksit başına bir kez)
  const soon = await deps.db
    .select()
    .from(contractInstallments)
    .where(and(eq(contractInstallments.status, "open"), isNull(contractInstallments.settledAt), lte(contractInstallments.dueAt, new Date(now.getTime() + HOUR))))
    .limit(500);
  for (const i of soon) {
    if (i.qtyDeliveredKg >= i.qtyDueKg || i.graceEndsAt.getTime() <= now.getTime()) continue;
    const uow = new UnitOfWork();
    const sent = await deps.db.transaction(async (tx) => {
      const i2 = (await tx.select().from(contractInstallments).where(eq(contractInstallments.id, i.id)).for("update", { skipLocked: true }))[0];
      if (!i2 || i2.settledAt) return false;
      const c = (await tx.select().from(contracts).where(eq(contracts.id, i.contractId)))[0];
      if (!c || c.status !== "active") return false;
      const ex = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.kind, "installment_due_soon"), sql`${notifications.params}->>'installmentId' = ${i.id}`)).limit(1);
      if (ex[0]) return false;
      await notify(tx, uow, c.sellerCompanyId!, "installment_due_soon", { contractId: c.id, installmentId: i.id, seq: i.seq, dueAt: i.dueAt.toISOString(), missingKg: i.qtyDueKg - i.qtyDeliveredKg }, now, `/play?tab=contracts&id=${c.id}`);
      return true;
    });
    if (sent) { uow.flush(deps.events); n++; }
  }
  return n;
}

/** Tolerans süresi dolan taksitleri kapatır (eksik/kısmi/ceza) */
export async function closeInstallments(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: contractInstallments.id, contractId: contractInstallments.contractId })
    .from(contractInstallments)
    .where(and(isNull(contractInstallments.settledAt), lte(contractInstallments.graceEndsAt, now)))
    .orderBy(contractInstallments.graceEndsAt)
    .limit(200);
  let n = 0;
  for (const d of due) {
    const uow = new UnitOfWork();
    const ok = await deps.db.transaction(async (tx) => {
      const c = (await tx.select().from(contracts).where(eq(contracts.id, d.contractId)).for("update", { skipLocked: true }))[0];
      if (!c || c.status !== "active") return false;
      const i = (await tx.select().from(contractInstallments).where(eq(contractInstallments.id, d.id)).for("update"))[0];
      if (!i || i.settledAt) return false;
      await settleInstallmentTx(tx, uow, deps.catalog, c, i.id, now);
      return true;
    });
    if (ok) { uow.flush(deps.events); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- DTO'lar

export async function contractDtos(db: DbOrTx, rows: ContractRow[], myId: string | null): Promise<ContractDto[]> {
  const ids = rows.flatMap((r) => [r.proposerCompanyId, r.sellerCompanyId, r.buyerCompanyId].filter((x): x is string => !!x));
  const names = await companyBriefs(db, ids);
  return rows.map((c) => {
    const sn = c.sellerCompanyId ? names.get(c.sellerCompanyId) : undefined;
    const bn = c.buyerCompanyId ? names.get(c.buyerCompanyId) : undefined;
    const t = termsOf(c);
    const value = BigInt(c.qtyPerInstallmentKg) * t.price * BigInt(c.installments);
    return {
      id: c.id, status: c.status, isSystem: c.isSystem, isPublic: !c.counterpartyCompanyId,
      proposerCompanyId: c.proposerCompanyId, sellerCompanyId: c.sellerCompanyId, buyerCompanyId: c.buyerCompanyId,
      sellerName: sn?.name ?? null, buyerName: bn?.name ?? null,
      myRole: myId && c.sellerCompanyId === myId ? "seller" : myId && c.buyerCompanyId === myId ? "buyer" : null,
      productId: c.productId, minQuality: c.minQuality, qtyPerInstallmentKg: c.qtyPerInstallmentKg, pricePerKg: m(t.price),
      deliveryCityId: c.deliveryCityId, freightPayer: c.freightPayer, installments: c.installments,
      firstDueAt: c.firstDueAt.toISOString(), intervalHours: c.intervalHours, graceHours: c.graceHours, penaltyBp: c.penaltyBp,
      lateFeeBp: c.lateFeeBp, expiresAt: c.expiresAt.toISOString(), createdAt: c.createdAt.toISOString(),
      acceptedAt: c.acceptedAt?.toISOString() ?? null, totalValue: m(value),
      buyerEscrow: m(c.status === "proposed" ? value : c.buyerEscrow),
      sellerDeposit: m(c.status === "proposed" ? (value * BigInt(c.penaltyBp)) / 10000n : c.sellerDeposit),
      sellerReputationBp: sn ? reputationBp(sn.onTime, sn.late) : null, buyerReputationBp: bn ? reputationBp(bn.onTime, bn.late) : null,
      note: c.note,
    } as ContractDto;
  });
}

export async function contractDetail(db: Db, row: ContractRow, myId: string | null): Promise<ContractDetailDto> {
  const [dto] = await contractDtos(db, [row], myId);
  const insts = await db.select().from(contractInstallments).where(eq(contractInstallments.contractId, row.id)).orderBy(contractInstallments.seq);
  const dels = insts.length ? await db.select().from(contractDeliveries).where(eq(contractDeliveries.contractId, row.id)).orderBy(contractDeliveries.deliveredAt) : [];
  const jobs = insts.length
    ? await db.select({ id: freightJobs.id, installmentId: freightJobs.installmentId, status: freightJobs.status, createdAt: freightJobs.createdAt }).from(freightJobs).where(inArray(freightJobs.installmentId, insts.map((i) => i.id))).orderBy(desc(freightJobs.createdAt))
    : [];
  const t = termsOf(row);
  const schedule: InstallmentDto[] = insts.map((i) => ({
    id: i.id, seq: i.seq, dueAt: i.dueAt.toISOString(), windowOpensAt: i.windowOpensAt.toISOString(), graceEndsAt: i.graceEndsAt.toISOString(),
    qtyDueKg: i.qtyDueKg, qtyDeliveredKg: i.qtyDeliveredKg, qtyLateKg: i.qtyLateKg, status: i.status,
    paidToSeller: m(i.paidToSeller), lateFees: m(i.lateFees), penalty: m(i.penalty), refundedToBuyer: m(i.refundedToBuyer),
    outstandingKg: i.settledAt ? 0 : i.qtyDueKg - i.qtyDeliveredKg, escrowRemaining: m(i.escrowRemaining),
    deliveries: dels.filter((d) => d.installmentId === i.id).map((d) => ({
      id: d.id, at: d.deliveredAt.toISOString(), qtyKg: d.qtyKg, quality: d.quality, late: d.late, shipmentId: d.shipmentId, saleId: d.saleId, ledgerTransactionId: d.transactionId,
    })),
    freightJobId: jobs.find((j) => j.installmentId === i.id)?.id ?? null,
  }));
  const sum = (f: (i: InstRow) => bigint) => insts.reduce((a, i) => a + f(i), 0n);
  const open = insts.filter((i) => !i.settledAt);
  const deliveredKg = insts.reduce((a, i) => a + i.qtyDeliveredKg, 0);
  return {
    contract: dto!,
    terms: (row.terms as Record<string, unknown> | null) ?? { ...t, price: t.price.toString() },
    schedule,
    balances: {
      seller: {
        delivered: deliveredKg, owedKg: open.reduce((a, i) => a + i.qtyDueKg - i.qtyDeliveredKg, 0),
        received: m(sum((i) => i.paidToSeller)), penaltiesPaid: m(sum((i) => i.penalty + i.lateFees)),
        depositHeld: m(open.reduce((a, i) => a + i.depositShare, 0n)),
      },
      buyer: {
        received: deliveredKg, paid: m(sum((i) => i.paidToSeller + i.lateFees)),
        escrowHeld: m(open.reduce((a, i) => a + i.escrowRemaining, 0n)), refunds: m(sum((i) => i.refundedToBuyer)),
        penaltiesReceived: m(sum((i) => i.penalty + i.lateFees)),
      },
    },
  };
}
