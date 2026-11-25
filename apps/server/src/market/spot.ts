/**
 * Anlık piyasa çekirdeği: ilan, alım emri, ilandan alım, emre satış, iptal.
 * Kilit sırası: emir satırı → (sistem şirketi sayacı) → stok satırları (sıralı) → defter.
 * Tüm yollar `settleSpot` üzerinden geçer: stok, defter, trades ve sales aynı işlemde yazılır.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { applyBp, qualityAdjusted } from "@capitalforge/economy";
import {
  QUALITY_PRICE_BP, type BuyFromListingReq, type BuyOrderReq, type CancelReq, type ListingDto, type ListingReq, type SellToOrderReq,
} from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { marketOrders, sales, trades } from "../db/schema";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { addStock, lockHolding, releaseStock, removeStock, reserveStock, type HoldingKey } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { bookSystemFill } from "../system/daily";
import { afterCashIn, companyBriefs, linkMovements, type CompanyRow } from "./common";

export type OrderRow = typeof marketOrders.$inferSelect;

const MAX_OPEN_ORDERS = 100;

/** Emrin bu kalitedeki fiyatı: sistem alım emri kalite 2 tabanıdır, kaliteye göre çarpılır */
export function effectivePrice(o: OrderRow, quality: number): bigint {
  return o.isSystem && o.side === "buy" ? qualityAdjusted(o.pricePerKg, quality, QUALITY_PRICE_BP) : o.pricePerKg;
}

export function orderDto(o: OrderRow, name: string, myCompanyId: string | null): ListingDto {
  return {
    id: o.id, side: o.side, companyId: o.companyId, companyName: name, isSystem: o.isSystem,
    cityId: o.cityId, productId: o.productId, quality: o.quality, qtyKg: o.qtyKg, remainingKg: o.remainingKg,
    pricePerKg: m(o.pricePerKg), createdAt: o.createdAt.toISOString(), status: o.status, mine: !!myCompanyId && o.companyId === myCompanyId,
  };
}

const cmpKey = (a: HoldingKey, b: HoldingKey) =>
  `${a.companyId}|${a.cityId}|${a.productId}|${a.quality}`.localeCompare(`${b.companyId}|${b.cityId}|${b.productId}|${b.quality}`);

async function openCount(tx: Tx, companyId: string): Promise<number> {
  const r = await tx.select({ n: sql<number>`count(*)::int` }).from(marketOrders).where(and(eq(marketOrders.companyId, companyId), eq(marketOrders.status, "open")));
  return r[0]?.n ?? 0;
}

export async function createListing(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof ListingReq>, now: Date, opts?: { isSystem?: boolean },
): Promise<OrderRow> {
  catalog.city(req.cityId);
  catalog.product(req.productId);
  if (!opts?.isSystem && (await openCount(tx, company.id)) >= MAX_OPEN_ORDERS) fail("CONFLICT");
  await reserveStock(tx, { companyId: company.id, cityId: req.cityId, productId: req.productId, quality: req.quality }, req.qtyKg);
  const [row] = await tx
    .insert(marketOrders)
    .values({
      side: "sell", companyId: company.id, isSystem: opts?.isSystem ?? false, cityId: req.cityId, productId: req.productId,
      quality: req.quality, qtyKg: req.qtyKg, remainingKg: req.qtyKg, pricePerKg: BigInt(req.pricePerKg), createdAt: now,
    })
    .returning();
  uow.invalidate(company.id, "inventory", "market");
  uow.world("market");
  return row!;
}

export async function createBuyOrder(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof BuyOrderReq>, now: Date,
): Promise<OrderRow> {
  catalog.city(req.cityId);
  catalog.product(req.productId);
  if ((await openCount(tx, company.id)) >= MAX_OPEN_ORDERS) fail("CONFLICT");
  const id = randomUUID();
  const budget = BigInt(req.qtyKg) * BigInt(req.maxPricePerKg);
  await post(tx, {
    kind: "order_escrow", idempotencyKey: `order-open:${id}`, refType: "order", refId: id, at: now, memo: "Alım emri emaneti",
    lines: [{ account: co(company.id, "escrow"), amount: budget }, { account: co(company.id, "cash"), amount: -budget }],
  });
  const [row] = await tx
    .insert(marketOrders)
    .values({
      id, side: "buy", companyId: company.id, cityId: req.cityId, productId: req.productId, quality: req.minQuality,
      qtyKg: req.qtyKg, remainingKg: req.qtyKg, pricePerKg: BigInt(req.maxPricePerKg), escrowRemaining: budget, createdAt: now,
    })
    .returning();
  uow.invalidate(company.id, "finance", "market", "company");
  uow.world("market");
  return row!;
}

export interface SettleSpotArgs {
  order: OrderRow;
  qtyKg: number;
  quality: number;
  unitPrice: bigint;
  buyerId: string;
  buyerIsSystem: boolean;
  sellerId: string;
  sellerIsSystem: boolean;
  /** satıcı stoğu rezerveden mi düşer (ilan) yoksa kullanılabilirden mi (emre satış) */
  fromReserved: boolean;
  buyerFunding: "escrow" | "cash";
  now: Date;
  marketFeeBp: number;
}

