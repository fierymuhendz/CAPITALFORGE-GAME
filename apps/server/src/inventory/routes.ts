import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { MovementsQuery, type CostBreakdownDto, type HoldingDto, type MovementDto } from "@capitalforge/shared";
import { avgUnitCost } from "@capitalforge/economy";
import { holdings, inventoryMovements } from "../db/schema";
import type { Deps } from "../deps";
import { route } from "../http/route";
import { m } from "../lib/serialize";

export function registerInventoryRoutes(app: FastifyInstance, deps: Deps): void {
  route(app, deps, {
    method: "GET", url: "/inventory", auth: "company",
    handler: async ({ company }): Promise<HoldingDto[]> => {
      const rows = await deps.db
        .select()
        .from(holdings)
        .where(and(eq(holdings.companyId, company!.id), gt(holdings.qtyKg, 0)))
        .orderBy(holdings.cityId, holdings.productId, holdings.quality);
      return rows.map((h) => ({
        cityId: h.cityId, productId: h.productId, quality: h.quality, qtyKg: h.qtyKg, reservedKg: h.reservedKg, availableKg: h.qtyKg - h.reservedKg,
        costTotal: m(h.costTotal), avgCostPerKg: m(avgUnitCost(h.qtyKg, h.costTotal)), avgCostPerTonne: m(avgUnitCost(h.qtyKg, h.costTotal, 1000)),
      }));
    },
  });
  route(app, deps, {
    method: "GET", url: "/inventory/movements", auth: "company", body: MovementsQuery,
    handler: async ({ company, body }): Promise<MovementDto[]> => {
      const rows = await deps.db
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.companyId, company!.id),
            body.productId ? eq(inventoryMovements.productId, body.productId) : undefined,
            body.cityId ? eq(inventoryMovements.cityId, body.cityId) : undefined,
            body.quality ? eq(inventoryMovements.quality, body.quality) : undefined,
          ),
        )
        .orderBy(desc(inventoryMovements.createdAt), sql`${inventoryMovements.id} desc`)
        .limit(200);
      return rows.map((r) => ({
        id: r.id, at: r.createdAt.toISOString(), kind: r.kind, cityId: r.cityId, productId: r.productId, quality: r.quality,
        qtyKg: r.qtyKg, cost: m(r.cost), refType: r.refType, refId: r.refId, breakdown: (r.breakdown as CostBreakdownDto | null) ?? null,
      }));
    },
  });
}
