/**
 * Günlük bakım (bina seviyesi + araç) ve saatlik şirket snapshot'ı.
 * Bakım nakitle ödenir; yetmeyen kısım arrears'a yazılır ve bildirim gider.
 */
import { and, eq, isNull, lte, ne, sql } from "drizzle-orm";
import type { Catalog } from "../catalog/catalog";
import type { Tx } from "../db/client";
import { companies, facilities, vehicles } from "../db/schema";
import type { Deps } from "../deps";
import { withTx } from "../deps";
import type { UnitOfWork } from "../events/bus";
import { co, post } from "../ledger/post";
import { notify } from "../lib/notify";
import { m } from "../lib/serialize";
import { lockAccounts } from "./locks";

const DAY_MS = 86_400_000;

export async function dailyUpkeepFor(tx: Tx, catalog: Catalog, companyId: string): Promise<bigint> {
  let total = 0n;
  const fs = await tx.select({ type: facilities.type, level: facilities.level }).from(facilities).where(and(eq(facilities.companyId, companyId), eq(facilities.state, "ready")));
  for (const f of fs) total += BigInt(catalog.levelDef(f.type, f.level).upkeepPerDay);
  const vs = await tx.select({ modelId: vehicles.modelId }).from(vehicles).where(and(eq(vehicles.companyId, companyId), ne(vehicles.status, "sold")));
  for (const v of vs) total += BigInt(catalog.vehicleModel(v.modelId).upkeepPerDay);
  return total;
}

async function chargeUpkeep(tx: Tx, uow: UnitOfWork, catalog: Catalog, companyId: string, now: Date): Promise<number> {
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const c = (
      await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.isSystem, false), isNull(companies.dissolvedAt), lte(companies.nextUpkeepAt, now)))
        .for("update", { skipLocked: true })
    )[0];
    if (!c) break;
    const due = c.nextUpkeepAt;
    const u = await dailyUpkeepFor(tx, catalog, companyId);
    if (u > 0n) {
      const bal = await lockAccounts(tx, companyId, ["cash", "arrears"]);
      const cash = bal.cash ?? 0n;
      const paid = cash < u ? cash : u;
      const unpaid = u - paid;
      await post(tx, {
        kind: "upkeep", idempotencyKey: `upkeep:${companyId}:${due.toISOString()}`, refType: "company", refId: companyId, at: now,
        memo: "Günlük bakım",
        lines: [
          { account: co(companyId, "exp_upkeep"), amount: u },
          { account: co(companyId, "cash"), amount: -paid },
          { account: co(companyId, "arrears"), amount: -unpaid },
        ],
      });
      if (unpaid > 0n) {
        await notify(tx, uow, companyId, "upkeep_missed", { amount: m(unpaid), arrears: m(-((bal.arrears ?? 0n) - unpaid)) }, now, "/play?tab=finance");
      }
      uow.invalidate(companyId, "company", "finance");
    }
    await tx.update(companies).set({ nextUpkeepAt: new Date(due.getTime() + DAY_MS) }).where(eq(companies.id, companyId));
    days++;
  }
  return days;
}

export async function upkeepTask(deps: Deps, now: Date): Promise<number> {
  const due = await deps.db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.isSystem, false), isNull(companies.dissolvedAt), lte(companies.nextUpkeepAt, now)))
    .orderBy(companies.nextUpkeepAt)
    .limit(200);
  let n = 0;
  for (const c of due) {
    try {
      n += await withTx(deps, (tx, uow) => chargeUpkeep(tx, uow, deps.catalog, c.id, now));
    } catch (err) {
      deps.log.error({ err, companyId: c.id }, "günlük bakım işlenemedi");
    }
  }
  return n;
}

/** Saatlik net değer görüntüsü: nakit + stok + wip + emanet + peşin navlun + sabit kıymet − kredi − arrears. */
export async function snapshotTask(deps: Deps, now: Date): Promise<number> {
  const at = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const r = await deps.db.execute(sql`
    INSERT INTO cf.company_snapshots (company_id, at, cash, net_worth)
    SELECT c.id, ${at.toISOString()}::timestamptz,
           coalesce(sum(a.balance) FILTER (WHERE a.code = 'cash'), 0),
           coalesce(sum(a.balance) FILTER (WHERE a.code IN ('cash','inventory','wip','escrow','prepaid_freight','fixed_assets','loans','arrears')), 0)
    FROM cf.companies c LEFT JOIN cf.ledger_accounts a ON a.company_id = c.id
    WHERE c.is_system = false AND c.dissolved_at IS NULL
    GROUP BY c.id
    ON CONFLICT DO NOTHING
    RETURNING company_id`);
  return (r as unknown as unknown[]).length;
}
