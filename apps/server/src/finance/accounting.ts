/**
 * Şirket Muhasebesi: dönem özeti, günlük gelir-gider, nakit akışı ve sayfalı işlem geçmişi.
 *
 * Kurallar (hepsi defterden, yalnızca oturumdaki şirketin hesaplarından):
 * - Gelir = gelir hesaplarının alacak toplamı; gider = gider hesaplarının borç toplamı (cogs dahil).
 *   Kredi anaparası (loans), başlangıç sermayesi ve yönetici ayarı (equity) gelir değildir.
 * - Stok alışı inventory'ye (varlık) yazılır; gider yalnızca satışta cogs olarak bir kez doğar.
 * - Ters kayıt kendi kayıt anına (createdAt) düşer; orijinal dönem değişmez.
 * - Oyun günü İstanbul saatidir (UTC+3, yaz saati yok). "Bugün" yerel gece yarısından şimdiye,
 *   "7d"/"30d" bugünle birlikte son 7/30 takvim günü.
 * - Açılış nakdi = dönem başından önceki nakit satırları; kapanış = açılış + dönem net nakit hareketi.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AccountingDto, AccountingPeriod, AccountingTxDto, AccountingTxPageDto } from "@capitalforge/shared";
import type { DbOrTx } from "../db/client";
import { ledgerAccounts, ledgerEntries, ledgerTransactions, sales } from "../db/schema";
import { COMPANY_ACCOUNTS, EXPENSE_CODES, REVENUE_CODES } from "../ledger/accounts";
import { m } from "../lib/serialize";
import { cashflowGroup } from "./report";

const DAY_MS = 86_400_000;
/** Oyun günü saat dilimi (İstanbul, UTC+3) */
export const GAME_TZ_OFFSET_MIN = 180;
const PERIOD_DAYS: Record<AccountingPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

const REV = new Set<string>(REVENUE_CODES);
const EXP = new Set<string>(EXPENSE_CODES);

/** Oyun gününün başlangıcı (UTC anı) ve "YYYY-MM-DD" etiketi */
export function gameDayStart(at: Date, tzMin = GAME_TZ_OFFSET_MIN): Date {
  const shift = tzMin * 60_000;
  return new Date(Math.floor((at.getTime() + shift) / DAY_MS) * DAY_MS - shift);
}
export function gameDayLabel(dayStart: Date, tzMin = GAME_TZ_OFFSET_MIN): string {
  return new Date(dayStart.getTime() + tzMin * 60_000).toISOString().slice(0, 10);
}
export function periodBounds(period: AccountingPeriod, now: Date): { from: Date; to: Date; days: number } {
  const days = PERIOD_DAYS[period];
  return { from: new Date(gameDayStart(now).getTime() - (days - 1) * DAY_MS), to: now, days };
}

const inWindow = (from: Date, to: Date) =>
  sql`${ledgerEntries.createdAt} >= ${from.toISOString()}::timestamptz and ${ledgerEntries.createdAt} <= ${to.toISOString()}::timestamptz`;

/** Gelir (+) ve gider (+) etkisi; bilinmeyen hesaplar etkisiz */
function plEffect(code: string, amount: bigint): { revenue: bigint; expense: bigint } {
  if (REV.has(code)) return { revenue: -amount, expense: 0n };
  if (EXP.has(code)) return { revenue: 0n, expense: amount };
  return { revenue: 0n, expense: 0n };
}

