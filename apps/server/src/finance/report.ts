/**
 * Finans raporları: bakiyeler, kâr-zarar, nakit akışı, defter satırları, satışlar ve satış izi.
 * Kâr-zarar gelir/gider hesaplarından, nakit akışı nakit hesabının işlem türüne göre dökümünden gelir
 * (ikisi ayrı gösterilir).
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { FinanceDto, LedgerLineDto, SaleDto, SaleTraceDto } from "@capitalforge/shared";
import { loanLimit } from "@capitalforge/economy";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx } from "../db/client";
import {
  companies, contractInstallments, contracts, ledgerAccounts, ledgerEntries, ledgerTransactions, loans, sales, shipments,
} from "../db/schema";
import { fail } from "../errors";
import { COMPANY_ACCOUNTS, EXPENSE_CODES, REVENUE_CODES } from "../ledger/accounts";
import { m } from "../lib/serialize";
import { loanDto, outstandingTotal } from "./loans";

const DAY_MS = 86_400_000;

/** Nakit akışı sınıflandırması: işlem türü → grup. Bilinmeyen türler faaliyet sayılır. */
const INVESTING = /^(plot_|construction|facility_|upgrade|quality_|vehicle_|fleet_|dissolve)/;
const FINANCING = /^(starting_capital|loan_disburse|loan_repay)/;
export function cashflowGroup(kind: string): "operating" | "investing" | "financing" {
  if (FINANCING.test(kind)) return "financing";
  if (INVESTING.test(kind)) return "investing";
  return "operating";
}

/** Tüm hesap bakiyeleri (ham defter işareti: borç +, alacak −). */
export async function rawBalances(db: DbOrTx, companyId: string): Promise<Record<string, bigint>> {
  const rows = await db.select({ code: ledgerAccounts.code, b: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.companyId, companyId));
  const out: Record<string, bigint> = {};
  for (const r of rows) out[r.code] = r.b;
  return out;
}

export function netWorthOf(b: Record<string, bigint>): bigint {
  // pasifler defterde negatif olduğundan düz toplam: varlıklar − kredi − arrears
  return ["cash", "inventory", "wip", "escrow", "prepaid_freight", "fixed_assets", "loans", "arrears"].reduce((a, c) => a + (b[c] ?? 0n), 0n);
}

/** Pencere içindeki hesap kodu başına hareket toplamı */
async function windowByCode(db: DbOrTx, companyId: string, since: Date): Promise<Record<string, bigint>> {
  const rows = await db
    .select({ code: ledgerAccounts.code, s: sql<string>`sum(${ledgerEntries.amount})::text` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.companyId, companyId), sql`${ledgerEntries.createdAt} >= ${since.toISOString()}::timestamptz`))
    .groupBy(ledgerAccounts.code);
  const out: Record<string, bigint> = {};
  for (const r of rows) out[r.code] = BigInt(r.s);
  return out;
}

export async function pnl(db: DbOrTx, companyId: string, now: Date, days: number): Promise<FinanceDto["pnl"]> {
  const w = await windowByCode(db, companyId, new Date(now.getTime() - days * DAY_MS));
  const revenue = -REVENUE_CODES.reduce((a, c) => a + (w[c] ?? 0n), 0n);
  const cogs = w.cogs ?? 0n;
  const expenses: Record<string, string> = {};
  let expTotal = 0n;
  for (const c of EXPENSE_CODES) {
    if (c === "cogs") continue;
    const v = w[c] ?? 0n;
    expenses[c] = m(v);
    expTotal += v;
  }
  const gross = revenue - cogs;
  return { revenue: m(revenue), cogs: m(cogs), grossProfit: m(gross), expenses, netProfit: m(gross - expTotal), days };
}

export async function cashflow(db: DbOrTx, companyId: string, now: Date, days: number): Promise<FinanceDto["cashflow"]> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const rows = await db
    .select({ kind: ledgerTransactions.kind, s: sql<string>`sum(${ledgerEntries.amount})::text` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "cash"), sql`${ledgerEntries.createdAt} >= ${since.toISOString()}::timestamptz`))
    .groupBy(ledgerTransactions.kind);
  const g = { operating: 0n, investing: 0n, financing: 0n };
  for (const r of rows) g[cashflowGroup(r.kind)] += BigInt(r.s);
  return { operating: m(g.operating), investing: m(g.investing), financing: m(g.financing), net: m(g.operating + g.investing + g.financing), days };
}

export async function financeDto(db: DbOrTx, catalog: Catalog, company: typeof companies.$inferSelect, now: Date): Promise<FinanceDto> {
  const raw = await rawBalances(db, company.id);
  // Gösterim işareti: varlık ve gider hesapları olduğu gibi; pasif, özkaynak ve gelir hesapları pozitif
  const balances: Record<string, string> = {};
  for (const code of Object.keys(COMPANY_ACCOUNTS)) {
    const kind = COMPANY_ACCOUNTS[code]!;
    const v = raw[code] ?? 0n;
    balances[code] = m(kind === "asset" || kind === "expense" ? v : -v);
  }
  const ls = await db.select().from(loans).where(eq(loans.companyId, company.id)).orderBy(desc(loans.createdAt)).limit(30);
  const active = await outstandingTotal(db, company.id);
  const s = catalog.settings.loan;
  return {
    balances,
    pnl: await pnl(db, company.id, now, 7),
    cashflow: await cashflow(db, company.id, now, 7),
    loans: ls.map(loanDto),
    loanOffer: { maxAmount: m(loanLimit(company.level, s.limitPerLevel, active)), dailyInterestBp: s.dailyInterestBp, termsDays: [...s.termsDays] },
    netWorth: m(netWorthOf(raw)),
  };
}