export interface SpotResult { tradeId: string; saleId: string; transactionId: string; gross: bigint; fee: bigint; cogs: bigint }

/** Tek bir anlık işlemi yerleştirir. Çağıran emir satırını FOR UPDATE ile kilitlemiş olmalıdır. */
export async function settleSpot(tx: Tx, uow: UnitOfWork, a: SettleSpotArgs): Promise<SpotResult> {
  const { order, now } = a;
  const tradeId = randomUUID();
  const saleId = randomUUID();
  const gross = BigInt(a.qtyKg) * a.unitPrice;
  const fee = applyBp(gross, a.marketFeeBp);
  const sk: HoldingKey = { companyId: a.sellerId, cityId: order.cityId, productId: order.productId, quality: a.quality };
  const bk: HoldingKey = { ...sk, companyId: a.buyerId };

  // Sistem sayaçları (sert üst sınır), sonra stok satırları sıralı kilit
  if (a.sellerIsSystem) await bookSystemFill(tx, a.sellerId, order.productId, now, "sold", a.qtyKg, gross);
  if (a.buyerIsSystem) await bookSystemFill(tx, a.buyerId, order.productId, now, "bought", a.qtyKg, gross);
  for (const k of [sk, bk].sort(cmpKey)) await lockHolding(tx, k);

  const cogs = await removeStock(tx, sk, a.qtyKg, { kind: "sale", refType: "trade", refId: tradeId, at: now }, { fromReserved: a.fromReserved });
  await addStock(tx, bk, a.qtyKg, gross, { kind: "purchase", refType: "trade", refId: tradeId, at: now });

  const led = await post(tx, {
    kind: "spot_trade", idempotencyKey: `trade:${tradeId}`, refType: "trade", refId: tradeId, at: now,
    memo: `${order.productId} ${a.qtyKg} kg @ ${a.unitPrice}`,
    lines: [
      { account: co(a.sellerId, "cogs"), amount: cogs },
      { account: co(a.sellerId, "inventory"), amount: -cogs },
      { account: co(a.sellerId, "cash"), amount: gross - fee },
      { account: co(a.sellerId, "exp_fees"), amount: fee },
      { account: co(a.sellerId, "revenue_sales"), amount: -gross },
      { account: co(a.buyerId, "inventory"), amount: gross },
      { account: co(a.buyerId, a.buyerFunding === "escrow" ? "escrow" : "cash"), amount: -gross },
    ],
  });

  await linkMovements(tx, "trade", tradeId, led.id);
  await tx.insert(trades).values({
    id: tradeId, orderId: order.id, buyerCompanyId: a.buyerId, sellerCompanyId: a.sellerId,
    buyerIsSystem: a.buyerIsSystem, sellerIsSystem: a.sellerIsSystem, cityId: order.cityId, productId: order.productId,
    quality: a.quality, qtyKg: a.qtyKg, pricePerKg: a.unitPrice, gross, fee, transactionId: led.id, saleId, createdAt: now,
  });
  await tx.insert(sales).values({
    id: saleId, sellerCompanyId: a.sellerId, buyerCompanyId: a.buyerId,
    source: a.buyerIsSystem || a.sellerIsSystem ? "system" : "spot", cityId: order.cityId, productId: order.productId,
    quality: a.quality, qtyKg: a.qtyKg, pricePerKg: a.unitPrice, gross, cogs, freight: 0n, fees: fee, netProfit: gross - cogs - fee,
    tradeId, transactionIds: [led.id], createdAt: now,
  });

  const remaining = order.remainingKg - a.qtyKg;
  const escrowLeft = order.side === "buy" && !order.isSystem ? order.escrowRemaining - gross : order.escrowRemaining;
  await tx
    .update(marketOrders)
    .set({
      remainingKg: remaining, escrowRemaining: escrowLeft, firstFillAt: order.firstFillAt ?? now,
      ...(remaining === 0 ? { status: "filled" as const, closedAt: now } : {}),
    })
    .where(eq(marketOrders.id, order.id));
  // Emir tamamen dolduysa artan emanet (olmamalı, sağlamlık için) alıcıya iade
  if (remaining === 0 && escrowLeft > 0n) {
    await post(tx, {
      kind: "order_refund", idempotencyKey: `order-close:${order.id}`, refType: "order", refId: order.id, at: now,
      lines: [{ account: co(order.companyId, "escrow"), amount: -escrowLeft }, { account: co(order.companyId, "cash"), amount: escrowLeft }],
    });
    await tx.update(marketOrders).set({ escrowRemaining: 0n }).where(eq(marketOrders.id, order.id));
  }

  const params = { productId: order.productId, qtyKg: a.qtyKg, cityId: order.cityId, gross: gross.toString(), pricePerKg: a.unitPrice.toString() };
  if (!a.sellerIsSystem) await notify(tx, uow, a.sellerId, "trade_sell", params, now, "/play?tab=sales");
  if (!a.buyerIsSystem) await notify(tx, uow, a.buyerId, "trade_buy", params, now, "/play?tab=inventory");
  uow.invalidate(a.sellerId, "inventory", "finance", "market", "company");
  uow.invalidate(a.buyerId, "inventory", "finance", "market", "company");
  uow.world("market");
  await afterCashIn(tx, uow, a.sellerId, now);
  return { tradeId, saleId, transactionId: led.id, gross, fee, cogs };
}

