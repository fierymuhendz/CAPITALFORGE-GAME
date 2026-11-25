/**
 * Sözleşme ↔ bugün spot satış karşılaştırması (GET /contracts/:id/compare) ve kabulde yazılan beklenen rakamlar.
 * Satıcı navlunu: stok şehrinden (en çok kullanılabilir stok) teslim şehrine sistem taşımacısı tarifesi,
 * yalnızca navlunu satıcı öderse (freightPayer = seller) sayılır. Sözleşme teslimi komisyonsuzdur.
 */
import { and, eq, gt, ne } from "drizzle-orm";
import { applyBp, contractEscrows, settleInstallment } from "@capitalforge/economy";
import type { ContractCompareDto } from "@capitalforge/shared";
import type { Catalog } from "../catalog/catalog";
import type { DbOrTx } from "../db/client";
import { marketOrders } from "../db/schema";
import { m } from "../lib/serialize";
import { companyBriefs, HOUR } from "../market/common";
import { ceilDiv, floorDiv, stockRows, systemFreightEstimate, topStockCity } from "../market/offers";
import { effectivePrice } from "../market/spot";
import { productBidCap, systemContractCap } from "../system/pricing";
import { termsOf, type ContractRow } from "./contracts";

export type CompareRole = "seller" | "buyer";

export function roleIn(c: ContractRow, companyId: string): CompareRole {
  if (c.sellerCompanyId === companyId) return "seller";
  if (c.buyerCompanyId === companyId) return "buyer";
  // herkese açık teklif: kabul edersem teklif sahibinin karşı tarafı olurum
  return c.proposerRole === "seller" ? "buyer" : "seller";
}

export interface CompareResult { dto: ContractCompareDto; avgCost: bigint | null; freightTotal: bigint }

