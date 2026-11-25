/**
 * Sistem şirketleri (saatlik görev): stok yenileme, günlük bütçe/kapasite sınırlı alım emirleri ve ilanlar,
 * oyuncu payına göre küçülme, sahipsiz ilan/emir üstlenme, sistem taşıma işleri, sistem taşımacısı filosu,
 * itibarlı şirketlere tekrarlayan alım sözleşmeleri. Sistem alış fiyatı DAİMA cap'li systemBid'dir.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  applyBp, qualityAdjusted, reputationBp, systemAsk, systemBid, systemCarrierQuote, systemShareFactorBp,
} from "@capitalforge/economy";
import { QUALITY_PRICE_BP, SYSTEM_CARRIER, SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY, SYSTEM_PROFILES, roadDistanceKm, type SystemProfile } from "@capitalforge/shared";
import type { Tx } from "../db/client";
import { companies, contracts, freightJobs, holdings, marketOrders, shipments, trades, vehicles } from "../db/schema";
import type { Deps } from "../deps";
import { AppError } from "../errors";
import { UnitOfWork } from "../events/bus";
import { addStock, releaseStock, removeStock, reserveStock } from "../inventory/holdings";
import { balanceOf, co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { acceptFreightJob, createFreightJob } from "../logistics/jobs";
import { startShipment } from "../logistics/shipping";
import { dayStart, HOUR, linkMovements, MIN } from "../market/common";
import { closeOrder, settleSpot } from "../market/spot";
import { bidCapFromRefs, loadRefs } from "./pricing";
import { dailyOf, spentToday } from "./daily";

type CompanyRow = typeof companies.$inferSelect;

async function systemCompanies(db: Deps["db"] | Tx): Promise<Map<string, CompanyRow>> {
  const rows = await db.select().from(companies).where(eq(companies.isSystem, true));
  return new Map(rows.filter((r) => r.systemKey).map((r) => [r.systemKey!, r]));
}

/** Sistem "hazinesi": nakit hedefin altına düşerse sermaye enjeksiyonu (equity). Defter dengeli. */
async function topUp(tx: Tx, companyId: string, minCash: bigint, now: Date): Promise<void> {
  const cash = await balanceOf(tx, co(companyId, "cash"));
  if (cash >= minCash) return;
  const delta = minCash * 2n - cash;
  await post(tx, {
    kind: "system_topup", idempotencyKey: `sys-topup:${companyId}:${randomUUID()}`, refType: "company", refId: companyId, at: now, memo: "Sistem hazine takviyesi",
    lines: [{ account: co(companyId, "cash"), amount: delta }, { account: co(companyId, "equity"), amount: -delta }],
  });
}

/** Sistem üretimi: stok girer, defterde inventory +maliyet, equity −maliyet */
async function produceStock(tx: Tx, companyId: string, cityId: string, productId: string, quality: number, kg: number, unitCost: bigint, now: Date): Promise<void> {
  if (kg <= 0) return;
  const cost = unitCost * BigInt(kg);
  await addStock(tx, { companyId, cityId, productId, quality }, kg, cost, { kind: "system_production", refType: "company", refId: companyId, at: now });
  const led = await post(tx, {
    kind: "system_production", idempotencyKey: `sys-prod:${randomUUID()}`, refType: "company", refId: companyId, at: now, memo: "Sistem üretimi",
    lines: [{ account: co(companyId, "inventory"), amount: cost }, { account: co(companyId, "equity"), amount: -cost }],
  });
  await linkMovements(tx, "company", companyId, led.id);
}

