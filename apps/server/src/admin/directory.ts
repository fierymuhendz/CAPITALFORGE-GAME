/** Yönetici: hesap/şirket arama ve şirket ayrıntısı. IP bilgisi hiçbir yanıtta yer almaz. */
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { AdminCompanyDetailDto, AdminSearchDto, HoldingDto, LedgerLineDto, SaleDto } from "@capitalforge/shared";
import { avgUnitCost } from "@capitalforge/economy";
import type { Db } from "../db/client";
import {
  accounts, companies, contracts, facilities, freightJobs, holdings, ledgerAccounts, ledgerEntries, ledgerTransactions,
  marketOrders, productionJobs, sales, vehicles,
} from "../db/schema";
import { fail } from "../errors";
import { m } from "../lib/serialize";
import { companyNames, likePattern } from "./common";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function search(db: Db, q: string): Promise<AdminSearchDto> {
  const pat = likePattern(q);
  const isId = UUID_RE.test(q);
  const accRows = await db
    .select({ a: accounts, c: companies })
    .from(accounts)
    .leftJoin(companies, and(eq(companies.accountId, accounts.id), isNull(companies.dissolvedAt)))
    .where(isId ? or(eq(accounts.id, q), eq(companies.id, q)) : like(accounts.usernameLower, pat))
    .orderBy(accounts.usernameLower)
    .limit(25);
  const coRows = await db
    .select({ c: companies, username: accounts.username })
    .from(companies)
    .leftJoin(accounts, eq(accounts.id, companies.accountId))
    .where(isId ? or(eq(companies.id, q), eq(companies.accountId, q)) : like(companies.nameLower, pat))
    .orderBy(companies.nameLower)
    .limit(25);
  return {
    accounts: accRows.map(({ a, c }) => ({
      id: a.id, username: a.username, role: a.role, frozen: !!a.frozenAt, createdAt: a.createdAt.toISOString(),
      companyId: c?.id ?? null, companyName: c?.name ?? null,
    })),
    companies: coRows.map(({ c, username }) => ({
      id: c.id, name: c.name, sector: c.sector, homeCityId: c.homeCityId, level: c.level, isSystem: c.isSystem,
      dissolved: !!c.dissolvedAt, accountId: c.accountId, username: username ?? null,
    })),
  };
}

const count = async (q: PromiseLike<Array<{ n: number | string | bigint }>>): Promise<number> => Number((await q)[0]?.n ?? 0);

