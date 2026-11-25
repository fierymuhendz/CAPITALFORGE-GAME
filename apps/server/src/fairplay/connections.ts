/**
 * Bağlantı grupları: aynı IP karmasını paylaşan hesaplar. Ham IP ve karma hiçbir yanıta girmez;
 * grup kimliği sha256(karma + sabit) değerinin ilk 12 hanesidir. Aynı gruptaki hesaplar arasındaki
 * ticaret serbesttir; burada yalnızca görünürlük sağlanır, otomatik engel yoktur.
 */
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { AdminConnectionGroupDto, AdminReviewDto } from "@capitalforge/shared";
import { sha256 } from "../auth/crypto";
import type { Db } from "../db/client";
import { accounts, companies, connectionRecords, contracts, freightJobs, sales, trades } from "../db/schema";
import { fail } from "../errors";
import type { Catalog } from "../catalog/catalog";
import { m } from "../lib/serialize";
import { evaluateAnomaly } from "./anomaly";

const GROUP_SALT = "|cf-conn-group-v1";
const CAP = { trades: 100, deliveries: 100, contracts: 50, freight: 50 };

export const groupIdOf = (ipHash: string): string => sha256(ipHash + GROUP_SALT).slice(0, 12);
/** Gösterim etiketi: "Bağlantı grubu #N" (N kimlikten türetilir, kararlı) */
export const groupLabel = (groupId: string): string => `Bağlantı grubu #${parseInt(groupId.slice(0, 5), 16) % 100000}`;

interface RawGroup { ipHash: string; groupId: string; accountIds: string[]; lastSeenAt: Date }

/** En az iki farklı hesabın paylaştığı karmalar */
async function rawGroups(db: Db): Promise<RawGroup[]> {
  const rows = await db
    .select({ ipHash: connectionRecords.ipHash, accountId: connectionRecords.accountId, lastSeenAt: connectionRecords.lastSeenAt })
    .from(connectionRecords)
    .where(sql`${connectionRecords.ipHash} IN (SELECT ip_hash FROM cf.connection_records GROUP BY ip_hash HAVING count(DISTINCT account_id) > 1)`);
  const map = new Map<string, RawGroup>();
  for (const r of rows) {
    const g = map.get(r.ipHash) ?? { ipHash: r.ipHash, groupId: groupIdOf(r.ipHash), accountIds: [], lastSeenAt: r.lastSeenAt };
    g.accountIds.push(r.accountId);
    if (r.lastSeenAt > g.lastSeenAt) g.lastSeenAt = r.lastSeenAt;
    map.set(r.ipHash, g);
  }
  return [...map.values()];
}

async function members(db: Db, accountIds: string[]) {
  const rows = await db
    .select({ a: accounts, c: companies })
    .from(accounts)
    .leftJoin(companies, eq(companies.accountId, accounts.id))
    .where(inArray(accounts.id, accountIds))
    .orderBy(accounts.usernameLower);
  const byAccount = new Map<string, { accountId: string; username: string; companyId: string | null; companyName: string | null }>();
  const companyIds: string[] = [];
  for (const { a, c } of rows) {
    if (c) companyIds.push(c.id);
    const cur = byAccount.get(a.id);
    // aktif şirket (feshedilmemiş) tercih edilir
    if (!cur || (c && !c.dissolvedAt)) byAccount.set(a.id, { accountId: a.id, username: a.username, companyId: c?.id ?? cur?.companyId ?? null, companyName: c?.name ?? cur?.companyName ?? null });
  }
  return { accounts: [...byAccount.values()], companyIds };
}

type InteractionKind = "trade" | "contract_delivery" | "contract" | "offer" | "freight_job";
interface Interaction {
  at: Date; kind: InteractionKind; refId: string; fromId: string; toId: string;
  productId: string | null; qtyKg: number | null; pricePerKg: bigint | null; value: bigint;
  /** yalnızca gerçekleşmiş para akışları toplama girer (sözleşme/teklif değil, ödeme/teslim) */
  counted: boolean;
  anomalyOf: null | { cityId: string; quality: number; sellerId: string; buyerId: string; tradeId?: string; contractId?: string };
}