export async function contractCompare(db: DbOrTx, catalog: Catalog, c: ContractRow, companyId: string, now: Date): Promise<CompareResult> {
  void now;
  const role = roleIn(c, companyId);
  const t = { ...termsOf(c) };
  if (c.status === "proposed" && c.isSystem && c.proposerRole === "buyer") {
    const cap = await systemContractCap(db, catalog, t.productId); // kabulde uygulanacak fiyat
    if (cap !== null && t.price > cap) t.price = cap < 1n ? 1n : cap;
  }
  const qty = c.qtyPerInstallmentKg;
  const n = c.installments;
  const totalQty = qty * n;
  const goodsPer = BigInt(qty) * t.price;

  // stok (yalnızca satıcı için anlamlı)
  const stock = role === "seller" ? (await stockRows(db, companyId, t.productId)).filter((s) => s.quality >= t.minQuality) : [];
  const stockCity = topStockCity(stock);
  const stockKg = stock.reduce((a, s) => a + s.availableKg, 0);
  const costSum = stock.reduce((a, s) => a + s.costTotal, 0n);
  const qtySum = stock.reduce((a, s) => a + s.qtyKg, 0);
  const avgCost = qtySum > 0 ? costSum / BigInt(qtySum) : null;

  const freightPer = role === "seller" && t.freightPayer === "seller" && stockCity
    ? systemFreightEstimate(catalog, stockCity, t.deliveryCityId, qty).freight
    : 0n;
  const nBig = BigInt(n);
  const netPer = role === "seller" ? goodsPer - freightPer : goodsPer + freightPer;
  const netTotal = netPer * nBig;
  const perKg = (net: bigint, kg: number) => (role === "seller" ? floorDiv(net, BigInt(kg)) : ceilDiv(net, BigInt(kg)));

  const esc = contractEscrows({ qtyPerInstallmentKg: qty, pricePerKg: t.price, installments: n, penaltyBp: c.penaltyBp, lateFeeBp: t.lateFeeBp });
  const sellerDeposit = c.status === "proposed" ? esc.sellerDeposit : c.sellerDeposit;
  const buyerEscrow = c.status === "proposed" ? esc.buyerEscrow : c.buyerEscrow;
  const miss = settleInstallment(qty, 0, t.price, c.penaltyBp, esc.perInstallmentDeposit[0] ?? 0n);

  // bugünkü spot: teslim şehrindeki veya stok şehrindeki en iyi alım emri (toplam miktar için)
  let spotNow: ContractCompareDto["spotNow"] = null;
  if (role === "seller") {
    const cities = new Set<string>([t.deliveryCityId]);
    if (stockCity) cities.add(stockCity);
    const origin = stockCity ?? t.deliveryCityId;
    const orders = (
      await db
        .select()
        .from(marketOrders)
        .where(and(eq(marketOrders.side, "buy"), eq(marketOrders.status, "open"), eq(marketOrders.productId, t.productId), gt(marketOrders.remainingKg, 0), ne(marketOrders.companyId, companyId)))
    ).filter((o) => cities.has(o.cityId) && o.quality <= t.minQuality);
    const bidCap = orders.some((o) => o.isSystem) ? await productBidCap(db, catalog, t.productId) : null;
    const feeBp = catalog.settings.marketFeeBp;
    let best: NonNullable<ContractCompareDto["spotNow"]> | null = null;
    let bestPerKg = 0n;
    for (const o of orders) {
      const price = effectivePrice(o, t.minQuality, o.isSystem ? bidCap : null);
      const fill = Math.min(totalQty, o.remainingKg);
      const goods = BigInt(fill) * price;
      const net = goods - applyBp(goods, feeBp) - systemFreightEstimate(catalog, origin, o.cityId, fill).freight;
      const pk = floorDiv(net, BigInt(fill));
      if (!best || pk > bestPerKg) { best = { cityId: o.cityId, pricePerKg: m(price), fillKg: fill, net: m(net), perKg: m(pk) }; bestPerKg = pk; }
    }
    spotNow = best;
  } else {
    // alıcı için: aynı miktarı bugün en ucuz satış ilanından alıp teslim şehrine getirtmek (mal + navlun)
    const lists = (
      await db
        .select()
        .from(marketOrders)
        .where(and(eq(marketOrders.side, "sell"), eq(marketOrders.status, "open"), eq(marketOrders.productId, t.productId), gt(marketOrders.remainingKg, 0), ne(marketOrders.companyId, companyId)))
    ).filter((o) => o.quality >= t.minQuality);
    let best: NonNullable<ContractCompareDto["spotNow"]> | null = null;
    let bestPerKg = 0n;
    for (const o of lists) {
      const fill = Math.min(totalQty, o.remainingKg);
      const total = BigInt(fill) * o.pricePerKg + systemFreightEstimate(catalog, o.cityId, t.deliveryCityId, fill).freight;
      const pk = floorDiv(total, BigInt(fill));
      if (!best || pk < bestPerKg) { best = { cityId: o.cityId, pricePerKg: m(o.pricePerKg), fillKg: fill, net: m(total), perKg: m(pk) }; bestPerKg = pk; }
    }
    spotNow = best;
  }

  const first = c.firstDueAt.getTime();
  const dto: ContractCompareDto = {
    contractId: c.id, myRole: role,
    perInstallment: { qtyKg: qty, goods: m(goodsPer), freight: m(freightPer), fees: "0", net: m(netPer), perKg: m(perKg(netPer, qty)) },
    total: { qtyKg: totalQty, goods: m(goodsPer * nBig), freight: m(freightPer * nBig), fees: "0", net: m(netTotal) },
    schedule: {
      firstDueAt: c.firstDueAt.toISOString(), intervalHours: c.intervalHours, installments: n,
      lastDueAt: new Date(first + (n - 1) * c.intervalHours * HOUR).toISOString(),
    },
    commitment: { sellerDeposit: m(sellerDeposit), buyerEscrow: m(buyerEscrow), penaltyPerMissed: m(miss.penaltyToBuyer) },
    spotNow, myStockKg: stockKg, avgCostPerKg: avgCost === null ? null : m(avgCost),
  };
  return { dto, avgCost, freightTotal: freightPer * nBig };
}

/** Kabulde iki tarafa yazılacak beklenen rakamlar */
export async function contractExpected(db: DbOrTx, catalog: Catalog, c: ContractRow, companyId: string, now: Date) {
  const r = await contractCompare(db, catalog, c, companyId, now);
  const d = r.dto;
  const last = new Date(d.schedule.lastDueAt);
  if (d.myRole === "seller") {
    const goods = BigInt(d.total.goods);
    const cost = r.avgCost === null ? null : r.avgCost * BigInt(d.total.qtyKg);
    return {
      qtyKg: d.total.qtyKg, revenue: goods, freight: r.freightTotal, fees: 0n, cost,
      profit: cost === null ? null : goods - r.freightTotal - cost, minutes: Math.round((last.getTime() - now.getTime()) / 60_000), at: last,
    };
  }
  const goods = BigInt(d.total.goods);
  return { qtyKg: d.total.qtyKg, goods, freight: 0n, cost: goods, minutes: Math.round((last.getTime() - now.getTime()) / 60_000), at: last };
}

export async function nameIsSystem(db: DbOrTx, id: string): Promise<boolean> {
  return (await companyBriefs(db, [id])).get(id)?.isSystem ?? false;
}