export async function companyDetail(db: Db, id: string): Promise<AdminCompanyDetailDto> {
  const c = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!c) fail("NOT_FOUND");
  const acc = c.accountId ? (await db.select().from(accounts).where(eq(accounts.id, c.accountId)).limit(1))[0] ?? null : null;

  const bal = await db.select({ code: ledgerAccounts.code, balance: ledgerAccounts.balance }).from(ledgerAccounts).where(eq(ledgerAccounts.companyId, id));
  const balances: Record<string, string> = {};
  for (const b of bal) balances[b.code] = m(b.balance);

  const lines = await db
    .select({ tx: ledgerTransactions, code: ledgerAccounts.code, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(eq(ledgerAccounts.companyId, id))
    .orderBy(desc(ledgerTransactions.createdAt), desc(ledgerEntries.id))
    .limit(120);
  const ledger: LedgerLineDto[] = lines.map((l) => ({
    transactionId: l.tx.id, at: l.tx.createdAt.toISOString(), kind: l.tx.kind, memo: l.tx.memo, account: l.code, amount: m(l.amount),
    refType: l.tx.refType, refId: l.tx.refId,
  }));

  const saleRows = await db
    .select()
    .from(sales)
    .where(or(eq(sales.sellerCompanyId, id), eq(sales.buyerCompanyId, id)))
    .orderBy(desc(sales.createdAt))
    .limit(30);
  const names = await companyNames(db, saleRows.flatMap((s) => [s.buyerCompanyId, s.sellerCompanyId]));
  const saleDtos: SaleDto[] = saleRows.map((s) => ({
    id: s.id, at: s.createdAt.toISOString(), source: s.source, productId: s.productId, quality: s.quality, qtyKg: s.qtyKg,
    pricePerKg: m(s.pricePerKg), buyerName: names.get(s.buyerCompanyId) ?? "", sellerName: names.get(s.sellerCompanyId) ?? "",
    cityId: s.cityId, gross: m(s.gross), cogs: m(s.cogs), freight: m(s.freight), fees: m(s.fees), netProfit: m(s.netProfit),
    contractId: s.contractId, installmentId: s.installmentId, shipmentId: s.shipmentId, ledgerTransactionIds: s.transactionIds,
  }));

  const hold = await db.select().from(holdings).where(and(eq(holdings.companyId, id), sql`${holdings.qtyKg} > 0`)).orderBy(holdings.productId, holdings.cityId);
  const holdingDtos: HoldingDto[] = hold.map((h) => ({
    cityId: h.cityId, productId: h.productId, quality: h.quality, qtyKg: h.qtyKg, reservedKg: h.reservedKg, availableKg: h.qtyKg - h.reservedKg,
    costTotal: m(h.costTotal), avgCostPerKg: m(avgUnitCost(h.qtyKg, h.costTotal)), avgCostPerTonne: m(avgUnitCost(h.qtyKg, h.costTotal, 1000)),
  }));

  const facs = await db.select().from(facilities).where(eq(facilities.companyId, id)).orderBy(facilities.createdAt);
  const running = facs.length
    ? await db
        .select({ facilityId: productionJobs.facilityId, n: sql<number>`count(*)::int` })
        .from(productionJobs)
        .where(and(inArray(productionJobs.facilityId, facs.map((f) => f.id)), eq(productionJobs.status, "running")))
        .groupBy(productionJobs.facilityId)
    : [];
  const runMap = new Map(running.map((r) => [r.facilityId, Number(r.n)]));

  const cnt = sql<number>`count(*)::int`.as("n");
  const counts = {
    openListings: await count(db.select({ n: cnt }).from(marketOrders).where(and(eq(marketOrders.companyId, id), eq(marketOrders.status, "open"), eq(marketOrders.side, "sell")))),
    openOrders: await count(db.select({ n: cnt }).from(marketOrders).where(and(eq(marketOrders.companyId, id), eq(marketOrders.status, "open"), eq(marketOrders.side, "buy")))),
    activeContracts: await count(db.select({ n: cnt }).from(contracts).where(and(eq(contracts.status, "active"), or(eq(contracts.sellerCompanyId, id), eq(contracts.buyerCompanyId, id))))),
    openFreightJobs: await count(db.select({ n: cnt }).from(freightJobs).where(and(inArray(freightJobs.status, ["open", "assigned", "in_transit"]), or(eq(freightJobs.shipperCompanyId, id), eq(freightJobs.carrierCompanyId, id))))),
    vehicles: await count(db.select({ n: cnt }).from(vehicles).where(and(eq(vehicles.companyId, id), sql`${vehicles.status} <> 'sold'`))),
  };

  return {
    company: {
      id: c.id, name: c.name, sector: c.sector, homeCityId: c.homeCityId, level: c.level, xp: c.xp, isSystem: c.isSystem,
      createdAt: c.createdAt.toISOString(), dissolvedAt: c.dissolvedAt?.toISOString() ?? null,
      onTimeDeliveries: c.onTimeDeliveries, lateOrMissed: c.lateOrMissed,
    },
    account: acc ? { id: acc.id, username: acc.username, role: acc.role, frozen: !!acc.frozenAt } : null,
    balances, ledger, sales: saleDtos, holdings: holdingDtos,
    facilities: facs.map((f) => ({
      id: f.id, type: f.type, level: f.level, qualityLevel: f.qualityLevel, state: f.state, cityId: f.cityId,
      stalledReason: f.stalledReason ?? null, runningJobs: runMap.get(f.id) ?? 0,
    })),
    counts,
  };
}
