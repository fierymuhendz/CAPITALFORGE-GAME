/**
 * Tahmin ↔ gerçekleşen. Karar anında beklenen rakamlar `deal_outcomes` içine yazılır (yalnızca tahmin);
 * gerçekleşen rakamlar GET /finance/outcomes çağrısında gerçek kayıtlardan (iş, satış, sevkiyat, sözleşme, defter) hesaplanır.
 */
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { OutcomeDto, OutcomeFiguresDto } from "@capitalforge/shared";
import type { DbOrTx, Tx } from "../db/client";
import {
  contractInstallments, contracts, dealOutcomes, freightJobs, inventoryMovements, ledgerAccounts, ledgerEntries, ledgerTransactions,
  productionJobs, sales, shipments, trades,
} from "../db/schema";
import { m } from "../lib/serialize";

export type OutcomeKind = OutcomeDto["kind"];

/** yazılan beklenen rakamlar; para değerleri bigint */
export interface ExpectedIn {
  qtyKg?: number | null;
  revenue?: bigint | null;
  goods?: bigint | null;
  freight?: bigint | null;
  fees?: bigint | null;
  cost?: bigint | null;
  profit?: bigint | null;
  minutes?: number | null;
  at?: Date | null;
  /** DTO'ya çıkmayan bağlantılar (ör. taşıma işi kimlikleri) */
  meta?: Record<string, unknown>;
}

export interface OutcomeIn {
  companyId: string;
  kind: OutcomeKind;
  refType: string;
  refId: string;
  productId?: string | null;
  recipeId?: string | null;
  cityId?: string | null;
  destCityId?: string | null;
  expected: ExpectedIn;
  at: Date;
}

const MONEY_KEYS = ["revenue", "goods", "freight", "fees", "cost", "profit"] as const;

function serialize(e: ExpectedIn): Record<string, unknown> {
  const out: Record<string, unknown> = { qtyKg: e.qtyKg ?? null, minutes: e.minutes ?? null, at: e.at ? e.at.toISOString() : null, meta: e.meta ?? {} };
  for (const k of MONEY_KEYS) out[k] = e[k] === null || e[k] === undefined ? null : e[k]!.toString();
  return out;
}

/** (şirket, tür, referans) başına tek kayıt; tekrar çağrı mevcut kaydı döndürür. Kimliği döndürür. */
export async function writeOutcome(tx: Tx, o: OutcomeIn): Promise<string> {
  const [ins] = await tx
    .insert(dealOutcomes)
    .values({
      companyId: o.companyId, kind: o.kind, refType: o.refType, refId: o.refId, productId: o.productId ?? null, recipeId: o.recipeId ?? null,
      cityId: o.cityId ?? null, destCityId: o.destCityId ?? null, expected: serialize(o.expected), createdAt: o.at,
    })
    .onConflictDoNothing()
    .returning({ id: dealOutcomes.id });
  if (ins) return ins.id;
  const ex = await tx
    .select({ id: dealOutcomes.id })
    .from(dealOutcomes)
    .where(and(eq(dealOutcomes.companyId, o.companyId), eq(dealOutcomes.kind, o.kind), eq(dealOutcomes.refId, o.refId)))
    .limit(1);
  return ex[0]!.id;
}

// ---------------------------------------------------------------- okuma

const EMPTY: OutcomeFiguresDto = { qtyKg: null, revenue: null, goods: null, freight: null, fees: null, cost: null, profit: null, minutes: null, at: null };

function figuresFromExpected(raw: unknown): OutcomeFiguresDto {
  const e = (raw ?? {}) as Record<string, unknown>;
  const money = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : null);
  return {
    qtyKg: typeof e.qtyKg === "number" ? e.qtyKg : null, revenue: money("revenue"), goods: money("goods"), freight: money("freight"),
    fees: money("fees"), cost: money("cost"), profit: money("profit"), minutes: typeof e.minutes === "number" ? e.minutes : null,
    at: typeof e.at === "string" ? e.at : null,
  };
}

const metaOf = (raw: unknown): Record<string, unknown> => ((raw as { meta?: Record<string, unknown> } | null)?.meta ?? {});
const minutesBetween = (a: Date, b: Date): number => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

interface Resolved { status: OutcomeDto["status"]; actual: OutcomeFiguresDto | null; saleIds: string[]; txIds: string[] }
const PENDING: Resolved = { status: "pending", actual: null, saleIds: [], txIds: [] };