/** Tüketim: sistemin tutmayacağı stok yok edilir (exp_other) */
async function consumeStock(tx: Tx, companyId: string, prof: SystemProfile | null, now: Date): Promise<void> {
  const rows = await tx.select().from(holdings).where(and(eq(holdings.companyId, companyId), gt(holdings.qtyKg, 0)));
  for (const h of rows) {
    const keep = prof && h.quality === 2 && h.cityId === prof.cityId ? prof.sells[h.productId] ?? 0 : 0;
    const burn = h.qtyKg - h.reservedKg - keep;
    if (burn <= 0) continue;
    const cost = await removeStock(tx, { companyId, cityId: h.cityId, productId: h.productId, quality: h.quality }, burn, { kind: "system_consume", refType: "company", refId: companyId, at: now });
    if (cost > 0n) {
      const led = await post(tx, {
        kind: "system_consume", idempotencyKey: `sys-consume:${randomUUID()}`, refType: "company", refId: companyId, at: now, memo: "Sistem tüketimi",
        lines: [{ account: co(companyId, "exp_other"), amount: cost }, { account: co(companyId, "inventory"), amount: -cost }],
      });
      await linkMovements(tx, "company", companyId, led.id);
    }
  }
}

/** Oyuncular arası işlem hacmine göre oyuncu payı (bp): pp / (pp + nominal günlük) */
async function playerShareBp(tx: Tx, productId: string, cityId: string, nominalKg: number, now: Date): Promise<number> {
  const r = await tx
    .select({ pp: sql<string>`coalesce(sum(${trades.qtyKg}), 0)::text` })
    .from(trades)
    .where(and(eq(trades.productId, productId), eq(trades.cityId, cityId), eq(trades.buyerIsSystem, false), eq(trades.sellerIsSystem, false), gte(trades.createdAt, new Date(now.getTime() - 24 * HOUR))));
  const pp = Number(r[0]?.pp ?? 0);
  return pp + nominalKg > 0 ? Math.min(10000, Math.floor((pp * 10000) / (pp + nominalKg))) : 0;
}

