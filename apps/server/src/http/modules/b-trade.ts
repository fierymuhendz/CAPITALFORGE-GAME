/**
 * Modül B: piyasa, sözleşme, lojistik, sistem şirketleri. Tüm uç ve görev kayıtları yalnızca burada.
 * Uçlar: /market*, /contracts*, /fleet*, /shipments*, /freight-jobs*, /freight/quote
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import {
  BoardScopeQuery, BuyFromListingReq, BuyOrderReq, BuyVehicleReq, CancelReq, ContractProposalReq, DeliverReq, FreightJobReq, FreightQuoteQuery,
  MarketCompareQuery, MarketStatsQuery, AcceptFreightReq, HaulReq, ListingReq, MarketHistoryQuery, MarketQuery, MineScopeQuery, OffersQuery, SellToOrderReq, ShipmentReq,
} from "@capitalforge/shared";
import { z } from "zod";
import { contracts, freightJobs, marketOrders, shipmentCargo, shipments, vehicles } from "../../db/schema";
import type { Deps } from "../../deps";
import { fail } from "../../errors";
import { registerTask } from "../../scheduler/scheduler";
import { route } from "../route";
import { companyBriefs, needCompany, uuidParam } from "../../market/common";
import { cancelOrder, createBuyOrder, createListing, orderDto, sellToOrder } from "../../market/spot";
import { buyWithDelivery } from "../../market/buy";
import { haulForSale } from "../../market/haul";
import { offers } from "../../market/offers";
import { contractCompare } from "../../contracts/compare";
import { marketOverview, marketView, priceHistoryView } from "../../market/views";
import { marketCompare, marketStats } from "../../market/stats";
import { updatePriceRefs } from "../../market/prices";
import {
  acceptContract, cancelContract, closeInstallments, contractDetail, contractDtos, declineContract, deliverManual, expireProposals, openWindows,
  proposeContract, withdrawContract,
} from "../../contracts/contracts";
import { buyVehicle, freightQuote, ownShipment, shipmentDto, vehicleDtos } from "../../logistics/fleet";
import { acceptFreightJob, cancelFreightJob, createFreightJob, expireJobs, jobDtos } from "../../logistics/jobs";
import { processArrivals } from "../../logistics/shipping";
import { runSystemCycle } from "../../system/system";
import { m } from "../../lib/serialize";

const spotOut = (r: { tradeId: string; saleId: string; gross: bigint; fee: bigint; cogs: bigint }) => ({
  tradeId: r.tradeId, saleId: r.saleId, gross: m(r.gross), fee: m(r.fee), cogs: m(r.cogs),
});
const noBody = z.object({});

export function register(app: FastifyInstance, deps: Deps): void {
  const cat = deps.catalog;

  // ------------------------------------------------------------ piyasa
  route(app, deps, {
    method: "GET", url: "/market", auth: "none", body: MarketQuery,
    handler: async ({ body, company }) => marketView(deps.db, cat, body.cityId, body.productId, company?.id ?? null),
  });
  route(app, deps, {
    method: "GET", url: "/market/overview", auth: "none", body: noBody,
    handler: async ({ now }) => marketOverview(deps.db, cat, now),
  });
  route(app, deps, {
    method: "GET", url: "/market/history", auth: "none", body: MarketHistoryQuery,
    handler: async ({ body, now }) => {
      cat.city(body.cityId);
      cat.product(body.productId);
      return priceHistoryView(deps.db, body.cityId, body.productId, body.hours ?? 72, now);
    },
  });
  route(app, deps, {
    method: "GET", url: "/market/stats", auth: "none", body: MarketStatsQuery, rateLimitPerMin: 30, rateKey: "mstat",
    handler: async ({ body, company, now }) => marketStats(deps.db, cat, body, company?.id ?? null, now),
  });
  route(app, deps, {
    method: "GET", url: "/market/compare", auth: "none", body: MarketCompareQuery, rateLimitPerMin: 20, rateKey: "mcmp",
    handler: async ({ body, company, now }) => marketCompare(deps.db, cat, body, company, now),
  });
  route(app, deps, {
    method: "POST", url: "/market/listings", auth: "company", kind: "mutation", body: ListingReq,
    handler: async ({ tx, uow, body, company, now }) => {
      const c = needCompany(company);
      const o = await createListing(tx, uow, cat, c, body, now);
      return orderDto(o, c.name, c.id);
    },
  });
  route(app, deps, {
    method: "POST", url: "/market/orders", auth: "company", kind: "mutation", body: BuyOrderReq,
    handler: async ({ tx, uow, body, company, now }) => {
      const c = needCompany(company);
      const o = await createBuyOrder(tx, uow, cat, c, body, now);
      return orderDto(o, c.name, c.id);
    },
  });
  route(app, deps, {
    method: "POST", url: "/market/listings/:id/buy", auth: "company", kind: "mutation", body: BuyFromListingReq,
    handler: async ({ tx, uow, body, company, now, params }) => buyWithDelivery(tx, uow, cat, needCompany(company), uuidParam(params.id), body, now),
  });
  route(app, deps, {
    method: "GET", url: "/market/offers", auth: "company", body: OffersQuery,
    handler: async ({ body, company, now }) => offers(deps.db, cat, needCompany(company), body, now),
  });
  route(app, deps, {
    method: "POST", url: "/market/orders/:id/sell", auth: "company", kind: "mutation", body: SellToOrderReq,
    handler: async ({ tx, uow, body, company, now, params }) => spotOut(await sellToOrder(tx, uow, cat, needCompany(company), uuidParam(params.id), body, now)),
  });
  route(app, deps, {
    method: "POST", url: "/market/listings/:id/cancel", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, body, company, now, params }) => {
      await cancelOrder(tx, uow, needCompany(company), uuidParam(params.id), "sell", body, now);
      return { ok: true };
    },
  });
  route(app, deps, {
    method: "POST", url: "/market/orders/:id/cancel", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, body, company, now, params }) => {
      await cancelOrder(tx, uow, needCompany(company), uuidParam(params.id), "buy", body, now);
      return { ok: true };
    },
  });
  // kendi açık emirlerim
  route(app, deps, {
    method: "GET", url: "/market/mine", auth: "company", body: noBody,
    handler: async ({ company }) => {
      const c = needCompany(company);
      const rows = await deps.db.select().from(marketOrders).where(and(eq(marketOrders.companyId, c.id), eq(marketOrders.status, "open"))).orderBy(desc(marketOrders.createdAt));
      return rows.map((o) => orderDto(o, c.name, c.id));
    },
  });

  // ------------------------------------------------------------ sözleşmeler
  route(app, deps, {
    method: "GET", url: "/contracts", auth: "company", body: BoardScopeQuery,
    handler: async ({ body, company, now }) => {
      const c = needCompany(company);
      const rows =
        body.scope === "board"
          ? await deps.db
              .select().from(contracts)
              .where(and(eq(contracts.status, "proposed"), eq(contracts.proposerCompanyId, contracts.proposerCompanyId), ne(contracts.proposerCompanyId, c.id)))
              .orderBy(desc(contracts.createdAt)).limit(300)
          : await deps.db
              .select().from(contracts)
              .where(or(eq(contracts.proposerCompanyId, c.id), eq(contracts.sellerCompanyId, c.id), eq(contracts.buyerCompanyId, c.id), eq(contracts.counterpartyCompanyId, c.id)))
              .orderBy(desc(contracts.createdAt)).limit(300);
      const visible = body.scope === "board" ? rows.filter((r) => !r.counterpartyCompanyId && r.expiresAt.getTime() > now.getTime()) : rows;
      return contractDtos(deps.db, visible, c.id);
    },
  });
  route(app, deps, {
    method: "GET", url: "/contracts/:id", auth: "company",
    handler: async ({ company, params }) => {
      const c = needCompany(company);
      const row = (await deps.db.select().from(contracts).where(eq(contracts.id, uuidParam(params.id))))[0];
      if (!row) fail("NOT_FOUND");
      const party = [row.sellerCompanyId, row.buyerCompanyId, row.proposerCompanyId, row.counterpartyCompanyId].includes(c.id);
      const openPublic = row.status === "proposed" && !row.counterpartyCompanyId;
      if (!party && !openPublic) fail("NOT_PARTY");
      return contractDetail(deps.db, row, c.id);
    },
  });
  route(app, deps, {
    method: "GET", url: "/contracts/:id/compare", auth: "company",
    handler: async ({ company, params, now }) => {
      const c = needCompany(company);
      const row = (await deps.db.select().from(contracts).where(eq(contracts.id, uuidParam(params.id))))[0];
      if (!row) fail("NOT_FOUND");
      const party = [row.sellerCompanyId, row.buyerCompanyId, row.proposerCompanyId, row.counterpartyCompanyId].includes(c.id);
      const openPublic = row.status === "proposed" && !row.counterpartyCompanyId;
      if (!party && !openPublic) fail("NOT_PARTY");
      return (await contractCompare(deps.db, cat, row, c.id, now)).dto;
    },
  });
  route(app, deps, {
    method: "POST", url: "/contracts", auth: "company", kind: "mutation", body: ContractProposalReq,
    handler: async ({ tx, uow, body, company, now }) => {
      const c = needCompany(company);
      const row = await proposeContract(tx, uow, cat, c, body, now);
      return (await contractDtos(tx, [row], c.id))[0];
    },
  });
  route(app, deps, {
    method: "POST", url: "/contracts/:id/accept", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, company, now, params }) => {
      const c = needCompany(company);
      const row = await acceptContract(tx, uow, cat, c, uuidParam(params.id), now);
      return (await contractDtos(tx, [row], c.id))[0];
    },
  });
  route(app, deps, {
    method: "POST", url: "/contracts/:id/decline", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, company, now, params }) => { await declineContract(tx, uow, needCompany(company), uuidParam(params.id), now); return { ok: true }; },
  });
  route(app, deps, {
    method: "POST", url: "/contracts/:id/withdraw", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, company, now, params }) => { await withdrawContract(tx, uow, needCompany(company), uuidParam(params.id), now); return { ok: true }; },
  });
  route(app, deps, {
    method: "POST", url: "/contracts/:id/cancel", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, company, now, params }) => {
      const r = await cancelContract(tx, uow, cat, needCompany(company), uuidParam(params.id), now);
      return { ok: true, penalty: m(r.penalty) };
    },
  });
  route(app, deps, {
    method: "POST", url: "/contracts/installments/:id/deliver", auth: "company", kind: "mutation", body: DeliverReq,
    handler: async ({ tx, uow, body, company, now, params }) => {
      const r = await deliverManual(tx, uow, cat, needCompany(company), uuidParam(params.id), body, now);
      return { deliveryId: r.deliveryId, saleId: r.saleId, gross: m(r.gross), lateFee: m(r.lateFee), net: m(r.net), late: r.late };
    },
  });

  // ------------------------------------------------------------ filo ve sevkiyat
  route(app, deps, {
    method: "GET", url: "/fleet", auth: "company", body: noBody,
    handler: async ({ company }) => {
      const c = needCompany(company);
      const rows = await deps.db.select().from(vehicles).where(and(eq(vehicles.companyId, c.id), ne(vehicles.status, "sold"))).orderBy(vehicles.purchasedAt);
      return vehicleDtos(deps.db, rows);
    },
  });
  route(app, deps, {
    method: "POST", url: "/fleet/buy", auth: "company", kind: "mutation", body: BuyVehicleReq,
    handler: async ({ tx, uow, body, company, now }) => (await vehicleDtos(tx, [await buyVehicle(tx, uow, cat, needCompany(company), body, now)]))[0],
  });
  route(app, deps, {
    method: "POST", url: "/shipments", auth: "company", kind: "mutation", body: ShipmentReq,
    handler: async ({ tx, uow, body, company, now }) => {
      const c = needCompany(company);
      return shipmentDto(tx, await ownShipment(tx, uow, cat, c, body, now), c.id);
    },
  });
  route(app, deps, {
    method: "GET", url: "/shipments", auth: "company", body: MineScopeQuery,
    handler: async ({ company }) => {
      const c = needCompany(company);
      const owned = await deps.db.select({ id: shipmentCargo.shipmentId }).from(shipmentCargo).where(or(eq(shipmentCargo.ownerCompanyId, c.id), eq(shipmentCargo.consigneeCompanyId, c.id)));
      const ids = [...new Set(owned.map((x) => x.id))];
      const rows = await deps.db
        .select().from(shipments)
        .where(ids.length ? or(eq(shipments.carrierCompanyId, c.id), inArray(shipments.id, ids)) : eq(shipments.carrierCompanyId, c.id))
        .orderBy(desc(shipments.departedAt)).limit(200);
      return Promise.all(rows.map((s) => shipmentDto(deps.db, s, c.id)));
    },
  });
  route(app, deps, {
    method: "GET", url: "/shipments/:id", auth: "company",
    handler: async ({ company, params }) => {
      const c = needCompany(company);
      const s = (await deps.db.select().from(shipments).where(eq(shipments.id, uuidParam(params.id))))[0];
      if (!s) fail("NOT_FOUND");
      const cargo = await deps.db.select().from(shipmentCargo).where(eq(shipmentCargo.shipmentId, s.id));
      if (s.carrierCompanyId !== c.id && !cargo.some((x) => x.ownerCompanyId === c.id || x.consigneeCompanyId === c.id)) fail("NOT_PARTY");
      return shipmentDto(deps.db, s, c.id);
    },
  });

  route(app, deps, {
    method: "POST", url: "/market/haul", auth: "company", kind: "mutation", body: HaulReq,
    handler: async ({ tx, uow, body, company, now }) => haulForSale(tx, uow, cat, needCompany(company), body, now),
  });

  // ------------------------------------------------------------ taşıma işleri
  route(app, deps, {
    method: "GET", url: "/freight-jobs", auth: "company", body: BoardScopeQuery,
    handler: async ({ body, company, now }) => {
      const c = needCompany(company);
      const rows =
        body.scope === "board"
          ? (await deps.db.select().from(freightJobs).where(eq(freightJobs.status, "open")).orderBy(desc(freightJobs.createdAt)).limit(300)).filter((j) => j.deadlineAt.getTime() > now.getTime())
          : await deps.db.select().from(freightJobs).where(or(eq(freightJobs.shipperCompanyId, c.id), eq(freightJobs.carrierCompanyId, c.id))).orderBy(desc(freightJobs.createdAt)).limit(300);
      return jobDtos(deps.db, cat, rows, c);
    },
  });
  route(app, deps, {
    method: "POST", url: "/freight-jobs", auth: "company", kind: "mutation", body: FreightJobReq,
    handler: async ({ tx, uow, body, company, now }) => {
      const c = needCompany(company);
      return (await jobDtos(tx, cat, [await createFreightJob(tx, uow, cat, c, body, now)], c))[0];
    },
  });
  route(app, deps, {
    method: "POST", url: "/freight-jobs/:id/accept", auth: "company", kind: "mutation", body: AcceptFreightReq,
    handler: async ({ tx, uow, body, company, now, params }) => {
      const c = needCompany(company);
      return (await jobDtos(tx, cat, [await acceptFreightJob(tx, uow, cat, c, uuidParam(params.id), body, now)], c))[0];
    },
  });
  route(app, deps, {
    method: "POST", url: "/freight-jobs/:id/cancel", auth: "company", kind: "mutation", body: CancelReq,
    handler: async ({ tx, uow, body, company, now, params }) => { await cancelFreightJob(tx, uow, needCompany(company), uuidParam(params.id), body, now); return { ok: true }; },
  });
  route(app, deps, {
    method: "GET", url: "/freight/quote", auth: "company", body: FreightQuoteQuery,
    handler: async ({ body, company, now }) => freightQuote(deps.db, cat, needCompany(company).id, body, now),
  });
  void companyBriefs;
}

/** Zamanlayıcı görevleri. Sıra önemlidir: önce varışlar, sonra taksit kapanışları. */
export function tasks(): void {
  registerTask({ name: "b.shipments.arrive", everyMs: 0, run: (d, now) => processArrivals(d, now) });
  registerTask({ name: "b.contracts.windows", everyMs: 0, run: (d, now) => openWindows(d, now) });
  registerTask({ name: "b.contracts.close", everyMs: 5_000, run: (d, now) => closeInstallments(d, now) });
  registerTask({ name: "b.contracts.expire", everyMs: 30_000, run: (d, now) => expireProposals(d, now) });
  registerTask({ name: "b.freight.expire", everyMs: 30_000, run: (d, now) => expireJobs(d, now) });
  registerTask({ name: "b.system.cycle", everyMs: 60_000, run: (d, now) => runSystemCycle(d, now) });
  registerTask({ name: "b.prices.update", everyMs: 60_000, run: (d, now) => updatePriceRefs(d, now) });
}