type OutRow = typeof dealOutcomes.$inferSelect;

/** Son 50 kayıt, yeniden eskiye; `before` imleci createdAt üzerinden */
export async function outcomesFor(db: DbOrTx, companyId: string, before: Date | undefined, pageSize = 50): Promise<OutcomeDto[]> {
  const fetched = await db
    .select()
    .from(dealOutcomes)
    .where(and(eq(dealOutcomes.companyId, companyId), before ? lt(dealOutcomes.createdAt, before) : undefined))
    .orderBy(desc(dealOutcomes.createdAt), desc(dealOutcomes.id))
    .limit(pageSize + 1);
  let rows = fetched;
  if (fetched.length > pageSize) {
    // sayfa sınırında aynı anın kayıtları bölünmez (imleç createdAt'e göre)
    rows = fetched.slice(0, pageSize);
    const lastAt = rows[rows.length - 1]!.createdAt.getTime();
    const trimmed = rows.filter((r) => r.createdAt.getTime() !== lastAt);
    if (trimmed.length > 0) rows = trimmed;
  }
  const by = (k: OutcomeKind) => rows.filter((r) => r.kind === k);
  const resolved = new Map<string, Resolved>();
  const put = (m2: Map<string, Resolved>) => { for (const [k, v] of m2) resolved.set(k, v); };
  put(await resolveProduction(db, by("production")));
  put(await resolveSales(db, by("sale")));
  put(await resolvePurchases(db, by("purchase")));
  put(await resolveFreightJobs(db, by("freight_job")));
  put(await resolveContracts(db, companyId, by("contract")));
  // yalnızca kendi hesaplarıma dokunan defter işlemleri
  const allTx = [...new Set([...resolved.values()].flatMap((r) => r.txIds))];
  const mineTx = new Set<string>();
  if (allTx.length) {
    const own = await db
      .selectDistinct({ id: ledgerEntries.transactionId })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .where(and(eq(ledgerAccounts.companyId, companyId), inArray(ledgerEntries.transactionId, allTx)));
    for (const o of own) mineTx.add(o.id);
  }
  return rows.map((r) => {
    const res = resolved.get(r.id) ?? PENDING;
    return {
      id: r.id, kind: r.kind, refType: r.refType, refId: r.refId, productId: r.productId, recipeId: r.recipeId, cityId: r.cityId, destCityId: r.destCityId,
      createdAt: r.createdAt.toISOString(), status: res.status, expected: figuresFromExpected(r.expected), actual: res.actual,
      saleIds: res.saleIds, ledgerTransactionIds: [...new Set(res.txIds)].filter((t) => mineTx.has(t)),
    };
  });
}

/** (refType, refId) çiftlerine bağlı defter işlemleri */
async function txByRef(db: DbOrTx, refs: Array<{ refType: string; refId: string }>): Promise<string[]> {
  if (!refs.length) return [];
  const rows = await db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(or(...refs.map((r) => and(eq(ledgerTransactions.refType, r.refType), eq(ledgerTransactions.refId, r.refId)))))
    .orderBy(ledgerTransactions.createdAt);
  return rows.map((r) => r.id);
}

async function resolveProduction(db: DbOrTx, rows: OutRow[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (!rows.length) return out;
  const jobs = await db.select().from(productionJobs).where(inArray(productionJobs.id, rows.map((r) => r.refId)));
  const moves = await db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.refType, "production_job"), eq(inventoryMovements.kind, "production_output"), inArray(inventoryMovements.refId, rows.map((r) => r.refId))));
  for (const r of rows) {
    const j = jobs.find((x) => x.id === r.refId);
    if (!j) { out.set(r.id, { status: "cancelled", actual: null, saleIds: [], txIds: [] }); continue; }
    const txIds = [j.startTransactionId, j.settleTransactionId].filter((x): x is string => !!x);
    if (j.status === "cancelled") { out.set(r.id, { status: "cancelled", actual: null, saleIds: [], txIds }); continue; }
    if (j.status !== "completed" || !j.completedAt) { out.set(r.id, { ...PENDING, txIds }); continue; }
    const mv = moves.find((x) => x.refId === j.id);
    out.set(r.id, {
      status: "settled", saleIds: [], txIds,
      actual: { ...EMPTY, qtyKg: mv?.qtyKg ?? j.outputKg, cost: m(mv?.cost ?? j.costTotal), minutes: minutesBetween(j.startedAt, j.completedAt), at: j.completedAt.toISOString() },
    });
  }
  return out;
}

