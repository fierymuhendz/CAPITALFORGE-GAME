/**
 * Satış için taşıt: oyuncunun stoğunu alıcının şehrine, sistem taşımacısına açık taşıma işleriyle gönderir.
 * Her kamyon dolusu ayrı iş; ücret = o parçanın sistem tarifesi (sistem taşımacısı bu ücreti kabul eder).
 * Stok rezervi ve navlun emaneti createFreightJob içinde, aynı işlemde yazılır.
 */
import { minutesToMs } from "../catalog/pace";
import { systemCarrierQuote } from "@capitalforge/economy";
import type { HaulReq, HaulResultDto } from "@capitalforge/shared";
import type { z } from "zod";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { fail } from "../errors";
import type { UnitOfWork } from "../events/bus";
import { createFreightJob } from "../logistics/jobs";
import { m } from "../lib/serialize";
import { MAX_DELIVERY_LOADS } from "./buy";
import type { CompanyRow } from "./common";
import { loadChunks, systemFreightEstimate } from "./offers";

const HAUL_DEADLINE_HOURS = 24;

export async function haulForSale(tx: Tx, uow: UnitOfWork, catalog: Catalog, company: CompanyRow, req: z.infer<typeof HaulReq>, now: Date): Promise<HaulResultDto> {
  catalog.city(req.originCityId);
  catalog.city(req.destCityId);
  catalog.product(req.productId);
  if (req.originCityId === req.destCityId) fail("SAME_CITY");
  const truck = catalog.vehicleModel("truck");
  const chunks = loadChunks(req.qtyKg, truck.capacityKg);
  if (chunks.length > MAX_DELIVERY_LOADS) fail("TOO_MANY_LOADS", { max: MAX_DELIVERY_LOADS });
  const est = systemFreightEstimate(catalog, req.originCityId, req.destCityId, req.qtyKg);
  const f = catalog.settings.freight;
  const jobIds: string[] = [];
  let freight = 0n;
  for (const [i, kg] of chunks.entries()) {
    const pay = systemCarrierQuote(est.km, kg, f.systemBaseFee, f.systemPerKm, truck.capacityKg);
    const job = await createFreightJob(tx, uow, catalog, company, {
      originCityId: req.originCityId, destCityId: req.destCityId, cargo: [{ productId: req.productId, quality: req.quality, qtyKg: kg }],
      payAmount: Number(pay), deadlineHours: HAUL_DEADLINE_HOURS, allowSystemCarrier: true, idempotencyKey: `haul:${req.idempotencyKey}:${i}`,
    }, now);
    jobIds.push(job.id);
    freight += pay;
  }
  return { jobIds, freight: m(freight), loads: chunks.length, arrivesBy: new Date(now.getTime() + minutesToMs(est.etaMinutes)).toISOString() };
}