/** Defter satırları, yeniden eskiye. Sayfalama: aynı işlemin satırları bölünmez. */
export async function ledgerLines(db: DbOrTx, companyId: string, before: Date | undefined, pageSize = 100): Promise<LedgerLineDto[]> {
  const rows = await db
    .select({
      txId: ledgerTransactions.id, at: ledgerEntries.createdAt, kind: ledgerTransactions.kind, memo: ledgerTransactions.memo,
      account: ledgerAccounts.code, amount: ledgerEntries.amount, refType: ledgerTransactions.refType, refId: ledgerTransactions.refId,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(and(eq(ledgerAccounts.companyId, companyId), before ? lt(ledgerEntries.createdAt, before) : undefined))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(pageSize + 1);
  let page = rows;
  if (rows.length > pageSize) {
    page = rows.slice(0, pageSize);
    const lastAt = page[page.length - 1]!.at.getTime();
    const trimmed = page.filter((r) => r.at.getTime() !== lastAt);
    if (trimmed.length > 0) page = trimmed;
  }
  return page.map((r) => ({
    transactionId: r.txId, at: r.at.toISOString(), kind: r.kind, memo: r.memo, account: r.account, amount: m(r.amount), refType: r.refType, refId: r.refId,
  }));
}

type SaleRow = typeof sales.$inferSelect;

async function saleDtos(db: DbOrTx, rows: SaleRow[]): Promise<SaleDto[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.sellerCompanyId, r.buyerCompanyId]))];
  const names = ids.length ? await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, ids)) : [];
  const nm = new Map(names.map((n) => [n.id, n.name]));
  return rows.map((r) => ({
    id: r.id, at: r.createdAt.toISOString(), source: r.source, productId: r.productId, quality: r.quality, qtyKg: r.qtyKg, pricePerKg: m(r.pricePerKg),
    buyerName: nm.get(r.buyerCompanyId) ?? "", sellerName: nm.get(r.sellerCompanyId) ?? "", cityId: r.cityId,
    gross: m(r.gross), cogs: m(r.cogs), freight: m(r.freight), fees: m(r.fees), netProfit: m(r.netProfit),
    contractId: r.contractId, installmentId: r.installmentId, shipmentId: r.shipmentId, ledgerTransactionIds: r.transactionIds,
  }));
}

export async function salesList(db: DbOrTx, companyId: string, before: Date | undefined): Promise<SaleDto[]> {
  const rows = await db
    .select()
    .from(sales)
    .where(and(eq(sales.sellerCompanyId, companyId), before ? lt(sales.createdAt, before) : undefined))
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(100);
  return saleDtos(db, rows);
}

export async function saleTrace(db: DbOrTx, companyId: string, saleId: string): Promise<SaleTraceDto> {
  const row = (await db.select().from(sales).where(eq(sales.id, saleId)).limit(1))[0];
  if (!row || (row.sellerCompanyId !== companyId && row.buyerCompanyId !== companyId)) fail("NOT_FOUND");
  const [sale] = await saleDtos(db, [row]);
  const c = row.contractId ? (await db.select().from(contracts).where(eq(contracts.id, row.contractId)).limit(1))[0] : undefined;
  const inst = row.installmentId ? (await db.select().from(contractInstallments).where(eq(contractInstallments.id, row.installmentId)).limit(1))[0] : undefined;
  const sh = row.shipmentId ? (await db.select().from(shipments).where(eq(shipments.id, row.shipmentId)).limit(1))[0] : undefined;
  const txs = row.transactionIds.length
    ? await db.select().from(ledgerTransactions).where(inArray(ledgerTransactions.id, row.transactionIds)).orderBy(ledgerTransactions.createdAt)
    : [];
  const lines = txs.length
    ? await db
        .select({ txId: ledgerEntries.transactionId, account: ledgerAccounts.code, amount: ledgerEntries.amount })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(and(inArray(ledgerEntries.transactionId, txs.map((t) => t.id)), eq(ledgerAccounts.companyId, companyId)))
        .orderBy(ledgerEntries.id)
    : [];
  return {
    sale: sale!,
    contract: c ? { id: c.id, status: c.status, pricePerKg: m(c.pricePerKg), deliveryCityId: c.deliveryCityId, installments: c.installments } : null,
    installment: inst ? { id: inst.id, seq: inst.seq, dueAt: inst.dueAt.toISOString(), status: inst.status } : null,
    shipment: sh
      ? { id: sh.id, originCityId: sh.originCityId, destCityId: sh.destCityId, departedAt: sh.departedAt.toISOString(), arrivesAt: sh.arrivesAt.toISOString(), deliveredAt: sh.deliveredAt?.toISOString() ?? null, status: sh.status }
      : null,
    transactions: txs.map((t) => ({
      id: t.id, at: t.createdAt.toISOString(), kind: t.kind, memo: t.memo,
      lines: lines.filter((l) => l.txId === t.id).map((l) => ({ account: l.account, amount: m(l.amount) })),
    })),
  };
}
