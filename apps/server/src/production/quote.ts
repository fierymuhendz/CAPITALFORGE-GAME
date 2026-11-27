/** POST /production/quote: başlatmadan aynı hesabı yapar (kilitsiz), en iyi alıcıları ekler. */
import { minutesToMs } from "../catalog/pace";
import { and, eq, gt, ne } from "drizzle-orm";
import type { z } from "zod";
import { SYSTEM_PROFILES, roadDistanceKm, type ProductionQuoteDto, type ProductionQuoteReq } from "@capitalforge/shared";
import { applyBp, systemAsk, systemBid, systemBidCap, unitCostPerKg } from "@capitalforge/economy";
import type { Catalog } from "../catalog/catalog";
import type { Db, DbOrTx } from "../db/client";
import { companies, facilities, marketOrders, priceRefs } from "../db/schema";
import { fail } from "../errors";
import { m } from "../lib/serialize";
import { effectivePrice } from "../market/spot";
import { productBidCap } from "../system/pricing";
import { systemFreightEstimate } from "../market/offers";
import { evaluateProduction } from "./eval";

type Buyer = ProductionQuoteDto["bestBuyers"][number];

export async function bestBuyers(db: DbOrTx, catalog: Catalog, companyId: string, productId: string, quality: number, fromCityId: string): Promise<Buyer[]> {
  const out: Buyer[] = [];
  const orders = await db
    .select({ o: marketOrders, name: companies.name })
    .from(marketOrders)
    .innerJoin(companies, eq(companies.id, marketOrders.companyId))
    .where(and(eq(marketOrders.side, "buy"), eq(marketOrders.status, "open"), eq(marketOrders.productId, productId), gt(marketOrders.remainingKg, 0), ne(marketOrders.companyId, companyId)));
  for (const { o, name } of orders) {
    if (o.quality > quality) continue;
    out.push({ cityId: o.cityId, companyName: name, isSystem: o.isSystem, pricePerKg: m(o.pricePerKg), km: roadDistanceKm(fromCityId, o.cityId) });
  }
  const refs = await db.select().from(priceRefs).where(eq(priceRefs.productId, productId));
  const ref = (cityId: string) => refs.find((r) => r.cityId === cityId)?.refPricePerKg ?? BigInt(catalog.product(productId).basePricePerKg);
  const s = catalog.settings.system;
  const asks = SYSTEM_PROFILES.filter((p) => (p.sells[productId] ?? 0) > 0).map((p) => systemAsk(ref(p.cityId), s.askBp, 0, 1));
  const cap = asks.length ? systemBidCap(asks.reduce((a, b) => (b < a ? b : a))) : null;
  const seenSystem = new Set(out.filter((b) => b.isSystem).map((b) => `${b.cityId}|${b.companyName}`));
  for (const p of SYSTEM_PROFILES) {
    if ((p.buys[productId] ?? 0) <= 0 || seenSystem.has(`${p.cityId}|${p.name.tr}`)) continue;
    out.push({ cityId: p.cityId, companyName: p.name.tr, isSystem: true, pricePerKg: m(systemBid(ref(p.cityId), s.bidBp, 0, 1, cap)), km: roadDistanceKm(fromCityId, p.cityId) });
  }
  out.sort((a, b) => (BigInt(b.pricePerKg) > BigInt(a.pricePerKg) ? 1 : BigInt(b.pricePerKg) < BigInt(a.pricePerKg) ? -1 : a.km - b.km));
  return out.slice(0, 5);
}

/**
 * Çıktının en iyi alıcıya satılırsa tahmini: önce aynı şehirdeki en iyi alım emri (kaliteye göre fiyat, sellToOrder ile aynı formül),
 * yoksa bestBuyers'ın navlun sonrası en çok kazandıranı. Gelir = miktar × fiyat, komisyon piyasa komisyonu,
 * navlun alıcı başka şehirdeyse sistem taşımacısı tarifesi; kâr = gelir − komisyon − navlun − üretim maliyeti.
 */
