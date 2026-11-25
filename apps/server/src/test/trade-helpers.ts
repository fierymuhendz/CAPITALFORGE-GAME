import { and, eq } from "drizzle-orm";
import { addStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import { holdings, ledgerAccounts } from "../db/schema";
import type { Harness, Player } from "./harness";

let n = 0;
export async function found(h: Harness, p: Player, sector: string, cityId: string, starterBuilding?: string): Promise<string> {
  const ob = await p.ok("GET", `/world/onboarding?cityId=${cityId}&sector=${sector}${starterBuilding ? `&starterBuilding=${starterBuilding}` : ""}`);
  const plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
  if (!plot) throw new Error(`uygun arsa yok ${cityId}/${sector}`);
  n++;
  const r = await p.ok("POST", "/company", { name: `Firma ${n} ${Math.random().toString(36).slice(2, 6)}`, cityId, sector, plotId: plot.id, starterBuilding, idempotencyKey: h.key() });
  return r.companyId as string;
}

export async function grantStock(h: Harness, companyId: string, cityId: string, productId: string, quality: number, kg: number, unitCost = 100n): Promise<void> {
  const cost = unitCost * BigInt(kg);
  await h.deps.db.transaction(async (tx) => {
    await addStock(tx, { companyId, cityId, productId, quality }, kg, cost, { kind: "test_grant", at: h.deps.clock.now() });
    await post(tx, { kind: "test_grant", idempotencyKey: `grant:${companyId}:${h.key()}`, at: h.deps.clock.now(), lines: [{ account: co(companyId, "inventory"), amount: cost }, { account: co(companyId, "equity"), amount: -cost }] });
  });
}

export async function bal(h: Harness, companyId: string, code: string): Promise<bigint> {
  const r = await h.deps.db.select({ b: ledgerAccounts.balance }).from(ledgerAccounts).where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, code)));
  return r[0]?.b ?? 0n;
}

export async function holding(h: Harness, companyId: string, cityId: string, productId: string, quality: number) {
  const r = await h.deps.db.select().from(holdings).where(and(eq(holdings.companyId, companyId), eq(holdings.cityId, cityId), eq(holdings.productId, productId), eq(holdings.quality, quality)));
  return { qty: r[0]?.qtyKg ?? 0, reserved: r[0]?.reservedKg ?? 0, cost: r[0]?.costTotal ?? 0n };
}

export const withKey = <T extends object>(h: Harness, body: T) => ({ ...body, idempotencyKey: h.key() });
export const HOUR = 3_600_000;
