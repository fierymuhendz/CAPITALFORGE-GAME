/**
 * İlandan al + teslim ettir: tek işlemde alım ve (isteğe bağlı) sistem taşımacısına açık taşıma işi.
 * Kilit sırası: ilan satırı → stok → defter (buyFromListing), ardından taşıma işi (stok rezervi → emanet).
 * Nakit mal bedelini ve navlun emanetini birlikte karşılamıyorsa hiçbir şey yazılmadan INSUFFICIENT_FUNDS.
 */
import { and, eq } from "drizzle-orm";
import { systemCarrierQuote } from "@capitalforge/economy";
import type { BuyFromListingReq, BuyResultDto } from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { marketOrders } from "../db/schema";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { writeOutcome } from "../finance/outcomes";
import { balanceOf, co } from "../ledger/post";
import { createFreightJob } from "../logistics/jobs";
import { m } from "../lib/serialize";
import { MIN, type CompanyRow } from "./common";
import { loadChunks, systemFreightEstimate } from "./offers";
import { buyFromListing } from "./spot";

const DELIVERY_DEADLINE_HOURS = 24;
export const MAX_DELIVERY_LOADS = 10;

export async function buyWithDelivery(
  tx: Tx, uow: UnitOfWork, catalog: Catalog, buyer: CompanyRow, listingId: string, req: z.infer<typeof BuyFromListingReq>, now: Date,
): Promise<BuyResultDto> {
  const pre = (await tx.select().from(marketOrders).where(and(eq(marketOrders.id, listingId), eq(marketOrders.side, "sell"))).limit(1))[0];
  if (!pre) fail("NOT_FOUND");
  const dest = req.deliverToCityId;
  if (dest) catalog.city(dest);
  const deliver = !!dest && dest !== pre.cityId;
  if (deliver && loadChunks(req.qtyKg, catalog.vehicleModel("truck").capacityKg).length > MAX_DELIVERY_LOADS) fail("TOO_MANY_LOADS", { max: MAX_DELIVERY_LOADS });
  const est = deliver ? systemFreightEstimate(catalog, pre.cityId, dest!, req.qtyKg) : null;

  if (est && pre.status === "open" && pre.companyId !== buyer.id) {
    const unit = pre.pricePerKg < BigInt(req.expectedPricePerKg) ? pre.pricePerKg : BigInt(req.expectedPricePerKg);
    const need = BigInt(req.qtyKg) * unit + est.freight;
    const have = await balanceOf(tx, co(buyer.id, "cash"));
    if (have < need) fail("INSUFFICIENT_FUNDS", { missing: (need - have).toString() });
  }

  const spot = await buyFromListing(tx, uow, catalog, buyer, listingId, req, now);

  const jobIds: string[] = [];
  let freightPay = 0n;
  let arrivesBy: Date | null = null;
  if (est && dest) {
    const truck = catalog.vehicleModel("truck");
    const f = catalog.settings.freight;
    // kamyon dolusu başına bir iş: sistem taşımacısı bir işte tek araç alır; her işin ücreti = o parçanın sistem tarifesi
    for (const [i, kg] of loadChunks(req.qtyKg, truck.capacityKg).entries()) {
      const pay = systemCarrierQuote(est.km, kg, f.systemBaseFee, f.systemPerKm, truck.capacityKg);
      const job = await createFreightJob(tx, uow, catalog, buyer, {
        originCityId: pre.cityId, destCityId: dest, cargo: [{ productId: pre.productId, quality: pre.quality, qtyKg: kg }],
        payAmount: Number(pay), deadlineHours: DELIVERY_DEADLINE_HOURS, allowSystemCarrier: true, idempotencyKey: `buy-deliver:${spot.tradeId}:${i}`,
      }, now);
      jobIds.push(job.id);
      freightPay += pay;
    }
    arrivesBy = new Date(now.getTime() + est.etaMinutes * MIN);
  }

  let outcomeId: string | null = null;
  if (!buyer.isSystem) {
    const goods = spot.gross; // sunucunun hesapladığı gerçek mal bedeli
    outcomeId = await writeOutcome(tx, {
      companyId: buyer.id, kind: "purchase", refType: "trade", refId: spot.tradeId, productId: pre.productId, cityId: pre.cityId, destCityId: deliver ? dest! : pre.cityId,
      expected: {
        qtyKg: req.qtyKg, goods, freight: est ? est.freight : 0n, cost: goods + (est ? est.freight : 0n), minutes: est ? est.etaMinutes : 0,
        at: arrivesBy ?? now, meta: { freightJobIds: jobIds },
      },
      at: now,
    });
  }
  return {
    tradeId: spot.tradeId, saleId: spot.saleId, gross: m(spot.gross), fee: m(spot.fee), cogs: m(spot.cogs),
    freightJobId: jobIds[0] ?? null, freightPay: jobIds.length ? m(freightPay) : null, arrivesBy: arrivesBy ? arrivesBy.toISOString() : null, outcomeId,
  };
}