export async function estimateSale(
  db: DbOrTx, catalog: Catalog, companyId: string, cityId: string, productId: string, quality: number, qtyKg: number, cost: bigint, minutes: number,
  buyers?: Buyer[],
): Promise<ProductionQuoteDto["estimate"]> {
  if (qtyKg < 1) return null;
  const orders = await db
    .select()
    .from(marketOrders)
    .where(and(eq(marketOrders.side, "buy"), eq(marketOrders.status, "open"), eq(marketOrders.productId, productId), eq(marketOrders.cityId, cityId), gt(marketOrders.remainingKg, 0), ne(marketOrders.companyId, companyId)));
  let price: bigint | null = null;
  let at = cityId;
  const eligible = orders.filter((o) => o.quality <= quality);
  if (eligible.length) {
    const cap = eligible.some((o) => o.isSystem) ? await productBidCap(db, catalog, productId) : null;
    for (const o of eligible) {
      const p = effectivePrice(o, quality, o.isSystem ? cap : null);
      if (price === null || p > price) price = p;
    }
  } else {
    // başka şehirdeki alıcılar: navlun düşüldükten sonra en çok kazandıranı seç
    let bestNet: bigint | null = null;
    for (const b of buyers ?? (await bestBuyers(db, catalog, companyId, productId, quality, cityId))) {
      const p = BigInt(b.pricePerKg);
      const gross = BigInt(qtyKg) * p;
      const net = gross - applyBp(gross, catalog.settings.marketFeeBp) - systemFreightEstimate(catalog, cityId, b.cityId, qtyKg).freight;
      if (bestNet === null || net > bestNet) { bestNet = net; price = p; at = b.cityId; }
    }
  }
  if (price === null) return null;
  const revenue = BigInt(qtyKg) * price;
  const fee = applyBp(revenue, catalog.settings.marketFeeBp);
  const fr = systemFreightEstimate(catalog, cityId, at, qtyKg);
  const profit = revenue - fee - fr.freight - cost;
  return { pricePerKg: m(price), cityId: at, revenue: m(revenue), fee: m(fee), freight: m(fr.freight), km: fr.km, profit: m(profit), profitPerHour: m(minutes > 0 ? (profit * 3600n) / BigInt(Math.max(1, Math.round(minutes * 60))) : 0n) };
}

export async function quote(db: Db, catalog: Catalog, companyId: string, req: z.infer<typeof ProductionQuoteReq>, now: Date): Promise<ProductionQuoteDto> {
  const facility = (await db.select().from(facilities).where(and(eq(facilities.id, req.facilityId), eq(facilities.companyId, companyId))).limit(1))[0];
  if (!facility || facility.state === "demolished") fail("NOT_FOUND");
  const ev = await evaluateProduction(db, catalog, companyId, facility, req.recipeId, req.batches, false);
  const refs = await db.select().from(priceRefs).where(eq(priceRefs.cityId, facility.cityId));
  const ref = (pid: string) => refs.find((r) => r.productId === pid)?.refPricePerKg ?? BigInt(catalog.product(pid).basePricePerKg);
  let inputsEst = 0n;
  const inputs = ev.inputs.map((i) => {
    // eksik kısım referans fiyatla tahmin edilir
    const est = i.estCost + BigInt(i.missingKg) * ref(i.productId);
    inputsEst += est;
    const kg = i.lots.reduce((a, l) => a + l.kg, 0);
    const wq = kg > 0 ? Math.round(i.lots.reduce((a, l) => a + l.kg * l.quality, 0) / kg) : null;
    return { productId: i.productId, requiredKg: i.requiredKg, availableKg: i.availableKg, quality: wq, estCost: m(est) };
  });
  const total = inputsEst + ev.operatingCost;
  const { plan } = ev;
  const buyers = await bestBuyers(db, catalog, companyId, ev.recipe.output.productId, plan.outputQuality, facility.cityId);
  return {
    recipeId: ev.recipe.id, batches: req.batches, minutes: plan.minutes, endsAt: new Date(now.getTime() + minutesToMs(plan.minutes)).toISOString(),
    inputs,
    output: { productId: ev.recipe.output.productId, qtyKg: plan.outputKg, quality: plan.outputQuality },
    energyKwh: plan.energyKwh, waterM3: plan.waterM3, laborHours: plan.laborHours,
    cost: { inputs: m(inputsEst), energy: m(plan.energyCost), water: m(plan.waterCost), labor: m(plan.laborCost), total: m(total) },
    unitCostPerKg: m(unitCostPerKg(total, plan.outputKg)),
    bestBuyers: buyers,
    canStart: ev.blockers.length === 0,
    blockers: ev.blockers.map((b) => ({ code: b.code, productId: b.productId, missingKg: b.missingKg, missing: b.missing })),
    estimate: await estimateSale(db, catalog, companyId, facility.cityId, ev.recipe.output.productId, plan.outputQuality, plan.outputKg, total, plan.minutes, buyers),
  };
}