export async function accounting(db: DbOrTx, companyId: string, period: AccountingPeriod, now: Date): Promise<AccountingDto> {
  const { from, to, days } = periodBounds(period, now);
  const tzSec = GAME_TZ_OFFSET_MIN * 60;
  const dayExpr = sql<number>`floor((extract(epoch from ${ledgerEntries.createdAt}) + ${sql.raw(String(tzSec))}) / 86400)::int`;

  // 1) Hesap kodu × oyun günü toplamları (dönem içi)
  const rows = await db
    .select({ code: ledgerAccounts.code, day: dayExpr, s: sql<string>`sum(${ledgerEntries.amount})::text`, n: sql<number>`count(distinct ${ledgerEntries.transactionId})::int` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.companyId, companyId), inWindow(from, to)))
    .groupBy(ledgerAccounts.code, dayExpr);

  const firstDay = Math.floor((from.getTime() + tzSec * 1000) / DAY_MS);
  const daily = Array.from({ length: days }, (_, k) => ({ start: new Date(from.getTime() + k * DAY_MS), revenue: 0n, expense: 0n }));
  const revenueBy: Record<string, bigint> = {};
  const expenseBy: Record<string, bigint> = {};
  for (const r of rows) {
    const v = BigInt(r.s);
    const e = plEffect(r.code, v);
    if (REV.has(r.code)) revenueBy[r.code] = (revenueBy[r.code] ?? 0n) + e.revenue;
    if (EXP.has(r.code)) expenseBy[r.code] = (expenseBy[r.code] ?? 0n) + e.expense;
    const d = daily[r.day - firstDay];
    if (d) { d.revenue += e.revenue; d.expense += e.expense; }
  }
  const revenue = Object.values(revenueBy).reduce((a, b) => a + b, 0n);
  const expense = Object.values(expenseBy).reduce((a, b) => a + b, 0n);

  // 2) Dönemdeki işlem sayısı (boş durum için)
  const cnt = await db
    .select({ n: sql<number>`count(distinct ${ledgerEntries.transactionId})::int` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.companyId, companyId), inWindow(from, to)));

  // 3) Nakit akışı: ters kayıt, düzelttiği işlemin grubunda sayılır
  const orig = alias(ledgerTransactions, "orig");
  const cashRows = await db
    .select({ kind: ledgerTransactions.kind, origKind: orig.kind, s: sql<string>`sum(${ledgerEntries.amount})::text` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .leftJoin(orig, eq(orig.id, ledgerTransactions.reversesId))
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "cash"), inWindow(from, to)))
    .groupBy(ledgerTransactions.kind, orig.kind);
  const g = { operating: 0n, investing: 0n, financing: 0n };
  for (const r of cashRows) g[cashflowGroup(r.kind === "reversal" && r.origKind ? r.origKind : r.kind)] += BigInt(r.s);
  const net = g.operating + g.investing + g.financing;
  const openRow = await db
    .select({ s: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::text` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "cash"), sql`${ledgerEntries.createdAt} < ${from.toISOString()}::timestamptz`));
  const opening = BigInt(openRow[0]?.s ?? "0");
  const cashNow = (await db.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "cash"))).limit(1))[0]?.b ?? 0n;

  const pl = [...REVENUE_CODES, ...EXPENSE_CODES];
  const ever = await db
    .select({ one: sql<number>`1` })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.companyId, companyId), inArray(ledgerAccounts.code, pl)))
    .limit(1);

  const toMoney = (o: Record<string, bigint>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0n).map(([k, v]) => [k, m(v)]));
  return {
    period, from: from.toISOString(), to: to.toISOString(), tzOffsetMin: GAME_TZ_OFFSET_MIN,
    cashNow: m(cashNow),
    summary: { revenue: m(revenue), expense: m(expense), net: m(revenue - expense), revenueByAccount: toMoney(revenueBy), expenseByAccount: toMoney(expenseBy) },
    daily: daily.map((d) => ({ day: gameDayLabel(d.start), from: d.start.toISOString(), revenue: m(d.revenue), expense: m(d.expense), net: m(d.revenue - d.expense) })),
    cashflow: { opening: m(opening), operating: m(g.operating), investing: m(g.investing), financing: m(g.financing), net: m(net), closing: m(opening + net) },
    txCount: cnt[0]?.n ?? 0,
    hasActivity: ever.length > 0,
  };
}

/** Dönem içi işlemler, yeniden eskiye; imleç (zaman, kimlik) ile sayfalı. Yalnızca şirketin kendi satırları. */
export async function accountingTransactions(
  db: DbOrTx, companyId: string, q: { period: AccountingPeriod; before?: string; beforeId?: string; limit: number }, now: Date,
): Promise<AccountingTxPageDto> {
  const { from, to } = periodBounds(q.period, now);
  const mine = db
    .selectDistinct({ id: ledgerEntries.transactionId })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerAccounts.companyId, companyId), inWindow(from, to)));
  const cursor = q.before && q.beforeId
    ? sql`(${ledgerTransactions.createdAt}, ${ledgerTransactions.id}) < (${q.before}::timestamptz, ${q.beforeId}::uuid)`
    : undefined;
  const txs = await db
    .select()
    .from(ledgerTransactions)
    .where(and(inArray(ledgerTransactions.id, mine), cursor))
    .orderBy(desc(ledgerTransactions.createdAt), desc(ledgerTransactions.id))
    .limit(q.limit + 1);
  const page = txs.slice(0, q.limit);
  if (!page.length) return { items: [], next: null };
  const ids = page.map((t) => t.id);
  const lines = await db
    .select({ txId: ledgerEntries.transactionId, code: ledgerAccounts.code, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .where(and(inArray(ledgerEntries.transactionId, ids), eq(ledgerAccounts.companyId, companyId)))
    .orderBy(ledgerEntries.id);
  const saleRows = await db
    .select({ id: sales.id, txs: sales.transactionIds })
    .from(sales)
    .where(and(
      sql`(${sales.sellerCompanyId} = ${companyId} or ${sales.buyerCompanyId} = ${companyId})`,
      sql`${sales.transactionIds} && ARRAY[${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)}]`,
    ));
  const saleOf = new Map<string, string>();
  for (const s of saleRows) for (const t of s.txs) if (!saleOf.has(t)) saleOf.set(t, s.id);

  const items: AccountingTxDto[] = page.map((t) => {
    const ls = lines.filter((l) => l.txId === t.id);
    let cash = 0n, revenue = 0n, expense = 0n;
    for (const l of ls) {
      if (l.code === "cash") cash += l.amount;
      const e = plEffect(l.code, l.amount);
      revenue += e.revenue;
      expense += e.expense;
    }
    return {
      id: t.id, at: t.createdAt.toISOString(), kind: t.kind, memo: t.memo, refType: t.refType, refId: t.refId,
      cash: m(cash), revenue: m(revenue), expense: m(expense), saleId: saleOf.get(t.id) ?? null, reversesId: t.reversesId,
      lines: ls.filter((l) => COMPANY_ACCOUNTS[l.code]).map((l) => ({ account: l.code, amount: m(l.amount) })),
    };
  });
  const last = page[page.length - 1]!;
  return { items, next: txs.length > q.limit ? { before: last.createdAt.toISOString(), beforeId: last.id } : null };
}