async function resolveSales(db: DbOrTx, rows: OutRow[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (!rows.length) return out;
  const ts = await db.select().from(trades).where(inArray(trades.id, rows.map((r) => r.refId)));
  const saleIds = ts.map((t) => t.saleId).filter((x): x is string => !!x);
  const ss = saleIds.length ? await db.select().from(sales).where(inArray(sales.id, saleIds)) : [];
  for (const r of rows) {
    const t = ts.find((x) => x.id === r.refId);
    const s = t?.saleId ? ss.find((x) => x.id === t.saleId) : undefined;
    if (!t || !s) { out.set(r.id, { status: "cancelled", actual: null, saleIds: [], txIds: [] }); continue; }
    out.set(r.id, {
      status: "settled", saleIds: [s.id], txIds: [t.transactionId, ...s.transactionIds],
      actual: { ...EMPTY, qtyKg: s.qtyKg, revenue: m(s.gross), fees: m(s.fees), freight: m(s.freight), cost: m(s.cogs), profit: m(s.netProfit), minutes: 0, at: s.createdAt.toISOString() },
    });
  }
  return out;
}

async function resolvePurchases(db: DbOrTx, rows: OutRow[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (!rows.length) return out;
  const ts = await db.select().from(trades).where(inArray(trades.id, rows.map((r) => r.refId)));
  const jobIdsOf = (r: OutRow): string[] => {
    const v = metaOf(r.expected).freightJobIds;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  };
  const allJobIds = rows.flatMap(jobIdsOf);
  const jobs = allJobIds.length ? await db.select().from(freightJobs).where(inArray(freightJobs.id, allJobIds)) : [];
  const shipIds = jobs.map((j) => j.shipmentId).filter((x): x is string => !!x);
  const ships = shipIds.length ? await db.select().from(shipments).where(inArray(shipments.id, shipIds)) : [];
  for (const r of rows) {
    const t = ts.find((x) => x.id === r.refId);
    if (!t) { out.set(r.id, { status: "cancelled", actual: null, saleIds: [], txIds: [] }); continue; }
    const mine = jobIdsOf(r).map((id) => jobs.find((j) => j.id === id)).filter((j): j is NonNullable<typeof j> => !!j);
    const txIds = [t.transactionId, ...(await txByRef(db, mine.map((j) => ({ refType: "freight_job", refId: j.id }))))];
    const saleIds = t.saleId ? [t.saleId] : [];
    const delivered = mine.filter((j) => j.status === "delivered");
    for (const j of delivered) {
      const sh = ships.find((s) => s.id === j.shipmentId);
      if (sh?.arriveTransactionId) txIds.push(sh.arriveTransactionId);
    }
    const open = mine.filter((j) => j.status === "open" || j.status === "assigned" || j.status === "in_transit");
    if (open.length) { out.set(r.id, { status: "pending", actual: null, saleIds, txIds }); continue; }
    if (mine.length && !delivered.length) {
      out.set(r.id, {
        status: "cancelled", saleIds, txIds,
        actual: { ...EMPTY, qtyKg: t.qtyKg, goods: m(t.gross), freight: "0", cost: m(t.gross), at: t.createdAt.toISOString() },
      });
      continue;
    }
    const freight = delivered.reduce((a, j) => a + j.payAmount, 0n);
    const arrivals = delivered.map((j) => ships.find((s) => s.id === j.shipmentId)?.deliveredAt).filter((d): d is Date => !!d);
    const lastArrival = arrivals.length ? new Date(Math.max(...arrivals.map((d) => d.getTime()))) : t.createdAt;
    out.set(r.id, {
      status: "settled", saleIds, txIds,
      actual: {
        ...EMPTY, qtyKg: t.qtyKg, goods: m(t.gross), freight: m(freight), cost: m(t.gross + freight), minutes: minutesBetween(t.createdAt, lastArrival), at: lastArrival.toISOString(),
      },
    });
  }
  return out;
}

async function resolveFreightJobs(db: DbOrTx, rows: OutRow[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (!rows.length) return out;
  const jobs = await db.select().from(freightJobs).where(inArray(freightJobs.id, rows.map((r) => r.refId)));
  const shipIds = jobs.map((j) => j.shipmentId).filter((x): x is string => !!x);
  const ships = shipIds.length ? await db.select().from(shipments).where(inArray(shipments.id, shipIds)) : [];
  for (const r of rows) {
    const j = jobs.find((x) => x.id === r.refId);
    const sh = j?.shipmentId ? ships.find((s) => s.id === j.shipmentId) : undefined;
    if (!j || !sh) { out.set(r.id, { status: "cancelled", actual: null, saleIds: [], txIds: [] }); continue; }
    const txIds = [sh.departTransactionId, sh.arriveTransactionId].filter((x): x is string => !!x);
    if (sh.status !== "delivered" || !sh.deliveredAt) { out.set(r.id, { ...PENDING, txIds }); continue; }
    // komisyon: varış işleminde taşıyıcının exp_fees satırı
    let fees = 0n;
    if (sh.arriveTransactionId) {
      const e = await db
        .select({ amount: ledgerEntries.amount })
        .from(ledgerEntries)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
        .where(and(eq(ledgerEntries.transactionId, sh.arriveTransactionId), eq(ledgerAccounts.companyId, sh.carrierCompanyId), eq(ledgerAccounts.code, "exp_fees")));
      fees = e.reduce((a, x) => a + x.amount, 0n);
    }
    const cost = sh.fuelCost + sh.driverCost;
    out.set(r.id, {
      status: "settled", saleIds: [], txIds,
      actual: {
        ...EMPTY, qtyKg: j.totalKg, revenue: m(j.payAmount), fees: m(fees), cost: m(cost), profit: m(j.payAmount - fees - cost),
        minutes: minutesBetween(sh.departedAt, sh.deliveredAt), at: sh.deliveredAt.toISOString(),
      },
    });
  }
  return out;
}

async function resolveContracts(db: DbOrTx, companyId: string, rows: OutRow[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (!rows.length) return out;
  const ids = rows.map((r) => r.refId);
  const cs = await db.select().from(contracts).where(inArray(contracts.id, ids));
  const insts = await db.select().from(contractInstallments).where(inArray(contractInstallments.contractId, ids));
  const ss = await db.select().from(sales).where(inArray(sales.contractId, ids));
  for (const r of rows) {
    const c = cs.find((x) => x.id === r.refId);
    if (!c) { out.set(r.id, { status: "cancelled", actual: null, saleIds: [], txIds: [] }); continue; }
    const mySales = ss.filter((s) => s.contractId === c.id);
    const myInsts = insts.filter((i) => i.contractId === c.id);
    const txIds = [
      ...(await txByRef(db, [{ refType: "contract", refId: c.id }, ...myInsts.map((i) => ({ refType: "installment", refId: i.id }))])),
      ...mySales.flatMap((s) => s.transactionIds),
    ];
    const saleIds = mySales.map((s) => s.id);
    const status: OutcomeDto["status"] = c.status === "completed" ? "settled" : c.status === "active" || c.status === "proposed" ? "pending" : "cancelled";
    if (status === "pending") { out.set(r.id, { status, actual: null, saleIds, txIds }); continue; }
    const sum = (f: (s: typeof mySales[number]) => bigint) => mySales.reduce((a, s) => a + f(s), 0n);
    const qty = mySales.reduce((a, s) => a + s.qtyKg, 0);
    const lastAt = mySales.length ? new Date(Math.max(...mySales.map((s) => s.createdAt.getTime()))) : c.closedAt;
    const penalties = myInsts.reduce((a, i) => a + i.penalty, 0n);
    const minutes = lastAt && c.acceptedAt ? minutesBetween(c.acceptedAt, lastAt) : null;
    if (c.sellerCompanyId === companyId) {
      out.set(r.id, {
        status, saleIds, txIds,
        actual: {
          ...EMPTY, qtyKg: qty, revenue: m(sum((s) => s.gross)), freight: m(sum((s) => s.freight)), fees: m(sum((s) => s.fees) + penalties), cost: m(sum((s) => s.cogs)),
          profit: m(sum((s) => s.netProfit) - penalties), minutes, at: lastAt?.toISOString() ?? null,
        },
      });
    } else {
      out.set(r.id, {
        status, saleIds, txIds,
        actual: { ...EMPTY, qtyKg: qty, goods: m(sum((s) => s.gross)), cost: m(sum((s) => s.gross)), minutes, at: lastAt?.toISOString() ?? null },
      });
    }
  }
  return out;
}
