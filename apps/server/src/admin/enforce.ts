/**
 * Yaptırımlar (yalnızca yönetici uygular). Hepsi çağıranın veritabanı işlemi içinde çalışır; denetim kaydı ve
 * inceleme dosyası olayı çağıran (cases.ts) yazar.
 *
 * NOT (Modül B): ilan/emir ve sözleşme iptal mantığı Modül B'de yazıldığında `cancelOrderAsAdmin` ve
 * `cancelContractAsAdmin` ince sarmalayıcıya çevrilip B fonksiyonlarını çağırmalıdır. Şimdilik yalnızca durum
 * geçişi ve emanet/rezerv iadesi yapılır (ceza yok).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../db/client";
import {
  accounts, companies, contractInstallments, contracts, holdings, inventoryMovements, ledgerAccounts, ledgerEntries,
  ledgerTransactions, marketOrders, trades,
} from "../db/schema";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { lockHolding, releaseStock } from "../inventory/holdings";
import { co, post, reverse } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { uuidParam } from "./common";

export interface EnforceCtx { tx: Tx; uow: UnitOfWork; now: Date; adminId: string }
export interface EnforceResult { targetType: string; targetId: string; before: unknown; after: unknown }

/** Ters kayıtla düzeltilebilen hesap kodları: iş kaydı (emanet, kredi, tesis...) ile bağı olmayanlar */
const REVERSIBLE_CODES = new Set([
  "cash", "inventory", "revenue_sales", "revenue_freight", "revenue_other", "cogs", "exp_freight", "exp_fees", "exp_other", "exp_fleet", "exp_penalties", "equity",
]);

export async function freezeAccount(c: EnforceCtx, targetId: string, freeze: boolean): Promise<EnforceResult> {
  const id = uuidParam(targetId);
  const a = (await c.tx.select().from(accounts).where(eq(accounts.id, id)).for("update").limit(1))[0];
  if (!a) fail("NOT_FOUND");
  if (a.role === "admin") fail("FORBIDDEN");
  if (freeze === !!a.frozenAt) fail("CONFLICT");
  await c.tx.update(accounts).set({ frozenAt: freeze ? c.now : null }).where(eq(accounts.id, id));
  const co_ = (await c.tx.select({ id: companies.id }).from(companies).where(and(eq(companies.accountId, id), isNull(companies.dissolvedAt))).limit(1))[0];
  if (co_) await notify(c.tx, c.uow, co_.id, freeze ? "account_frozen" : "account_unfrozen", {}, c.now);
  return { targetType: "account", targetId: id, before: { frozen: !!a.frozenAt }, after: { frozen: freeze } };
}

export async function reverseTransaction(c: EnforceCtx, targetId: string): Promise<EnforceResult> {
  const id = uuidParam(targetId);
  // Hem defter işlemi hem anlık işlem (trade) kimliği kabul edilir
  let txId = id;
  const tr = (await c.tx.select({ t: trades.transactionId }).from(trades).where(eq(trades.id, id)).limit(1))[0];
  if (tr) txId = tr.t;
  const orig = (await c.tx.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, txId)).limit(1))[0];
  if (!orig) fail("NOT_FOUND");
  if (orig.kind === "reversal") fail("CONFLICT", { reason: "ALREADY_REVERSAL" });
  const already = await c.tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.reversesId, txId)).limit(1);
  if (already[0]) fail("CONFLICT", { reason: "ALREADY_REVERSED" });

  const lines = await c.tx
    .select({ amount: ledgerEntries.amount, companyId: ledgerAccounts.companyId, code: ledgerAccounts.code })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(eq(ledgerEntries.transactionId, txId));
  if (lines.some((l) => !REVERSIBLE_CODES.has(l.code))) fail("CONFLICT", { reason: "REVERSAL_UNSUPPORTED" });

  // Stok hareketleri: defterdeki stok satırlarıyla birebir eşleşmeli, yoksa defter ile depo ayrışır
  const moves = await c.tx.select().from(inventoryMovements).where(eq(inventoryMovements.transactionId, txId));
  const ledgerInv = new Map<string, bigint>();
  for (const l of lines) if (l.code === "inventory" && l.companyId) ledgerInv.set(l.companyId, (ledgerInv.get(l.companyId) ?? 0n) + l.amount);
  const moveInv = new Map<string, bigint>();
  for (const mv of moves) moveInv.set(mv.companyId, (moveInv.get(mv.companyId) ?? 0n) + mv.cost);
  for (const k of new Set([...ledgerInv.keys(), ...moveInv.keys()])) {
    if ((ledgerInv.get(k) ?? 0n) !== (moveInv.get(k) ?? 0n)) fail("CONFLICT", { reason: "REVERSAL_UNSUPPORTED" });
  }

  // Depo kayıtlarını tersine çevir (sabit sırayla kilitle)
  const sorted = [...moves].sort((a, b) => `${a.companyId}|${a.cityId}|${a.productId}|${a.quality}`.localeCompare(`${b.companyId}|${b.cityId}|${b.productId}|${b.quality}`));
  for (const mv of sorted) {
    const h = await lockHolding(c.tx, { companyId: mv.companyId, cityId: mv.cityId, productId: mv.productId, quality: mv.quality });
    const qty = h.qtyKg - mv.qtyKg;
    const cost = h.costTotal - mv.cost;
    if (qty < 0 || qty < h.reservedKg || cost < 0n) fail("CONFLICT", { reason: "STOCK_ALREADY_USED", productId: mv.productId });
    await c.tx.update(holdings).set({ qtyKg: qty, costTotal: cost, updatedAt: c.now }).where(eq(holdings.id, h.id));
  }

  const rev = await reverse(c.tx, txId, c.now, `Yönetici ters kaydı: ${orig.kind}`);
  for (const mv of sorted) {
    await c.tx.insert(inventoryMovements).values({
      companyId: mv.companyId, cityId: mv.cityId, productId: mv.productId, quality: mv.quality, qtyKg: -mv.qtyKg, cost: -mv.cost,
      kind: "reversal", refType: "ledger_transaction", refId: txId, transactionId: rev.id, createdAt: c.now,
    });
  }
  const companyIds = [...new Set(lines.map((l) => l.companyId).filter((x): x is string => !!x))];
  for (const cid of companyIds) {
    await notify(c.tx, c.uow, cid, "admin_transaction_reversed", { kind: orig.kind }, c.now);
    c.uow.invalidate(cid, "finance", "inventory", "company");
  }
  return { targetType: "ledger_transaction", targetId: txId, before: { kind: orig.kind, lines: lines.length }, after: { reversalId: rev.id, stockMoves: moves.length } };
}