async function lockOrder(tx: Tx, id: string): Promise<OrderRow> {
  const r = (await tx.select().from(marketOrders).where(eq(marketOrders.id, id)).for("update"))[0];
  if (!r) fail("NOT_FOUND");
  return r;
}

export async function buyFromListing(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, buyer: CompanyRow, listingId: string, req: z.infer<typeof BuyFromListingReq>, now: Date,
): Promise<SpotResult> {
  const o = await lockOrder(tx, listingId);
  if (o.side !== "sell") fail("NOT_FOUND");
  if (o.status !== "open" || o.remainingKg <= 0) fail("ORDER_CLOSED");
  if (o.companyId === buyer.id) fail("OWN_ORDER");
  if (o.pricePerKg > BigInt(req.expectedPricePerKg)) fail("PRICE_CHANGED", { pricePerKg: o.pricePerKg.toString() });
  if (req.qtyKg > o.remainingKg) fail("INSUFFICIENT_STOCK", { availableKg: o.remainingKg, requiredKg: req.qtyKg });
  const names = await companyBriefs(tx, [o.companyId]);
  return settleSpot(tx, uow, {
    order: o, qtyKg: req.qtyKg, quality: o.quality, unitPrice: o.pricePerKg,
    buyerId: buyer.id, buyerIsSystem: buyer.isSystem, sellerId: o.companyId, sellerIsSystem: names.get(o.companyId)?.isSystem ?? o.isSystem,
    fromReserved: true, buyerFunding: "cash", now, marketFeeBp: catalog.settings.marketFeeBp,
  });
}

export async function sellToOrder(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, seller: CompanyRow, orderId: string, req: z.infer<typeof SellToOrderReq>, now: Date,
): Promise<SpotResult> {
  const o = await lockOrder(tx, orderId);
  if (o.side !== "buy") fail("NOT_FOUND");
  if (o.status !== "open" || o.remainingKg <= 0) fail("ORDER_CLOSED");
  if (o.companyId === seller.id) fail("OWN_ORDER");
  if (req.quality < o.quality) fail("QUALITY_TOO_LOW", { minQuality: o.quality });
  const unit = effectivePrice(o, req.quality);
  if (unit < BigInt(req.expectedPricePerKg)) fail("PRICE_CHANGED", { pricePerKg: unit.toString() });
  if (req.qtyKg > o.remainingKg) fail("INSUFFICIENT_STOCK", { availableKg: o.remainingKg, requiredKg: req.qtyKg });
  const names = await companyBriefs(tx, [o.companyId]);
  return settleSpot(tx, uow, {
    order: o, qtyKg: req.qtyKg, quality: req.quality, unitPrice: unit,
    buyerId: o.companyId, buyerIsSystem: names.get(o.companyId)?.isSystem ?? o.isSystem, sellerId: seller.id, sellerIsSystem: seller.isSystem,
    fromReserved: false, buyerFunding: o.isSystem ? "cash" : "escrow", now, marketFeeBp: catalog.settings.marketFeeBp,
  });
}

/** Açık emri kapatır (iptal): ilanda rezerv serbest, alım emrinde emanet iade. Çağıran satırı kilitlemiştir. */
export async function closeOrder(tx: Tx, uow: UnitOfWork, o: OrderRow, now: Date, status: "cancelled" | "filled" = "cancelled"): Promise<void> {
  if (o.side === "sell") {
    if (o.remainingKg > 0) await releaseStock(tx, { companyId: o.companyId, cityId: o.cityId, productId: o.productId, quality: o.quality }, o.remainingKg);
  } else if (o.escrowRemaining > 0n) {
    await post(tx, {
      kind: "order_refund", idempotencyKey: `order-cancel:${o.id}`, refType: "order", refId: o.id, at: now, memo: "Alım emri iadesi",
      lines: [{ account: co(o.companyId, "escrow"), amount: -o.escrowRemaining }, { account: co(o.companyId, "cash"), amount: o.escrowRemaining }],
    });
  }
  await tx.update(marketOrders).set({ status, closedAt: now, escrowRemaining: 0n }).where(eq(marketOrders.id, o.id));
  uow.invalidate(o.companyId, "inventory", "finance", "market", "company");
  uow.world("market");
}

export async function cancelOrder(tx: Tx, uow: UnitOfWork, company: CompanyRow, orderId: string, side: "sell" | "buy", _req: z.infer<typeof CancelReq>, now: Date): Promise<void> {
  const o = await lockOrder(tx, orderId);
  if (o.side !== side) fail("NOT_FOUND");
  if (o.companyId !== company.id) fail("FORBIDDEN");
  if (o.status !== "open") fail("ORDER_CLOSED");
  await closeOrder(tx, uow, o, now);
}