async function syncProfile(deps: Deps, comp: CompanyRow, prof: SystemProfile, now: Date): Promise<void> {
  const cat = deps.catalog;
  const sys = cat.settings.system;
  const uow = new UnitOfWork();
  await deps.db.transaction(async (tx) => {
    await topUp(tx, comp.id, BigInt(prof.dailyBudget) * 2n, now);
    await consumeStock(tx, comp.id, prof, now);
    const products = new Set([...Object.keys(prof.sells), ...Object.keys(prof.buys)]);
    // Bütçe ağırlıkları (alım)
    const refsBy = new Map<string, Map<string, bigint>>();
    for (const p of products) refsBy.set(p, await loadRefs(tx, p));
    const refOf = (p: string) => refsBy.get(p)?.get(prof.cityId) ?? BigInt(cat.product(p).basePricePerKg);
    const weightSum = Object.entries(prof.buys).reduce((a, [p, kg]) => a + BigInt(kg) * refOf(p), 0n);

    for (const [p, S] of Object.entries(prof.sells)) {
      const factor = systemShareFactorBp(await playerShareBp(tx, p, prof.cityId, S + (prof.buys[p] ?? 0), now), sys.shareDampBp);
      const eff = Math.floor((S * factor) / 10000);
      const d = await dailyOf(tx, comp.id, p, now);
      const target = Math.max(0, Math.min(S - d.soldKg, eff - d.soldKg));
      const price = systemAsk(refOf(p), sys.askBp, d.soldKg, S);
      const ex = (await tx.select().from(marketOrders).where(and(eq(marketOrders.companyId, comp.id), eq(marketOrders.cityId, prof.cityId), eq(marketOrders.productId, p), eq(marketOrders.side, "sell"), eq(marketOrders.status, "open"))).for("update"))[0];
      const key = { companyId: comp.id, cityId: prof.cityId, productId: p, quality: 2 };
      const avail = async () => {
        const h = (await tx.select().from(holdings).where(and(eq(holdings.companyId, comp.id), eq(holdings.cityId, prof.cityId), eq(holdings.productId, p), eq(holdings.quality, 2))))[0];
        return h ? h.qtyKg - h.reservedKg : 0;
      };
      if (!ex) {
        if (target <= 0) continue;
        const have = await avail();
        if (have < target) await produceStock(tx, comp.id, prof.cityId, p, 2, target - have, refOf(p), now);
        await reserveStock(tx, key, target);
        await tx.insert(marketOrders).values({ side: "sell", companyId: comp.id, isSystem: true, cityId: prof.cityId, productId: p, quality: 2, qtyKg: target, remainingKg: target, pricePerKg: price, createdAt: now });
      } else if (target <= 0) {
        await closeOrder(tx, uow, ex, now, "filled");
      } else {
        if (target > ex.remainingKg) {
          const need = target - ex.remainingKg;
          const have = await avail();
          if (have < need) await produceStock(tx, comp.id, prof.cityId, p, 2, need - have, refOf(p), now);
          await reserveStock(tx, key, need);
        } else if (target < ex.remainingKg) {
          
          await releaseStock(tx, key, ex.remainingKg - target);
        }
        await tx.update(marketOrders).set({ qtyKg: target, remainingKg: target, pricePerKg: price }).where(eq(marketOrders.id, ex.id));
      }
    }

    for (const [p, B] of Object.entries(prof.buys)) {
      const refs = refsBy.get(p)!;
      const factor = systemShareFactorBp(await playerShareBp(tx, p, prof.cityId, B + (prof.sells[p] ?? 0), now), sys.shareDampBp);
      const eff = Math.floor((B * factor) / 10000);
      const d = await dailyOf(tx, comp.id, p, now);
      const bid = systemBid(refOf(p), sys.bidBp, d.boughtKg, B, bidCapFromRefs(refs, sys.askBp));
      const maxUnit = qualityAdjusted(bid, 5, QUALITY_PRICE_BP);
      const share = weightSum > 0n ? (BigInt(prof.dailyBudget) * BigInt(B) * refOf(p)) / weightSum : 0n;
      const budget = applyBp(share, factor);
      const budgetLeft = budget > d.spent ? budget - d.spent : 0n;
      const target = Math.max(0, Math.min(eff - d.boughtKg, Number(budgetLeft / maxUnit)));
      const ex = (await tx.select().from(marketOrders).where(and(eq(marketOrders.companyId, comp.id), eq(marketOrders.cityId, prof.cityId), eq(marketOrders.productId, p), eq(marketOrders.side, "buy"), eq(marketOrders.status, "open"))).for("update"))[0];
      if (!ex) {
        if (target <= 0) continue;
        await tx.insert(marketOrders).values({ side: "buy", companyId: comp.id, isSystem: true, cityId: prof.cityId, productId: p, quality: 1, qtyKg: target, remainingKg: target, pricePerKg: bid, createdAt: now });
      } else if (target <= 0) {
        await closeOrder(tx, uow, ex, now, "filled");
      } else {
        await tx.update(marketOrders).set({ qtyKg: target, remainingKg: target, pricePerKg: bid }).where(eq(marketOrders.id, ex.id));
      }
    }
  });
  uow.flush(deps.events);
}

