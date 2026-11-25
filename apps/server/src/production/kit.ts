/** Modül A entegrasyon testleri için ortak yardımcılar (yalnızca testler içe aktarır). */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withTx } from "../deps";
import { companies } from "../db/schema";
import { addStock } from "../inventory/holdings";
import { co, post } from "../ledger/post";
import type { Harness, Player } from "../test/harness";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface Founded {
  p: Player;
  companyId: string;
  facilityId: string;
  plot: { id: string; deposit: null | { kind: "iron" | "coal" } };
  cityId: string;
}

export async function found(h: Harness, sector: string, cityId: string, starterBuilding?: "food_plant" | "steel_mill"): Promise<Founded> {
  const p = await h.player();
  // Uygun (seviye 1, bütçeye uyan, boş) arsa kalmadıysa diğer şehirlere bak
  const order = [cityId, ...["yesilova", "kavsak", "korfezkent", "akyayla", "demirdag"].filter((c) => c !== cityId)];
  let plot: { id: string; deposit: null | { kind: "iron" | "coal" } } | undefined;
  for (const c of order) {
    const ob = await p.ok("GET", `/world/onboarding?cityId=${c}&sector=${sector}${starterBuilding ? `&starterBuilding=${starterBuilding}` : ""}`);
    plot = ob.plots.find((x: { eligible: boolean }) => x.eligible);
    if (plot) { cityId = c; break; }
  }
  if (!plot) throw new Error(`uygun arsa yok ${sector}/${cityId}`);
  const r = await p.ok("POST", "/company", {
    name: `Firma ${Math.random().toString(36).slice(2, 8)}`, cityId, sector, plotId: plot.id, starterBuilding, idempotencyKey: h.key(),
  });
  return { p, companyId: r.companyId, facilityId: r.facilityId, plot, cityId };
}

export async function grantCash(h: Harness, companyId: string, amount: bigint): Promise<void> {
  await withTx(h.deps, (tx) =>
    post(tx, {
      kind: "test_grant", idempotencyKey: `test:${randomUUID()}`, at: h.deps.clock.now(), memo: "test",
      lines: [{ account: co(companyId, "cash"), amount }, { account: co(companyId, "equity"), amount: -amount }],
    }),
  );
}

export async function grantStock(h: Harness, companyId: string, cityId: string, productId: string, quality: number, kg: number, cost: bigint): Promise<void> {
  await withTx(h.deps, async (tx) => {
    const at = h.deps.clock.now();
    const t = await post(tx, {
      kind: "test_grant", idempotencyKey: `test:${randomUUID()}`, at, memo: "test",
      lines: [{ account: co(companyId, "inventory"), amount: cost }, { account: co(companyId, "equity"), amount: -cost }],
    });
    await addStock(tx, { companyId, cityId, productId, quality }, kg, cost, { kind: "test_grant", at, transactionId: t.id });
  });
}

/** Nakdi sıfırla (gider olarak yaz) */
export async function drainCash(h: Harness, companyId: string): Promise<void> {
  await withTx(h.deps, async (tx) => {
    const r = (await tx.execute(sql`SELECT balance::text b FROM cf.ledger_accounts WHERE company_id = ${companyId} AND code = 'cash'`)) as unknown as Array<{ b: string }>;
    const bal = BigInt(r[0]!.b);
    if (bal > 0n) {
      await post(tx, {
        kind: "test_drain", idempotencyKey: `test:${randomUUID()}`, at: h.deps.clock.now(), memo: "test",
        lines: [{ account: co(companyId, "cash"), amount: -bal }, { account: co(companyId, "exp_other"), amount: bal }],
      });
    }
  });
}

export async function setLevel(h: Harness, companyId: string, level: number): Promise<void> {
  await h.deps.db.update(companies).set({ level }).where(eq(companies.id, companyId));
}

export async function balance(h: Harness, companyId: string, code: string): Promise<bigint> {
  const r = (await h.deps.db.execute(sql`SELECT balance::text b FROM cf.ledger_accounts WHERE company_id = ${companyId} AND code = ${code}`)) as unknown as Array<{ b: string }>;
  return BigInt(r[0]?.b ?? "0");
}

export const money = (v: string | bigint): bigint => BigInt(v);