export async function cancelOrderAsAdmin(c: EnforceCtx, targetId: string): Promise<EnforceResult> {
  const id = uuidParam(targetId);
  const o = (await c.tx.select().from(marketOrders).where(eq(marketOrders.id, id)).for("update").limit(1))[0];
  if (!o) fail("NOT_FOUND");
  if (o.status !== "open") fail("ORDER_CLOSED");
  if (o.side === "sell") {
    if (o.remainingKg > 0) await releaseStock(c.tx, { companyId: o.companyId, cityId: o.cityId, productId: o.productId, quality: o.quality }, o.remainingKg);
  } else if (o.escrowRemaining > 0n) {
    await post(c.tx, {
      kind: "admin_order_cancel", idempotencyKey: `admin-cancel-order:${id}`, refType: "market_order", refId: id, at: c.now, memo: "Yönetici emir iptali: emanet iadesi",
      lines: [{ account: co(o.companyId, "cash"), amount: o.escrowRemaining }, { account: co(o.companyId, "escrow"), amount: -o.escrowRemaining }],
    });
  }
  await c.tx.update(marketOrders).set({ status: "cancelled", escrowRemaining: 0n, closedAt: c.now }).where(eq(marketOrders.id, id));
  await notify(c.tx, c.uow, o.companyId, "admin_listing_cancelled", { productId: o.productId, cityId: o.cityId }, c.now);
  c.uow.invalidate(o.companyId, "market", "inventory", "finance");
  c.uow.world("market");
  return {
    targetType: "market_order", targetId: id,
    before: { side: o.side, status: o.status, remainingKg: o.remainingKg, escrowRemaining: m(o.escrowRemaining) },
    after: { status: "cancelled", refunded: m(o.side === "buy" ? o.escrowRemaining : 0n) },
  };
}

export async function cancelContractAsAdmin(c: EnforceCtx, targetId: string): Promise<EnforceResult> {
  const id = uuidParam(targetId);
  const k = (await c.tx.select().from(contracts).where(eq(contracts.id, id)).for("update").limit(1))[0];
  if (!k) fail("NOT_FOUND");
  if (k.status !== "proposed" && k.status !== "active") fail("CONTRACT_NOT_ACTIVE");
  let buyerRefund = 0n, sellerRefund = 0n;
  if (k.status === "active" && k.buyerCompanyId && k.sellerCompanyId) {
    const insts = await c.tx
      .select().from(contractInstallments)
      .where(and(eq(contractInstallments.contractId, id), isNull(contractInstallments.settledAt)))
      .orderBy(contractInstallments.seq).for("update");
    for (const i of insts) { buyerRefund += i.escrowRemaining; sellerRefund += i.depositShare; }
    const p = await post(c.tx, {
      kind: "admin_contract_cancel", idempotencyKey: `admin-cancel-contract:${id}`, refType: "contract", refId: id, at: c.now, memo: "Yönetici sözleşme iptali: emanet ve teminat iadesi",
      lines: [
        { account: co(k.buyerCompanyId, "cash"), amount: buyerRefund }, { account: co(k.buyerCompanyId, "escrow"), amount: -buyerRefund },
        { account: co(k.sellerCompanyId, "cash"), amount: sellerRefund }, { account: co(k.sellerCompanyId, "escrow"), amount: -sellerRefund },
      ],
    });
    for (const i of insts) {
      await c.tx.update(contractInstallments).set({
        status: "cancelled", escrowRemaining: 0n, refundedToBuyer: i.refundedToBuyer + i.escrowRemaining, settledAt: c.now, settleTransactionId: p.id,
      }).where(eq(contractInstallments.id, i.id));
    }
  }
  await c.tx.update(contracts).set({ status: "cancelled", closedAt: c.now }).where(eq(contracts.id, id));
  for (const cid of new Set([k.sellerCompanyId, k.buyerCompanyId, k.proposerCompanyId].filter((x): x is string => !!x))) {
    await notify(c.tx, c.uow, cid, "admin_contract_cancelled", { productId: k.productId }, c.now);
    c.uow.invalidate(cid, "contracts", "finance");
  }
  return {
    targetType: "contract", targetId: id,
    before: { status: k.status },
    after: { status: "cancelled", buyerRefund: m(buyerRefund), sellerRefund: m(sellerRefund) },
  };
}