/** Sahipsiz oyuncu ilanları (6 sa dolmamış) → bütçe/kapasite varsa sistem alır; sahipsiz alım emirleri (3 sa) → stok varsa sistem satar */
async function adoptOrphans(deps: Deps, now: Date, sysCos: Map<string, CompanyRow>): Promise<number> {
  const cat = deps.catalog;
  const sys = cat.settings.system;
  let n = 0;
  const listings = await deps.db
    .select({ id: marketOrders.id })
    .from(marketOrders)
    .where(and(eq(marketOrders.side, "sell"), eq(marketOrders.status, "open"), eq(marketOrders.isSystem, false), lte(marketOrders.createdAt, new Date(now.getTime() - sys.unsoldListingHours * HOUR)), isNull(marketOrders.firstFillAt)))
    .limit(30);
  for (const l of listings) {
    const uow = new UnitOfWork();
    try {
      const ok = await deps.db.transaction(async (tx) => {
        const o = (await tx.select().from(marketOrders).where(eq(marketOrders.id, l.id)).for("update", { skipLocked: true }))[0];
        if (!o || o.status !== "open" || o.firstFillAt) return false;
        const cands = SYSTEM_PROFILES.filter((p) => (p.buys[o.productId] ?? 0) > 0).sort(
          (a, b) => roadDistanceKm(a.cityId, o.cityId) - roadDistanceKm(b.cityId, o.cityId),
        );
        for (const prof of cands) {
          const comp = sysCos.get(prof.companyKey);
          if (!comp) continue;
          const refs = await loadRefs(tx, o.productId);
          const ref = refs.get(o.cityId) ?? BigInt(cat.product(o.productId).basePricePerKg);
          const B = prof.buys[o.productId]!;
          const d = await dailyOf(tx, comp.id, o.productId, now);
          const factor = systemShareFactorBp(await playerShareBp(tx, o.productId, o.cityId, B, now), sys.shareDampBp);
          const unitBid = qualityAdjusted(systemBid(ref, sys.bidBp, d.boughtKg, B, bidCapFromRefs(refs, sys.askBp)), o.quality, QUALITY_PRICE_BP);
          if (o.pricePerKg > unitBid) continue;
          const spent = await spentToday(tx, comp.id, now);
          const budgetLeft = BigInt(prof.dailyBudget) - spent;
          const qty = Math.min(o.remainingKg, Math.floor((B * factor) / 10000) - d.boughtKg, Number(budgetLeft / o.pricePerKg));
          if (qty < 1) continue;
          await topUp(tx, comp.id, o.pricePerKg * BigInt(qty), now);
          await settleSpot(tx, uow, {
            order: o, qtyKg: qty, quality: o.quality, unitPrice: o.pricePerKg, buyerId: comp.id, buyerIsSystem: true, sellerId: o.companyId, sellerIsSystem: false,
            fromReserved: true, buyerFunding: "cash", now, marketFeeBp: cat.settings.marketFeeBp,
          });
          return true;
        }
        return false;
      });
      if (ok) { uow.flush(deps.events); n++; }
    } catch (e) { if (!(e instanceof AppError)) throw e; }
  }
  const orders = await deps.db
    .select({ id: marketOrders.id })
    .from(marketOrders)
    .where(and(eq(marketOrders.side, "buy"), eq(marketOrders.status, "open"), eq(marketOrders.isSystem, false), lte(marketOrders.createdAt, new Date(now.getTime() - sys.unfilledOrderHours * HOUR)), isNull(marketOrders.firstFillAt)))
    .limit(30);
  for (const l of orders) {
    const uow = new UnitOfWork();
    try {
      const ok = await deps.db.transaction(async (tx) => {
        const o = (await tx.select().from(marketOrders).where(eq(marketOrders.id, l.id)).for("update", { skipLocked: true }))[0];
        if (!o || o.status !== "open" || o.firstFillAt || o.quality > 2) return false;
        const prof = SYSTEM_PROFILES.find((p) => p.cityId === o.cityId && (p.sells[o.productId] ?? 0) > 0);
        const comp = prof ? sysCos.get(prof.companyKey) : undefined;
        if (!prof || !comp) return false;
        const S = prof.sells[o.productId]!;
        const d = await dailyOf(tx, comp.id, o.productId, now);
        const refs = await loadRefs(tx, o.productId);
        const ref = refs.get(o.cityId) ?? BigInt(cat.product(o.productId).basePricePerKg);
        const ask = systemAsk(ref, sys.askBp, d.soldKg, S);
        if (o.pricePerKg < ask) return false;
        const factor = systemShareFactorBp(await playerShareBp(tx, o.productId, o.cityId, S + (prof.buys[o.productId] ?? 0), now), sys.shareDampBp);
        const qty = Math.min(o.remainingKg, Math.floor((S * factor) / 10000) - d.soldKg);
        if (qty < 1) return false;
        await produceStock(tx, comp.id, o.cityId, o.productId, 2, qty, ref, now);
        await settleSpot(tx, uow, {
          order: o, qtyKg: qty, quality: 2, unitPrice: o.pricePerKg, buyerId: o.companyId, buyerIsSystem: false, sellerId: comp.id, sellerIsSystem: true,
          fromReserved: false, buyerFunding: "escrow", now, marketFeeBp: cat.settings.marketFeeBp,
        });
        return true;
      });
      if (ok) { uow.flush(deps.events); n++; }
    } catch (e) { if (!(e instanceof AppError)) throw e; }
  }
  return n;
}