/** Grup şirketleri arasındaki tüm etkileşimler (yön: hizmet/mal veren → alan, değer: ödenen tutar) */
async function interactions(db: Db, ids: string[]): Promise<Interaction[]> {
  if (ids.length < 2) return [];
  const out: Interaction[] = [];
  const tr = await db
    .select().from(trades)
    .where(and(inArray(trades.sellerCompanyId, ids), inArray(trades.buyerCompanyId, ids), ne(trades.sellerCompanyId, trades.buyerCompanyId)))
    .orderBy(desc(trades.createdAt)).limit(CAP.trades);
  for (const t of tr) {
    out.push({
      at: t.createdAt, kind: "trade", refId: t.id, fromId: t.sellerCompanyId, toId: t.buyerCompanyId, productId: t.productId, qtyKg: t.qtyKg,
      pricePerKg: t.pricePerKg, value: t.gross, counted: true,
      anomalyOf: { cityId: t.cityId, quality: t.quality, sellerId: t.sellerCompanyId, buyerId: t.buyerCompanyId, tradeId: t.id },
    });
  }
  const sl = await db
    .select().from(sales)
    .where(and(eq(sales.source, "contract"), inArray(sales.sellerCompanyId, ids), inArray(sales.buyerCompanyId, ids), ne(sales.sellerCompanyId, sales.buyerCompanyId)))
    .orderBy(desc(sales.createdAt)).limit(CAP.deliveries);
  for (const s of sl) {
    out.push({
      at: s.createdAt, kind: "contract_delivery", refId: s.id, fromId: s.sellerCompanyId, toId: s.buyerCompanyId, productId: s.productId, qtyKg: s.qtyKg,
      pricePerKg: s.pricePerKg, value: s.gross, counted: true,
      anomalyOf: { cityId: s.cityId, quality: s.quality, sellerId: s.sellerCompanyId, buyerId: s.buyerCompanyId, ...(s.contractId ? { contractId: s.contractId } : {}) },
    });
  }
  const ct = await db
    .select().from(contracts)
    .where(or(
      and(isNotNull(contracts.sellerCompanyId), isNotNull(contracts.buyerCompanyId), inArray(contracts.sellerCompanyId, ids), inArray(contracts.buyerCompanyId, ids)),
      and(inArray(contracts.proposerCompanyId, ids), isNotNull(contracts.counterpartyCompanyId), inArray(contracts.counterpartyCompanyId, ids)),
    ))
    .orderBy(desc(contracts.createdAt)).limit(CAP.contracts);
  for (const k of ct) {
    const proposer = k.proposerCompanyId;
    const other = k.counterpartyCompanyId ?? (k.sellerCompanyId === proposer ? k.buyerCompanyId : k.sellerCompanyId);
    const sellerId = k.sellerCompanyId ?? (k.proposerRole === "seller" ? proposer : other);
    const buyerId = k.buyerCompanyId ?? (k.proposerRole === "buyer" ? proposer : other);
    if (!sellerId || !buyerId || sellerId === buyerId) continue;
    out.push({
      at: k.acceptedAt ?? k.createdAt, kind: k.acceptedAt ? "contract" : "offer", refId: k.id, fromId: sellerId, toId: buyerId,
      productId: k.productId, qtyKg: k.qtyPerInstallmentKg * k.installments, pricePerKg: k.pricePerKg,
      value: k.pricePerKg * BigInt(k.qtyPerInstallmentKg) * BigInt(k.installments), counted: false,
      anomalyOf: { cityId: k.deliveryCityId, quality: k.minQuality, sellerId, buyerId, ...(k.acceptedAt ? { contractId: k.id } : {}) },
    });
  }
  const fj = await db
    .select().from(freightJobs)
    .where(and(isNotNull(freightJobs.carrierCompanyId), inArray(freightJobs.shipperCompanyId, ids), inArray(freightJobs.carrierCompanyId, ids), ne(freightJobs.shipperCompanyId, freightJobs.carrierCompanyId)))
    .orderBy(desc(freightJobs.createdAt)).limit(CAP.freight);
  for (const j of fj) {
    out.push({
      at: j.acceptedAt ?? j.createdAt, kind: "freight_job", refId: j.id, fromId: j.carrierCompanyId!, toId: j.shipperCompanyId,
      productId: j.cargo[0]?.productId ?? null, qtyKg: j.totalKg, pricePerKg: null, value: j.payAmount, counted: j.status === "delivered", anomalyOf: null,
    });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

async function flaggedCount(db: Db, ids: string[]): Promise<number> {
  if (ids.length < 2) return 0;
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const r = (await db.execute(sql`
    SELECT count(*)::text AS n FROM cf.alerts
    WHERE kind = 'price_anomaly' AND details->>'insufficientData' = 'false'
      AND details->>'sellerCompanyId' IN (${list}) AND details->>'buyerCompanyId' IN (${list})`)) as unknown as Array<{ n: string }>;
  return Number(r[0]?.n ?? 0);
}

async function groupDto(db: Db, g: RawGroup): Promise<{ dto: AdminConnectionGroupDto; companyIds: string[] }> {
  const mem = await members(db, g.accountIds);
  const inter = await interactions(db, mem.companyIds);
  return {
    companyIds: mem.companyIds,
    dto: {
      groupId: g.groupId, label: groupLabel(g.groupId), accountCount: g.accountIds.length, lastSeenAt: g.lastSeenAt.toISOString(),
      accounts: mem.accounts, interactions: inter.length, flaggedTrades: await flaggedCount(db, mem.companyIds),
    },
  };
}

export async function listGroups(db: Db): Promise<AdminConnectionGroupDto[]> {
  const groups = (await rawGroups(db)).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).slice(0, 200);
  const out: AdminConnectionGroupDto[] = [];
  for (const g of groups) out.push((await groupDto(db, g)).dto);
  return out;
}

/** Tek ekranda inceleme. Grup yoksa NOT_FOUND. */
export async function reviewGroup(db: Db, catalog: Catalog, groupId: string): Promise<AdminReviewDto> {
  const g = (await rawGroups(db)).find((x) => x.groupId === groupId);
  if (!g) fail("NOT_FOUND");
  const { dto, companyIds } = await groupDto(db, g);
  const inter = await interactions(db, companyIds);
  const names = new Map<string, string>();
  if (companyIds.length) for (const c of await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds))) names.set(c.id, c.name);
  const nm = (id: string) => names.get(id) ?? id;

  const rows: AdminReviewDto["trades"] = [];
  const dir = new Map<string, { from: string; to: string; value: bigint }>();
  let total = 0n;
  for (const it of inter) {
    let anomaly: AdminReviewDto["trades"][number]["anomaly"] = null;
    if (it.anomalyOf && it.pricePerKg !== null) {
      const ev = await evaluateAnomaly(db, catalog.settings, {
        productId: it.productId!, cityId: it.anomalyOf.cityId, quality: it.anomalyOf.quality, pricePerKg: it.pricePerKg, at: it.at,
        sellerCompanyId: it.anomalyOf.sellerId, buyerCompanyId: it.anomalyOf.buyerId,
        excludeTradeId: it.anomalyOf.tradeId, excludeContractId: it.anomalyOf.contractId,
      });
      anomaly = { refPricePerKg: m(ev.refPricePerKg ?? 0n), deviationBp: ev.deviationBp ?? 0, comparables: ev.comparables, insufficientData: ev.insufficientData, flagged: ev.flagged };
    }
    rows.push({
      at: it.at.toISOString(), kind: it.kind, refId: it.refId, from: nm(it.fromId), to: nm(it.toId), productId: it.productId,
      qtyKg: it.qtyKg, pricePerKg: it.pricePerKg === null ? null : m(it.pricePerKg), value: m(it.value), anomaly,
    });
    if (it.counted) {
      total += it.value;
      const k = `${it.fromId}>${it.toId}`;
      const cur = dir.get(k) ?? { from: nm(it.fromId), to: nm(it.toId), value: 0n };
      cur.value += it.value;
      dir.set(k, cur);
    }
  }
  return {
    group: dto, trades: rows,
    totals: { valueTransferred: m(total), byDirection: [...dir.values()].map((d) => ({ from: d.from, to: d.to, value: m(d.value) })) },
  };
}