/** Anadolu Lojistik: filo, sistem taşıma işleri, sahipsiz oyuncu işlerini üstlenme, boş konum dengeleme */
async function freightCycle(deps: Deps, now: Date, sysCos: Map<string, CompanyRow>): Promise<number> {
  const cat = deps.catalog;
  const carrier = sysCos.get(SYSTEM_CARRIER.companyKey);
  if (!carrier) return 0;
  let n = 0;
  const cities = [...cat.cities.keys()].sort();
  const truck = cat.vehicleModel("truck");

  // Filo: şehir başına trucksPerCity araç (yalnızca eksikse)
  await deps.db.transaction(async (tx) => {
    const have = await tx.select().from(vehicles).where(and(eq(vehicles.companyId, carrier.id), ne(vehicles.status, "sold")));
    if (have.length >= cities.length * SYSTEM_CARRIER.trucksPerCity) return;
    const missing = cities.length * SYSTEM_CARRIER.trucksPerCity - have.length;
    const perCity = new Map<string, number>(cities.map((c) => [c, have.filter((v) => v.cityId === c).length]));
    let left = missing;
    for (const c of cities) {
      while (left > 0 && (perCity.get(c) ?? 0) < SYSTEM_CARRIER.trucksPerCity) {
        const [v] = await tx.insert(vehicles).values({ companyId: carrier.id, modelId: truck.id, cityId: c, status: "idle", purchasedAt: now }).returning();
        const price = BigInt(truck.price);
        await post(tx, {
          kind: "vehicle_purchase", idempotencyKey: `vehicle-buy:${v!.id}`, refType: "vehicle", refId: v!.id, at: now, memo: "Sistem taşımacısı aracı",
          lines: [{ account: co(carrier.id, "fixed_assets"), amount: price }, { account: co(carrier.id, "equity"), amount: -price }],
        });
        perCity.set(c, (perCity.get(c) ?? 0) + 1);
        left--;
        n++;
      }
    }
  });

  // Sistem taşıma işleri (şehir başına günlük sayı, gün içine yayılır)
  const hoursToday = (now.getTime() - dayStart(now).getTime()) / HOUR;
  const allowed = Math.min(SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY, 1 + Math.floor(hoursToday / 6));
  for (const c of cities) {
    const shipper = sysCos.get(`wholesale_${c}`);
    const prof = SYSTEM_PROFILES.find((p) => p.companyKey === `wholesale_${c}`);
    if (!shipper || !prof) continue;
    const uow = new UnitOfWork();
    const created = await deps.db.transaction(async (tx) => {
      const today = await tx.select({ n: sql<number>`count(*)::int` }).from(freightJobs).where(and(eq(freightJobs.isSystem, true), eq(freightJobs.originCityId, c), gte(freightJobs.createdAt, dayStart(now))));
      const open = await tx.select({ n: sql<number>`count(*)::int` }).from(freightJobs).where(and(eq(freightJobs.isSystem, true), eq(freightJobs.originCityId, c), eq(freightJobs.status, "open")));
      const k = today[0]?.n ?? 0;
      if (k >= allowed || (open[0]?.n ?? 0) >= SYSTEM_FREIGHT_JOBS_PER_CITY_PER_DAY) return 0;
      const sells = Object.keys(prof.sells).sort();
      const productId = sells[k % sells.length]!;
      const others = cities.filter((x) => x !== c);
      const dest = others[(k + Math.floor(now.getTime() / 86_400_000)) % others.length]!;
      const kg = 4000;
      const km = roadDistanceKm(c, dest);
      const pay = systemCarrierQuote(km, kg, cat.settings.freight.systemBaseFee, cat.settings.freight.systemPerKm, truck.capacityKg);
      const refs = await loadRefs(tx, productId);
      await topUp(tx, shipper.id, pay + BigInt(prof.dailyBudget), now);
      await produceStock(tx, shipper.id, c, productId, 2, kg, refs.get(c) ?? BigInt(cat.product(productId).basePricePerKg), now);
      await createFreightJob(tx, uow, cat, shipper, {
        originCityId: c, destCityId: dest, cargo: [{ productId, quality: 2, qtyKg: kg }], payAmount: Number(pay), deadlineHours: 24, allowSystemCarrier: false,
        idempotencyKey: `sysjob${randomUUID().replaceAll("-", "")}`,
      }, now, { isSystem: true });
      return 1;
    });
    if (created) { uow.flush(deps.events); n++; }
  }

  // Sahipsiz oyuncu işlerini üstlen
  const open = await deps.db
    .select()
    .from(freightJobs)
    .where(and(eq(freightJobs.status, "open"), eq(freightJobs.isSystem, false), eq(freightJobs.allowSystemCarrier, true), lte(freightJobs.createdAt, new Date(now.getTime() - cat.settings.freight.systemPickupAfterMinutes * MIN))))
    .limit(30);
  for (const j of open) {
    const quote = systemCarrierQuote(j.distanceKm, j.totalKg, cat.settings.freight.systemBaseFee, cat.settings.freight.systemPerKm, truck.capacityKg);
    if (j.payAmount < quote) continue;
    const uow = new UnitOfWork();
    try {
      const ok = await deps.db.transaction(async (tx) => {
        const v = (await tx.select().from(vehicles).where(and(eq(vehicles.companyId, carrier.id), eq(vehicles.status, "idle"), eq(vehicles.cityId, j.originCityId))).limit(1))[0];
        if (!v || cat.vehicleModel(v.modelId).capacityKg < j.totalKg) return false;
        await topUp(tx, carrier.id, 5_000_000n, now);
        await acceptFreightJob(tx, uow, cat, carrier, j.id, { vehicleId: v.id, idempotencyKey: `sysacc${randomUUID().replaceAll("-", "")}` }, now);
        return true;
      });
      if (ok) { uow.flush(deps.events); n++; }
    } catch (e) { if (!(e instanceof AppError)) throw e; }
  }

  // Boş konum dengeleme: araçsız şehre, ≥2 boşta aracı olan şehirden bir araç gönder
  const uow = new UnitOfWork();
  const moved = await deps.db.transaction(async (tx) => {
    const fleet = await tx.select().from(vehicles).where(and(eq(vehicles.companyId, carrier.id), ne(vehicles.status, "sold")));
    const idleBy = new Map<string, typeof fleet>(cities.map((c) => [c, fleet.filter((v) => v.status === "idle" && v.cityId === c)]));
    const inbound = new Set<string>();
    for (const v of fleet) if (v.status === "in_transit" && v.currentShipmentId) inbound.add(v.currentShipmentId);
    const dests = new Set<string>();
    if (inbound.size) {
      
      const s = await tx.select({ d: shipments.destCityId }).from(shipments).where(inArray(shipments.id, [...inbound]));
      for (const x of s) dests.add(x.d);
    }
    const empty = cities.find((c) => (idleBy.get(c)?.length ?? 0) === 0 && !dests.has(c));
    if (!empty) return false;
    const donor = cities.filter((c) => (idleBy.get(c)?.length ?? 0) >= 2).sort((a, b) => roadDistanceKm(a, empty) - roadDistanceKm(b, empty))[0];
    if (!donor) return false;
    const v = idleBy.get(donor)![0]!;
    await topUp(tx, carrier.id, 5_000_000n, now);
    await startShipment(tx, uow, cat, { vehicle: v, carrierId: carrier.id, destCityId: empty, cargo: [], purpose: "reposition", freightJobId: null, now });
    return true;
  });
  if (moved) { uow.flush(deps.events); n++; }
  return n;
}

/** İtibarlı şirketlere tekrarlayan sistem alım sözleşmesi teklifi (%5 prim, cap'li) */
async function recurringContracts(deps: Deps, now: Date, sysCos: Map<string, CompanyRow>): Promise<number> {
  const cat = deps.catalog;
  const sys = cat.settings.system;
  let n = 0;
  const players = await deps.db.select().from(companies).where(and(eq(companies.isSystem, false), isNull(companies.dissolvedAt), gte(companies.onTimeDeliveries, 5)));
  for (const pl of players) {
    if (reputationBp(pl.onTimeDeliveries, pl.lateOrMissed) < 9000) continue;
    const busy = await deps.db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.isSystem, true), eq(contracts.counterpartyCompanyId, pl.id), inArray(contracts.status, ["proposed", "active"])))
      .limit(1);
    if (busy[0]) continue;
    const uow = new UnitOfWork();
    const made = await deps.db.transaction(async (tx) => {
      const hs = await tx.select().from(holdings).where(and(eq(holdings.companyId, pl.id), gte(holdings.quality, 2), gt(holdings.qtyKg, 0)));
      for (const h of hs) {
        const prof = SYSTEM_PROFILES.find((p) => p.cityId === h.cityId && (p.buys[h.productId] ?? 0) > 0);
        const comp = prof ? sysCos.get(prof.companyKey) : undefined;
        if (!prof || !comp) continue;
        const B = prof.buys[h.productId]!;
        const qty = Math.min(Math.floor((h.qtyKg - h.reservedKg) / 3), Math.floor(B / 4));
        if (qty < 100) continue;
        const refs = await loadRefs(tx, h.productId);
        const ref = refs.get(h.cityId) ?? BigInt(cat.product(h.productId).basePricePerKg);
        const cap = bidCapFromRefs(refs, sys.askBp);
        let price = applyBp(systemBid(ref, sys.bidBp, 0, B, cap), 10000 + sys.reputationPremiumBp);
        if (cap !== null && price > cap) price = cap;
        const value = price * BigInt(qty) * 3n;
        if (value > BigInt(prof.dailyBudget) / 2n) continue;
        await topUp(tx, comp.id, value, now);
        const exp = new Date(now.getTime() + 24 * HOUR);
        await tx.insert(contracts).values({
          status: "proposed", isSystem: true, proposerCompanyId: comp.id, proposerRole: "buyer", counterpartyCompanyId: pl.id, sellerCompanyId: pl.id, buyerCompanyId: comp.id,
          productId: h.productId, minQuality: 2, qtyPerInstallmentKg: qty, pricePerKg: price, deliveryCityId: h.cityId, freightPayer: "seller", installments: 3,
          firstDueAt: new Date(now.getTime() + 24 * HOUR), intervalHours: 24, graceHours: 2, penaltyBp: 1000, lateFeeBp: cat.settings.contracts.lateFeeBp,
          expiresAt: exp, note: null, createdAt: now,
        });
        await notify(tx, uow, pl.id, "contract_offer_received", { productId: h.productId, from: comp.name, system: 1 }, now, "/play?tab=contracts");
        return true;
      }
      return false;
    });
    if (made) { uow.flush(deps.events); n++; }
  }
  return n;
}

export async function runSystemCycle(deps: Deps, now: Date): Promise<number> {
  const sysCos = await systemCompanies(deps.db);
  let n = 0;
  for (const prof of SYSTEM_PROFILES) {
    const comp = sysCos.get(prof.companyKey);
    if (!comp) continue;
    try {
      await syncProfile(deps, comp, prof, now);
      n++;
    } catch (err) {
      deps.log.error({ err, profile: prof.companyKey }, "sistem şirketi döngüsü başarısız");
    }
  }
  n += await adoptOrphans(deps, now, sysCos);
  n += await freightCycle(deps, now, sysCos);
  n += await recurringContracts(deps, now, sysCos);
  return n;
}

